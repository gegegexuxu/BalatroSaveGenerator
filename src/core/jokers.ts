// 小丑牌的界面逻辑：稀有度分组查询、槽位容量判断、贴纸元数据。
// 数据由 scripts/extractData.mjs 生成（src/data/jokers.ts）；存档写入见 core/saveDeck.ts。
// 游戏无「牌组赠送起始小丑」规则，故无牌组默认重建逻辑——切牌组不清空已选小丑。
import { JOKERS, JOKER_RARITY_ZH, JOKER_STICKER_COLOUR, JOKER_STICKER_ZH, type JokerDef } from '../data/jokers';

/** 稀有度顺序与图鉴页签顺序一致（普通 / 罕见 / 稀有 / 传奇） */
export const RARITY_ORDER: readonly number[] = [1, 2, 3, 4];

export function rarityLabel(rarity: number): string {
  return JOKER_RARITY_ZH[rarity] ?? String(rarity);
}

/** 按稀有度取牌池（保持游戏 order 顺序；undefined = 全部） */
export function listJokers(rarity?: number): JokerDef[] {
  return rarity === undefined ? JOKERS : JOKERS.filter(j => j.rarity === rarity);
}

export function jokerByKey(key: string): JokerDef | undefined {
  return JOKERS.find(j => j.key === key);
}

/**
 * 工作列表里的一张小丑牌：key = 中心 key；edition = 版本（undefined = 无版本）；
 * eternal/perishable/rental = 游戏的三种贴纸（card.lua:506-523）。版本与贴纸都是逐牌属性：
 * 加入时刻定制弹窗里的选择决定（写档写 edition 表 / ability 贴纸字段）。
 * 键名与存档字段一致（holo = 镭射）。
 */
export interface JokerItem {
  key: string;
  edition?: 'foil' | 'holo' | 'polychrome' | 'negative';
  eternal?: boolean;
  perishable?: boolean;
  rental?: boolean;
}

/** 版本取值（定制弹窗「版本」组的循环顺序 = 无/闪箔/镭射/多彩/负片） */
export const JOKER_EDITIONS: readonly NonNullable<JokerItem['edition']>[] =
  ['foil', 'holo', 'polychrome', 'negative'];

/** 贴纸的循环列表与展示元数据（永恒 / 易腐 / 租用；色 = 游戏 G.C 徽章色）。
 *  可组合性见 saveDeck.buildJokerCard：永恒/易腐互斥（card.lua:508/515）、租用独立可叠加、
 *  compat 门控在 JokerDef.eternal/perishable_compat（game.lua set_* 直接拒绝）。 */
export const STICKER_ORDER = ['eternal', 'perishable', 'rental'] as const;
export type StickerKey = (typeof STICKER_ORDER)[number];
export const stickerLabel = (key: StickerKey): string => JOKER_STICKER_ZH[key] ?? key;
export const stickerColour = (key: StickerKey): string | undefined => JOKER_STICKER_COLOUR[key];

/** 易腐小丑的开局剩余回合数（G.GAME.perishable_rounds，game.lua:1914） */
export const PERISHABLE_ROUNDS = 5;

/** 槽位硬上限判断：上限 = 参数面板「小丑槽位」+ 已有负片张数（card.lua:405-417，负片每张 +1）。
 *  与消耗牌同规则：负片不占槽位，永远可加。 */
export function canAddJoker(nonNegativeCount: number, capacity: number): boolean {
  return nonNegativeCount < capacity;
}

