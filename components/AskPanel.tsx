"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { AskMicStatus, Medicine, QaTurn } from "@/lib/types";

interface Props {
  medicine: Medicine;
  history: QaTurn[];
  onAsk: (question: string) => Promise<string>;
  onSpeak: (text: string) => void;
}

/** 快捷提问（方言无关的兜底，点一下直接发） */
const QUICK_QUESTIONS = [
  "这药一天吃几次？",
  "饭前还是饭后吃？",
  "能和别的药一起吃吗？",
  "忘了吃怎么办？",
  "这药要吃多久？",
  "这药有什么副作用？",
  "吃药期间不能吃什么？",
  "吃这个药能喝酒吗？",
  "这药要怎么保存？",
  "孕妇和小孩能吃吗？",
];

const RECORDING_LIMIT_MS = 30_000; // 与 glm-asr 单条 ≤30s 对齐

function MicIcon() {
  return (
    <svg width="26" height="26" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <rect x="9" y="2.5" width="6" height="11" rx="3" />
      <path d="M5.5 11a6.5 6.5 0 0 0 13 0" />
      <path d="M12 17.5V21" />
    </svg>
  );
}

function ReplayIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M3 12a9 9 0 1 0 3-6.7" />
      <path d="M3 4v5h5" />
    </svg>
  );
}

export default function AskPanel({ medicine, history, onAsk, onSpeak }: Props) {
  const [micStatus, setMicStatus] = useState<AskMicStatus>("idle");
  const [sending, setSending] = useState(false);
  const [echo, setEcho] = useState("");
  const [error, setError] = useState("");
  const [input, setInput] = useState("");
  const recorderRef = useRef<MediaRecorder | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  const streamRef = useRef<MediaStream | null>(null);
  const limitTimerRef = useRef<number | null>(null);
  const busy = micStatus !== "idle" || sending;

  /** 发送一个提问（chips / 输入框 / 语音回显共用） */
  const sendQuestion = useCallback(
    async (question: string) => {
      const q = question.trim();
      if (!q || sending) return;
      setError("");
      setSending(true);
      try {
        const answer = await onAsk(q);
        setEcho("");
        setInput("");
        onSpeak(answer);
      } catch (e) {
        setError(e instanceof Error ? e.message : "回答出错了，请稍后再试");
      } finally {
        setSending(false);
      }
    },
    [onAsk, onSpeak, sending],
  );

  /** 录音结束后上传转写；回显确认后自动发送 */
  const uploadRecording = useCallback(async () => {
    const chunks = chunksRef.current;
    streamRef.current?.getTracks().forEach((t) => t.stop());
    streamRef.current = null;
    recorderRef.current = null;
    const blob = new Blob(chunks, { type: chunks[0]?.type || "audio/webm" });
    if (blob.size === 0) {
      setMicStatus("idle");
      setError("没录到声音，请靠近手机再说一遍");
      return;
    }
    setMicStatus("recognizing");
    try {
      const form = new FormData();
      form.append("file", blob, blob.type.includes("mp4") ? "question.m4a" : "question.webm");
      const res = await fetch("/api/ask-audio", { method: "POST", body: form });
      const data = (await res.json().catch(() => ({}))) as { text?: string; error?: string };
      if (!res.ok || !data.text) {
        throw new Error(data.error || "没听清您说的话，请靠近手机再说一遍");
      }
      setMicStatus("idle");
      setEcho(`您问的是：${data.text}`);
      void sendQuestion(data.text);
    } catch (e) {
      setMicStatus("idle");
      setError(e instanceof Error ? e.message : "语音转文字出错了，请再说一遍");
    }
  }, [sendQuestion]);

  const stopRecording = useCallback(() => {
    if (limitTimerRef.current) {
      window.clearTimeout(limitTimerRef.current);
      limitTimerRef.current = null;
    }
    if (recorderRef.current && recorderRef.current.state !== "inactive") {
      recorderRef.current.stop(); // 收尾在 onstop → uploadRecording
    }
  }, []);

  const startRecording = useCallback(async () => {
    setError("");
    setEcho("");
    if (!navigator.mediaDevices?.getUserMedia || typeof MediaRecorder === "undefined") {
      setError("当前浏览器不支持语音提问，可以用下面的文字输入");
      return;
    }
    let stream: MediaStream;
    try {
      stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    } catch {
      setError("没能打开麦克风，请在浏览器设置里允许使用麦克风后再试");
      return;
    }
    streamRef.current = stream;
    chunksRef.current = [];
    // iOS Safari 不支持 webm 时 isTypeSupported 返回 false，传 undefined 走系统默认（mp4/aac）
    const mimeType = MediaRecorder.isTypeSupported("audio/webm;codecs=opus")
      ? "audio/webm;codecs=opus"
      : "";
    const recorder = new MediaRecorder(stream, mimeType ? { mimeType } : undefined);
    recorderRef.current = recorder;
    recorder.ondataavailable = (e) => {
      if (e.data.size > 0) chunksRef.current.push(e.data);
    };
    recorder.onstop = () => {
      void uploadRecording();
    };
    recorder.start();
    setMicStatus("recording");
    limitTimerRef.current = window.setTimeout(() => {
      setEcho("一次最多说 30 秒，已经帮您停下来了，正在听…");
      stopRecording();
    }, RECORDING_LIMIT_MS);
  }, [stopRecording, uploadRecording]);

  const toggleRecording = useCallback(() => {
    if (micStatus === "recording") {
      stopRecording();
    } else if (micStatus === "idle" && !sending) {
      void startRecording();
    }
  }, [micStatus, sending, startRecording, stopRecording]);

  // 卸载清理：定时器、录音、媒体轨道
  useEffect(
    () => () => {
      if (limitTimerRef.current) window.clearTimeout(limitTimerRef.current);
      if (recorderRef.current && recorderRef.current.state !== "inactive") {
        recorderRef.current.stop();
      }
      streamRef.current?.getTracks().forEach((t) => t.stop());
    },
    [],
  );

  return (
    <section className="ask-panel card-enter" aria-label="继续询问">
      <div className="sheet-head">
        <h2 className="sheet-title">继续询问</h2>
        <p className="sheet-note">{medicine.药名}</p>
      </div>

      <p className="ask-tip">支持主要方言与口音普通话，点下面话筒直接问</p>

      <div className="ask-chips">
        {QUICK_QUESTIONS.map((q) => (
          <button
            key={q}
            type="button"
            className="ask-chip"
            disabled={busy}
            onClick={() => void sendQuestion(q)}
          >
            {q}
          </button>
        ))}
      </div>

      <button
        type="button"
        className={`btn ask-mic ${micStatus === "recording" ? "recording" : "btn-primary"}`}
        onClick={toggleRecording}
        disabled={micStatus === "recognizing" || sending}
        aria-pressed={micStatus === "recording"}
      >
        <span className="ask-mic-icon">{micStatus === "recognizing" ? <span className="spinner" /> : <MicIcon />}</span>
        <span>
          {micStatus === "recording"
            ? "点一下结束，最长 30 秒"
            : micStatus === "recognizing"
              ? "正在听…"
              : "继续问用法"}
        </span>
      </button>

      {echo && <p className="ask-echo">{echo}</p>}
      {error && <p className="error-text">{error}</p>}
      {sending && <p className="ask-echo">正在想怎么回答您…</p>}

      {history.length > 0 && (
        <div className="ask-bubbles">
          {history.map((turn, i) => (
            <div key={i} className="ask-turn">
              <p className="ask-q">{turn.问}</p>
              <div className="ask-a">
                <p>{turn.答}</p>
                <div className="ask-a-foot">
                  <button
                    type="button"
                    className="ask-speak"
                    onClick={() => onSpeak(turn.答)}
                    aria-label="播放这条回答"
                  >
                    <ReplayIcon />
                    播放
                  </button>
                </div>
              </div>
            </div>
          ))}
        </div>
      )}

      <div className="ask-input-row">
        <input
          className="ask-input"
          value={input}
          onChange={(e) => setInput(e.target.value)}
          placeholder="家里人也可以打字提问"
          maxLength={200}
          disabled={busy}
          onKeyDown={(e) => {
            if (e.key === "Enter" && input.trim()) void sendQuestion(input);
          }}
        />
        <button
          type="button"
          className="btn btn-secondary ask-send"
          disabled={busy || !input.trim()}
          onClick={() => void sendQuestion(input)}
        >
          发送
        </button>
      </div>

      <p className="ask-disclaimer">本回答仅供参考，具体请遵医嘱。</p>
    </section>
  );
}
