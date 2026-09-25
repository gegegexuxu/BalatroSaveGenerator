// 新开局预掷复刻（game.lua:2166-2181 的 if not saveTable 分支 + common_events.lua 掷点函数）。
// 为什么需要：模板存档捕获时这三个值已按模板种子掷好并落在存档里，游戏读档时原样采用
//（不重掷）；生成器改种子后若不重掷，所有导出存档的第一底注 Boss/商店券/跳过标签就都是
// 模板残留值，与存档种子脱节。这里逐位复刻游戏的掷点链路：
//   Boss     = get_new_boss()          → pseudoseed('boss')（无重采样）
//   商店券   = get_next_voucher_key()  → pseudoseed('Voucher'..ante)，UNAVAILABLE 重采样 _resample2…
//   跳过标签 = get_next_tag_key() ×2   → pseudoseed('Tag'..ante)，Small 先、Big 后，同样可重采样
// 消费后的流状态写回存档 pseudorandom 缓存，使游戏内后续同 key 掷点（如第二底注）无缝续流。
import { LuaTable } from './luaTable';
import { RunRng, pseudorandomElementIndex } from './balatroRng';
import { BOSS_POOL, TAG_POOL, VOUCHER_POOL } from '../data/runPools';

/** 胜利底注（G.GAME.win_ante）：挑战模式才会改，开局存档恒为 8 */
const WIN_ANTE = 8;
/** 预掷发生的底注：开局存档恒为第 1 底注（round_resets.ante = 1） */
const ANTE = 1;

export interface RunStartRolls {
  /** round_resets.blind_choices.Boss（第一底注的 Boss 盲注 key） */
  boss: string;
  /** current_round.voucher（第一底注商店刷出的优惠券 key） */
  voucher: string;
  /** round_resets.blind_tags.Small / .Big（跳过对应盲注可得的标签 key） */
  tagSmall: string;
  tagBig: string;
  /** 消费后的随机流链值（= 写回存档 pseudorandom 缓存的部分） */
  rngCache: Record<string, number>;
}

/** get_current_pool 的池键 = 类型名..ante（common_events.lua:2071 的返回拼接） */
const poolKey = (type: string): string => `${type}${ANTE}`;

/** pseudorandom_element + UNAVAILABLE 重采样循环（get_next_voucher_key / get_next_tag_key
 *  的公共骨架，common_events.lua:1901-1925）：首次用池键掷，命中 UNAVAILABLE 占位则依次
 *  换 _resample2/_resample3… 重掷；池条目顺序即 ipairs 数组序（占位影响步进，必须保留） */
function pickFromPool(entries: string[], key: string, rng: RunRng): string {
  let it = 1;
  for (;;) {
    const seedKey = it === 1 ? key : `${key}_resample${it}`;
    const picked = entries[pseudorandomElementIndex(entries.length, rng.pseudoseed(seedKey))];
    if (picked !== 'UNAVAILABLE') return picked;
    it++;
  }
}

/** get_new_boss（common_events.lua:2338）：非终局且 min≤ante 的 Boss（ante<2 时终局分支
 *  恒不触发）；开局 bosses_used 全 0，最少使用过滤后全部保留；候选按键字符串排序后等概率
 *  取一个（pseudorandom_element 对值非表的池按 key 排序，misc_functions.lua:265） */
function rollBoss(rng: RunRng): string {
  const eligible = BOSS_POOL
    .filter(b => !b.showdown && b.min <= Math.max(1, ANTE) && (ANTE % WIN_ANTE !== 0 || ANTE < 2))
    .map(b => b.key)
    .sort();
  return eligible[pseudorandomElementIndex(eligible.length, rng.pseudoseed('boss'))];
}

/** get_next_voucher_key 的池（get_current_pool('Voucher') 的 Voucher 分支）：
 *  外层解锁门（unlocked=false 出局）+ 未拥有本券 + requires 基础券全部已拥有；开局
 *  used_vouchers 为空 → plus 券恒占位 UNAVAILABLE（与档案解锁状态无关，池长恒定） */
function rollVoucher(rng: RunRng): string {
  const usedVouchers = new Set<string>();   // 开局未拥有任何券
  const entries = VOUCHER_POOL.map(v =>
    v.unlocked && !usedVouchers.has(v.key) && v.requires.every(r => usedVouchers.has(r))
      ? v.key
      : 'UNAVAILABLE');
  return pickFromPool(entries, poolKey('Voucher'), rng);
}

/** get_next_tag_key 的池（get_current_pool('Tag') 的 Tag 分支）：min_ante 未达的占位
 *  UNAVAILABLE；requires 的中心按「已发现」处理——存档不含图鉴发现状态，模板捕获者
 *  的进度即全已发现（模板种子对账测试可证此假设），且掷点结果落盘后读档不再复核 */
function rollTag(rng: RunRng): string {
  const entries = TAG_POOL.map(t =>
    !t.minAnte || t.minAnte <= ANTE ? t.key : 'UNAVAILABLE');
  return pickFromPool(entries, poolKey('Tag'), rng);
}

/** 按种子重掷新开局预掷值并写入存档（读档走 game.lua 的 else 分支，原样采用写入值） */
export function applyRunStartRolls(root: LuaTable, seed: string): RunStartRolls {
  const rng = new RunRng(seed);
  const rolls: RunStartRolls = {
    boss: rollBoss(rng),
    voucher: rollVoucher(rng),
    tagSmall: rollTag(rng),
    tagBig: rollTag(rng),
    rngCache: rng.snapshot(),
  };
  const game = root.get('GAME') as LuaTable;
  ((game.get('round_resets') as LuaTable).get('blind_choices') as LuaTable)
    .set('Boss', rolls.boss);
  const blindTags = (game.get('round_resets') as LuaTable).get('blind_tags') as LuaTable;
  blindTags.set('Small', rolls.tagSmall);
  blindTags.set('Big', rolls.tagBig);
  (game.get('current_round') as LuaTable).set('voucher', rolls.voucher);
  // get_new_boss 掷中后使用计数 +1（game.lua:2372）。开局基线全 0：模板里的非零值是
  // 原种子的掷点残留，必须先归零再对本次掷中者 +1，否则计数会随种子叠加
  const bossesUsed = game.get('bosses_used') as LuaTable;
  for (const key of [...bossesUsed.entries.keys()]) bossesUsed.set(key, 0);
  bossesUsed.set(rolls.boss, 1);
  // 随机流缓存写回：游戏内后续同 key 掷点从此续流（否则会重放第一掷）
  const pr = game.get('pseudorandom') as LuaTable;
  for (const [key, value] of Object.entries(rolls.rngCache)) pr.set(key, value);
  return rolls;
}
