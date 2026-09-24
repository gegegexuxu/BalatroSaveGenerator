// LuaJIT math.random / math.randomseed 精确复刻（Tausworthe TW223，周期 2^223）
// 依据 LuaJIT v2.1 源码：lj_prng.c（TW223_STEP）、lib_math.c（random_seed / math_random）
//
// 为什么需要它：Balatro 通过 LÖVE 运行在 LuaJIT 上，游戏里的 math.randomseed/math.random
// 是 LuaJIT 内置实现（LÖVE 只提供 love.math.random，并未替换全局 math.random），
// 因此「古怪牌组」等种子相关的随机结果必须按此实现才能在浏览器端逐位对齐。

const MASK64 = (1n << 64n) - 1n;
const PI = Math.PI;
const E = Math.E;

const view = new DataView(new ArrayBuffer(8));

/** double → 64 位无符号位模式（random_seed 用 C union 做的转换） */
function bitsOf(x: number): bigint {
  view.setFloat64(0, x);
  return view.getBigUint64(0);
}

/** 64 位位模式 → double（lj_prng_u64d 的 [1,2) 转换） */
function fromBits(bits: bigint): number {
  view.setBigUint64(0, bits & MASK64);
  return view.getFloat64(0);
}

/** 单个 PRNG 实例（对应 LuaJIT 里那个 userdata PRNGState） */
export class LuaPrng {
  private readonly u: [bigint, bigint, bigint, bigint] = [0n, 0n, 0n, 0n];

  constructor(seed: number) {
    this.reseed(seed);
  }

  /** lib_math.c: random_seed —— 用 double 的位模式构造 4 个 64 位状态并预热 10 步 */
  reseed(d: number): void {
    let r = 0x11090601; // 64-k[i] 的四个 8 位常量（k = 63/58/55/47）
    let x = d;
    for (let i = 0; i < 4; i++) {
      const m = 1n << BigInt(r & 255);
      r >>>= 8;
      x = x * PI + E;
      let bits = bitsOf(x);
      if (bits < m) bits += m; // 保证 k[i] 的最高位非零
      this.u[i] = bits & MASK64;
    }
    for (let i = 0; i < 10; i++) this.step();
  }

  /** TW223_GEN：更新第 i 个生成器并返回其新状态 */
  private gen(i: 0 | 1 | 2 | 3, k: bigint, q: bigint, s: bigint): bigint {
    const z = this.u[i];
    const hi = (((z << q) & MASK64) ^ z) >> (k - s);
    const lo = ((z & ((MASK64 << (64n - k)) & MASK64)) << s) & MASK64;
    const next = (hi ^ lo) & MASK64;
    this.u[i] = next;
    return next;
  }

  /** TW223_STEP：四个生成器异或求和 */
  private step(): bigint {
    let r = 0n;
    r ^= this.gen(0, 63n, 31n, 18n);
    r ^= this.gen(1, 58n, 19n, 28n);
    r ^= this.gen(2, 55n, 24n, 7n);
    r ^= this.gen(3, 47n, 21n, 8n);
    return r & MASK64;
  }

  /** math.random()：返回 [0, 1) 的 double */
  random(): number {
    const bits = (this.step() & 0x000fffffffffffffn) | 0x3ff0000000000000n;
    return fromBits(bits) - 1.0;
  }

  /** math.random(n)：返回 [1, n] 整数（游戏里用作数组下标） */
  randomInt(n: number): number {
    return Math.floor(this.random() * n) + 1.0;
  }
}
