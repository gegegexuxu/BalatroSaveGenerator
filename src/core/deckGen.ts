// 按牌组类型生成「游戏默认牌组」：复刻 game.lua:start_run 的建牌顺序（2340-2375）
// 与开局洗牌（2383 self.deck:shuffle()），以及 back.lua:apply_to_run 里的牌组改动。
import type { BackDef } from '../data/backs';
import { RunRng, pseudorandomElementIndex, pseudoshuffle } from './balatroRng';

/** P_CARDS 的键序（Lua pairs 后按字符串排序）：花色 C<D<H<S，点数 2..9 < A < J < K < Q < T */
export const SUIT_CHARS = ['C', 'D', 'H', 'S'] as const;
export const RANK_CHARS = ['2', '3', '4', '5', '6', '7', '8', '9', 'A', 'J', 'K', 'Q', 'T'] as const;
export type SuitChar = (typeof SUIT_CHARS)[number];
export type RankChar = (typeof RANK_CHARS)[number];

/** P_CARDS 的 52 个 key（如 "S_Q"），即 pseudorandom_element 的排序后候选表 */
const CARD_KEYS: string[] = SUIT_CHARS.flatMap(s => RANK_CHARS.map(r => `${s}_${r}`));

const FACE_RANKS: readonly string[] = ['J', 'Q', 'K'];

export interface DeckCard {
  suit: SuitChar;
  rank: RankChar;
  /** 存档 playing_card：建牌顺序编号 1..n（游戏里 G.playing_card 会话自增） */
  playingCard: number;
  /** 存档 sort_id：与建牌顺序同序（游戏里是会话级自增，洗牌只看相对序） */
  sortId: number;
  /** 增强（存档 save_fields.center，如 m_glass）；无增强为 undefined */
  enhancement?: string;
  /** 蜡封（存档 seal）：Red / Blue / Gold / Purple；无蜡封为 undefined */
  seal?: string;
  /** 版本（存档 edition，互斥单值）：foil / holo / polychrome / negative；无版本为 undefined */
  edition?: string;
}

/** 新建牌的初值（黑桃 A、无增强无蜡封）；编号由 renumberDeck 统一分配 */
export function blankCard(): DeckCard {
  return { suit: 'S', rank: 'A', playingCard: 0, sortId: 0 };
}

/** 按当前牌堆顺序重编 playing_card / sort_id（1..n）。
 *  删牌/复制后调用：唯一性是唯一硬约束（PROJECT_SPEC §5.5），编号只需连续且不重复 */
export function renumberDeck(cards: DeckCard[]): void {
  cards.forEach((c, i) => {
    c.playingCard = i + 1;
    c.sortId = i + 1;
  });
}

interface Proto {
  suit: SuitChar;
  rank: RankChar;
}

/** 建牌前的 card_protos：牌组类型决定候选与过滤（game.lua:2335-2365 + back.lua） */
function deckProtos(def: BackDef, rng: RunRng): Proto[] {
  let protos: Proto[];
  if (def.config.randomize_rank_suit) {
    // 古怪牌组：为每一张牌随机抽一个「点数+花色」（pseudoseed('erratic') 每张推进一次）
    protos = [];
    for (let i = 0; i < CARD_KEYS.length; i++) {
      const key = CARD_KEYS[pseudorandomElementIndex(CARD_KEYS.length, rng.pseudoseed('erratic'))];
      protos.push({ suit: key[0] as SuitChar, rank: key[2] as RankChar });
    }
  } else {
    protos = CARD_KEYS.map(k => ({ suit: k[0] as SuitChar, rank: k[2] as RankChar }));
  }
  // 废弃牌组：去掉人头牌（back.lua remove_faces → starting_params.no_faces）
  if (def.config.remove_faces) protos = protos.filter(p => !FACE_RANKS.includes(p.rank));
  return protos;
}

/** 方格牌组：梅花→黑桃、方块→红桃（back.lua 按牌组名改花色，不改动牌序） */
function relabel(def: BackDef, cards: DeckCard[]): DeckCard[] {
  if (def.key !== 'b_checkered') return cards;
  const convert = (s: SuitChar): SuitChar => (s === 'C' ? 'S' : s === 'D' ? 'H' : s);
  return cards.map(c => ({ ...c, suit: convert(c.suit) }));
}

/**
 * 指定牌组 + 种子下的默认牌组（返回牌堆顺序 = 游戏读档时 G.deck 的顺序）。
 * 顺序 = 建牌序（按 s..r 字符串序）→ 开局洗牌 pseudoshuffle(pseudoseed('shuffle'))。
 */
export function defaultDeckCards(def: BackDef, seed: string): DeckCard[] {
  const rng = new RunRng(seed);
  const protos = deckProtos(def, rng);
  // game.lua:2360-2362 建牌前按 (s..r..e..d..g) 排序
  protos.sort((a, b) => (a.suit + a.rank < b.suit + b.rank ? -1 : 1));

  const cards: DeckCard[] = protos.map((p, i) => ({
    suit: p.suit,
    rank: p.rank,
    playingCard: i + 1,
    sortId: i + 1,
  }));

  // game.lua:2383 self.deck:shuffle()：按 sort_id 归位后 Fisher–Yates（牌序与真实开局一致）
  pseudoshuffle(cards, rng.pseudoseed('shuffle'));
  return relabel(def, cards);
}
