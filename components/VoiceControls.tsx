"use client";

import type { VoiceStatus } from "@/lib/types";

interface Props {
  status: VoiceStatus;
  onSpeak: () => void;
  onStop: () => void;
}

function SpeakerIcon() {
  return (
    <svg
      width="28"
      height="28"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d="M4 9.5v5h3.5L12 18.5v-13L7.5 9.5H4Z" />
      <path d="M15.5 9a4.3 4.3 0 0 1 0 6" />
      <path d="M18 6.5a8 8 0 0 1 0 11" />
    </svg>
  );
}

function StopIcon() {
  return (
    <svg width="26" height="26" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
      <rect x="6.5" y="6.5" width="11" height="11" rx="2" />
    </svg>
  );
}

function ReplayIcon() {
  return (
    <svg
      width="24"
      height="24"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d="M4 10a8 8 0 1 1 2 6" />
      <path d="M4 15v-5h5" />
    </svg>
  );
}

export default function VoiceControls({ status, onSpeak, onStop }: Props) {
  if (status === "loading") {
    return (
      <button type="button" disabled className="btn min-h-[68px] bg-[var(--color-primary-tint)] text-[23px] text-[var(--color-primary-deep)]">
        <span className="spinner" style={{ width: 28, height: 28, borderWidth: 3 }} aria-hidden="true" />
        正在生成语音…
      </button>
    );
  }

  if (status === "playing") {
    return (
      <div className="flex gap-3">
        <button type="button" onClick={onStop} className="btn btn-danger flex-1">
          <StopIcon />
          停止播报
        </button>
        <button type="button" onClick={onSpeak} className="btn btn-secondary flex-1">
          <ReplayIcon />
          再读一遍
        </button>
      </div>
    );
  }

  return (
    <button type="button" onClick={onSpeak} className="btn btn-primary min-h-[68px] text-[24px]">
      <SpeakerIcon />
      语音播报
    </button>
  );
}
