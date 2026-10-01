"use client";

interface Props {
  disabled: boolean;
  onSelect: (file: string) => void;
}

const SAMPLES = [
  { file: "sample-1.jpg", label: "阿莫西林胶囊" },
  { file: "sample-2.jpg", label: "布洛芬缓释胶囊" },
  { file: "sample-3.jpg", label: "连花清瘟胶囊" },
];

export default function SamplePicker({ disabled, onSelect }: Props) {
  return (
    <div>
      <p className="mb-3 flex items-center gap-3 text-[18px] font-bold text-[var(--color-ink-soft)]">
        <span className="h-px flex-1 bg-[var(--color-line)]" aria-hidden="true" />
        手边没有药盒 · 点示例图试一试
        <span className="h-px flex-1 bg-[var(--color-line)]" aria-hidden="true" />
      </p>
      <div className="flex gap-3 overflow-x-auto pb-2">
        {SAMPLES.map((s) => (
          <button
            key={s.file}
            type="button"
            disabled={disabled}
            onClick={() => onSelect(s.file)}
            className="sample-card"
          >
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={`/samples/${s.file}`} alt={`示例药盒：${s.label}`} loading="lazy" />
            <span>{s.label}</span>
          </button>
        ))}
      </div>
    </div>
  );
}
