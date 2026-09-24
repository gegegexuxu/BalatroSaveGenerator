// 按目标牌堆重建存档里的牌区：以模板卡表为原型，只改实例字段（增强 / 蜡封 / 版本 / 编号）。
// 建牌思路：模板里 52 张基础牌各一张，直接复用同花色同点数的模板卡表作原型，
// 只改实例相关字段（playing_card / sort_id / rank / save_fields.card），
// 其余字段（base 的颜色、点数、图集坐标等）天然正确，与游戏 Card:save() 的结构一致。
import { LuaTable, cloneLuaTable, type LuaValue } from './luaTable';
import { ENHANCEMENTS, EDITIONS, type EnhancementDef } from '../data/cardMods';
import type { DeckCard } from './deckGen';

const SUIT_FILE: Record<string, string> = { Spades: 'S', Hearts: 'H', Clubs: 'C', Diamonds: 'D' };
const VALUE_FILE: Record<string, string> = { Ace: 'A', King: 'K', Queen: 'Q', Jack: 'J', '10': 'T' };

function deckTable(root: LuaTable): LuaTable {
  const area = (root.get('cardAreas') as LuaTable).get('deck') as LuaTable;
  return area.get('cards') as LuaTable;
}

/** 模板牌堆里「花色+点数」→ 原始卡表（建牌原型） */
function cardPrototypes(root: LuaTable): Map<string, LuaTable> {
  const map = new Map<string, LuaTable>();
  for (const [, node] of deckTable(root).entries) {
    const t = node as LuaTable;
    const base = t.get('base') as LuaTable;
    const suit = SUIT_FILE[String(base.get('suit'))];
    const rank = VALUE_FILE[String(base.get('value'))] ?? String(base.get('value'));
    if (suit && rank) map.set(suit + rank, t);
  }
  return map;
}

/** 以原型卡表生成目标牌（只改实例字段与增强/蜡封，键序保持模板顺序） */
function buildCard(proto: LuaTable, card: DeckCard, index: number): LuaValue {
  const t = cloneLuaTable(proto);
  t.set('sort_id', card.sortId);
  t.set('playing_card', card.playingCard);
  t.set('rank', index);
  (t.get('params') as LuaTable).set('playing_card', card.playingCard);
  // 牌面 key 必须与 base 同花色同点数：游戏按它取 G.P_CARDS[key] 的图集与花色逻辑
  (t.get('save_fields') as LuaTable).set('card', `${card.suit}_${card.rank}`);

  // 增强：改 save_fields.center / label，并按 Card:set_ability（card.lua:277-337）重算 ability
  const enh = card.enhancement ? ENHANCEMENTS.find(e => e.key === card.enhancement) : undefined;
  if (card.enhancement && !enh) throw new Error(`未知增强类型: ${card.enhancement}`);
  if (enh) {
    (t.get('save_fields') as LuaTable).set('center', enh.key);
    t.set('label', enh.label);
    applyEnhancementAbility(t, enh);
  }

  // 蜡封：Card:save 的 seal 字段（字符串 key）
  if (card.seal) t.set('seal', card.seal);

  // 版本：Card:save 的 edition 字段（顶层表，与 seal 同级）
  const ed = buildEdition(card.edition);
  if (ed) t.set('edition', ed);
  return t;
}

/** 版本效果数值的存档字段名：闪箔→筹码、镭射→倍率、多彩→X 倍率、负片无数值（card.lua:387-407） */
export const EDITION_VALUE_FIELD: Record<string, string> = { foil: 'chips', holo: 'mult', polychrome: 'x_mult' };

/**
 * 扑克牌可用的版本：仅 闪箔 / 镭射 / 多彩。
 * 负片只作用于小丑与消耗品——游戏里给扑克牌加版本的唯一两条路径（Aura 幽灵牌 `card.lua:1195`、
 * 标准包 `card.lua:1761`）都显式传 `no_neg = true` 把负片排除；且负片的唯一效果是「不占槽位」
 * （`card.lua:687` jokers / `931` consumeables），扑克牌在牌堆里不占槽位，加了也毫无作用。
 */
const DECK_EDITIONS: readonly string[] = ['foil', 'holo', 'polychrome'];

/** 生成 edition 表（Card:set_edition 的键序：数值 → 布尔 → type）。
 *  注意：set_edition 里的槽位 +1 只在 added_to_deck（局内获得）时发生，
 *  开局牌堆中的牌不触发，故这里不动 jokers/consumeables 的 card_limit */
export function buildEdition(edition: string | undefined): LuaTable | undefined {
  if (!edition) return undefined;
  const def = EDITIONS.find(e => e.key === edition);
  if (!def) throw new Error(`未知版本类型: ${edition}`);
  if (!DECK_EDITIONS.includes(def.key)) {
    throw new Error(`扑克牌不支持「${def.zhName}」：负片仅作用于小丑与消耗品，游戏内扑克牌无法获得该版本`);
  }
  const t = new LuaTable();
  const field = EDITION_VALUE_FIELD[def.key];
  if (field) t.set(field, def.config.extra);
  t.set(def.key, true);
  t.set('type', def.key);
  return t;
}

/** 增强牌的 ability 表：常量项取 center.config（card.lua:277-302 的公式），其余沿用基础牌 */
function applyEnhancementAbility(t: LuaTable, enh: EnhancementDef): void {
  const c = enh.config;
  const ability = t.get('ability') as LuaTable;
  ability.set('name', enh.enName);
  ability.set('effect', enh.label);
  ability.set('set', 'Enhanced');
  ability.set('mult', c.mult ?? 0);
  ability.set('h_mult', c.h_mult ?? 0);
  ability.set('h_x_mult', c.h_x_mult ?? 0);
  ability.set('h_dollars', c.h_dollars ?? 0);
  ability.set('p_dollars', c.p_dollars ?? 0);
  ability.set('t_mult', c.t_mult ?? 0);
  ability.set('t_chips', c.t_chips ?? 0);
  ability.set('x_mult', c.Xmult ?? 1);
  ability.set('h_size', c.h_size ?? 0);
  ability.set('d_size', c.d_size ?? 0);
  ability.set('bonus', c.bonus ?? 0);
  ability.set('type', c.type ?? '');
  ability.set('order', enh.order);
  if (c.extra !== undefined) ability.set('extra', c.extra);
}

/**
 * 用目标牌组替换存档牌堆（cards + 牌区数量 + GAME.starting_deck_size）。
 * 牌区数量取游戏 CardArea:update 的稳态值（cardarea.lua:265-267）：
 * card_limit/temp_limit 收敛到实际张数，card_count = 实际张数。
 */
export function applyDeckToSave(root: LuaTable, cards: DeckCard[]): void {
  const area = (root.get('cardAreas') as LuaTable).get('deck') as LuaTable;
  const protos = cardPrototypes(root);

  const list = new LuaTable();
  cards.forEach((card, i) => {
    const proto = protos.get(card.suit + card.rank);
    if (!proto) throw new Error(`模板缺少牌面原型: ${card.suit}_${card.rank}`);
    list.set(i + 1, buildCard(proto, card, i + 1));
  });
  area.set('cards', list);

  const cfg = area.get('config') as LuaTable;
  cfg.set('card_count', cards.length);
  cfg.set('card_limit', cards.length);
  cfg.set('temp_limit', cards.length);

  (root.get('GAME') as LuaTable).set('starting_deck_size', cards.length);
}
