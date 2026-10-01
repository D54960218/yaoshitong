import { base64ToBlobUrl } from "./image";

/**
 * 浏览器端语音播放器（分段队列 + 文本缓存）。
 *
 * 设计目标（两个都是"少等"，但绝不乱序）：
 * 1. 提前开口：识别结果按内容切成数段，所有段同时发去合成（并行省时间）；
 *    但播放严格按段号顺序——第一段一好立刻播，后面的段即使先合成完，也排队等前面的播完。
 * 2. 重复秒开：同一段文字的音频按文本缓存（key 含方言开关），
 *    「再读一遍」「播放这条回答」第二次点击不再请求语音服务。
 *
 * 只在浏览器使用（依赖 fetch/Audio），服务端勿引。
 */

export type SpeakStatus = "idle" | "loading" | "playing";

/** 一段要朗读的内容：text 必传，vol 可选（禁忌/注意事项等安全内容提高音量） */
export interface SpeakSegment {
  text: string;
  /** 音量倍率，缺省用服务端默认（当前 2.0）；安全内容传更大的值。服务端会 clamp 到 0.1–5.0 */
  vol?: number;
  /** 播这段之前先停多少毫秒（用于祝语和提问引导之间的换气停顿） */
  pauseBeforeMs?: number;
}

/** 语音文本 → base64 音频的内存缓存 */
const audioCache = new Map<string, Promise<string>>();

function cacheKey(text: string, boost?: string, vol?: number): string {
  return `${boost ?? ""}|${vol ?? 1}|${text}`;
}

/** 取一段文字的音频：命中缓存直接返回；失败的不留缓存，下次可重试 */
async function fetchAudio(text: string, boost?: string, vol?: number): Promise<string> {
  const key = cacheKey(text, boost, vol);
  const cached = audioCache.get(key);
  if (cached) return cached;
  const req = (async () => {
    const res = await fetch("/api/tts", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        text,
        ...(boost ? { language_boost: boost } : {}),
        ...(vol && vol !== 1 ? { vol } : {}),
      }),
    });
    const data = (await res.json().catch(() => ({}))) as { audio?: string; error?: string };
    if (!res.ok || !data.audio) {
      throw new Error(data.error || "语音生成失败，请检查网络后重点「语音播报」");
    }
    return data.audio;
  })();
  audioCache.set(key, req);
  req.catch(() => audioCache.delete(key));
  return req;
}

export class TtsPlayer {
  /** 各段状态（下标即段号）：合成中的 promise 或已到手的临时链接 */
  private slots: Array<Promise<string> | string | null> = [];
  /** 各段的元信息（音量、段前停顿），下标与 slots 对齐 */
  private meta: SpeakSegment[] = [];
  /** 下一次要播的段号 */
  private nextToPlay = 0;
  private audio: HTMLAudioElement | null = null;
  /** pump 正在等某段合成完成（防止多个 pump 同时醒来抢播同一段） */
  private waiting = false;
  /** 等待期间又有段合成完，等完这一轮要再看一次 */
  private needsPump = false;
  /** 代次标记：stop() 后旧代次的迟到的音频直接丢弃 */
  private generation = 0;

  onStatus: (s: SpeakStatus) => void = () => {};
  onError: (msg: string) => void = () => {};

  /** 分段朗读：全部段同时合成（快），但播放严格按段号顺序（不乱）；每段可带音量 */
  async speak(segments: Array<string | SpeakSegment>, boost?: string) {
    const list: SpeakSegment[] = segments
      .map((s) => (typeof s === "string" ? { text: s } : s))
      .map((s) => ({ ...s, text: s.text.trim() }))
      .filter((s) => s.text);
    if (list.length === 0) return;
    this.stop();
    const gen = this.generation;
    this.onStatus("loading");
    this.slots = list.map(() => null);
    this.meta = list;
    this.nextToPlay = 0;

    // 并行合成所有段；完成后把 promise 填进自己的槽位，尝试推进播放
    list.forEach((seg, i) => {
      const p = fetchAudio(seg.text, boost, seg.vol)
        .then((b64) => base64ToBlobUrl(b64))
        .catch((e) => {
          if (this.generation !== gen) throw e;
          this.onError(e instanceof Error ? e.message : "语音生成失败，请检查网络后重试");
          // 失败段标记为已完成（resolve 空串），播放时会跳过
          return "";
        });
      this.slots[i] = p;
      p.then(() => {
        if (this.generation === gen) this.pump(gen);
      });
    });
  }

  /** 停止：掐断当前音频、清空全部槽位、让迟到的合成结果失效 */
  stop() {
    this.generation += 1;
    for (const s of this.slots) {
      // 已到手未播的链接要吊销，避免内存泄漏
      if (typeof s === "string") URL.revokeObjectURL(s);
    }
    this.slots = [];
    this.meta = [];
    this.nextToPlay = 0;
    this.waiting = false;
    this.needsPump = false;
    if (this.audio) {
      this.audio.pause();
      this.audio.src = "";
      this.audio = null;
    }
    this.onStatus("idle");
  }

  private async pump(gen: number) {
    // 有音频在播 / 已换代次 / 没有槽位：都不动
    if (this.generation !== gen || this.audio || this.slots.length === 0) return;
    // 已有 pump 在等某段合成：记下"待会再看"，由那个 pump 统一推进
    if (this.waiting) {
      this.needsPump = true;
      return;
    }

    const i = this.nextToPlay;
    const slot = this.slots[i];
    if (slot === null || slot === undefined) {
      // 所有段都播完，收工
      this.onStatus("idle");
      return;
    }

    if (typeof slot === "string") {
      this.playSlot(slot, gen);
      return;
    }

    // 该段还在合成：原地等它（顺序的门就在这里），好了继续
    this.waiting = true;
    const url = await slot;
    this.waiting = false;
    if (this.generation !== gen) {
      URL.revokeObjectURL(url);
      return;
    }
    this.slots[i] = url;
    this.playSlot(url, gen);
    // 等待期间若有别的段也好了，补一次推进
    if (this.needsPump) {
      this.needsPump = false;
      this.pump(gen);
    }
  }

  private playSlot(url: string, gen: number) {
    // 失败段是空串：跳过，直接看下一段
    if (!url) {
      this.slots[this.nextToPlay] = null;
      this.nextToPlay += 1;
      this.pump(gen);
      return;
    }
    const audio = new Audio(url);
    this.audio = audio;
    let started = false;
    let fallbackTimer: ReturnType<typeof setTimeout> | null = null;
    const advance = () => {
      if (fallbackTimer) clearTimeout(fallbackTimer);
      URL.revokeObjectURL(url);
      if (this.audio === audio) this.audio = null;
      if (this.generation !== gen) return;
      this.slots[this.nextToPlay] = null;
      this.nextToPlay += 1;
      // 下一段若标了"段前停顿"（如祝语后停 4 秒再引导提问），先等再播
      const pause = this.meta[this.nextToPlay]?.pauseBeforeMs ?? 0;
      if (pause > 0) {
        setTimeout(() => {
          if (this.generation === gen) this.pump(gen);
        }, pause);
      } else {
        this.pump(gen);
      }
    };
    audio.onended = advance;
    audio.onerror = advance;

    // 开头截断修复：等音频"可以完整播放"再出声。
    // 直接 play() 会从已缓冲的位置开始放，前面没缓冲到的部分就被吃掉——
    // 第一段/第一句听起来就像从中间开始。canplaythrough 触发说明整段已就绪。
    const startPlay = () => {
      if (started) return;
      started = true;
      if (fallbackTimer) clearTimeout(fallbackTimer);
      audio.oncanplaythrough = null; // 只清启动监听器，onended/onerror 要留着
      if (this.generation !== gen) return;
      audio.play().catch(() => {
        URL.revokeObjectURL(url);
        if (this.audio === audio) this.audio = null;
        this.onError("语音播放出错了，请再点一次「语音播报」");
        this.onStatus("idle");
      });
      this.onStatus("playing");
    };
    audio.oncanplaythrough = startPlay;
    // 兜底：个别浏览器不发 canplaythrough，3 秒后硬播（宁可开头稳也不卡死）
    fallbackTimer = setTimeout(() => {
      if (!started && this.audio === audio) startPlay();
    }, 3000);
    // 显式触发加载（部分浏览器对 blob 链接不自动预载）
    audio.load();
  }
}

/** 全局唯一播放器（页面任意处点播报/停止都作用于同一个队列） */
export const ttsPlayer = new TtsPlayer();
