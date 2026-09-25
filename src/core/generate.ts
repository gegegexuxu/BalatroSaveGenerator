// 存档组装入口（v0.5：在 v0.4 的牌组/赌注/开局数值之上，写入按牌组类型生成的目标牌堆）
// 字段映射与键序依据 PROJECT_SPEC.md 5.4 / 附录 B（模板 BACK 的键序：name, pos, effect, key）
import { BACKS, type BackDef } from '../data/backs';
import templateSource from '../data/templateSource';
import { LuaTable, parseLua, serializeLua, jsonToLua } from './luaTable';
import { deflateSave } from './deflate';
import { validateSave } from './validate';
import { applyConsumablesToSave, applyDeckToSave, applyJokersToSave, applyVouchersToSave, type ConsumablesSpec, type JokersSpec, type VouchersSpec } from './saveDeck';
import { deckDefaultVouchers } from './vouchers';
import type { DeckCard } from './deckGen';

export const MIN_STAKE = 1;
export const MAX_STAKE = 8;

/** 游戏种子字符表（33 个，不含 0/I/O 以免混淆；game.lua SEED_CHARS）*/
export const SEED_CHARS = '123456789ABCDEFGHJKLMNPQRSTUVWXYZ';
const SEED_RE = /^[1-9ABCDEFGHJKLMNPQRSTUVWXYZ]{8}$/;

/** 模仿游戏生成策略：从字符表随机取 8 个字符 */
export function randomSeed(): string {
  let seed = '';
  for (let i = 0; i < 8; i++) {
    seed += SEED_CHARS[Math.floor(Math.random() * SEED_CHARS.length)];
  }
  return seed;
}

/** 开局数值覆盖（出牌次数 / 弃牌次数 / 手牌上限 / 小丑槽 / 消耗品槽 / 金币 / 种子），由界面参数面板传入 */
export interface RunInitOverrides {
  hands: number;
  discards: number;
  /** 每回合手牌上限（省略时沿用模板值 8） */
  handSize?: number;
  /** 小丑牌槽位数（省略时沿用模板值 5） */
  jokerSlots?: number;
  /** 消耗品槽位数（省略时沿用模板值 2） */
  consumableSlots?: number;
  dollars: number;
  seed?: string;
}

/** 用牌组定义重建 BACK 块（键序与模板逐字节对齐，b_red 可还原无损一致） */
function buildBack(def: BackDef, stake: number): { back: LuaTable; center: LuaTable } {
  // 注意：模板中 pos 的键序是 y 在 x 前（pairs 遍历序），保持一致以通过往返测试
  const pos = new LuaTable().set('y', def.pos.y).set('x', def.pos.x);
  const config = jsonToLua(def.config) as LuaTable;
  const center = new LuaTable()
    .set('order', def.order)
    .set('set', 'Back')
    .set('stake', stake)
    .set('discovered', true)
    .set('pos', pos)
    .set('unlocked', true)
    .set('alerted', true)
    .set('key', def.key)
    .set('name', def.enName)
    .set('config', config);
  const effect = new LuaTable()
    .set('center', center)
    .set('text_UI', '')
    .set('config', config);
  const back = new LuaTable()
    .set('name', def.enName)
    .set('pos', pos)
    .set('effect', effect)
    .set('key', def.key);
  return { back, center };
}

/** 应用赌注效果（累进，>= 即生效）。
 *  依据 game.lua:2049-2058 —— 该段仅在开局（非读档）执行，读档时 G.GAME 整表替换，
 *  因此所有 modifiers 必须已写进存档 */
function applyStake(root: LuaTable, stake: number): void {
  const game = root.get('GAME') as LuaTable;
  game.set('stake', stake);

  if (stake >= 2 || stake >= 4 || stake >= 7 || stake >= 8) {
    const modifiers = game.get('modifiers') as LuaTable;
    if (stake >= 2) {
      const nbr = new LuaTable().set('Small', true);
      modifiers.set('no_blind_reward', nbr);
    }
    if (stake >= 4) modifiers.set('enable_eternals_in_shop', true);
    if (stake >= 7) modifiers.set('enable_perishables_in_shop', true);
    if (stake >= 8) modifiers.set('enable_rentals_in_shop', true);
  }
  if (stake >= 3 || stake >= 6) {
    const modifiers = game.get('modifiers') as LuaTable;
    modifiers.set('scaling', stake >= 6 ? 3 : 2);
  }
  if (stake >= 5) {
    // 蓝注起：开局弃牌 -1，三处同步（game.lua:2056 + 2151-2152 的赋值链）
    const game2 = root.get('GAME') as LuaTable;
    const sp = game2.get('starting_params') as LuaTable;
    const discards = (sp.get('discards') as number) - 1;
    sp.set('discards', discards);
    (game2.get('round_resets') as LuaTable).set('discards', discards);
    (game2.get('current_round') as LuaTable).set('discards_left', discards);
  }
}

/** 写入开局数值。game.lua 开局时把 starting_params 同步进 round_resets 与 current_round，
 *  读档时 G.GAME 整表替换、该段不再执行，因此三处（及金币的 GAME.dollars）必须全部落盘 */
function applyRunInit(root: LuaTable, init: RunInitOverrides): void {
  const game = root.get('GAME') as LuaTable;
  const sp = game.get('starting_params') as LuaTable;
  const rr = game.get('round_resets') as LuaTable;
  const cr = game.get('current_round') as LuaTable;
  sp.set('hands', init.hands);
  rr.set('hands', init.hands);
  cr.set('hands_left', init.hands);
  sp.set('discards', init.discards);
  rr.set('discards', init.discards);
  cr.set('discards_left', init.discards);
  sp.set('dollars', init.dollars);
  game.set('dollars', init.dollars);
  if (init.handSize !== undefined) {
    // 手牌上限只落在 starting_params（round_resets/current_round 无此字段）与手牌区容量上；
    // 实际抓牌数取手牌区 card_limit（state_events.lua:362），故两处都要写
    sp.set('hand_size', init.handSize);
    const handCfg = ((root.get('cardAreas') as LuaTable).get('hand') as LuaTable).get('config') as LuaTable;
    handCfg.set('card_limit', init.handSize);
    handCfg.set('temp_limit', init.handSize);
  }
  // 槽位数与手牌上限同理：开局由 game.lua:2239-2245 从 starting_params 派生进牌区 config，
  // 读档时该段不执行（G.GAME 整表替换），因此 starting_params 与牌区容量必须同时落盘
  if (init.jokerSlots !== undefined) {
    sp.set('joker_slots', init.jokerSlots);
    const jokerCfg = ((root.get('cardAreas') as LuaTable).get('jokers') as LuaTable).get('config') as LuaTable;
    jokerCfg.set('card_limit', init.jokerSlots);
    jokerCfg.set('temp_limit', init.jokerSlots);
  }
  if (init.consumableSlots !== undefined) {
    sp.set('consumable_slots', init.consumableSlots);
    const consCfg = ((root.get('cardAreas') as LuaTable).get('consumeables') as LuaTable).get('config') as LuaTable;
    consCfg.set('card_limit', init.consumableSlots);
    consCfg.set('temp_limit', init.consumableSlots);
  }
}

function needInt(v: number, name: string, min: number, max: number): void {
  if (!Number.isInteger(v) || v < min || v > max) {
    throw new Error(`开局${name}超出范围(${min}-${max}): ${v}`);
  }
}

function validateRunInit(init: RunInitOverrides): void {
  needInt(init.hands, '出牌次数', 1, 99);
  needInt(init.discards, '弃牌次数', 0, 99);
  needInt(init.dollars, '金币', 0, 999999);
  if (init.handSize !== undefined) needInt(init.handSize, '手牌上限', 1, 99);
  if (init.jokerSlots !== undefined) needInt(init.jokerSlots, '小丑槽位', 1, 99);
  if (init.consumableSlots !== undefined) needInt(init.consumableSlots, '消耗品槽位', 0, 99);
  if (init.seed !== undefined && !SEED_RE.test(init.seed)) {
    throw new Error(`种子格式错误（8 位，字符不含 0/I/O）: ${init.seed}`);
  }
}

/** 写入种子。pseudorandom 表里除 seed 外的键都是原种子的随机流缓存，
 *  改种子后必须清空，游戏载入/运行时会按新种子重新派生 */
function applySeed(root: LuaTable, seed: string): void {
  const game = root.get('GAME') as LuaTable;
  const pr = game.get('pseudorandom') as LuaTable;
  pr.set('seed', seed);
  for (const key of [...pr.entries.keys()]) {
    if (key !== 'seed') pr.entries.delete(key);
  }
}

/** 生成指定牌组与赌注（1-8，白注~金注）的开局 save.jkr 字节流。
 *  cards 为目标牌堆（牌堆顺序，见 core/deckGen）：传入时替换存档牌堆，
 *  省略则沿用模板牌堆（模板虽是合法红牌组，但牌序来自别的种子）；
 *  consumables 为开局消耗牌（items = 区内顺序，每张自带负片标记），空列表跳过；
 *  jokers 为开局小丑牌（items = 区内顺序，每张自带版本），空列表跳过 */
export function generateSave(
  deckKey: string,
  stake: number = 1,
  init?: RunInitOverrides,
  cards?: DeckCard[],
  consumables?: ConsumablesSpec,
  jokers?: JokersSpec,
  vouchers?: VouchersSpec,
): Uint8Array {
  const def = BACKS.find(b => b.key === deckKey && !b.omit);
  if (!def) throw new Error(`未知或不可选的牌组: ${deckKey}`);
  if (!Number.isInteger(stake) || stake < MIN_STAKE || stake > MAX_STAKE) {
    throw new Error(`赌注超出范围(${MIN_STAKE}-${MAX_STAKE}): ${stake}`);
  }

  const root = parseLua(templateSource);
  const { back, center } = buildBack(def, stake);
  root.set('BACK', back);
  // 模板中 selected_back_key 存的是完整 center 表（非字符串 key），保持同构
  (root.get('GAME') as LuaTable).set('selected_back_key', center);
  applyStake(root, stake);
  if (init) {
    validateRunInit(init);
    // 覆盖放在赌注效果之后：面板传入的已是含蓝注修正的最终值
    applyRunInit(root, init);
    if (init.seed !== undefined) applySeed(root, init.seed);
  }
  if (cards) applyDeckToSave(root, cards);
  if (consumables && consumables.items.length > 0) applyConsumablesToSave(root, def, consumables);
  if (jokers && jokers.items.length > 0) applyJokersToSave(root, jokers);
  // 券最后结算：与消耗牌/牌组规则写入的 used_vouchers 标记合并（魔法水晶球），
  // 只要有任何券（自选或牌组规则）就按最终拥有集合落盘结构效果
  if ((vouchers && vouchers.keys.length > 0) || deckDefaultVouchers(def).length > 0) {
    applyVouchersToSave(root, def, vouchers ?? { keys: [] });
  } else {
    const uv = (root.get('GAME') as LuaTable).get('used_vouchers');
    if (uv instanceof LuaTable && uv.entries.size > 0) applyVouchersToSave(root, def, { keys: [] });
  }

  validateSave(root);
  return deflateSave(serializeLua(root));
}
