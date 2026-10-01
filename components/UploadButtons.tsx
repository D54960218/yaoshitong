"use client";

import { useRef } from "react";

interface Props {
  disabled: boolean;
  onFile: (file: File) => void;
}

function CameraIcon() {
  return (
    <svg
      width="30"
      height="30"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d="M4 8h3l2-2.5h6L17 8h3a1.5 1.5 0 0 1 1.5 1.5V18A1.5 1.5 0 0 1 20 19.5H4A1.5 1.5 0 0 1 2.5 18V9.5A1.5 1.5 0 0 1 4 8Z" />
      <circle cx="12" cy="13.5" r="3.5" />
    </svg>
  );
}

function AlbumIcon() {
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
      <rect x="3" y="4" width="18" height="16" rx="2" />
      <circle cx="9" cy="10" r="1.6" />
      <path d="m4.5 18 4.5-4.5 3 3 3.5-3.5 4 4" />
    </svg>
  );
}

export default function UploadButtons({ disabled, onFile }: Props) {
  const cameraInputRef = useRef<HTMLInputElement>(null);
  const albumInputRef = useRef<HTMLInputElement>(null);

  const pick = (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (file) onFile(file);
  };

  return (
    <div className="flex flex-col gap-4">
      <button
        type="button"
        disabled={disabled}
        onClick={() => cameraInputRef.current?.click()}
        className="btn btn-primary"
      >
        <CameraIcon />
        拍照识别
      </button>
      <button
        type="button"
        disabled={disabled}
        onClick={() => albumInputRef.current?.click()}
        className="btn btn-secondary"
      >
        <AlbumIcon />
        从相册选择
      </button>
      {/* capture="environment" 尽量调起后置摄像头 */}
      <input ref={cameraInputRef} type="file" accept="image/*" capture="environment" className="hidden" onChange={pick} />
      <input ref={albumInputRef} type="file" accept="image/*" className="hidden" onChange={pick} />
    </div>
  );
}
