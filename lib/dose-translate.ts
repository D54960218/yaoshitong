/**
 * 用法用量的"克数 → 几粒几片"换算（确定性规则，不依赖模型自觉）
 *
 * 背景：AI 按提示词要求照抄说明书（"成人一次0.25g"），但老人看不懂克数——
 * 药盒规格上写着每粒 0.25g，就该说"一次1粒"。模型自己换算算错过
 * （"一次0.5g"算成"半粒"），所以换算必须由确定性代码做，数字可以验算。
 *
 * 规则（显式、可单测）：
 * 1. 从**原文规格**里解析"每粒/片/袋多少克"（如 0.25gx24粒 → 每粒0.25克）；
 *    规格里只有数量没有克重（如 24粒/盒）时无法换算，原文返回；
 * 2. 单位优先取规格里写明的（粒/片/袋…）；规格只写了克重（如 0.25g）时，
 *    从药名推断（胶囊→粒、片→片、颗粒→袋、丸→丸），推断不出原文返回；
 * 3. 注射类药不换算（给药由医护决定，"几支"意义不同）；
 * 4. 文本里"数字+克/毫克"的绝对剂量按 数量=克数÷每粒克重 换算，
 *    写法：整数→"N粒"，分数→"半片/四分之一片/四分之三片"，1.5→"1片半"，
 *    其余非整数→"约N粒"（四舍五入）；区间剂量（0.25~0.5g）两端各换算；
 * 5. 按体重的剂量（小儿 20~40mg/kg）**换算不了**（取决于孩子体重），
 *    改写成"按体重算，具体吃多少让医生定"，不让 mg/kg 出现在老人面前；
 * 6. 换算结果超出 100 粒或小于等于 0 时不换算（防解析事故）。
 */

interface SpecStrength {
  /** 每一单位含多少克（mg 已折算成 g） */
  strengthG: number;
  /** 体积型规格用 ml 计量（口服液），此时 strengthG 无意义、strengthMl 有值 */
  isVolume: boolean;
  /** 每一单位含多少毫升（仅 isVolume 时有值） */
  strengthMl: number;
  /** 包装单位（粒/片/袋…） */
  unit: string;
}

/** 从药名推断包装单位（规格里没写单位时的兜底） */
function inferUnitFromName(药名: string): string | null {
  if (药名.includes("胶囊") || 药名.includes("软胶囊")) return "粒";
  if (药名.includes("片")) return "片";
  if (药名.includes("颗粒")) return "袋";
  if (药名.includes("丸")) return "丸";
  if (药名.includes("散")) return "袋";
  if (药名.includes("口服液") || 药名.includes("糖浆") || 药名.includes("混悬液")) return "支";
  return null;
}

/**
 * 解析原文规格，取"每一单位的剂量"。
 * 支持：0.25gx24粒 / 0.25g×24粒 / 10g*9袋 / 100mg*12片 / 5ml*10支 / 单独 0.25g
 * 不支持（返回 null）：24粒/盒（无克重）、2g:100ml（输液浓度）、说明书未标注等
 */
export function parseSpecStrength(spec: string): SpecStrength | null {
  const s = (spec ?? "").trim();
  if (!s || s === "说明书未标注") return null;

  // 形式一：克重 × 数量 × 单位（0.25gx24粒 / 10g*9袋 / 100mg*12片 / 5ml*10支）
  const m = s.match(
    /^(\d+(?:\.\d+)?)\s*(mg|μg|µg|g|克|毫升|ml|mL)\s*[x×*]\s*(\d+)\s*(袋|粒|片|支|瓶|板|枚|个|包|贴|丸)$/,
  );
  if (m) {
    const amount = parseFloat(m[1]);
    const weightUnit = m[2].toLowerCase();
    const unit = m[4];
    if (weightUnit === "ml") {
      return { strengthG: 0, isVolume: true, strengthMl: amount, unit };
    }
    if (weightUnit === "μg" || weightUnit === "µg") return null; // 微克级不换算
    const strengthG = weightUnit === "mg" ? amount / 1000 : amount;
    return { strengthG, isVolume: false, strengthMl: 0, unit };
  }

  // 形式二：只有克重（0.25g / 100mg），单位由药名推断（在 rewriteDoseText 里做）
  const bare = s.match(/^(\d+(?:\.\d+)?)\s*(mg|g|克)$/);
  if (bare) {
    const amount = parseFloat(bare[1]);
    const strengthG = bare[2].toLowerCase() === "mg" ? amount / 1000 : amount;
    return { strengthG, isVolume: false, strengthMl: 0, unit: "" };
  }

  // 形式三：体积型单独写（5ml），单位由药名推断
  const bareMl = s.match(/^(\d+(?:\.\d+)?)\s*(ml|毫升)$/);
  if (bareMl) {
    return { strengthG: 0, isVolume: true, strengthMl: parseFloat(bareMl[1]), unit: "" };
  }

  return null;
}

/** 常见分数叫法：换算结果落在这附近（±0.02）就写成"半片/四分之一片"这类老人熟悉的话 */
const FRACTION_NAMES: Array<[number, string]> = [
  [0.125, "八分之一"],
  [0.25, "四分之一"],
  [1 / 3, "三分之一"],
  [0.375, "八分之三"],
  [0.5, "半"],
  [0.625, "八分之五"],
  [2 / 3, "三分之二"],
  [0.75, "四分之三"],
  [0.875, "八分之七"],
];

/** 把换算出的数量格式化成老人看得懂的说法（半片、四分之一片、1片半、约5粒…） */
function formatCount(count: number, unit: string): string | null {
  if (!Number.isFinite(count) || count <= 0 || count > 100) return null;
  const rounded = Math.round(count * 100) / 100;
  if (Number.isInteger(rounded)) return `${rounded}${unit}`;
  // 不足 1 片：优先叫"半片 / 四分之一片"这类分数
  for (const [value, name] of FRACTION_NAMES) {
    if (Math.abs(rounded - value) < 0.02) return `${name}${unit}`;
  }
  // 1 片半这类：整数部分照写，尾巴是半的叫"半"
  const intPart = Math.floor(rounded);
  const tail = rounded - intPart;
  if (Math.abs(tail - 0.5) < 0.02) return `${intPart}${unit}半`;
  // 其余非整数：四舍五入成整数，加"约"字
  const nearest = Math.round(rounded);
  if (nearest >= 1) return `约${nearest}${unit}`;
  return null;
}

/** "数字+重量单位"（mg 先于 g 处理，避免 mg 被拆成 m+g） */
const DOSE_RE = /(\d+(?:\.\d+)?)\s*(mg|克|g|毫升|ml)(?![a-zA-Z])/g;

/** 区间剂量：0.25~0.5g / 0.5-1g / 5~10ml（两端数字共用一个单位） */
const DOSE_RANGE_RE = /(\d+(?:\.\d+)?)\s*[~～\-]\s*(\d+(?:\.\d+)?)\s*(mg|克|g|毫升|ml)(?![a-zA-Z])/g;

/**
 * 按体重算的剂量（小儿 20~40mg/kg）：没法换算成固定的"几粒"——
 * 取决于孩子体重，家长自己估算有风险。统一改写成让医生定量的说法，
 * 把 mg/kg 从老人面前拿掉（换算不了的信息不硬翻）。
 */
const WEIGHT_DOSE_REPLACEMENT = "按体重算，具体吃多少让医生定";

function replaceWeightDoseClause(text: string): string {
  return text
    // "按体重20~40mg/kg"（带"按体重"前缀的最常见写法）
    .replace(/按体重\s*\d+(?:\.\d+)?\s*[~～\-至到]?\s*\d*(?:\.\d+)?\s*(?:mg|毫克)\s*(?:\/\s*kg|每公斤|每千克)?/gi, WEIGHT_DOSE_REPLACEMENT)
    // "20~40mg/kg"（区间，前面没有"按体重"三个字）
    .replace(/\d+(?:\.\d+)?\s*[~～\-]\s*\d+(?:\.\d+)?\s*(?:mg|毫克)\s*\/\s*kg/gi, WEIGHT_DOSE_REPLACEMENT)
    // "20mg/kg"（单值）
    .replace(/\d+(?:\.\d+)?\s*(?:mg|毫克)\s*\/\s*kg/gi, WEIGHT_DOSE_REPLACEMENT);
}

/**
 * 把用法用量里的绝对剂量（克/毫克/毫升）换成"几粒几片"。
 * 不可换算（规格没克重、单位推断不出、注射类）时原文返回。
 * 处理顺序：先改写"按体重 mg/kg"（换算不了）→ 再换算区间剂量 → 最后换算单个剂量。
 */
export function rewriteDoseText(用法用量: string, 规格: string, 药名: string): string {
  const usage = (用法用量 ?? "").trim();
  if (!usage || usage === "说明书未标注") return usage;

  // 注射类不换算：给药由医护操作，"一次几支"对老人没有意义
  if (药名.includes("注射") || 药名.includes("针剂") || 药名.includes("粉针") || usage.includes("注射") || usage.includes("输液")) {
    return usage;
  }

  const spec = parseSpecStrength(规格);
  if (!spec) return usage;

  let unit = spec.unit;
  if (!unit) {
    const inferred = inferUnitFromName(药名 ?? "");
    if (!inferred) return usage;
    unit = inferred;
  }

  const strength = spec.isVolume ? spec.strengthMl : spec.strengthG;
  if (!(strength > 0)) return usage;

  // 第一步：按体重剂量（20~40mg/kg）改写成"让医生定"
  let out = replaceWeightDoseClause(usage);
  let changed = out !== usage;

  // 第二步：区间剂量（0.25~0.5g）两端各换算一次，共用一个单位
  out = out.replace(DOSE_RANGE_RE, (raw: string, loStr: string, hiStr: string, weightUnit: string): string => {
    const toCount = (s: string) => {
      const amount = parseFloat(s);
      return spec.isVolume ? amount / strength : (weightUnit.toLowerCase() === "mg" ? amount / 1000 : amount) / strength;
    };
    const lo = formatCount(toCount(loStr), unit);
    const hi = formatCount(toCount(hiStr), unit);
    if (!lo || !hi) return raw;
    changed = true;
    return `${lo}~${hi}`;
  });

  // 第三步：单个剂量（一次0.25g）
  out = out.replace(DOSE_RE, (raw: string, numStr: string, weightUnit: string, offset: number): string => {
    const after = out.slice(offset + raw.length, offset + raw.length + 8);
    const before = out.slice(Math.max(0, offset - 8), offset);

    // 剩下的"每公斤体重剂量"不换算（前面没替换到的极端写法，宁可保留原文）
    if (/^\s*(\/|每)/.test(after) || /\/\s*k?[gGkK]/.test(after)) return raw;

    const amount = parseFloat(numStr);
    const grams = weightUnit.toLowerCase() === "mg" ? amount / 1000 : amount;
    const count = spec.isVolume ? amount / strength : grams / strength;
    const formatted = formatCount(count, unit);
    if (!formatted) return raw;
    changed = true;
    return formatted;
  });

  return changed ? out : usage;
}
