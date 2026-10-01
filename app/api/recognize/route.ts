import { promises as fs } from "fs";
import path from "path";
import { NextRequest, NextResponse } from "next/server";
import {
  appendMealTiming,
  detectInjection,
  dropOffTopicSentences,
  hasMealTiming,
  INJECTION_NOTICE,
  rewriteSpecText,
} from "@/lib/text-guard";
import { rewriteDoseText } from "@/lib/dose-translate";
import { guardApiRequest } from "@/lib/server-guard";

export const maxDuration = 60;

const ZHIPU_URL = "https://open.bigmodel.cn/api/paas/v4/chat/completions";
const MODEL_VISION = "glm-4v-flash";
const MODEL_TEXT = "glm-4-flash";

const TEXT_FIELDS = ["规格", "适应症", "用法用量", "禁忌", "注意事项"] as const;

/**
 * 全局系统提示词：所有识别与说明文字都必须遵守这里的人设和表达方式。
 * 设计目标：① 大白话，让老年人听得懂；② 语气像家里晚辈一样关心体贴；
 *           ③ 医疗信息不失真（数值/禁忌原样保留，不编造、不替代医生）。
 */
const SYSTEM_PROMPT = [
  "你是一位耐心、细心的用药小助手，服务对象是上了年纪的爷爷奶奶，他们看不清小字、也听不懂专业名词。",
  "",
  "【怎么说话】",
  "1. 每段文字都要写成“医嘱”的口气：像医生或儿女在老人耳边交代事情，不是在念说明书。先说结论、再说注意什么，不要堆专业名词。",
  "2. 全部用大白话，像面对面跟老人聊天一样；称呼对方用“您”。句子要短，一句话只说一件事。",
  "3. 语气要关心、体贴，像家里晚辈的叮嘱；但不要夸张、不要喊口号、不要说空话套话（例如“请仔细阅读说明书”“在医生指导下使用”这类话不要出现，页面底部已经有免责说明）。",
  "3.1 先判断这盒药是怎么用的（口服 / 打针 / 外用），后面所有话都要跟它对得上：打针和抹的药不能说“记得吃药”“饭后吃”。",
  "",
  "【内容底线】",
  "4. 只根据图片里真实看到的文字和包装内容回答，绝不编造；看不到的信息对应字段填“说明书未标注”。",
  "5. 剂量、频次、疗程、禁忌这些关键信息只能来自图片上印的文字：数字和单位必须一字不差地照抄，绝对不许凭记忆补、不许换算、不许简化（例如图片上写“每6-8小时一次”就只能写这个，不能改成“一天三次”）。",
  "6. 图片上没有印的字段（尤其是用法用量、禁忌），一律填“说明书未标注”，把话说清楚交给系统去补通用说明，不要自己猜。",
  "7. 不许添加疗效承诺、不许吓唬人；拿不准是不是处方药时填 false；如果图片里根本不是药品包装、或文字完全看不清，就返回 {\"error\":\"无法识别，请重新拍摄清晰药盒\"}。",
  "",
  "8. 只输出 JSON 本身，不要 markdown 代码块，不要多余解释。",
].join("\n");

const USER_PROMPT = [
  "识别图片中的药盒/药品包装，严格返回这个 JSON 结构：",
  "{\"药名\":\"\",\"规格\":\"\",\"适应症\":\"\",\"用法用量\":\"\",\"禁忌\":\"\",\"注意事项\":\"\",\"贴心叮嘱\":\"\",\"是否处方药\":false,\"识别置信度\":\"高/中/低\"}",
  "填写要求（重要）：",
  "· 药名：写通用名（如 阿莫西林胶囊）；",
  "· 规格：**照抄包装上的原文**（如 10gx9袋），系统会自动把它翻译成大白话，你不用自己改写；",
  "· 适应症：必须改写成**跟老人当面说话的口吻**，不许直接照搬说明书句式（“用于治疗……等症状”这种句子不要出现）。写法：一句“这种药是用来……”讲清治什么、缓解什么，**写完就停**。禁止加“能让您不那么难受”“吃了会好一些”“让您舒服些”这类安慰或客套话——它们没有任何信息量；出现专业词要紧跟一句解释（如“带状疱疹，就是腰上起一串水泡、火辣辣疼的那种”）。不要凭想象添加说明书上没有的症状；遇到让人难为情的病名，用准确但不刺激的说法（如“某些细菌引起的泌尿生殖系统感染”），不要回避也不要渲染；",
  "· 用法用量：保留说明书里的**数字和事实**（药量、次数、疗程、给药方式），但句式要改口语；**说明书上如果写了饭前、饭后、空腹、随餐、睡前这类时间要求，必须原样写出来**（如“饭后半小时吃”“早餐前半小时吃”），一个字都不许省；说明书没写就不要自己加（系统会按药名补一句公认的服用时间建议）；注意：如果药盒/说明书上只写了“一次0.5g、每6-8小时一次”，就只能写这个，**不许自己折算成“每天两次、每次两粒”**（换算容易算错，是医疗风险）；图片上如果只有包装规格（比如“24粒/盒”）而没有服药方法，填“说明书未标注”；",
  "· 禁忌、注意事项：写成医生当面交代的口吻，但**只允许两类内容**——① 把图片上真实印着的说明书文字改写成口语（如“这个药只能打针，不能输液；肾不太好的话，打之前先跟医生说一声”）；② 公认的通用安全提醒（如“有过敏史要先告诉医生”“正在吃的其他药也跟医生说一声”）。除此之外不许自由发挥：不许写与用药无关的话（如护士态度、医院流程）；**不许做成分断言**（“本品含有××成分”只有图片上明确印着成分表时才能写，否则一律不写，例如布洛芬不能写成阿莫西林或阿司匹林的成分）；不许编造具体医学结论；两条都写不出来就填“说明书未标注”；",
  "· 贴心叮嘱：像家人那样说一句具体的关心话，**不许复述剂量、次数、天数**（那栏已经有了，重复容易前后打架），也不要写“如有不适请及时就医”“请遵医嘱”“请仔细阅读说明书”这类套话。要说的是做法上的小提醒，比如“记得饭后吃，别忘喝口水”“药膏抹完记得洗手，别揉眼睛”“打了针别马上揉针眼”；**必须和给药方式对得上**（打针的药不要说“记得吃药”，外用药不要说“饭后用”）；不要写医疗承诺，不要吓唬人；",
  "· 是否处方药：包装上有 Rx 或标明处方药填 true，有 OTC 标志填 false；",
  "· 如果是打针、输液的药，你不用自己写“去正规医院打”这类场所提醒——系统会用固定文案另外提示，你只要把用法用量写准就行；",
  "· 识别置信度：根据图片文字清晰程度填写。",
].join("\n");

interface LocalMedicine {
  药名: string;
  别名?: string[];
  规格?: string;
  适应症?: string;
  用法用量?: string;
  /** 明确的服用时间（饭前／饭后／空腹等），用于卡片上把时间说清楚 */
  服用时间?: string;
  禁忌?: string;
  注意事项?: string;
  是否处方药?: boolean;
}

function normalizeName(name: string): string {
  return name.replace(/[\s（）()·、,，.。]/g, "").toLowerCase();
}

/** 智谱接口返回的内容偶尔带 markdown 代码块包裹，这里 robust 地取出第一个 {...} */
function extractJson(text: string): unknown | null {
  if (!text) return null;
  let t = text.trim();
  const fence = t.match(/```(?:json)?\s*([\s\S]*?)```/);
  if (fence) t = fence[1].trim();
  const start = t.indexOf("{");
  const end = t.lastIndexOf("}");
  if (start === -1 || end === -1 || end <= start) return null;
  try {
    return JSON.parse(t.slice(start, end + 1));
  } catch {
    return null;
  }
}

function asBoolean(value: unknown): boolean {
  if (typeof value === "boolean") return value;
  if (typeof value === "string") {
    return ["是", "true", "yes", "处方"].some((keyword) => value.includes(keyword));
  }
  return false;
}

function asCleanString(value: unknown): string {
  return String(value ?? "").trim();
}

interface RecognizedMedicine {
  药名: string;
  规格: string;
  适应症: string;
  用法用量: string;
  禁忌: string;
  注意事项: string;
  贴心叮嘱: string;
  是否处方药: boolean;
  识别置信度: string;
  /** 注射类药的固定安全提醒（由确定性规则判定后附加，不依赖模型） */
  注射提醒?: string;
  通用信息?: boolean;
  数据来源?: string;
}

function normalize(raw: unknown): RecognizedMedicine | null {
  if (!raw || typeof raw !== "object") return null;
  const obj = raw as Record<string, unknown>;
  const 药名 = asCleanString(obj.药名);
  if (!药名) return null;
  const confidence = asCleanString(obj.识别置信度);
  return {
    药名,
    规格: asCleanString(obj.规格) || "说明书未标注",
    适应症: asCleanString(obj.适应症) || "说明书未标注",
    用法用量: asCleanString(obj.用法用量) || "说明书未标注",
    禁忌: asCleanString(obj.禁忌) || "说明书未标注",
    注意事项: asCleanString(obj.注意事项) || "说明书未标注",
    贴心叮嘱: asCleanString(obj.贴心叮嘱),
    是否处方药: asBoolean(obj.是否处方药),
    识别置信度: ["高", "中", "低"].includes(confidence) ? confidence : "中",
  };
}

/** 调用智谱聊天接口；失败时抛出带友好信息的 Error */
async function callZhipu(apiKey: string, model: string, messages: unknown[]): Promise<string> {
  const res = await fetch(ZHIPU_URL, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model,
      response_format: { type: "json_object" },
      temperature: 0.1,
      messages,
    }),
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
      throw new Error("识别请求太频繁，请稍等几秒再试");
    }
    throw new Error(data?.error?.message || `识别服务出错（状态码 ${res.status}），请稍后再试`);
  }
  return data?.choices?.[0]?.message?.content ?? "";
}

/** 读取本地常用药库，按"去空格小写药名"建索引 */
async function loadLocalMedicines(): Promise<LocalMedicine[]> {
  try {
    const raw = await fs.readFile(path.join(process.cwd(), "data", "common-medicines.json"), "utf-8");
    const list = JSON.parse(raw) as LocalMedicine[];
    return Array.isArray(list) ? list.filter((item) => item && item.药名) : [];
  } catch {
    return [];
  }
}

/** 先在药名里找，找不到再看别名；支持"阿莫西林"匹配"阿莫西林胶囊"这种互相包含 */
function matchLocalMedicine(localList: LocalMedicine[], 药名: string): LocalMedicine | null {
  const target = normalizeName(药名);
  if (!target) return null;
  for (const item of localList) {
    if (normalizeName(item.药名) === target) return item;
  }
  let best: LocalMedicine | null = null;
  let bestLength = 0;
  for (const item of localList) {
    const names = [item.药名, ...(item.别名 ?? [])];
    for (const n of names) {
      const key = normalizeName(n);
      if (key && key.length > bestLength && (target.includes(key) || key.includes(target))) {
        best = item;
        bestLength = key.length;
      }
    }
  }
  return best;
}

function mergeWithLocal(result: RecognizedMedicine, local: LocalMedicine | null): void {
  if (!local) {
    result.数据来源 = "AI识别";
    return;
  }
  let usedLocal = false;
  for (const field of TEXT_FIELDS) {
    const current = result[field];
    const localValue = asCleanString(local[field]);
    if ((!current || current === "说明书未标注") && localValue && localValue !== "说明书未标注") {
      result[field] = localValue;
      usedLocal = true;
    }
  }
  if (!result.是否处方药 && local.是否处方药) {
    result.是否处方药 = true;
  }

  // 服用时间：药库里明确写了饭前／饭后／空腹时，务必让老人看到；
  // 卡片上（用法用量 + 注意事项）任何一处已经写了时间就不再重复。
  if (local.服用时间 && !hasMealTiming(result.用法用量, result.注意事项)) {
    result.用法用量 = appendMealTiming(result.用法用量, local.服用时间);
    usedLocal = true;
  }

  result.数据来源 = usedLocal || local.是否处方药 ? "AI识别+本地药库" : "AI识别";
}

/** AI 返回的信息太少时，按药名用文本模型补一段通用说明，并明确标注 */
async function fillGenericInfo(apiKey: string, result: RecognizedMedicine): Promise<void> {
  const filledCount = TEXT_FIELDS.filter(
    (field) => result[field] && result[field] !== "说明书未标注",
  ).length;
  if (filledCount > 1) return;

  const content = await callZhipu(apiKey, MODEL_TEXT, [
    {
      role: "system",
      content: [
        "你是一位耐心、细心的用药小助手，服务对象是上了年纪的爷爷奶奶。",
        "每段文字都写成“医嘱”的口气：像医生或儿女在老人耳边交代事情，先说结论再说注意什么，不堆专业名词。",
        "大白话、句子短、称呼用“您”，语气关心体贴但不夸张；先弄清这药是怎么用的（口服/打针/外用），所有话都要跟给药方式对得上。",
        "不要编造，拿不准的写“说明书未标注”；剂量、次数、疗程天数必须原样保留，不要许诺疗效。",
        "只输出严格 JSON，不要输出任何其他内容。",
      ].join(""),
    },
    {
      role: "user",
      content: [
        `药品“${result.药名}”的常见说明书信息，把这些内容讲成老年人一听就懂的医嘱，返回 JSON：`,
        "{\"规格\":\"\",\"适应症\":\"\",\"用法用量\":\"\",\"禁忌\":\"\",\"注意事项\":\"\",\"贴心叮嘱\":\"\",\"是否处方药\":false}",
        "要求：不确定的内容填“说明书未标注”，不要编造具体剂量；",
        "适应症先用一句家常话讲清这药治什么，不许照搬说明书句式，必要的专业词紧跟一句解释；",
        "用法用量保留说明书里的数字和事实，不许自己折算（如把“每6-8小时一次”改成“每天三次”），只把句子改口语；有明确的饭前／饭后／空腹要求就写出来，没把握就不写；",
        "禁忌和注意事项写成医生当面交代的口吻，但只允许写说明书的真实内容或公认的通用安全提醒（有过敏史先告诉医生、正在吃的其他药也跟医生说），不许自由发挥、不许写与用药无关的话；",
        "贴心叮嘱只写一句话、不超过 30 个字：不许复述剂量、次数、天数，也不许写“如有不适请及时就医”这类套话；只说做法上的小提醒，且必须跟给药方式对得上（打针的别说“记得吃药”）；不要写医疗承诺、不要吓唬人。",
      ].join(""),
    },
  ]);
  const generic = extractJson(content) as Record<string, unknown> | null;
  if (!generic) return;
  for (const field of TEXT_FIELDS) {
    const value = asCleanString(generic[field]);
    if ((!result[field] || result[field] === "说明书未标注") && value) {
      result[field] = value;
    }
  }
  if (!result.贴心叮嘱) {
    const care = asCleanString(generic.贴心叮嘱);
    if (care) result.贴心叮嘱 = care;
  }
  if (!result.是否处方药) {
    result.是否处方药 = asBoolean(generic.是否处方药);
  }
  result.通用信息 = true;
}

export async function POST(req: NextRequest) {
  // 防滥用：来源检查 + 按 IP 限流（详见 lib/server-guard.ts）
  const blocked = guardApiRequest(req, "recognize");
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
    const image = asCleanString((body as Record<string, unknown>)?.image);
    if (!image) {
      return NextResponse.json({ error: "没有收到图片，请重新拍摄" }, { status: 400 });
    }
    if (image.length > 8_000_000) {
      return NextResponse.json({ error: "图片太大了，请靠近一点重新拍摄" }, { status: 400 });
    }

    let content: string;
    try {
      content = await callZhipu(apiKey, MODEL_VISION, [
        { role: "system", content: SYSTEM_PROMPT },
        {
          role: "user",
          content: [
            { type: "image_url", image_url: { url: `data:image/jpeg;base64,${image}` } },
            { type: "text", text: USER_PROMPT },
          ],
        },
      ]);
    } catch (e) {
      // 真实原因只写服务器日志（老年用户看不懂 "fetch failed" 这类信息），
      // 页面统一显示"识别失败"，并按用户要求语音提示重试
      console.error("[recognize] 调用智谱失败:", e);
      return NextResponse.json({ error: "识别失败" }, { status: 502 });
    }

    const raw = extractJson(content) as Record<string, unknown> | null;
    if (!raw) {
      return NextResponse.json({ error: "无法识别，请重新拍摄清晰药盒" }, { status: 422 });
    }
    if (raw.error) {
      return NextResponse.json({ error: asCleanString(raw.error) || "无法识别，请重新拍摄清晰药盒" }, { status: 422 });
    }

    const result = normalize(raw);
    if (!result) {
      return NextResponse.json({ error: "无法识别，请重新拍摄清晰药盒" }, { status: 422 });
    }

    const localList = await loadLocalMedicines();
    mergeWithLocal(result, matchLocalMedicine(localList, result.药名));

    try {
      await fillGenericInfo(apiKey, result);
    } catch {
      // 兜底信息生成失败不影响主结果，按 AI 识别到的内容返回
    }

    // 输出守门：丢掉与用药无关的跑题句子（无论内容来自图片识别还是兜底说明）
    result.禁忌 = dropOffTopicSentences(result.禁忌);
    result.注意事项 = dropOffTopicSentences(result.注意事项);
    result.贴心叮嘱 = dropOffTopicSentences(result.贴心叮嘱);

    // 注射类药：强制附加“去正规场所注射”的安全提醒（确定性规则，不依赖模型）
    if (detectInjection(result.药名, result.用法用量)) {
      result.注射提醒 = INJECTION_NOTICE;
    }

    // 剂量换算：按包装上的规格把"一次0.25g"改成"一次1粒"（确定性变换，可验算）
    // 必须在规格翻译之前做——翻译后的写法（一袋重10克…）里没有可解析的克重
    result.用法用量 = rewriteDoseText(result.用法用量, result.规格, result.药名);

    // 规格翻译：把 10gx9袋 这类写法统一改成大白话（确定性变换，数字不变）
    result.规格 = rewriteSpecText(result.规格);

    return NextResponse.json(result);
  } catch (e) {
    console.error("[recognize] 未预期的错误:", e);
    return NextResponse.json({ error: "识别出错了，请稍后再试" }, { status: 500 });
  }
}
