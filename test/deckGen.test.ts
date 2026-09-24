// 牌组生成测试：
// 1) LuaJIT PRNG / Balatro pseudoseed 与社区参考实现（dlew/balatro-erratic-generator）逐值对齐
// 2) 各牌组类型的默认牌堆（张数、花色点数、牌组专属规则）
// 3) 写入存档后的结构自洽（牌堆张数 / starting_deck_size / save_fields.card）
import { describe, it, expect } from 'vitest';
import { inflateRawSync } from 'node:zlib';
import { LuaPrng } from '../src/core/luajitRandom';
import { pseudohash, truncate13, RunRng, pseudorandomElementIndex } from '../src/core/balatroRng';
import { defaultDeckCards, renumberDeck, type DeckCard } from '../src/core/deckGen';
import { generateSave } from '../src/core/generate';
import { parseLua, LuaTable } from '../src/core/luaTable';
import { validateSave } from '../src/core/validate';
import { BACKS } from '../src/data/backs';

const deck = (key: string) => {
  const def = BACKS.find(b => b.key === key);
  if (!def) throw new Error(`测试用牌组不存在: ${key}`);
  return def;
};

const tally = (cards: DeckCard[], pick: (c: DeckCard) => string): Record<string, number> => {
  const out: Record<string, number> = {};
  for (const c of cards) out[pick(c)] = (out[pick(c)] ?? 0) + 1;
  return out;
};

/** 与参考实现一致：0 基下标（Lua math.random(52) - 1） */
const random52 = (seed: number): number => pseudorandomElementIndex(52, seed);

describe('LuaJIT math.random 复刻（参考实现测试向量）', () => {
  it('random(seed)：TW223 输出与参考实现逐值一致', () => {
    expect(new LuaPrng(1.0).random()).toBe(0.3238105623786367);
    expect(new LuaPrng(0.15252152112567).random()).toBe(0.9092652238207108);
    expect(new LuaPrng(0.5993819212141018).random()).toBe(0.02339323168160301);
  });

  it('random(52)：0 基下标与参考实现一致', () => {
    expect(random52(1.0)).toBe(16);
    expect(random52(0.15252152112567)).toBe(47);
  });

  it('每次 math.randomseed 都是全新状态（连续取值不推进同一实例）', () => {
    const a = new LuaPrng(1.0).random();
    const b = new LuaPrng(1.0).random();
    expect(a).toBe(b);
    const prng = new LuaPrng(1.0);
    expect(prng.random()).not.toBe(prng.random());
  });
});

describe('pseudohash / pseudoseed 复刻', () => {
  it('pseudohash 值与参考实现一致', () => {
    expect(pseudohash('erratic')).toBe(0.45752552206801056);
    expect(pseudohash('erratic11153DRU')).toBe(0.8218377909411174);
    expect(pseudohash('11153DRU')).toBe(0.6472053688891037);
    expect(pseudohash('7LB2WVPK')).toBe(0.17691054639954018);
  });

  it('溢出成 NaN 的种子（游戏里的「坏种子」，整副牌变成同一张）', () => {
    expect(Number.isNaN(pseudohash('erratic7LB2WVPK'))).toBe(true);
  });

  it('pseudoseed 推进一次后的取值与参考实现一致', () => {
    const rng = new RunRng('11153DRU');
    expect(rng.hashedSeed).toBe(pseudohash('11153DRU'));
    expect(rng.pseudoseed('erratic')).toBe(0.5993819212141018);
  });

  it('同一 key 持续推进、不同 key 互不影响', () => {
    const rng = new RunRng('11153DRU');
    const first = rng.pseudoseed('erratic');
    const second = rng.pseudoseed('erratic');
    expect(second).not.toBe(first);
    expect(pseudohash('shuffle' + '11153DRU')).not.toBe(pseudohash('11153DRU'));
  });

  it('%.13f 截断：正常值四舍五入，非有限值原样保留', () => {
    expect(truncate13(0.55155847353913)).toBe(0.5515584735391);
    expect(truncate13(1 / 3)).toBe(0.3333333333333);
    expect(truncate13(0)).toBe(0);
    expect(Number.isNaN(truncate13(NaN))).toBe(true);
  });
});

describe('各牌组类型的默认牌堆', () => {
  it('普通牌组：52 张，四花色各 13、点数各 4', () => {
    const cards = defaultDeckCards(deck('b_red'), 'RED12345');
    expect(cards).toHaveLength(52);
    const bySuit = tally(cards, c => c.suit);
    expect(bySuit).toEqual({ C: 13, D: 13, H: 13, S: 13 });
    const byRank = tally(cards, c => c.rank);
    expect(Object.values(byRank)).toEqual(new Array(13).fill(4));
  });

  it('废弃牌组：40 张且没有人头牌（J/Q/K 全无）', () => {
    const cards = defaultDeckCards(deck('b_abandoned'), 'ABND1234');
    expect(cards).toHaveLength(40);
    expect(cards.filter(c => ['J', 'Q', 'K'].includes(c.rank))).toHaveLength(0);
    const bySuit = tally(cards, c => c.suit);
    expect(bySuit).toEqual({ C: 10, D: 10, H: 10, S: 10 });
  });

  it('方格牌组：26 张黑桃 + 26 张红桃', () => {
    const cards = defaultDeckCards(deck('b_checkered'), 'CHKR1234');
    expect(cards).toHaveLength(52);
    expect(tally(cards, c => c.suit)).toEqual({ S: 26, H: 26 });
    expect(Object.values(tally(cards, c => c.rank))).toEqual(new Array(13).fill(4));
  });

  it('古怪牌组：按种子复刻游戏随机结果（点数/花色可能出现重复与缺失）', () => {
    // 参考实现 card_counter("11153DRU")：K 17 张、方块 19 张
    const a = defaultDeckCards(deck('b_erratic'), '11153DRU');
    expect(a).toHaveLength(52);
    expect(tally(a, c => c.rank).K).toBe(17);
    expect(tally(a, c => c.suit).D).toBe(19);

    // 坏种子：整副 52 张全是黑桃 10（NaN 随机流定死）
    const bad = defaultDeckCards(deck('b_erratic'), '7LB2WVPK');
    expect(bad.every(c => c.suit === 'S' && c.rank === 'T')).toBe(true);
  });

  it('同种子可复现、不同种子开局洗牌不同', () => {
    const a1 = defaultDeckCards(deck('b_erratic'), '11153DRU');
    const a2 = defaultDeckCards(deck('b_erratic'), '11153DRU');
    expect(a2).toEqual(a1);
    const b = defaultDeckCards(deck('b_erratic'), 'GGGG1234');
    expect(b.map(c => c.suit + c.rank).join()).not.toBe(a1.map(c => c.suit + c.rank).join());

    // 普通牌组同样受开局洗牌影响（game.lua:2383 self.deck:shuffle()）
    const r1 = defaultDeckCards(deck('b_red'), 'RED12345');
    const r2 = defaultDeckCards(deck('b_red'), 'BLUE1234');
    expect(r2.map(c => c.playingCard).join()).not.toBe(r1.map(c => c.playingCard).join());
  });

  it('playing_card / sort_id 为 1..n 且与建牌序一致', () => {
    for (const key of ['b_red', 'b_abandoned', 'b_checkered', 'b_erratic']) {
      const cards = defaultDeckCards(deck(key), 'SEED1234');
      const ids = cards.map(c => c.playingCard).sort((x, y) => x - y);
      expect(ids).toEqual(Array.from({ length: cards.length }, (_, i) => i + 1));
      expect(cards.every(c => c.sortId === c.playingCard)).toBe(true);
    }
  });
});

describe('牌堆写入存档', () => {
  const init = { hands: 4, discards: 3, dollars: 4, seed: 'ABND1234' };

  it('废弃牌组：张数、牌区配置、starting_deck_size 三处同步为 40', () => {
    const cards = defaultDeckCards(deck('b_abandoned'), init.seed);
    const root = parseLua(inflateRawSync(generateSave('b_abandoned', 1, init, cards)).toString('utf8'));
    expect(() => validateSave(root)).not.toThrow();

    const area = (root.get('cardAreas') as LuaTable).get('deck') as LuaTable;
    const cardList = area.get('cards') as LuaTable;
    const cfg = area.get('config') as LuaTable;
    expect(cardList.entries.size).toBe(40);
    expect(cfg.get('card_count')).toBe(40);
    expect(cfg.get('card_limit')).toBe(40);
    expect(cfg.get('temp_limit')).toBe(40);
    expect((root.get('GAME') as LuaTable).get('starting_deck_size')).toBe(40);

    // 每张牌：键序与模板一致，牌面 key 与 base 同花色点数，rank = 牌堆序
    const faces = new Set<string>();
    let index = 0;
    for (const [k, v] of cardList.entries) {
      const t = v as LuaTable;
      index++;
      expect(k).toBe(index);
      expect(t.get('rank')).toBe(index);
      const base = t.get('base') as LuaTable;
      const suit = { Spades: 'S', Hearts: 'H', Clubs: 'C', Diamonds: 'D' }[String(base.get('suit'))];
      const value = String(base.get('value'));
      const rank = { Ace: 'A', King: 'K', Queen: 'Q', Jack: 'J', '10': 'T' }[value] ?? value;
      expect((t.get('save_fields') as LuaTable).get('card')).toBe(`${suit}_${rank}`);
      expect(['J', 'Q', 'K']).not.toContain(rank);
      expect((t.get('params') as LuaTable).get('playing_card')).toBe(t.get('playing_card'));
      faces.add(`${suit}_${rank}`);
    }
    expect(faces.size).toBe(40); // 废弃牌组 40 张互不重复
  });

  it('古怪牌组坏种子：写入存档后 52 张全是黑桃 10', () => {
    const cards = defaultDeckCards(deck('b_erratic'), '7LB2WVPK');
    const root = parseLua(inflateRawSync(generateSave('b_erratic', 1,
      { ...init, seed: '7LB2WVPK' }, cards)).toString('utf8'));
    const cardList = ((root.get('cardAreas') as LuaTable).get('deck') as LuaTable).get('cards') as LuaTable;
    expect(cardList.entries.size).toBe(52);
    for (const [, v] of cardList.entries) {
      const base = (v as LuaTable).get('base') as LuaTable;
      expect(base.get('suit')).toBe('Spades');
      expect(base.get('value')).toBe('10');
    }
    expect(() => validateSave(root)).not.toThrow();
  });

  it('15 种牌组逐个 + 种子写入后仍通过校验', () => {
    for (const def of BACKS.filter(b => !b.omit)) {
      const cards = defaultDeckCards(def, 'CHECK123');
      const root = parseLua(inflateRawSync(
        generateSave(def.key, 3, { ...init, seed: 'CHECK123' }, cards)).toString('utf8'));
      expect(() => validateSave(root)).not.toThrow();
      const cardList = ((root.get('cardAreas') as LuaTable).get('deck') as LuaTable).get('cards') as LuaTable;
      expect(cardList.entries.size).toBe(cards.length);
    }
  });

  it('不传牌堆时保持模板牌堆（旧行为不变）', () => {
    const root = parseLua(inflateRawSync(generateSave('b_red')).toString('utf8'));
    const cardList = ((root.get('cardAreas') as LuaTable).get('deck') as LuaTable).get('cards') as LuaTable;
    expect(cardList.entries.size).toBe(52);
  });
});

describe('增强 / 蜡封（扑克详情弹窗的改动）', () => {
  const glow = (root: LuaTable, i: number): LuaTable =>
    (((root.get('cardAreas') as LuaTable).get('deck') as LuaTable).get('cards') as LuaTable).get(i) as LuaTable;

  it('增强牌：save_fields.center / label / ability 按 Card:set_ability 重算', () => {
    const cards = defaultDeckCards(deck('b_red'), 'GLAS1234');
    cards[0].enhancement = 'm_glass';
    cards[1].enhancement = 'm_bonus';
    const root = parseLua(inflateRawSync(
      generateSave('b_red', 1, { hands: 4, discards: 3, dollars: 4, seed: 'GLAS1234' }, cards)).toString('utf8'));
    expect(() => validateSave(root)).not.toThrow();

    const glass = glow(root, 1);
    expect((glass.get('save_fields') as LuaTable).get('center')).toBe('m_glass');
    expect(glass.get('label')).toBe('Glass Card');
    const ga = glass.get('ability') as LuaTable;
    expect(ga.get('name')).toBe('Glass Card');
    expect(ga.get('set')).toBe('Enhanced');
    expect(ga.get('effect')).toBe('Glass Card');
    expect(ga.get('x_mult')).toBe(2);        // config.Xmult
    expect(ga.get('extra')).toBe(4);
    expect(ga.get('order')).toBe(5);
    expect(ga.get('bonus')).toBe(0);
    expect(ga.get('mult')).toBe(0);
    expect(ga.get('hands_played_at_create')).toBe(0);

    const bonus = glow(root, 2);
    expect((bonus.get('save_fields') as LuaTable).get('center')).toBe('m_bonus');
    expect(bonus.get('label')).toBe('Bonus Card');
    expect((bonus.get('ability') as LuaTable).get('bonus')).toBe(30);

    // 未改动的那张仍是基础牌
    const plain = glow(root, 3);
    expect((plain.get('save_fields') as LuaTable).get('center')).toBe('c_base');
    expect((plain.get('ability') as LuaTable).get('name')).toBe('Default Base');
    expect(plain.get('seal')).toBe(undefined);
  });

  it('蜡封：写入 seal 字段（字符串 key）', () => {
    const cards = defaultDeckCards(deck('b_red'), 'SEAL1234');
    cards[0].seal = 'Red';
    cards[1].seal = 'Purple';
    const root = parseLua(inflateRawSync(
      generateSave('b_red', 1, { hands: 4, discards: 3, dollars: 4, seed: 'SEAL1234' }, cards)).toString('utf8'));
    expect(glow(root, 1).get('seal')).toBe('Red');
    expect(glow(root, 2).get('seal')).toBe('Purple');
    expect(glow(root, 3).get('seal')).toBe(undefined);   // 无蜡封不写字段
    expect(() => validateSave(root)).not.toThrow();
  });

  it('花色改动：save_fields.card 与 base 同步（详情弹窗的「花色」组）', () => {
    const cards = defaultDeckCards(deck('b_red'), 'SU1T2345');
    const moved = cards.find(c => c.suit === 'S' && c.rank === 'A')!;
    moved.suit = 'H';                                    // 黑桃 A → 红桃 A
    const root = parseLua(inflateRawSync(
      generateSave('b_red', 1, { hands: 4, discards: 3, dollars: 4, seed: 'SU1T2345' }, cards)).toString('utf8'));
    for (const [, v] of (((root.get('cardAreas') as LuaTable).get('deck') as LuaTable).get('cards') as LuaTable).entries) {
      const t = v as LuaTable;
      const base = t.get('base') as LuaTable;
      if (base.get('suit') === 'Hearts' && base.get('value') === 'Ace') {
        expect((t.get('save_fields') as LuaTable).get('card')).toBe('H_A');
        expect(base.get('name')).toBe('Ace of Hearts');   // base 整体取自红桃 A 的原型
      }
    }
    expect(() => validateSave(root)).not.toThrow();
  });

  it('点数改动：save_fields.card / base.value / base.nominal 同步（详情弹窗的「点数」组）', () => {
    const cards = defaultDeckCards(deck('b_red'), 'RANK1234');
    const moved = cards.find(c => c.suit === 'S' && c.rank === 'A')!;
    moved.rank = 'K';                                    // 黑桃 A → 黑桃 K
    const root = parseLua(inflateRawSync(
      generateSave('b_red', 1, { hands: 4, discards: 3, dollars: 4, seed: 'RANK1234' }, cards)).toString('utf8'));
    let kings = 0;
    for (const [, v] of (((root.get('cardAreas') as LuaTable).get('deck') as LuaTable).get('cards') as LuaTable).entries) {
      const t = v as LuaTable;
      const base = t.get('base') as LuaTable;
      if (base.get('value') === 'Ace' && base.get('suit') === 'Spades') throw new Error('被改掉的黑桃 A 仍以 A 写入');
      if (base.get('suit') === 'Spades' && base.get('value') === 'King') {
        kings++;
        expect((t.get('save_fields') as LuaTable).get('card')).toBe('S_K');
        expect(base.get('name')).toBe('King of Spades');
        expect(base.get('nominal')).toBe(10);            // 人头牌点数
        expect(base.get('face_nominal')).toBe(0.3);
      }
    }
    expect(kings).toBe(2);                               // 原 S_K + 改出来的那张
    expect(() => validateSave(root)).not.toThrow();
  });
});

describe('牌堆手工编辑（右键删除 / 编号重排）', () => {
  it('renumberDeck 按当前顺序重编 1..n', () => {
    const cards = defaultDeckCards(deck('b_red'), 'ED1T2345');
    cards.splice(5, 1);                                   // 删掉一张
    cards.splice(0, 0, { ...cards[0] });                  // 再插入一张（同牌面副本）
    renumberDeck(cards);
    expect(cards.map(c => c.playingCard)).toEqual(Array.from({ length: 52 }, (_, i) => i + 1));
    expect(cards.every(c => c.sortId === c.playingCard)).toBe(true);
  });

  it('编辑后写入存档：张数、编号唯一性与校验全部自洽', () => {
    const cards = defaultDeckCards(deck('b_checkered'), 'ED1T2345');
    // 插入一张黑桃 A 的副本、删掉一张红桃 2
    const dup = cards.find(c => c.suit === 'S' && c.rank === 'A')!;
    cards.splice(cards.indexOf(dup) + 1, 0, { ...dup });
    const del = cards.find(c => c.suit === 'H' && c.rank === '2')!;
    cards.splice(cards.indexOf(del), 1);
    renumberDeck(cards);

    const root = parseLua(inflateRawSync(
      generateSave('b_checkered', 1, { hands: 4, discards: 3, dollars: 4, seed: 'ED1T2345' }, cards)).toString('utf8'));
    expect(() => validateSave(root)).not.toThrow();

    const area = (root.get('cardAreas') as LuaTable).get('deck') as LuaTable;
    const cardList = area.get('cards') as LuaTable;
    const cfg = area.get('config') as LuaTable;
    expect(cardList.entries.size).toBe(52);               // 52 + 1（复制）- 1（删除）
    expect(cfg.get('card_limit')).toBe(52);
    expect((root.get('GAME') as LuaTable).get('starting_deck_size')).toBe(52);

    const seen = new Set<number>();
    let spadeAces = 0;
    let heartTwos = 0;
    for (const [, v] of cardList.entries) {
      const t = v as LuaTable;
      const pc = t.get('playing_card') as number;
      expect(seen.has(pc)).toBe(false);                   // 编号唯一
      seen.add(pc);
      expect((t.get('params') as LuaTable).get('playing_card')).toBe(pc);
      const base = t.get('base') as LuaTable;
      if (base.get('suit') === 'Spades' && base.get('value') === 'Ace') spadeAces++;
      if (base.get('suit') === 'Hearts' && base.get('value') === '2') heartTwos++;
    }
    expect(seen.size).toBe(52);
    expect(spadeAces).toBe(3);                            // 方格牌组原有 2 张黑桃 A，复制 1 张后 3 张
    expect(heartTwos).toBe(1);                            // 原有 2 张红桃 2，删掉 1 张后剩 1 张
  });
});
