import { NextRequest, NextResponse } from "next/server";
import { guardApiRequest } from "@/lib/server-guard";

export const maxDuration = 60;

const ZHIPU_ASR_URL = "https://open.bigmodel.cn/api/paas/v4/audio/transcriptions";
const ASR_MODEL = "glm-asr-2512";
/** 客户端已限 30 秒（编码后远小于此），这里再兜底，远低于服务上限 25MB */
const MAX_AUDIO_BYTES = 8 * 1024 * 1024;

/** 浏览器录音 blob 的 mime → 文件扩展名（glm-asr 接受常见格式；iOS Safari 常产出 mp4/aac） */
function resolveExtension(mime: string): string {
  if (mime.includes("mp4") || mime.includes("m4a") || mime.includes("aac")) return "m4a";
  if (mime.includes("mpeg") || mime.includes("mp3")) return "mp3";
  if (mime.includes("wav")) return "wav";
  if (mime.includes("ogg")) return "ogg";
  return "webm";
}

export async function POST(req: NextRequest) {
  // 防滥用：来源检查 + 按 IP 限流（详见 lib/server-guard.ts）
  const blocked = guardApiRequest(req, "ask-audio");
  if (blocked) return blocked;

  try {
    const apiKey = process.env.ZHIPU_API_KEY;
    if (!apiKey) {
      return NextResponse.json(
        { error: "服务器还没配置智谱 API Key，请按 README.md 的说明填写 .env.local 后重启" },
        { status: 500 },
      );
    }

    let form: FormData;
    try {
      form = await req.formData();
    } catch {
      return NextResponse.json({ error: "请求格式不对，请刷新页面重试" }, { status: 400 });
    }
    const file = form.get("file");
    if (!(file instanceof File) || file.size === 0) {
      return NextResponse.json({ error: "没有收到语音，请再试一次" }, { status: 400 });
    }
    if (file.size > MAX_AUDIO_BYTES) {
      return NextResponse.json({ error: "录音太长了，请说短一点，30 秒以内" }, { status: 400 });
    }

    const bytes = await file.arrayBuffer();
    const forward = new FormData();
    forward.append("model", ASR_MODEL);
    forward.append("stream", "false");
    forward.append(
      "file",
      new File([bytes], `question.${resolveExtension(file.type || "")}`, {
        type: file.type || "application/octet-stream",
      }),
    );

    const res = await fetch(ZHIPU_ASR_URL, {
      method: "POST",
      headers: { Authorization: `Bearer ${apiKey}` },
      body: forward,
      signal: AbortSignal.timeout(45000),
    });

    const data = (await res.json().catch(() => null)) as {
      text?: string;
      error?: { message?: string };
    } | null;

    if (!res.ok) {
      if (res.status === 401 || res.status === 403) {
        return NextResponse.json({ error: "智谱 API Key 无效，请检查 .env.local 里的 ZHIPU_API_KEY" }, { status: 502 });
      }
      if (res.status === 429) {
        return NextResponse.json({ error: "请求太频繁，请稍等几秒再试" }, { status: 502 });
      }
      return NextResponse.json(
        { error: data?.error?.message || "语音转文字出错了，请再说一遍" },
        { status: 502 },
      );
    }

    const text = (data?.text ?? "").trim();
    if (!text) {
      return NextResponse.json({ error: "没听清您说的话，请靠近手机再说一遍" }, { status: 422 });
    }

    return NextResponse.json({ text });
  } catch (e) {
    console.error("[ask-audio] 未预期的错误:", e);
    return NextResponse.json({ error: "语音出错了，请稍后再试" }, { status: 500 });
  }
}
