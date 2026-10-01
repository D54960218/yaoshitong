import { NextRequest, NextResponse } from "next/server";
import { dropOffTopicSentences, guardDosageAnswer } from "@/lib/text-guard";
import { guardApiRequest } from "@/lib/server-guard";

export const maxDuration = 60;

const ZHIPU_URL = "https://open.bigmodel.cn/api/paas/v4/chat/completions";
const MODEL_TEXT = "glm-4-flash";
const MAX_QUESTION_LENGTH = 200;
const MAX_ANSWER_LENGTH = 80;
const FALLBACK_ANSWER = "这个问题我答不上来，您可以问问医生或药师。";

/**
 * 问答专用全局提示词：与识别提示词同一套人设与口吻，
 * 额外加了「医疗安全拒答」——凡是需要判断个人具体情况的问题一律不给结论。
 */
const SYSTEM_PROMPT = [
  "你是一位耐心、细心的用药小助手，正在陪一位上了年纪的爷爷奶奶聊他们手里这盒药。他们看不清小字、听不懂专业名词，说话可能带点方言口音。",
  "",
  "【怎么说话】",
  "1. 全部用大白话，像家里晚辈当面对老人交代事情：先说结论，再说要注意什么；句子要短，一句话只说一件事，称呼对方用“您”。",
  "2. 回答最多 80 个字、最多 3 句话；问什么答什么，不绕弯子。",
  "3. 语气关心、体贴，但不夸张、不喊口号；不许说空话套话——“希望对您有帮助”“祝您早日康复”“请注意休息”这类没有任何信息量的客套话一律不要出现（页面底部已有免责说明，也不用复述）。",
  "",
  "【能答什么】",
  "4. 只依据下面给出的这盒药的信息和公认的用药常识回答；这盒药的信息里没写、公认常识里也没有的内容，直接说“我不确定”，绝不编造。",
  "5. 老人的问题如果跟手里这盒药完全无关，就温和地拉回来：只回答跟这盒药有关的问题，一句就够。",
  "5.1 涉及药量、次数、粒数时，**只准照抄药品信息里用法用量的原文**，例如原文写“一次0.5g、每6-8小时一次”就照这个说，可以原样念给老人；**禁止换算成“一天几次”“几粒”“半粒”这类说法**（你算不准，换算错了会害人）；老人问“一天吃几次”时，就告诉他“每6到8小时吃一次”，不要自己算一天几回。",
  "",
  "【必须拒绝的】",
  "6. 凡是涉及个人具体情况、需要当面判断的问题，一律不给结论，只建议去问医生或药师，包括但不限于：能不能和别的药一起吃、能不能停药/减量/加量、孕妇/哺乳期/小孩子能不能用、自己有某种病能不能吃、吃了不舒服怎么办。标准答法：“这个得看您个人的情况，我拿不准，千万别自己拿主意，去问医生或药师最稳妥。”",
  "7. 不许做疗效承诺、不许吓唬人；拿不准就说“我不确定”。",
  "",
  "【输出要求】",
  "8. 只输出回答文字本身：不要 JSON、不要 markdown、不要任何解释。",
].join("\n");

interface MedicineBrief {
  药名: string;
  规格: string;
  适应症: string;
  用法用量: string;
  禁忌: string;
  注意事项: string;
  贴心叮嘱: string;
  注射提醒: string;
  是否处方药: boolean;
}

interface QaTurn {
  问: string;
  答: string;
}

function asCleanString(value: unknown): string {
  return String(value ?? "").trim();
}

function buildUserPrompt(question: string, medicine: MedicineBrief, history: QaTurn[]): string {
  const lines = [
    `老人问：「${question}」`,
    "",
    "这盒药的信息（没列出来的就是不知道，不要自己补）：",
    `药名：${medicine.药名}`,
    `规格：${medicine.规格}`,
    `适应症：${medicine.适应症}`,
    `用法用量：${medicine.用法用量}`,
    `禁忌：${medicine.禁忌}`,
    `注意事项：${medicine.注意事项}`,
  ];
  if (medicine.贴心叮嘱) lines.push(`贴心叮嘱：${medicine.贴心叮嘱}`);
  if (medicine.注射提醒) lines.push(`特别提醒：${medicine.注射提醒}`);
  if (medicine.是否处方药) lines.push("注意：这是处方药。");
  if (history.length > 0) {
    lines.push("", "前面几轮问答（供你接上上下文，不要重复已答过的内容）：");
    for (const h of history) {
      lines.push(`问：${h.问}`, `答：${h.答}`);
    }
  }
  lines.push("", "请用不超过 80 个字、最多 3 句话回答老人的问题。");
  return lines.join("\n");
}

/** 调智谱聊天接口；失败时抛出带友好信息的 Error（问答输出是纯文本，不走 json_object） */
async function callZhipuText(apiKey: string, messages: unknown[]): Promise<string> {
  const res = await fetch(ZHIPU_URL, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ model: MODEL_TEXT, temperature: 0.3, messages }),
    signal: AbortSignal.timeout(60000),
  });
  const data = (await res.json().catch(() => null)) as {
    choices?: Array<{ message?: { content?: string } }>;
    error?: { message?: string };
  } | null;
  if (!res.ok) {
    if (res.status === 401 || res.status === 403) {
      throw new Error("智谱 API Key 无效，请检查 .env.local 里的 ZHIPU_API_KEY");
    }
    if (res.status === 429) {
      throw new Error("请求太频繁，请稍等几秒再试");
    }
    throw new Error(data?.error?.message || "问答服务出错（请稍后再试）");
  }
  return (data?.choices?.[0]?.message?.content ?? "").trim();
}

export async function POST(req: NextRequest) {
  // 防滥用：来源检查 + 按 IP 限流（详见 lib/server-guard.ts）
  const blocked = guardApiRequest(req, "ask");
  if (blocked) return blocked;

  try {
    const apiKey = process.env.ZHIPU_API_KEY;
    if (!apiKey) {
      return NextResponse.json(
        { error: "服务器还没配置智谱 API Key，请按 README.md 的说明填写 .env.local 后重启" },
        { status: 500 },
      );
    }

    let body: unknown;
    try {
      body = await req.json();
    } catch {
      return NextResponse.json({ error: "请求格式不对，请刷新页面重试" }, { status: 400 });
    }
    const payload = (body ?? {}) as Record<string, unknown>;

    let question = asCleanString(payload.question);
    if (!question) {
      return NextResponse.json({ error: "没有收到问题，请再说一遍" }, { status: 400 });
    }
    if (question.length > MAX_QUESTION_LENGTH) {
      question = question.slice(0, MAX_QUESTION_LENGTH);
    }

    const rawMedicine = (payload.medicine ?? {}) as Record<string, unknown>;
    const medicine: MedicineBrief = {
      药名: asCleanString(rawMedicine.药名) || "未识别",
      规格: asCleanString(rawMedicine.规格) || "说明书未标注",
      适应症: asCleanString(rawMedicine.适应症) || "说明书未标注",
      用法用量: asCleanString(rawMedicine.用法用量) || "说明书未标注",
      禁忌: asCleanString(rawMedicine.禁忌) || "说明书未标注",
      注意事项: asCleanString(rawMedicine.注意事项) || "说明书未标注",
      贴心叮嘱: asCleanString(rawMedicine.贴心叮嘱),
      注射提醒: asCleanString(rawMedicine.注射提醒),
      是否处方药: Boolean(rawMedicine.是否处方药),
    };

    const rawHistory = Array.isArray(payload.history) ? payload.history : [];
    const history: QaTurn[] = rawHistory.slice(-3).map((h) => {
      const turn = (h ?? {}) as Record<string, unknown>;
      return { 问: asCleanString(turn.问), 答: asCleanString(turn.答) };
    });

    let content: string;
    try {
      content = await callZhipuText(apiKey, [
        { role: "system", content: SYSTEM_PROMPT },
        { role: "user", content: buildUserPrompt(question, medicine, history) },
      ]);
    } catch (e) {
      return NextResponse.json(
        { error: e instanceof Error ? e.message : "问答服务暂时不可用，请稍后再试" },
        { status: 502 },
      );
    }

    // 输出守门：空回兜底 → 超长截断 → 跑题句过滤（全丢时回兜底）→ 剂量守门（不允许出现说明书里没有的数量）
    let answer = content;
    if (!answer) answer = FALLBACK_ANSWER;
    if (answer.length > MAX_ANSWER_LENGTH) answer = `${answer.slice(0, MAX_ANSWER_LENGTH)}。`;
    answer = dropOffTopicSentences(answer);
    if (!answer || answer === "说明书未标注") answer = FALLBACK_ANSWER;
    answer = guardDosageAnswer(answer, medicine.用法用量);

    return NextResponse.json({ answer });
  } catch (e) {
    console.error("[ask] 未预期的错误:", e);
    return NextResponse.json({ error: "问答出错了，请稍后再试" }, { status: 500 });
  }
}
