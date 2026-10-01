import { NextRequest, NextResponse } from "next/server";
import { normalizeUnitsForSpeech } from "@/lib/text-guard";
import { guardApiRequest } from "@/lib/server-guard";

export const maxDuration = 60;

const MINIMAX_URL = "https://api-bj.minimaxi.com/v1/t2a_v2";
const MAX_TEXT_LENGTH = 800;

/**
 * MiniMax 支持的 language_boost 取值（官方文档原文枚举）。
 * 中文相关的方言**只有粤语**（Chinese,Yue）；四川话/东北话/湖北话等暂不支持。
 * 设成 auto 则由模型自行判断语种。
 */
const SUPPORTED_LANGUAGE_BOOST = new Set([
  "Chinese", "Chinese,Yue", "English", "Arabic", "Russian", "Spanish", "French", "Portuguese",
  "German", "Turkish", "Dutch", "Ukrainian", "Vietnamese", "Indonesian", "Japanese", "Italian",
  "Korean", "Thai", "Polish", "Romanian", "Greek", "Czech", "Finnish", "Hindi", "Bulgarian",
  "Danish", "Hebrew", "Malay", "Persian", "Slovak", "Swedish", "Croatian", "Filipino",
  "Hungarian", "Norwegian", "Slovenian", "Catalan", "Nynorsk", "Tamil", "Afrikaans", "auto",
]);

/** 读环境变量并做白名单校验，非法值直接忽略（避免把错误参数发给语音服务）。
 *  @param override 前端首页"使用粤语"开关传进来的值；合法则优先，缺省用环境变量默认值 */
function resolveLanguageBoost(override?: string): string {
  const raw = (override ?? process.env.TTS_LANGUAGE_BOOST ?? "Chinese").trim();
  if (SUPPORTED_LANGUAGE_BOOST.has(raw)) return raw;
  console.warn(`[tts] language_boost="${raw}" 不在支持列表里，已回退为 Chinese`);
  return "Chinese";
}

/** 语速：老人听不清可以把字调慢，范围 0.5–2.0，默认 0.9（比正常稍慢） */
function resolveSpeed(): number {
  const value = Number(process.env.TTS_SPEED ?? "0.9");
  if (!Number.isFinite(value)) return 0.9;
  return Math.min(2, Math.max(0.5, value));
}

/** 音量：整体默认 2.0（老人听力弱，用户要求整体调大）；
 *  前端可给单段再提音量（禁忌/注意事项传 3.0），范围 0.1–5.0，非法值回退 2.0 */
function resolveVol(raw: unknown): number {
  const value = Number(raw ?? 2.0);
  if (!Number.isFinite(value)) return 2.0;
  return Math.min(5, Math.max(0.1, value));
}

/** MiniMax 返回的音频是 hex 字符串，转成 base64 方便前端直接播放 */
function hexToBase64(hex: string): string {
  return Buffer.from(hex, "hex").toString("base64");
}

export async function POST(req: NextRequest) {
  // 防滥用：来源检查 + 按 IP 限流（详见 lib/server-guard.ts）
  const blocked = guardApiRequest(req, "tts");
  if (blocked) return blocked;

  try {
    const apiKey = process.env.MINIMAX_API_KEY;
    if (!apiKey) {
      return NextResponse.json(
        { error: "服务器还没配置 MiniMax API Key，请按 README.md 的说明填写 .env.local 后重启" },
        { status: 500 },
      );
    }

    let body: unknown;
    try {
      body = await req.json();
    } catch {
      return NextResponse.json({ error: "请求格式不对，请刷新页面重试" }, { status: 400 });
    }

    let text = String((body as Record<string, unknown>)?.text ?? "").trim();
    if (!text) {
      return NextResponse.json({ error: "没有要朗读的内容" }, { status: 400 });
    }
    // 单位符号换成中文单位名：0.3g 念"零点三克"而不是"零点三寄"（只影响语音，不影响屏幕显示）
    text = normalizeUnitsForSpeech(text);
    if (text.length > MAX_TEXT_LENGTH) {
      text = `${text.slice(0, MAX_TEXT_LENGTH)}。`;
    }

    const groupId = process.env.MINIMAX_GROUP_ID;
    const res = await fetch(MINIMAX_URL, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
        // 部分 MiniMax 账号要求必须带 GroupId 请求头
        ...(groupId ? { GroupId: groupId } : {}),
      },
      body: JSON.stringify({
        model: "speech-2.6-turbo",
        text,
        stream: false,
        // 语种/方言增强：粤语填 Chinese,Yue；不确定填 auto。优先用前端开关传来的值。
        language_boost: resolveLanguageBoost(String((body as Record<string, unknown>)?.language_boost ?? "")),
        voice_setting: {
          voice_id: process.env.TTS_VOICE_ID || "male-qn-jingying",
          speed: resolveSpeed(),
          vol: resolveVol((body as Record<string, unknown>)?.vol),
          pitch: 0,
        },
        audio_setting: {
          sample_rate: 24000,
          bitrate: 128000,
          format: "mp3",
          channel: 1,
        },
      }),
      signal: AbortSignal.timeout(45000),
    });

    const data = (await res.json().catch(() => null)) as {
      data?: { audio?: string };
      base_resp?: { status_code?: number; status_msg?: string };
      message?: string;
    } | null;

    const baseResp = data?.base_resp;
    if (!res.ok || (baseResp && baseResp.status_code !== 0)) {
      let msg = baseResp?.status_msg || data?.message || "";
      if (res.status === 401) msg = "MiniMax API Key 无效，请检查 .env.local 里的 MINIMAX_API_KEY";
      if (!msg) msg = "语音服务暂时不可用，请稍后再试";
      if (/group/i.test(msg) && !groupId) {
        msg += "（提示：请在 .env.local 里补充 MINIMAX_GROUP_ID）";
      }
      return NextResponse.json({ error: msg }, { status: 502 });
    }

    const audioHex = data?.data?.audio;
    if (!audioHex) {
      return NextResponse.json({ error: "语音服务没有返回音频，请稍后再试" }, { status: 502 });
    }

    return NextResponse.json({ audio: hexToBase64(audioHex), format: "mp3" });
  } catch (e) {
    console.error("[tts] 未预期的错误:", e);
    return NextResponse.json({ error: "语音出错了，请稍后再试" }, { status: 500 });
  }
}
