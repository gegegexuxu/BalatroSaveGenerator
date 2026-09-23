// 从真实存档模板提取完整牌组（52 张）的牌面数据：花色 / 点数 / 强化
// 数据即存档 cardAreas.deck.cards 的内容——存档里有强化的牌会带 enhancement 字段
import { parseLua, type LuaTable } from './luaTable';
import templateSource from '../data/templateSource';

export interface SaveCard {
  /** 花色文件代号：S / H / C / D（对应 cards/{S}_{R}.png）*/
  suit: string;
  /** 点数文件代号：A / K / Q / J / T / 9..2 */
  rank: string;
  /** 强化底板代号（Bonus / Mult / Steel Card 等），普通牌为 undefined */
  enhancement?: string;
}

const SUIT_FILE: Record<string, string> = { Spades: 'S', Hearts: 'H', Clubs: 'C', Diamonds: 'D' };
const VALUE_FILE: Record<string, string> = { Ace: 'A', King: 'K', Queen: 'Q', Jack: 'J', '10': 'T' };
// 存档中 enhancement 字段值 → enhancement 底板文件名
const ENH_FILE: Record<string, string> = {
  m_bonus: 'Bonus', m_mult: 'Mult', m_glass: 'Glass Card', m_steel: 'Steel Card',
  m_gold: 'Gold', m_lucky: 'Lucky Card', m_wild: 'Wild Card', m_stone: 'Stone Card',
};

const SUIT_ORDER = ['S', 'H', 'C', 'D'];
const RANK_ORDER = ['A', 'K', 'Q', 'J', 'T', '9', '8', '7', '6', '5', '4', '3', '2'];

let cache: SaveCard[] | undefined;

/** 模板存档中的 52 张牌，按花色（黑桃/红心/梅花/方块）与点数降序排列 */
export function deckCards(): SaveCard[] {
  if (cache) return cache;
  const root = parseLua(templateSource);
  const deckArea = ((root.get('cardAreas') as LuaTable).get('deck') as LuaTable);
  const cards = deckArea.get('cards') as LuaTable;
  const list: SaveCard[] = [];
  for (const [, node] of cards.entries) {
    const t = node as LuaTable;
    const base = t.get('base') as LuaTable;
    const suit = SUIT_FILE[String(base.get('suit'))];
    const value = String(base.get('value'));
    const rank = VALUE_FILE[value] ?? value;
    if (!suit || !rank) throw new Error(`存档牌面数据异常: ${suit}_${rank} (${base.get('name')})`);
    const enhRaw = t.get('enhancement');
    const enhancement = typeof enhRaw === 'string' ? ENH_FILE[enhRaw] : undefined;
    if (enhRaw !== undefined && !enhancement) throw new Error(`未知强化类型: ${String(enhRaw)}`);
    list.push({ suit, rank, enhancement });
  }
  list.sort((a, b) =>
    SUIT_ORDER.indexOf(a.suit) - SUIT_ORDER.indexOf(b.suit) ||
    RANK_ORDER.indexOf(a.rank) - RANK_ORDER.indexOf(b.rank));
  cache = list;
  return list;
}
