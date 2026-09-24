// 消耗牌写入存档的门禁测试（PROJECT_SPEC.md 5.6 / 附录 D）：
// 生成的消耗牌卡表与真机样例存档（magic/ghost_initial.jkr）逐字段一致（sort_id 除外——
// 实例计数器只需唯一）。负片 edition 无真机样例，结构依据 Card:save 的 edition 表。
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { inflateRawSync } from 'node:zlib';
import { parseLua, LuaTable, type LuaValue } from '../src/core/luaTable';
import { generateSave } from '../src/core/generate';
import { BACKS } from '../src/data/backs';
import { deckDefaultConsumables } from '../src/core/consumables';

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

function consumeablesOf(luaSource: string): { cards: Record<string, unknown>[]; config: Record<string, unknown> } {
  const root = parseLua(luaSource) as LuaTable;
  const area = (((root.get('cardAreas') as LuaTable).get('consumeables')) as LuaTable);
  return toJS(area) as { cards: Record<string, unknown>[]; config: Record<string, unknown> };
}

const back = (key: string) => BACKS.find(b => b.key === key)!;

describe('消耗牌写入：与真机样例逐字段一致（sort_id 除外）', () => {
  it('魔法牌组默认消耗牌（愚者×2）= magic_initial.jkr 的消耗牌卡表', () => {
    const keys = deckDefaultConsumables(back('b_magic'));
    expect(keys).toEqual(['c_fool', 'c_fool']);
    const bytes = generateSave('b_magic', 1, undefined, undefined, { items: keys.map(key => ({ key, negative: false })) });
    const gen = consumeablesOf(inflateRawSync(bytes).toString('utf8'));
    const src = consumeablesOf(sample('magic_initial'));

    expect(gen.config.card_count).toBe(src.config.card_count);
    expect(gen.cards).toHaveLength(2);
    for (const i of [0, 1]) {
      const { sort_id: _sample, ...want } = src.cards[i] as Record<string, unknown>;
      const { sort_id: genSort, ...genRest } = gen.cards[i] as Record<string, unknown>;
      expect(genSort).toBeGreaterThan(0);
      expect(genRest).toEqual({ ...want, rank: i + 1 });
    }
  });

  it('幽灵牌组默认消耗牌（妖法×1）= ghost_initial.jkr 的消耗牌卡表（extra 双写）', () => {
    const keys = deckDefaultConsumables(back('b_ghost'));
    expect(keys).toEqual(['c_hex']);
    const bytes = generateSave('b_ghost', 1, undefined, undefined, { items: keys.map(key => ({ key, negative: false })) });
    const gen = consumeablesOf(inflateRawSync(bytes).toString('utf8'));
    const src = consumeablesOf(sample('ghost_initial'));

    expect(gen.cards).toHaveLength(1);
    const { sort_id: _sample, ...want } = src.cards[0] as Record<string, unknown>;
    const { sort_id: genSort, ...genRest } = gen.cards[0] as Record<string, unknown>;
    expect(genSort).toBeGreaterThan(0);
    expect(genRest).toEqual(want);
    const ability = gen.cards[0].ability as Record<string, unknown>;
    expect(ability.extra).toBe(2);
    expect(ability.consumeable).toEqual({ extra: 2 });
    expect(ability.effect).toBeUndefined();   // 妖法中心无 effect 字段
  });

  it('魔法牌组同时写入水晶球券（used_vouchers.v_crystal_ball，样例一致）', () => {
    const bytes = generateSave('b_magic', 1, undefined, undefined, { items: [{ key: 'c_fool', negative: false }] });
    const root = parseLua(inflateRawSync(bytes).toString('utf8')) as LuaTable;
    const uv = toJS((root.get('GAME') as LuaTable).get('used_vouchers'));
    expect(uv).toEqual({ v_crystal_ball: true });
  });

  it('非魔法牌组不写水晶球券', () => {
    const bytes = generateSave('b_red', 1, undefined, undefined, { items: [{ key: 'c_fool', negative: false }] });
    const root = parseLua(inflateRawSync(bytes).toString('utf8')) as LuaTable;
    const uv = (root.get('GAME') as LuaTable).get('used_vouchers');
    // 模板本无该键或为空表：只断言不含水晶球
    expect(uv instanceof LuaTable ? toJS(uv) : undefined).not.toEqual({ v_crystal_ball: true });
  });
});

describe('负片与星球牌（无真机样例，结构依据 card.lua Card:save/set_ability）', () => {
  it('负片逐牌生效：标记 negative 的牌写 edition，未标记的不写', () => {
    const bytes = generateSave('b_magic', 1, undefined, undefined, {
      items: [
        { key: 'c_fool', negative: true },
        { key: 'c_fool', negative: false },
        { key: 'c_hex', negative: true },
      ],
    });
    const cons = consumeablesOf(inflateRawSync(bytes).toString('utf8'));
    expect(cons.cards[0].edition).toEqual({ negative: true, type: 'negative' });
    expect(cons.cards[1].edition).toBeUndefined();
    expect(cons.cards[2].edition).toEqual({ negative: true, type: 'negative' });
  });

  it('负片关闭时加入的牌：不写 edition 键', () => {
    const bytes = generateSave('b_magic', 1, undefined, undefined, { items: [{ key: 'c_fool', negative: false }] });
    const cons = consumeablesOf(inflateRawSync(bytes).toString('utf8'));
    expect(cons.cards[0].edition).toBeUndefined();
  });

  it('星球牌（水星）：consumeable = 中心整表 {hand_type}，无 extra，effect = Hand Upgrade', () => {
    // card.lua:305-307 —— ability.consumeable = center.config 深拷贝；星球 config 无 extra
    const bytes = generateSave('b_red', 1, undefined, undefined, { items: [{ key: 'c_mercury', negative: false }] });
    const cons = consumeablesOf(inflateRawSync(bytes).toString('utf8'));
    const ability = cons.cards[0].ability as Record<string, unknown>;
    expect(ability.consumeable).toEqual({ hand_type: 'Pair' });
    expect(ability.extra).toBeUndefined();
    expect(ability.effect).toBe('Hand Upgrade');
    expect(cons.cards[0].params).toMatchObject({ bypass_back: { x: 0, y: 0 } });   // b_red pos
  });

  it('sort_id 与牌堆不冲突且互不相同', () => {
    const bytes = generateSave('b_magic', 1, undefined, undefined, {
      // 妖法标负片：魔法 2 槽放 2 张非负片 + 1 张负片（负片不占槽位）
      items: [{ key: 'c_fool', negative: false }, { key: 'c_fool', negative: false }, { key: 'c_hex', negative: true }],
    });
    const root = parseLua(inflateRawSync(bytes).toString('utf8')) as LuaTable;
    const areas = root.get('cardAreas') as LuaTable;
    const deckIds = [...((areas.get('deck') as LuaTable).get('cards') as LuaTable).entries.keys()];
    const cons = consumeablesOf(inflateRawSync(bytes).toString('utf8'));
    const ids = cons.cards.map(c => c.sort_id as number);
    expect(new Set(ids).size).toBe(ids.length);
    for (const id of ids) expect(deckIds).not.toContain(id);
  });

  it('负片牌使上限 +1（1 张负片 = 1/3）：card_limit/temp_limit 与校验', () => {
    // card.lua:405-417 —— added_to_deck 的负片消耗牌令 card_limit +1；
    // HUD 计数 = card_count/card_limit（cardarea.lua:265-266），故 2 槽 + 1 负片显示 1/3
    const bytes = generateSave('b_red', 1, undefined, undefined, {
      items: [{ key: 'c_fool', negative: true }],
    });
    const cons = consumeablesOf(inflateRawSync(bytes).toString('utf8'));
    expect(cons.config.card_limit).toBe(3);
    expect(cons.config.temp_limit).toBe(3);
    expect(cons.config.card_count).toBe(1);
  });

  it('全负片可超槽位（红组 2 槽放 3 张负片 = 上限 5），非负片数超槽位则校验失败', () => {
    // card.lua:931 —— negative 消耗牌不占 card_limit
    const bytes = generateSave('b_red', 1, undefined, undefined, {
      items: [
        { key: 'c_fool', negative: true },
        { key: 'c_mercury', negative: true },
        { key: 'c_hex', negative: true },
      ],
    });
    const cons = consumeablesOf(inflateRawSync(bytes).toString('utf8'));
    expect(cons.cards).toHaveLength(3);
    expect(cons.config.card_limit).toBe(5);   // 2 槽 + 3 负片
    expect(cons.config.temp_limit).toBe(5);
    expect(() => {
      generateSave('b_red', 1, undefined, undefined, {
        items: [
          { key: 'c_fool', negative: false },
          { key: 'c_mercury', negative: false },
          { key: 'c_hex', negative: false },
        ],
      });
    }).toThrow(/非负片消耗牌张数/);
  });
});
