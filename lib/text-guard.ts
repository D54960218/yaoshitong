/**
 * 输出守门员（确定性规则，不依赖模型自觉）
 *
 * 背景：提示词再严，模型仍偶发“自由发挥”——实测出现过
 * 「打针的时候，别紧张，放松点，别让护士姐姐觉得不舒服。」这类与用药无关的碎话
 * （出现在“注意事项”字段里，由兜底通用说明链路产生）。
 *
 * 规则（显式、可单测）：
 * 1. 把文本按句末标点切成句子；
 * 2. 丢掉命中“跑题黑名单”的整句；
 * 3. 如果全部被丢掉，返回“说明书未标注”，避免留下空字段或半截话。
 */

/** 与用药无关的跑题句式黑名单（宁可少写，不可乱写） */
export const OFF_TOPIC_PATTERNS: RegExp[] = [
   /护士/,
  /医院(的)?(流程|规定|环境|氛围)/,
  /医生(的)?(态度|心情|情绪)/,
  /(态度|心情)不好/,
];

export const NOT_MENTIONED = "说明书未标注";

/* ============================================================
   注射类药物的场所提醒（安全信息，用确定性规则兜底，不依赖模型自觉）
   ============================================================ */

/** 固定提示文案：打针的药必须去正规场所 */
export const INJECTION_NOTICE = "打针的药，请到正规医院或诊所，由医护人员给您注射，不要自己在家里打。";

/** 给药途径关键词：命中任意一个即视为注射/输液类（含静脉、肌内、皮下） */
const INJECTION_ROUTE_KEYWORDS = [
  "注射",
  "静脉",
  "肌内",
  "皮下",
  "静滴",
  "静推",
  "点滴",
  "输液",
  "打针",
];

/** 药名关键词：注射液/注射用/针剂 等 */
const INJECTION_NAME_KEYWORDS = ["注射用", "注射液", "针剂", "粉针", "输液"];

/**
 * 判断这盒药是否需要注射给药。
 *
 * 规则（显式）：
 * 1. 只看**药名**和**用法用量**两处——给药途径只会写在这两处；
 * 2. 故意**不看**适应症与注意事项：适应症里“肌肉疼痛”之类字样会把口服药误判成打针的药
 *    （实测布洛芬适应症含“肌肉疼痛”），注意事项里“不得静脉给药”也可能是对别的药的说明；
 * 3. 只做“是/否”判断，不改写任何内容。
 */
export function detectInjection(药名?: string | null, 用法用量?: string | null): boolean {
  const name = 药名 ?? "";
  const usage = 用法用量 ?? "";
  if (INJECTION_NAME_KEYWORDS.some((k) => name.includes(k))) return true;
  return INJECTION_ROUTE_KEYWORDS.some((k) => usage.includes(k));
}

/* ============================================================
   规格翻译成大白话（确定性变换，不依赖模型自觉）
   例：10gx9袋 → 一袋重10克，一盒有9袋
   ============================================================ */

const SPEC_COUNT_UNITS = ["袋", "粒", "片", "支", "瓶", "板", "枚", "个", "包", "贴", "丸"];
const SPEC_WEIGHT_UNITS: Record<string, string> = { g: "克", mg: "毫克", 克: "克", 毫克: "毫克" };
const SPEC_VOLUME_UNITS: Record<string, string> = { ml: "毫升", 毫升: "毫升" };

function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

const COUNT_SRC = SPEC_COUNT_UNITS.map(escapeRegExp).join("|");
const WEIGHT_SRC = Object.keys(SPEC_WEIGHT_UNITS).map(escapeRegExp).join("|");
const VOLUME_SRC = Object.keys(SPEC_VOLUME_UNITS).map(escapeRegExp).join("|");

/** 形式一：重量/容量 × 数量，如 10gx9袋、0.25g×24粒、5ml*10支 */
const SPEC_WEIGHT_COUNT = new RegExp(
  `^(\\d+(?:\\.\\d+)?)\\s*(${WEIGHT_SRC}|${VOLUME_SRC})\\s*[x×*]\\s*(\\d+)\\s*(${COUNT_SRC})$`,
);
/** 形式二：只有数量，如 24粒/盒、12片*2板 */
const SPEC_COUNT_ONLY = new RegExp(`^(\\d+)\\s*(${COUNT_SRC})\\s*/\\s*盒$`);
const SPEC_COUNT_ONLY_STAR = new RegExp(`^(\\d+)\\s*(${COUNT_SRC})\\s*[x×*]\\s*(\\d+)\\s*板$`);

/**
 * 把包装规格改写成大白话。
 * 数字一律原样保留；不是常见包装形式的规格（如 0.25g、2g）原样返回。
 */
export function rewriteSpecText(spec: string): string {
  const s = (spec ?? "").trim();
  if (!s || s === NOT_MENTIONED) return s;

  let m = s.match(SPEC_WEIGHT_COUNT);
  if (m) {
    const amount = m[1];
    const unit = m[2];
    const count = m[3];
    const pieceUnit = m[4];
    const measureVerb = SPEC_WEIGHT_UNITS[unit] ? "重" : "有";
    const pieceWord = pieceUnit === "粒" ? "一粒" : `一${pieceUnit}`;
    const cnUnit = SPEC_WEIGHT_UNITS[unit] ?? SPEC_VOLUME_UNITS[unit] ?? unit;
    return `${pieceWord}${measureVerb}${amount}${cnUnit}，一盒有${count}${pieceUnit}`;
  }

  m = s.match(SPEC_COUNT_ONLY);
  if (m) return `一盒有${m[1]}${m[2]}`;

  m = s.match(SPEC_COUNT_ONLY_STAR);
  if (m) return `一盒有${m[3]}板，共${m[1]}${m[2]}`;

  return s;
}


/** 按句末标点切句并保留标点 */
function splitSentences(text: string): string[] {
  return text
    .split(/(?<=[。！？!?；;\n])/)
    .map((s) => s.trim())
    .filter(Boolean);
}

/**
 * 丢掉跑题句子。
 * @param text 模型输出的一段文字
 * @returns 过滤后的文字；若全部被过滤则返回“说明书未标注”
 */
export function dropOffTopicSentences(text: string): string {
  const raw = (text ?? "").trim();
  if (!raw || raw === NOT_MENTIONED) return raw;
  const kept = splitSentences(raw).filter((sentence) => !OFF_TOPIC_PATTERNS.some((re) => re.test(sentence)));
  return kept.length > 0 ? kept.join("") : NOT_MENTIONED;
}

/* ============================================================
   服用时间（饭前／饭后／空腹…）：明确写出来，且不重复
   ============================================================ */

/** 服用时间关键词：出现任意一个即认为卡片上已经写了时间要求 */
const MEAL_TIMING_KEYWORDS = ["饭前", "饭后", "餐前", "餐后", "空腹", "随餐", "餐中", "睡前"];

/** 文本里是否已经提到服用时间 */
export function hasMealTiming(...texts: Array<string | undefined | null>): boolean {
  return texts.some((t) => !!t && MEAL_TIMING_KEYWORDS.some((k) => t.includes(k)));
}

/**
 * 把“服用时间”补进用法用量。
 * 只有当卡片上（用法用量 + 注意事项）完全没提时间时才调用，避免同一张卡片重复两遍。
 */
export function appendMealTiming(用法用量: string, 服用时间?: string): string {
  const timing = (服用时间 ?? "").trim();
  const usage = (用法用量 ?? "").trim();
  if (!timing) return usage;
  const sentence = `一般建议${timing}吃。`;
  if (!usage || usage === NOT_MENTIONED) return sentence;
  return `${usage.replace(/[。\s]+$/, "")}。${sentence}`;
}

/* ============================================================
   回答剂量守门（确定性规则）：答案不许出现说明书里没有的数量
   背景：实测 flash 模型会把"一次0.5g"错误换算成"半粒"、
   把"每6-8小时一次"错算成"一天两次"——换算错 = 医疗风险。
   策略：答案里的"数词+单位"短语，必须能在用法用量原文里找到；
   找不到（含"半粒"这类说法）就整句替换为照抄说明书。
   ============================================================ */

const CN_DIGIT: Record<string, string> = {
  零: "0", 一: "1", 二: "2", 两: "2", 三: "3", 四: "4", 五: "5", 六: "6", 七: "7", 八: "8", 九: "9",
};

const UNIT_CANON: Record<string, string> = { g: "克", mg: "毫克", ml: "毫升" };

/** 匹配"数词+单位"：阿拉伯数字或中文数词（含半/两/十），单位覆盖常见药品单位 */
const QUANTITY_RE = /([零一二两三四五六七八九十百千万]+|\d+(?:\.\d+)?)\s*(克|毫克|毫升|g|mg|ml|次|粒|片|袋|支|瓶|贴|丸|天|日|小时|分钟|周|月)/gi;

function canonUnit(unit: string): string {
  return UNIT_CANON[unit.toLowerCase()] ?? unit;
}

/** 中文数词转阿拉伯数字；无法转换返回空串（不判定）；"半"返回特殊标记（一律视为违规） */
function numeralToArabic(word: string): string {
  if (/^\d/.test(word)) return word;
  if (word.includes("半")) return "__HALF__";
  if (word === "十") return "10";
  if (word.includes("十")) {
    const [left, right] = word.split("十");
    const l = left ? left.split("").map((c) => CN_DIGIT[c] ?? "").join("") : "1";
    const r = right ? right.split("").map((c) => CN_DIGIT[c] ?? "").join("") : "0";
    if (!l || !r) return "";
    return r === "0" ? `${l}0` : `${l}${r}`;
  }
  const digits = word.split("").map((c) => CN_DIGIT[c] ?? "").join("");
  return digits || "";
}

/** 提取文本里的"数词+单位"短语（归一化后比较：中文数词→阿拉伯、单位小写规范化） */
export function extractQuantityPhrases(text: string): string[] {
  const out: string[] = [];
  const re = new RegExp(QUANTITY_RE.source, "gi");
  let m: RegExpExecArray | null;
  while ((m = re.exec(text)) !== null) {
    const num = numeralToArabic(m[1]);
    if (!num) continue;
    out.push(`${num}${canonUnit(m[2])}`);
  }
  return out;
}

/**
 * 回答剂量守门：答案中的每个数量短语都必须能在用法用量原文中找到；
 * 否则整句替换为"照抄说明书 + 问医生"（宁照抄，不换算）。
 */
export function guardDosageAnswer(answer: string, 用法用量: string): string {
  const usage = (用法用量 ?? "").trim();
  if (!usage || usage === NOT_MENTIONED) return answer;
  const usagePhrases = new Set(extractQuantityPhrases(usage));
  const bad = extractQuantityPhrases(answer).some((p) => !usagePhrases.has(p));
  if (!bad) return answer;
  return `按说明书写的：${usage.replace(/[。\s]+$/, "")}。拿不准就问医生或药师。`;
}

/* ============================================================
   语音朗读前的单位归一化（确定性文本变换）
   背景：MiniMax 语音把"0.3g"里的字母 g 念成英文字母"g"（用户实测），
   老人听到"零点三寄"而不是"零点三克"。
   规则：数字后面紧跟的计量单位符号，一律换成中文单位名。
   只用于语音合成，屏幕显示仍保留标准写法（0.3g 是规范标注）。
   注意替换顺序：先多字母单位（mg/μg/ml/IU），最后才是 g，
   否则 mg 会被先拆成"m克"。
   ============================================================ */

export function normalizeUnitsForSpeech(text: string): string {
  return (text ?? "")
    .replace(/(\d+(?:\.\d+)?)\s*(?:mg|mG|Mg|MG)/g, "$1毫克")
    .replace(/(\d+(?:\.\d+)?)\s*(?:μg|µg|u[Gg]|Ug|UG)/g, "$1微克")
    .replace(/(\d+(?:\.\d+)?)\s*(?:ml|mL|Ml|ML)/g, "$1毫升")
    .replace(/(\d+(?:\.\d+)?)\s*(?:IU|Iu|iU|iu)/g, "$1国际单位")
    .replace(/(\d+(?:\.\d+)?)\s*[gG]/g, "$1克");
}
