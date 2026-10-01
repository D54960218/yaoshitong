"use client";

import UploadButtons from "@/components/UploadButtons";
import SamplePicker from "@/components/SamplePicker";
import ResultCard from "@/components/ResultCard";
import AskPanel from "@/components/AskPanel";
import { fileToCompressedBase64 } from "@/lib/image";
import { ttsPlayer } from "@/lib/tts-client";
import type { SpeakSegment } from "@/lib/tts-client";
import type { Medicine, QaTurn, RecognizeStatus, VoiceStatus } from "@/lib/types";
import { useCallback, useEffect, useState } from "react";

const DISCLAIMER = "本工具仅供参考，不能替代医生和药师。用药请遵医嘱。";

/** 首页「使用前请知晓」完整声明（语音里只念上面的短句，这里展示完整版） */
const DISCLAIMER_ITEMS = [
  "识别和回答都由人工智能生成，可能因拍摄角度、光线、药品包装版本不同而出错，仅供参考。",
  "实际用药请以药盒内的说明书为准，并遵医嘱；本工具不能替代医生和药师。",
  "处方药必须凭医生处方购买和使用，请勿自行加量、减量或停药。",
  "用药后如出现皮疹、胸闷、呼吸困难等不适，请立即停药并尽快就医。",
  "拍摄的照片仅用于本次识别，不会被保存或另作他用。",
];

/**
 * 把识别结果切成六段语音（每段带音量/停顿标记）：
 * 1. 老人最先要听到的——招呼、处方药警示、药名、注射提醒（最短，合成最快，先开口）；
 * 2. 药品信息主体（适应症/用法用量；规格不念，屏幕上有，念了反而打断节奏）；
 * 3. 禁忌 + 注意事项（安全相关，单独一段，音量比整体再高一档）；
 * 4. 贴心叮嘱 + 祝语；
 * 5. AI 声明（信息由人工智能识别生成，以说明书和医嘱为准）；
 * 6. 引导继续提问（与 AI 声明之间停 4 秒，让老人缓一缓）。
 */
function buildSpeechSegments(m: Medicine): SpeakSegment[] {
  const first: string[] = ["您好，我帮您看看这盒药。"];
  if (m.是否处方药) first.push("注意，这是处方药，一定要先问过医生再吃。");
  first.push(`这个药叫${m.药名 || "未知名称"}。`);
  // 注射类药的安全提醒放在最前面念，比具体用法更紧要
  if (m.注射提醒) first.push(m.注射提醒);

  const second: string[] = [];
  // 规格故意不念：老人关心怎么吃，规格（0.25g 这种数字）念出来没意义还打断节奏
  const fields: Array<[string, string]> = [
    ["适应症", m.适应症],
    ["用法用量", m.用法用量],
  ];
  for (const [label, value] of fields) {
    if (value && value !== "说明书未标注") second.push(`${label}，${value}。`);
  }

  // 禁忌和注意事项单独成段：安全相关，提高音量让老人听清
  const safety: string[] = [];
  if (m.禁忌 && m.禁忌 !== "说明书未标注") safety.push(`禁忌，${m.禁忌}。`);
  if (m.注意事项 && m.注意事项 !== "说明书未标注") safety.push(`注意事项，${m.注意事项}。`);

  const fourth: string[] = [];
  if (m.贴心叮嘱) fourth.push(m.贴心叮嘱);
  fourth.push("祝您身体健康，一天比一天舒坦。");

  // 祝语之后、引导提问之前，单独念一遍 AI 声明（安全收口，语音里必须有）
  const aiNotice =
    "再跟您声明一句，刚才这些信息都是人工智能从药盒照片里识别出来的，可能不够准确，您以药盒里的说明书和医生说的话为准。";

  // 收尾固定多问一句：引导老人用「继续询问」接着提问（放在全文最后，与 AI 声明之间停 4 秒）
  const fifth = "您还有问题吗？如果有问题，可以随时点击页面下方按钮来问我，您可以直接用方言提问。";

  return [
    { text: first.join("") },
    { text: second.join("") },
    // 禁忌和注意事项单独成段：安全相关，音量比整体（2 倍）再高一档
    { text: safety.join(""), vol: 3.0 },
    { text: fourth.join("") },
    { text: aiNotice },
    { text: fifth, pauseBeforeMs: 4000 },
  ].filter((s) => s.text);
}

export default function Home() {
  const [status, setStatus] = useState<RecognizeStatus>("idle");
  const [errorMsg, setErrorMsg] = useState("");
  const [preview, setPreview] = useState<string | null>(null);
  const [medicine, setMedicine] = useState<Medicine | null>(null);
  const [voice, setVoice] = useState<VoiceStatus>("idle");
  const [voiceError, setVoiceError] = useState("");
  /** 粤语播报开关（存入 localStorage，下次打开还保留） */
  const [useCantonese, setUseCantonese] = useState(false);
  /** 「继续询问」面板开关与多轮问答历史（「重新识别」时整体清空） */
  const [askOpen, setAskOpen] = useState(false);
  const [qaHistory, setQaHistory] = useState<QaTurn[]>([]);

  // 读取"使用粤语"开关的本地记录；把全局播放器的回调接到页面状态上
  useEffect(() => {
    setUseCantonese(localStorage.getItem("yaoshitong-yue") === "1");
    ttsPlayer.onStatus = setVoice;
    ttsPlayer.onError = (msg) => setVoiceError(msg);
    return () => ttsPlayer.stop();
  }, []);

  /** 切换播报语言：true=粤语，false=普通话；本地记住选择 */
  const chooseLanguage = useCallback((yue: boolean) => {
    setUseCantonese(yue);
    localStorage.setItem("yaoshitong-yue", yue ? "1" : "0");
  }, []);

  /** 停止播报：掐断当前语音并清空队列 */
  const stopVoice = useCallback(() => {
    setVoiceError("");
    ttsPlayer.stop();
  }, []);

  /** 分段播报（识别结果用）：第一段到手立刻播，其余自动接龙；每段可带音量/停顿标记 */
  const speakSegments = useCallback(
    (segments: SpeakSegment[]) => {
      setVoiceError("");
      void ttsPlayer.speak(segments, useCantonese ? "Chinese,Yue" : undefined);
    },
    [useCantonese],
  );

  /** 单段播报（问答回答用） */
  const speakText = useCallback(
    (text: string) => {
      speakSegments([{ text }]);
    },
    [speakSegments],
  );

  const recognize = useCallback(
    async (base64: string) => {
      setStatus("recognizing");
      try {
        const res = await fetch("/api/recognize", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ image: base64 }),
        });
        const data = (await res.json().catch(() => ({}))) as Partial<Medicine> & { error?: string };
        if (!res.ok || data.error || !data.药名) {
          // 出错只给老人一句能听懂的话：卡片显示"识别失败"，
          // 语音再说清楚下一步——点下方的红色按钮重试
          setErrorMsg("识别失败");
          setStatus("error");
          void speakText("识别失败，请点击下方红色按钮重试");
          return;
        }
        const result: Medicine = {
          药名: data.药名,
          规格: data.规格 || "说明书未标注",
          适应症: data.适应症 || "说明书未标注",
          用法用量: data.用法用量 || "说明书未标注",
          禁忌: data.禁忌 || "说明书未标注",
          注意事项: data.注意事项 || "说明书未标注",
          贴心叮嘱: data.贴心叮嘱 || "",
          注射提醒: data.注射提醒 || "",
          是否处方药: Boolean(data.是否处方药),
          识别置信度: data.识别置信度 || "中",
          通用信息: data.通用信息,
          数据来源: data.数据来源,
        };
        setMedicine(result);
        setStatus("done");
        void speakSegments(buildSpeechSegments(result));
      } catch {
        setErrorMsg("网络出错了，请确认手机连着网，然后重试");
        setStatus("error");
      }
    },
    [speakSegments, speakText],
  );

  const handleFile = useCallback(
    async (file: File) => {
      if (!file.type.startsWith("image/")) {
        setErrorMsg("请选择图片文件");
        setStatus("error");
        return;
      }
      setErrorMsg("");
      stopVoice();
      setStatus("compressing");
      try {
        const base64 = await fileToCompressedBase64(file);
        setPreview(`data:image/jpeg;base64,${base64}`);
        await recognize(base64);
      } catch (e) {
        setErrorMsg(e instanceof Error ? e.message : "图片处理失败，请重新拍摄");
        setStatus("error");
      }
    },
    [recognize, stopVoice],
  );

  const handleSample = useCallback(
    async (file: string) => {
      setErrorMsg("");
      stopVoice();
      setStatus("compressing");
      try {
        const res = await fetch(`/samples/${file}`);
        if (!res.ok) throw new Error("示例图片加载失败，请刷新页面重试");
        const blob = await res.blob();
        const sampleFile = new File([blob], file, { type: blob.type || "image/jpeg" });
        const base64 = await fileToCompressedBase64(sampleFile);
        setPreview(`data:image/jpeg;base64,${base64}`);
        await recognize(base64);
      } catch (e) {
        setErrorMsg(e instanceof Error ? e.message : "示例图片加载失败，请重试");
        setStatus("error");
      }
    },
    [recognize, stopVoice],
  );

  /** 发送一个提问到 /api/ask；成功后追加进历史并返回答案（失败抛错由面板兜底展示） */
  const ask = useCallback(
    async (question: string) => {
      if (!medicine) throw new Error("请先识别药品，再向我提问");
      const res = await fetch("/api/ask", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          question,
          medicine: {
            药名: medicine.药名,
            规格: medicine.规格,
            适应症: medicine.适应症,
            用法用量: medicine.用法用量,
            禁忌: medicine.禁忌,
            注意事项: medicine.注意事项,
            贴心叮嘱: medicine.贴心叮嘱,
            注射提醒: medicine.注射提醒,
            是否处方药: medicine.是否处方药,
          },
          history: qaHistory.slice(-3),
        }),
      });
      const data = (await res.json().catch(() => ({}))) as { answer?: string; error?: string };
      if (!res.ok || !data.answer) {
        throw new Error(data.error || "回答出错了，请稍后再试");
      }
      const turn: QaTurn = { 问: question, 答: data.answer };
      setQaHistory((h) => [...h, turn]);
      return turn.答;
    },
    [medicine, qaHistory],
  );

  const reset = useCallback(() => {
    stopVoice();
    setMedicine(null);
    setPreview(null);
    setErrorMsg("");
    setAskOpen(false);
    setQaHistory([]);
    setStatus("idle");
  }, [stopVoice]);

  const busy = status === "compressing" || status === "recognizing";

  return (
    <main className="relative z-[1] mx-auto flex min-h-screen w-full max-w-[480px] flex-col px-5 pb-28 pt-8">
      {/* 顶部：衬线大标题 + 一句大白话 */}
      <header className="text-center">
        <h1 className="font-display text-[40px] font-bold tracking-[0.04em] text-[var(--color-primary)]">
          药视通
        </h1>
        <p className="mt-2 text-[20px] text-[var(--color-ink-soft)]">
          拍下药盒，用法用量念给您听
        </p>
      </header>

      {/* 播报语言开关：粤语 / 普通话（选择会记住，下次打开还在） */}
      <div className="lang-row">
        <span className="lang-label">播报语言</span>
        <button
          type="button"
          className={`lang-pill ${useCantonese ? "" : "on"}`}
          aria-pressed={!useCantonese}
          onClick={() => chooseLanguage(false)}
        >
          普通话
        </button>
        <button
          type="button"
          className={`lang-pill ${useCantonese ? "on" : ""}`}
          aria-pressed={useCantonese}
          onClick={() => chooseLanguage(true)}
        >
          粤语
        </button>
      </div>

      {preview && (
        <div className="paper-frame mt-6">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={preview} alt="已上传的药盒照片" />
        </div>
      )}

      {(status === "compressing" || status === "recognizing") && (
        <div className="py-12 text-center" role="status">
          <div className="spinner mx-auto" />
          <p className="loading-text">{status === "compressing" ? "正在处理图片…" : "正在识别，请稍等"}</p>
        </div>
      )}

      {status === "error" && (
        <div className="error-box mt-6" role="alert">
          <p className="error-text">{errorMsg}</p>
          <button type="button" onClick={reset} className="btn btn-danger mt-4">
            重试
          </button>
        </div>
      )}

      {status === "done" && medicine && (
        <div className="card-enter mt-6">
          <ResultCard
            medicine={medicine}
            voice={voice}
            onSpeak={() => speakSegments(buildSpeechSegments(medicine))}
            onStop={stopVoice}
          />
          {voiceError && <p className="error-text mt-3 text-center text-[19px]">{voiceError}</p>}
          <button
            type="button"
            onClick={() => setAskOpen((v) => !v)}
            className={`btn ${askOpen ? "btn-secondary" : "btn-primary"} mt-5`}
          >
            {askOpen ? "收起问题" : "继续询问"}
          </button>
          {askOpen && <AskPanel medicine={medicine} history={qaHistory} onAsk={ask} onSpeak={speakText} />}
          <button type="button" onClick={reset} className="btn btn-secondary mt-5">
            重新识别
          </button>
        </div>
      )}

      {(status === "idle" || status === "error") && (
        <div className="mt-7">
          <UploadButtons disabled={busy} onFile={handleFile} />
          <div className="my-7">
            <SamplePicker disabled={busy} onSelect={handleSample} />
          </div>
          {/* 使用前请知晓：完整免责声明（页脚只放得下一句，完整版放这里） */}
          <div className="notice-card">
            <h2 className="notice-title">使用前请知晓</h2>
            <ul className="notice-list">
              {DISCLAIMER_ITEMS.map((item) => (
                <li key={item}>{item}</li>
              ))}
            </ul>
          </div>
        </div>
      )}

      <footer className="disclaimer fixed inset-x-0 bottom-0">
        <p className="disclaimer-text mx-auto max-w-[480px] px-4 py-3">{DISCLAIMER}</p>
      </footer>
    </main>
  );
}
