// 小丑牌写入存档的门禁测试（PROJECT_SPEC.md 5.7 / 附录 D.3）：生成的小丑卡表与真机样例
// 存档（red_round1_jokers.jkr：j_gift + j_wrathful_joker）逐字段一致。例外（均为对局进度，
// 生成的是开局初始值）：
//   - sort_id：实例计数器只需唯一，不与样例比对
//   - ability.hands_played_at_create：样例取自已打过 2 手牌的对局（=2），开局为 0
// 负片/其他版本无同款真机样例，结构依据 Card:save / Card:set_edition（见 buildEdition）。
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { inflateRawSync } from 'node:zlib';
import { parseLua, LuaTable, type LuaValue } from '../src/core/luaTable';
import { generateSave } from '../src/core/generate';
import { EDITIONS } from '../src/data/cardMods';
import { EDITION_VALUE_FIELD } from '../src/core/saveDeck';

const sample = (name: string): string =>
  inflateRawSync(readFileSync(new URL(`../references/save/sample/${name}.jkr`, import.meta.url))).toString('utf8');

/** LuaTable → 普通值；数字键全为连续 1..n 时转数组（按键序升序），否则转对象 */
function toJS(v: LuaValue): unknown {
  if (!(v instanceof LuaTable)) return v;
  const keys = [...v.entries.keys()];
  if (keys.length > 0 && keys.every(k => typeof k === 'number')) {
    const out: unknown[] = [];
    for (let i = 1; i <= keys.length; i++) out.push(toJS(v.get(i)));
    return out;
  }
  const out: Record<string, unknown> = {};
  for (const [k, val] of v.entries) out[String(k)] = toJS(val);
  return out;
}

function jokersOf(luaSource: string): { cards: Record<string, unknown>[]; config: Record<string, unknown> } {
  const root = parseLua(luaSource) as LuaTable;
  const area = ((root.get('cardAreas') as LuaTable).get('jokers')) as LuaTable;
  return toJS(area) as { cards: Record<string, unknown>[]; config: Record<string, unknown> };
}

/** 剔除对局进度字段后的小丑卡表（见文件头注释） */
function comparable(card: Record<string, unknown>): Record<string, unknown> {
  const { sort_id: _s, ...rest } = card;
  const ability = { ...(rest.ability as Record<string, unknown>) };
  delete ability.hands_played_at_create;
  return { ...rest, ability };
}

const gen = (jokers: { key: string; edition?: 'foil' | 'holo' | 'polychrome' | 'negative'; eternal?: boolean; perishable?: boolean; rental?: boolean }[], init?: Parameters<typeof generateSave>[2]) =>
  jokersOf(inflateRawSync(generateSave('b_red', 1, init ?? { hands: 4, discards: 3, dollars: 4 }, undefined, undefined, { items: jokers })).toString('utf8'));

describe('小丑牌写入：与真机样例逐字段一致（sort_id / hands_played_at_create 除外）', () => {
  it('j_gift + j_wrathful_joker = red_round1_jokers.jkr 的小丑卡表（含区 config）', () => {
    const genArea = gen([{ key: 'j_gift' }, { key: 'j_wrathful_joker' }]);
    const srcArea = jokersOf(sample('red_round1_jokers'));

    expect(genArea.cards).toHaveLength(2);
    expect(genArea.config.card_count).toBe(srcArea.config.card_count);
    expect(genArea.config).toEqual(srcArea.config);   // 模板区 config（card_limit=5 等）逐字段一致
    for (const i of [0, 1]) {
      const want = comparable(srcArea.cards[i] as Record<string, unknown>);
      const got = comparable(genArea.cards[i] as Record<string, unknown>);
      expect(got).toEqual({ ...want, rank: i + 1 });
    }
    // 关键差异点显式钉住（区别于消耗牌）
    const gift = genArea.cards[0] as { params: Record<string, unknown>; ability: Record<string, unknown> };
    expect(gift.params.discover).toBe(false);                       // 消耗牌是 true
    expect(gift.params.bypass_back).toEqual({ y: 0, x: 0 });        // 消耗牌是牌组 pos
    expect(gift.ability.set).toBe('Joker');
    expect(gift.ability).not.toHaveProperty('consumeable');
  });

  it('j_wrathful_joker 的 ability.extra 深拷贝中心 config（s_mult / suit）', () => {
    const area = gen([{ key: 'j_wrathful_joker' }]);
    const ability = (area.cards[0] as { ability: Record<string, unknown> }).ability;
    expect(ability.extra).toEqual({ s_mult: 3, suit: 'Spades' });
    expect(ability.effect).toBe('Suit Mult');
    expect(ability.x_mult).toBe(1);   // 小丑的 set_ability 公式：Xmult 缺省 1
    expect(ability.mult).toBe(0);
  });
});

describe('小丑版本写入（Card:set_edition 结构）', () => {
  it('闪箔/镭射/多彩：互斥单值 + type 一致 + 数值项 = 中心 config.extra', () => {
    const area = gen([
      { key: 'j_gift', edition: 'foil' },
      { key: 'j_joker', edition: 'holo' },
      { key: 'j_jolly', edition: 'polychrome' },
    ]);
    for (const [i, ed] of [['foil'], ['holo'], ['polychrome']].entries()) {
      const card = area.cards[i] as { edition: Record<string, unknown> };
      expect(card.edition).toEqual({
        ...{ [ed[0]]: true, type: ed[0] },
        ...EDITION_VALUE_FIELD[ed[0]]
          ? { [EDITION_VALUE_FIELD[ed[0]]]: EDITIONS.find(e => e.key === ed[0])!.config.extra }
          : {},
      });
    }
  });

  it('负片：edition = {negative, type}（无数值），并使 jokers 区上限 +1', () => {
    const area = gen([
      { key: 'j_gift' },
      { key: 'j_joker', edition: 'negative' },
    ], { hands: 4, discards: 3, dollars: 4, jokerSlots: 2 });
    const card = area.cards[1] as { edition: Record<string, unknown> };
    expect(card.edition).toEqual({ negative: true, type: 'negative' });
    // 2 槽 + 1 负片 → card_limit = 3，temp_limit = max(张数 2, 3) = 3（cardarea.lua:266 稳态）
    expect(area.config.card_limit).toBe(3);
    expect(area.config.temp_limit).toBe(3);
    expect(area.config.card_count).toBe(2);
  });

  it('负片不占槽位：非负片张数可以等于槽位数，负片额外追加', () => {
    const area = gen([
      { key: 'j_gift', edition: 'negative' },
      { key: 'j_joker' },
      { key: 'j_jolly' },
    ], { hands: 4, discards: 3, dollars: 4, jokerSlots: 2 });
    expect(area.cards).toHaveLength(3);
    expect(area.config.card_limit).toBe(3);
    expect(area.config.temp_limit).toBe(3);
  });

  it('非负片小丑超过槽位数：校验抛错，不产出文件', () => {
    expect(() => gen([{ key: 'j_gift' }, { key: 'j_joker' }, { key: 'j_jolly' }], { hands: 4, discards: 3, dollars: 4, jokerSlots: 2 }))
      .toThrow(/非负片小丑张数/);
  });

  it('空列表 / 不传：jokers 区保持空表，容量 = 槽位数', () => {
    const none = jokersOf(inflateRawSync(generateSave('b_red', 1, undefined, undefined, undefined, { items: [] })).toString('utf8'));
    expect(none.config.card_count).toBe(0);
    expect(none.config.card_limit).toBe(5);
  });
});

describe('创建期特例（card.lua:308-333 set_ability 尾部，缺失会让游戏读档后崩溃/说明报错）', () => {
  it('Invisible Joker 写 invis_rounds = 0', () => {
    const area = gen([{ key: 'j_invisible' }]);
    const ability = (area.cards[0] as { ability: Record<string, unknown> }).ability;
    expect(ability.invis_rounds).toBe(0);
  });

  it('Caino 写 caino_xmult = 1；Loyalty Card 写 loyalty_remaining = extra.every；To Do List 固定高牌', () => {
    const area = gen([{ key: 'j_caino' }, { key: 'j_loyalty_card' }, { key: 'j_todo_list' }]);
    const [caino, loyalty, todo] = area.cards as { ability: Record<string, unknown> }[];
    expect(caino.ability.caino_xmult).toBe(1);
    expect(loyalty.ability.loyalty_remaining).toBe(5);   // extra.every = 5（game.lua）
    expect(todo.ability.to_do_poker_hand).toBe('High Card');
  });
});

describe('贴纸写入（card.lua:506-523 set_eternal / set_perishable / set_rental）', () => {
  it('永恒：ability.eternal = true', () => {
    const area = gen([{ key: 'j_gift', eternal: true }]);
    const ability = (area.cards[0] as { ability: Record<string, unknown> }).ability;
    expect(ability.eternal).toBe(true);
    expect(ability).not.toHaveProperty('perishable');
  });

  it('易腐：ability.perishable = true + 开局 perish_tally = 5（G.GAME.perishable_rounds）', () => {
    const area = gen([{ key: 'j_gift', perishable: true }]);
    const ability = (area.cards[0] as { ability: Record<string, unknown> }).ability;
    expect(ability.perishable).toBe(true);
    expect(ability.perish_tally).toBe(5);
    expect(ability).not.toHaveProperty('eternal');
  });

  it('租用：ability.rental = true，cost = 1（card.lua:381）、sell_cost = 1（card.lua:382）、base_cost 不变', () => {
    const area = gen([{ key: 'j_gift', rental: true }]);
    const card = area.cards[0] as Record<string, unknown> & { ability: Record<string, unknown> };
    expect(card.ability.rental).toBe(true);
    expect(card.base_cost).toBe(6);
    expect(card.cost).toBe(1);
    expect(card.sell_cost).toBe(1);
  });

  it('compat 门控：不容永恒/易腐的小丑（game.lua eternal/perishable_compat = false）不写对应贴纸', () => {
    const area = gen([
      { key: 'j_gros_michel', eternal: true },      // eternal_compat = false
      { key: 'j_ceremonial', perishable: true },    // perishable_compat = false
    ]);
    const [gros, ceremonial] = area.cards as { ability: Record<string, unknown> }[];
    expect(gros.ability).not.toHaveProperty('eternal');
    expect(ceremonial.ability).not.toHaveProperty('perishable');
  });

  it('永恒与易腐互斥：同时请求时只写永恒（set_perishable 拒绝已永恒的牌，card.lua:515）', () => {
    const area = gen([{ key: 'j_gift', eternal: true, perishable: true }]);
    const ability = (area.cards[0] as { ability: Record<string, unknown> }).ability;
    expect(ability.eternal).toBe(true);
    expect(ability).not.toHaveProperty('perishable');
  });

  it('租用可与永恒叠加（set_rental 无互斥），负片版本同样正常写入', () => {
    const area = gen([{ key: 'j_gift', rental: true, eternal: true, edition: 'negative' }], { hands: 4, discards: 3, dollars: 4 });
    const card = area.cards[0] as Record<string, unknown> & { ability: Record<string, unknown>; edition: Record<string, unknown> };
    expect(card.ability.rental).toBe(true);
    expect(card.ability.eternal).toBe(true);
    expect(card.cost).toBe(1);
    expect(card.edition).toEqual({ negative: true, type: 'negative' });
  });
});
