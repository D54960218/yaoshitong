/** 把用户选的图片压到最大 896px 宽，转成 base64（不带 data: 前缀），控制上传体积。
 *  896 是保守档：比 1024 上传/识别更快，配合高质量重采样，药盒小字仍看得清。 */
export function fileToCompressedBase64(file: File, maxWidth = 896, quality = 0.8): Promise<string> {
  return new Promise((resolve, reject) => {
    const objectUrl = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => {
      try {
        const scale = Math.min(1, maxWidth / img.width);
        const width = Math.max(1, Math.round(img.width * scale));
        const height = Math.max(1, Math.round(img.height * scale));
        const canvas = document.createElement("canvas");
        canvas.width = width;
        canvas.height = height;
        const ctx = canvas.getContext("2d");
        if (!ctx) {
          URL.revokeObjectURL(objectUrl);
          reject(new Error("当前浏览器不支持图片处理，请换个浏览器试试"));
          return;
        }
        // 缩小图片时用高质量重采样，保住药盒上的小字边缘，识别不掉字
        ctx.imageSmoothingQuality = "high";
        ctx.drawImage(img, 0, 0, width, height);
        URL.revokeObjectURL(objectUrl);
        resolve(canvas.toDataURL("image/jpeg", quality).split(",")[1] ?? "");
      } catch {
        URL.revokeObjectURL(objectUrl);
        reject(new Error("图片处理失败，请换一张清晰的照片"));
      }
    };
    img.onerror = () => {
      URL.revokeObjectURL(objectUrl);
      reject(new Error("图片打不开，可能是格式不支持，请换一张"));
    };
    img.src = objectUrl;
  });
}

/** 把后端返回的 base64 音频转成可供 <audio> 播放的临时链接 */
export function base64ToBlobUrl(base64: string, mimeType = "audio/mpeg"): string {
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) {
    bytes[i] = binary.charCodeAt(i);
  }
  return URL.createObjectURL(new Blob([bytes], { type: mimeType }));
}
