// 存档组装入口（v0.4：替换牌组 BACK + 选择赌注 stake 1-8 + 开局数值覆盖（出牌/弃牌/金币）；
// 牌组其余规则字段（手牌上限/小丑槽位等）仍未应用）
// 字段映射与键序依据 PROJECT_SPEC.md 5.4 / 附录 B（模板 BACK 的键序：name, pos, effect, key）
import { BACKS, type BackDef } from '../data/backs';
import templateSource from '../data/templateSource';
import { LuaTable, parseLua, serializeLua, type LuaValue } from './luaTable';
import { deflateSave } from './deflate';
import { validateSave } from './validate';

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

/** 开局数值覆盖（出牌次数 / 弃牌次数 / 金币 / 种子），由界面参数面板传入 */
export interface RunInitOverrides {
  hands: number;
  discards: number;
  dollars: number;
  seed?: string;
}

/** 提取脚本产出的 JSON 值 → LuaTable（数组转数字键 1..n） */
function jsonToLua(v: unknown): LuaValue {
  if (v === null || v === undefined) throw new Error('数据里不允许 null');
  if (typeof v === 'number' || typeof v === 'string' || typeof v === 'boolean') return v;
  if (Array.isArray(v)) {
    const t = new LuaTable();
    v.forEach((item, i) => t.set(i + 1, jsonToLua(item)));
    return t;
  }
  if (typeof v === 'object') {
    const t = new LuaTable();
    for (const [k, item] of Object.entries(v)) t.set(k, jsonToLua(item));
    return t;
  }
  throw new Error(`无法转换的数据类型: ${typeof v}`);
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

/** 生成指定牌组与赌注（1-8，白注~金注）的开局 save.jkr 字节流 */
export function generateSave(deckKey: string, stake: number = 1, init?: RunInitOverrides): Uint8Array {
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

  validateSave(root);
  return deflateSave(serializeLua(root));
}
