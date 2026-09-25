// Balatro 的伪随机体系复刻（functions/misc_functions.lua：pseudohash / pseudoseed /
// pseudorandom_element / pseudoshuffle），底层用 LuaJIT 的 math.random。
//
// 关键点：每个 key 的随机流互相独立，首次使用时以 pseudohash(key..运行种子) 起步，
// 之后每次调用只按 2.134453429141 + v*1.72431234 递推并截断到 13 位小数。
import { LuaPrng } from './luajitRandom';

const view = new DataView(new ArrayBuffer(8));

/** double → 64 位位模式（用于精确复刻字符串截断） */
function bitsOf(x: number): bigint {
  view.setFloat64(0, x);
  return view.getBigUint64(0);
}

const encoder = new TextEncoder();

/** Lua 侧逐字节取值的 pseudohash（misc_functions.lua） */
export function pseudohash(str: string): number {
  const bytes = encoder.encode(str);
  let num = 1;
  for (let i = bytes.length; i >= 1; i--) {
    num = ((1.1239285023 / num) * bytes[i - 1] * Math.PI + Math.PI * i) % 1;
  }
  return num;
}

/** Lua: tonumber(string.format("%.13f", v)) —— 精确四舍五入到 13 位小数（就近、逢半取偶） */
export function truncate13(v: number): number {
  if (!Number.isFinite(v)) return v; // NaN/Inf 原样返回：NaN 种子会让随机流定死（见测试）
  const neg = v < 0;
  const a = neg ? -v : v;
  const bits = bitsOf(a);
  const exp = Number((bits >> 52n) & 0x7ffn);
  const mant = bits & 0x000fffffffffffffn;
  const m = exp === 0 ? mant : mant | (1n << 52n);
  const e = (exp === 0 ? -1074 : exp - 1075);

  const SCALE = 10n ** 13n;
  let n: bigint;
  if (e >= 0) {
    n = m * SCALE * (1n << BigInt(e));
  } else {
    const num = m * SCALE;
    const den = 1n << BigInt(-e);
    const q = num / den;
    const r = num % den;
    const twice = r * 2n;
    n = twice > den || (twice === den && q % 2n === 1n) ? q + 1n : q;
  }
  const out = Number(n) / 1e13;
  return neg ? -out : out;
}

/**
 * 一次开局的随机流集合（对应 G.GAME.pseudorandom 表）。
 * 同一 key 反复取用会持续推进；不同 key 之间互不影响。
 */
export class RunRng {
  readonly hashedSeed: number;
  private readonly chains = new Map<string, number>();

  constructor(readonly seed: string) {
    this.hashedSeed = pseudohash(seed);
  }

  /** pseudoseed(key)：返回本次使用的种子值（[0,1) 的 double） */
  pseudoseed(key: string): number {
    let v = this.chains.get(key);
    if (v === undefined) v = pseudohash(key + this.seed);
    v = Math.abs(truncate13((2.134453429141 + v * 1.72431234) % 1));
    this.chains.set(key, v);
    return (v + this.hashedSeed) / 2;
  }

  /** 当前各 key 的链值快照（= G.GAME.pseudorandom 的流缓存；seed/hashed_seed 不在内）。
   *  游戏里掷点后链值就存在该表中随存档持久化，后续同 key 掷点从此续流 */
  snapshot(): Record<string, number> {
    return Object.fromEntries(this.chains);
  }
}

/** pseudorandom_element：从 n 个元素里等概率取一个，返回 0 基下标 */
export function pseudorandomElementIndex(n: number, seedValue: number): number {
  return new LuaPrng(seedValue).randomInt(n) - 1;
}

/** pseudoshuffle：先按 sort_id 升序归位，再做 Fisher–Yates 原地洗牌（就地修改入参） */
export function pseudoshuffle<T>(list: T[], seedValue: number): T[] {
  const rng = new LuaPrng(seedValue);
  for (let i = list.length; i >= 2; i--) {
    const j = rng.randomInt(i);
    const tmp = list[i - 1];
    list[i - 1] = list[j - 1];
    list[j - 1] = tmp;
  }
  return list;
}
