// 按目标牌堆重建存档里的牌区：以模板卡表为原型，只改实例字段（增强 / 蜡封 / 版本 / 编号）。
// 建牌思路：模板里 52 张基础牌各一张，直接复用同花色同点数的模板卡表作原型，
// 只改实例相关字段（playing_card / sort_id / rank / save_fields.card），
// 其余字段（base 的颜色、点数、图集坐标等）天然正确，与游戏 Card:save() 的结构一致。
// 消耗牌写入（applyConsumablesToSave）：模板消耗区为空表，无原型可用，
// 按附录 D（真机样例 magic/ghost_initial.jkr）从零构建卡表。
import { LuaTable, cloneLuaTable, jsonToLua, type LuaValue } from './luaTable';
import { ENHANCEMENTS, EDITIONS, type EnhancementDef } from '../data/cardMods';
import { type ConsumableDef } from '../data/consumables';
import { type JokerDef } from '../data/jokers';
import { consumableByKey, type ConsumableItem } from './consumables';
import { jokerByKey, PERISHABLE_ROUNDS, type JokerItem } from './jokers';
import type { BackDef } from '../data/backs';
import type { DeckCard } from './deckGen';

/** 开局消耗牌规格：items = 区内顺序（每张自带负片标记） */
export interface ConsumablesSpec {
  items: ConsumableItem[];
}

/** 开局小丑牌规格：items = 区内顺序（每张自带版本） */
export interface JokersSpec {
  items: JokerItem[];
}

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
export function buildEdition(
  edition: string | undefined,
  opts: { allowNegative?: boolean } = {},
): LuaTable | undefined {
  if (!edition) return undefined;
  const def = EDITIONS.find(e => e.key === edition);
  if (!def) throw new Error(`未知版本类型: ${edition}`);
  const negativeOk = opts.allowNegative === true && def.key === 'negative';
  if (!DECK_EDITIONS.includes(def.key) && !negativeOk) {
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

// ---------- 消耗牌写入（PROJECT_SPEC.md 5.6 / 附录 D）----------

/** 全存档现有最大 sort_id（实例计数器续接用；附录 D.4：唯一即可） */
function maxSortId(root: LuaTable): number {
  let max = 0;
  const areas = root.get('cardAreas') as LuaTable;
  for (const name of ['deck', 'jokers', 'consumeables', 'hand', 'play', 'discard']) {
    const area = areas.get(name);
    if (!(area instanceof LuaTable)) continue;
    const cards = area.get('cards');
    if (!(cards instanceof LuaTable)) continue;
    for (const [, node] of cards.entries) {
      const sid = (node as LuaTable).get('sort_id');
      if (typeof sid === 'number' && sid > max) max = sid;
    }
  }
  return max;
}

/**
 * 单张消耗牌卡表：18 键集合与键序按附录 D（真机样例），ability 数值按
 * card.lua:277-307 set_ability 从 center 定义派生 —— extra 仅在 config.extra 存在时写
 * （塔罗/星球无），ability.consumeable = 整个 center.config 的深拷贝
 * （妖法 {extra=2}、愚者空表、星球 {hand_type=...}）。
 */
function buildConsumableCard(
  def: ConsumableDef,
  deck: BackDef,
  rank: number,
  sortId: number,
  negative: boolean | undefined,
): LuaTable {
  const cfg = def.config;
  const num = (k: string, dflt: number): number => (typeof cfg[k] === 'number' ? (cfg[k] as number) : dflt);
  const ability = new LuaTable()
    .set('set', def.set)
    .set('name', def.enName)
    .set('order', def.order);
  if (def.effect !== undefined) ability.set('effect', def.effect);
  if (cfg.extra !== undefined) ability.set('extra', jsonToLua(cfg.extra));
  ability.set('consumeable', jsonToLua(cfg));
  ability.set('bonus', num('bonus', 0));
  ability.set('h_mult', num('h_mult', 0));
  ability.set('mult', num('mult', 0));
  ability.set('t_mult', num('t_mult', 0));
  ability.set('t_chips', num('t_chips', 0));
  ability.set('h_dollars', num('h_dollars', 0));
  ability.set('p_dollars', num('p_dollars', 0));
  ability.set('h_size', num('h_size', 0));
  ability.set('d_size', num('d_size', 0));
  ability.set('x_mult', num('Xmult', 1));
  ability.set('perma_bonus', 0);
  ability.set('extra_value', 0);
  ability.set('h_x_mult', num('h_x_mult', 0));
  ability.set('hands_played_at_create', 0);
  ability.set('type', typeof cfg.type === 'string' ? (cfg.type as string) : '');

  const t = new LuaTable()
    .set('save_fields', new LuaTable().set('center', def.key))
    .set('label', def.enName)
    .set('rank', rank)
    .set('sort_id', sortId)
    .set('facing', 'front')
    .set('sprite_facing', 'front')
    .set('base', new LuaTable()
      .set('nominal', 0).set('suit_nominal', 0).set('face_nominal', 0).set('times_played', 0))
    .set('ability', ability)
    .set('base_cost', def.cost)
    .set('cost', def.cost)
    .set('extra_cost', 0)
    .set('sell_cost', Math.floor(def.cost / 2))
    .set('added_to_deck', true)
    .set('debuff', false)
    .set('bypass_discovery_center', true)
    .set('bypass_discovery_ui', true)
    .set('bypass_lock', true)
    .set('params', new LuaTable()
      .set('discover', true)
      .set('bypass_discovery_center', true)
      // bypass_back = 目标牌组 pos；样例键序 y 在 x 前（与模板 BACK.pos 一致）
      .set('bypass_back', new LuaTable().set('y', deck.pos.y).set('x', deck.pos.x)));
  const ed = buildEdition('negative', { allowNegative: true });
  if (negative && ed) t.set('edition', ed);
  return t;
}

/**
 * 把开局消耗牌写进 consumeables 区：cards 替换、card_count 同步；
 * card_limit/temp_limit = 槽位数，由 applyRunInit 落盘（魔法牌组的水晶球券 +1
 * 在游戏读档 redeem used_vouchers 时补上，见下）。sort_id 从全存档最大值续接。
 */
export function applyConsumablesToSave(root: LuaTable, deck: BackDef, spec: ConsumablesSpec): void {
  const area = (root.get('cardAreas') as LuaTable).get('consumeables') as LuaTable;
  let sortId = maxSortId(root);
  const list = new LuaTable();
  spec.items.forEach((item, i) => {
    const def = consumableByKey(item.key);
    if (!def) throw new Error(`未知消耗牌: ${item.key}`);
    list.set(i + 1, buildConsumableCard(def, deck, i + 1, ++sortId, item.negative));
  });
  area.set('cards', list);
  const cfg = area.get('config') as LuaTable;
  cfg.set('card_count', spec.items.length);

  // 负片每张使消耗区上限 +1（card.lua:405-417 set_edition：added_to_deck 的负片消耗牌
  // 令 card_limit +1）。存档必须直接写 +1 后的值——读档不走 set_edition。
  // 例：2 槽 + 1 张负片 → card_limit = 3，游戏 HUD 显示 1/3（card_count/card_limit）。
  // temp_limit = max(张数, card_limit)（cardarea.lua:266 的稳态），无负片时同样同步
  const negCount = spec.items.filter(it => it.negative).length;
  cfg.set('card_limit', (cfg.get('card_limit') as number) + negCount);
  cfg.set('temp_limit', Math.max(spec.items.length, cfg.get('card_limit') as number));

  // 魔法牌组自带水晶球券（backs.ts apply_to_run → used_vouchers；真机样例一致）。
  // 读档时游戏对 used_vouchers 逐个 redeem（水晶球 = 消耗区上限 +1），故
  // starting_params.consumable_slots 保持面板值即可，勿在此提前加进 card_limit
  if (deck.key === 'b_magic') {
    const game = root.get('GAME') as LuaTable;
    let uv = game.get('used_vouchers');
    if (!(uv instanceof LuaTable)) {
      uv = new LuaTable();
      game.set('used_vouchers', uv);
    }
    uv.set('v_crystal_ball', true);
  }
}

// ---------- 小丑牌写入（PROJECT_SPEC.md 5.9 / 附录 D.3）----------

/**
 * 单张小丑卡表：18 键集合与消耗牌同构（无 consumeable 子表），数值与键序按
 * card.lua:277-307 set_ability 从 center 定义派生，真机样例 red_round1_jokers.jkr 逐字段对齐：
 *   - x_mult 默认 1（小丑的 set_ability 公式与消耗牌一致）
 *   - effect 为空串时也写（游戏无条件拷贝 center.effect；仅未定义该字段的中心如 j_gift 不写）
 *   - params.discover = false、bypass_back = {0,0}（小丑来源是商店/新建，不是牌组，样例 D.3）
 * 创建期特例（card.lua:308-333 set_ability 尾部）：这些字段缺失会让游戏在读档后
 * nil 算术崩溃（invis_rounds +1）或悬停说明报错（to_do_poker_hand 传 nil），
 * 与游戏开局创建小丑时的赋值一致地补上。
 * 贴纸（card.lua:506-523 set_eternal/set_perishable/set_rental）写在 ability 上：
 *   - 永恒/易腐互斥且受 center compat 门控（游戏 set_* 直接拒绝）；
 *   - 易腐开局写 perish_tally = G.GAME.perishable_rounds（game.lua:1914，= 5）；
 *   - 租用令 cost = 1（card.lua:381 set_cost）、sell_cost = max(1, floor(cost/2)) = 1
 *     （card.lua:382；租金 $3/回合由游戏按 G.GAME.rental_rate 逐回合扣，无需落盘）。
 */
function buildJokerCard(
  def: JokerDef,
  rank: number,
  sortId: number,
  edition: JokerItem['edition'],
  stickers: Pick<JokerItem, 'eternal' | 'perishable' | 'rental'> = {},
): LuaTable {
  const cfg = def.config;
  const num = (k: string, dflt: number): number => (typeof cfg[k] === 'number' ? (cfg[k] as number) : dflt);
  const ability = new LuaTable()
    .set('set', 'Joker')
    .set('name', def.enName)
    .set('order', def.order);
  if (def.effect !== undefined) ability.set('effect', def.effect);
  if (cfg.extra !== undefined) ability.set('extra', jsonToLua(cfg.extra));
  ability.set('bonus', num('bonus', 0));
  ability.set('h_mult', num('h_mult', 0));
  ability.set('mult', num('mult', 0));
  ability.set('t_mult', num('t_mult', 0));
  ability.set('t_chips', num('t_chips', 0));
  ability.set('h_dollars', num('h_dollars', 0));
  ability.set('p_dollars', num('p_dollars', 0));
  ability.set('h_size', num('h_size', 0));
  ability.set('d_size', num('d_size', 0));
  ability.set('x_mult', num('Xmult', 1));
  ability.set('perma_bonus', 0);
  ability.set('extra_value', 0);
  ability.set('h_x_mult', num('h_x_mult', 0));
  ability.set('hands_played_at_create', 0);
  ability.set('type', typeof cfg.type === 'string' ? (cfg.type as string) : '');

  const extra = (cfg.extra ?? {}) as Record<string, unknown>;
  if (def.enName === 'Invisible Joker') ability.set('invis_rounds', 0);
  if (def.enName === 'To Do List') ability.set('to_do_poker_hand', 'High Card');   // 游戏随机取可见牌型；生成值取高牌
  if (def.enName === 'Caino') ability.set('caino_xmult', 1);
  if (def.enName === 'Yorick') ability.set('yorick_discards', typeof extra.discards === 'number' ? extra.discards : 0);
  if (def.enName === 'Loyalty Card') {
    ability.set('burnt_hand', 0);
    ability.set('loyalty_remaining', typeof extra.every === 'number' ? extra.every : 0);
  }
  // 贴纸：互斥与 compat 门控与游戏 set_* 行为一致
  if (stickers.eternal && def.eternal_compat) ability.set('eternal', true);
  if (stickers.perishable && def.perishable_compat && !stickers.eternal) {
    ability.set('perishable', true);
    ability.set('perish_tally', PERISHABLE_ROUNDS);
  }
  if (stickers.rental) ability.set('rental', true);

  // 租用小丑的当前价 = $1（card.lua:381），售价 = max(1, floor(cost/2))（card.lua:382）；
  // base_cost 保持中心定义价不变（样例：base_cost = cost = 6 的非租用小丑）
  const rental = ability.get('rental') === true;
  const cost = rental ? 1 : def.cost;
  const t = new LuaTable()
    .set('save_fields', new LuaTable().set('center', def.key))
    .set('label', def.enName)                  // card.lua:340 set='Joker' 时 label = ability.name
    .set('rank', rank)
    .set('sort_id', sortId)
    .set('facing', 'front')
    .set('sprite_facing', 'front')
    .set('base', new LuaTable()
      .set('nominal', 0).set('suit_nominal', 0).set('face_nominal', 0).set('times_played', 0))
    .set('ability', ability)
    .set('base_cost', def.cost)
    .set('cost', cost)
    .set('extra_cost', 0)
    .set('sell_cost', Math.max(1, Math.floor(cost / 2)))
    .set('added_to_deck', true)
    .set('debuff', false)
    .set('bypass_discovery_center', true)
    .set('bypass_discovery_ui', true)
    .set('bypass_lock', true)
    .set('params', new LuaTable()
      .set('discover', false)                  // 样例 D.3：小丑不改 discover（消耗牌是 true）
      .set('bypass_discovery_center', true)
      .set('bypass_discovery_ui', true)
      // 小丑来源与牌组无关：bypass_back 固定 {0,0}（附录 D.4，区别于消耗牌的牌组 pos）
      .set('bypass_back', new LuaTable().set('y', 0).set('x', 0)));
  const ed = buildEdition(edition, { allowNegative: true });
  if (ed) t.set('edition', ed);
  return t;
}

/**
 * 把开局小丑写进 jokers 区：cards 替换、card_count 同步；槽位数由 applyRunInit 落盘。
 * 负片每张使 jokers 区上限 +1（card.lua:687 set_edition，与消耗区同规则），
 * card_limit 直接写 +1 后的值——读档不走 set_edition；temp_limit = max(张数, card_limit)。
 * sort_id 从全存档最大值续接（唯一即可，附录 D.4）。
 */
export function applyJokersToSave(root: LuaTable, spec: JokersSpec): void {
  const area = (root.get('cardAreas') as LuaTable).get('jokers') as LuaTable;
  let sortId = maxSortId(root);
  const list = new LuaTable();
  spec.items.forEach((item, i) => {
    const def = jokerByKey(item.key);
    if (!def) throw new Error(`未知小丑: ${item.key}`);
    list.set(i + 1, buildJokerCard(def, i + 1, ++sortId, item.edition,
      { eternal: item.eternal, perishable: item.perishable, rental: item.rental }));
  });
  area.set('cards', list);
  const cfg = area.get('config') as LuaTable;
  cfg.set('card_count', spec.items.length);

  const negCount = spec.items.filter(it => it.edition === 'negative').length;
  cfg.set('card_limit', (cfg.get('card_limit') as number) + negCount);
  cfg.set('temp_limit', Math.max(spec.items.length, cfg.get('card_limit') as number));
}
