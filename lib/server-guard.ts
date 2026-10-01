import { NextRequest, NextResponse } from "next/server";

/**
 * API 防滥用护栏：每个接口请求进来先过这道门。
 *
 * 做两件事：
 * 1. 来源检查 —— 拦住"别的网站偷偷调你的接口、烧你的 API 额度"的跨站请求；
 * 2. 频率限制 —— 按 IP 计数，同一个人短时间内刷太多次直接拒。
 *
 * 为什么不挡自家手机/电脑：判断是否"自己人"的标准是
 * 请求的 Origin（浏览器自动带，改不了）是不是指向本站自己，
 * 所以电脑 localhost、手机局域网 IP、Vercel 域名全都天然放行。
 *
 * 局限（诚实说明）：计数存在单台服务器的内存里。
 * Vercel 部署时每个函数实例各自计数，防随手乱刷绰绰有余；
 * 真想防大规模攻击要上 Redis 之类的外部计数（本项目量级用不到）。
 */

export type GuardedRoute = "recognize" | "ask" | "ask-audio" | "tts";

/** 每个接口一套额度（按"接口名 + IP"分别计数）。对正常家用非常宽松，
 *  只拦恶意/误操作刷屏；要调整改这里即可。 */
const LIMITS: Record<GuardedRoute, { windowMs: number; max: number }> = {
  recognize: { windowMs: 60_000, max: 12 },
  ask: { windowMs: 60_000, max: 30 },
  "ask-audio": { windowMs: 60_000, max: 20 },
  tts: { windowMs: 60_000, max: 90 },
};

interface Bucket {
  count: number;
  resetAt: number;
}

const buckets = new Map<string, Bucket>();
let lastSweepAt = Date.now();
const SWEEP_INTERVAL_MS = 10 * 60_000;

/** 顺手清掉过期计数桶，服务跑很多天也不会把内存撑大 */
function sweepIfNeeded(now: number): void {
  if (now - lastSweepAt < SWEEP_INTERVAL_MS) return;
  lastSweepAt = now;
  for (const [key, bucket] of buckets) {
    if (bucket.resetAt <= now) buckets.delete(key);
  }
}

function clientIp(req: NextRequest): string {
  const forwarded = req.headers.get("x-forwarded-for");
  if (forwarded) return forwarded.split(",")[0]?.trim() || "unknown";
  return req.ip ?? "unknown";
}

/**
 * 用法（在每个 API 路由的 POST 开头）：
 *   const blocked = guardApiRequest(req, "recognize");
 *   if (blocked) return blocked;
 *
 * 返回 null = 放行；返回 NextResponse = 直接把它 return 给浏览器即可。
 */
export function guardApiRequest(req: NextRequest, route: GuardedRoute): NextResponse | null {
  // ① 来源检查：浏览器跨站 POST（Origin 指向别的网站）一律 403。
  //    额外信任名单可用环境变量 ALLOWED_ORIGINS 配置（逗号分隔多个域名），
  //    例如前端和接口部署在不同域名时。
  const origin = req.headers.get("origin");
  if (origin) {
    const host = req.headers.get("host") ?? "";
    const proto = req.headers.get("x-forwarded-proto") ?? new URL(origin).protocol.replace(":", "");
    const selfOrigin = `${proto}://${host}`;
    const extraAllowed = new Set(
      (process.env.ALLOWED_ORIGINS ?? "")
        .split(",")
        .map((s) => s.trim())
        .filter(Boolean),
    );
    if (origin !== selfOrigin && !extraAllowed.has(origin)) {
      return NextResponse.json({ error: "请求来源不被允许" }, { status: 403 });
    }
  }

  // ② 频率限制：固定窗口计数，窗口内超额度返回 429。
  const now = Date.now();
  sweepIfNeeded(now);
  const { windowMs, max } = LIMITS[route];
  const key = `${route}|${clientIp(req)}`;
  const bucket = buckets.get(key);
  if (!bucket || bucket.resetAt <= now) {
    buckets.set(key, { count: 1, resetAt: now + windowMs });
  } else {
    bucket.count += 1;
    if (bucket.count > max) {
      return NextResponse.json({ error: "请求太频繁，请稍等几秒再试" }, { status: 429 });
    }
  }
  return null;
}
