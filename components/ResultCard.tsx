"use client";

import VoiceControls from "@/components/VoiceControls";
import type { Medicine, VoiceStatus } from "@/lib/types";

interface Props {
  medicine: Medicine;
  voice: VoiceStatus;
  onSpeak: () => void;
  onStop: () => void;
}

function HeartIcon() {
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
      <path d="M12 20s-6.5-4.3-8.4-8A4.8 4.8 0 0 1 12 6.6 4.8 4.8 0 0 1 20.4 12c-1.9 3.7-8.4 8-8.4 8Z" />
    </svg>
  );
}

function ClinicIcon() {
  return (
    <svg
      width="26"
      height="26"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <rect x="3.5" y="7" width="17" height="13" rx="2" />
      <path d="M9 7V5.2A1.2 1.2 0 0 1 10.2 4h3.6A1.2 1.2 0 0 1 15 5.2V7" />
      <path d="M12 11v5M9.5 13.5h5" />
    </svg>
  );
}

function Field({ label, value, danger = false }: { label: string; value: string; danger?: boolean }) {
  const empty = !value || value === "说明书未标注";
  return (
    <div>
      <p className={`field-label ${danger ? "field-label-danger" : ""}`}>{label}</p>
      <p className={`field-value ${empty ? "field-value-empty" : ""} ${danger && !empty ? "text-[var(--color-accent)]" : ""}`}>
        {empty ? "说明书未标注" : value}
      </p>
    </div>
  );
}

export default function ResultCard({ medicine, voice, onSpeak, onStop }: Props) {
  return (
    <section className="card card-enter p-5">
      {/* 处方笺表头：双线 + 笺注 */}
      <div className="sheet-head">
        <h2 className="sheet-title">识别结果</h2>
        <p className="sheet-note">
          置信度 {medicine.识别置信度}
          {medicine.数据来源 ? ` · ${medicine.数据来源}` : ""}
        </p>
      </div>

      <div className="mt-5">
        <VoiceControls status={voice} onSpeak={onSpeak} onStop={onStop} />
      </div>

      {/* 注射类药的场所提醒（后端确定性判定后下发，固定文案） */}
      {medicine.注射提醒 && (
        <p className="inject-note mt-5" role="alert">
          <ClinicIcon />
          <span>{medicine.注射提醒}</span>
        </p>
      )}

      {medicine.是否处方药 && (
        <p className="rx-stamp mt-5" role="alert">
          ⚠ 该药为处方药
          <br />
          请务必咨询医生
        </p>
      )}
      {medicine.通用信息 && <p className="note-banner mt-5">以下为通用信息，请核对药盒</p>}

      {/* 药名词条 */}
      <div className="mt-6">
        <h3 className="med-name">{medicine.药名 || "未知名称"}</h3>
        <div className="med-name-rule" aria-hidden="true" />
      </div>

      {/* 字段：规则细线分隔 */}
      <dl className="mt-5 space-y-4">
        <Field label="规格" value={medicine.规格} />
        <div className="border-t border-[var(--color-line)] pt-4">
          <Field label="适应症" value={medicine.适应症} />
        </div>
        <div className="border-t border-[var(--color-line)] pt-4">
          <Field label="用法用量" value={medicine.用法用量} />
        </div>
        <div className="border-t border-[var(--color-line)] pt-4">
          <Field label="禁忌" value={medicine.禁忌} danger />
        </div>
        <div className="border-t border-[var(--color-line)] pt-4">
          <Field label="注意事项" value={medicine.注意事项} />
        </div>
      </dl>

      {/* AI 用大白话说的一句贴心提醒（语音也会念出来） */}
      {medicine.贴心叮嘱 && (
        <p className="care-note mt-6">
          <HeartIcon />
          <span>{medicine.贴心叮嘱}</span>
        </p>
      )}
    </section>
  );
}
