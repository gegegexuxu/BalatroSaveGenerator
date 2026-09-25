// 优惠券写入存档的门禁测试（PROJECT_SPEC.md 5.10）：used_vouchers 集合 + 结构效果落盘。
// 关键模型：续档时 Game:start_run 走 saveTable 分支原样恢复 G.GAME 与牌区（CardArea:load
// 直接替换 config），不重放 Card.apply_to_run——所以水晶球/反物质等结构效果必须写进存档状态。
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { inflateRawSync } from 'node:zlib';
import { parseLua, LuaTable, type LuaValue } from '../src/core/luaTable';
import { generateSave } from '../src/core/generate';

const init = { hands: 4, discards: 3, dollars: 4 };
const gen = (opts: { vouchers?: string[]; deck?: string }) =>
  inflateRawSync(generateSave(opts.deck ?? 'b_red', 1, init, undefined, undefined, undefined,
    { keys: opts.vouchers ?? [] })).toString('utf8');

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

function gameOf(luaSource: string): Record<string, any> {
  const root = parseLua(luaSource) as LuaTable;
  return toJS(root.get('GAME')) as Record<string, any>;
}

const uvOf = (g: Record<string, any>): string[] =>
  Object.keys(g.used_vouchers as Record<string, unknown>).sort();

describe('优惠券写入：used_vouchers 集合', () => {
  it('选一张券 → used_vouchers 标记 + starting_voucher_count = 自选数', () => {
    const g = gameOf(gen({ vouchers: ['v_crystal_ball'] }));
    expect(uvOf(g)).toEqual(['v_crystal_ball']);
    expect(g.starting_voucher_count).toBe(1);
  });

  it('plus 券自动带上基础券（requires，common_events.lua:1993 的上架条件）', () => {
    const g = gameOf(gen({ vouchers: ['v_liquidation'] }));
    expect(uvOf(g)).toEqual(['v_clearance_sale', 'v_liquidation']);
  });

  it('不选券：used_vouchers 为空、starting_voucher_count 不写', () => {
    const g = gameOf(gen({}));
    expect(uvOf(g)).toEqual([]);
    expect(g.starting_voucher_count).toBeUndefined();
  });

  it('魔法牌组与自选券合并（水晶球来自牌组规则，不清空、不重复）', () => {
    const bytes = generateSave('b_magic', 1, init, undefined,
      { items: [{ key: 'c_fool', negative: false }] }, undefined, { keys: ['v_seed_money'] });
    const g = gameOf(inflateRawSync(bytes).toString('utf8'));
    expect(uvOf(g)).toEqual(['v_crystal_ball', 'v_seed_money']);
    expect(g.starting_voucher_count).toBe(2);   // 最终拥有数（自选 1 + 牌组水晶球 1）
  });
});

describe('结构效果落盘（Card.apply_to_run 的等价写入；续档不重放，CardArea:load 原样恢复 config）', () => {
  it('水晶球：consumeables card_limit/temp_limit = 槽位数 2 + 1', () => {
    const root = parseLua(gen({ vouchers: ['v_crystal_ball'] })) as LuaTable;
    const cfg = (((root.get('cardAreas') as LuaTable).get('consumeables') as LuaTable).get('config')) as LuaTable;
    expect(cfg.get('card_limit')).toBe(3);
    expect(cfg.get('temp_limit')).toBe(3);
  });

  it('黄道牌组（自带塔罗/星球商人+库存过剩）：标记、出现率、商店位数一次落盘', () => {
    const g = gameOf(gen({ deck: 'b_zodiac' }));
    expect(uvOf(g)).toEqual(['v_overstock_norm', 'v_planet_merchant', 'v_tarot_merchant']);
    expect(g.starting_voucher_count).toBe(3);
    expect(g.tarot_rate).toBeCloseTo(9.6, 6);     // 4 × extra(2.4)，apply_to_run 的 4*extra
    expect(g.planet_rate).toBeCloseTo(9.6, 6);
    expect(g.shop.joker_max).toBe(3);              // 2 + 库存过剩
  });

  it('魔法牌组（牌组规则自带水晶球，不选券）= 真机样例的 card_limit 3，计数 = 1（back.lua）', () => {
    const bytes = generateSave('b_magic', 1, init, undefined,
      { items: [{ key: 'c_fool', negative: false }] });
    const root = parseLua(inflateRawSync(bytes).toString('utf8')) as LuaTable;
    const cfg = (((root.get('cardAreas') as LuaTable).get('consumeables') as LuaTable).get('config')) as LuaTable;
    expect(cfg.get('card_limit')).toBe(3);
    const g = gameOf(inflateRawSync(bytes).toString('utf8'));
    expect(g.starting_voucher_count).toBe(1);   // back.lua:177-178 牌组券计入起始数
  });

  it('反物质：jokers card_limit/temp_limit = 槽位数 5 + 1', () => {
    const root = parseLua(gen({ vouchers: ['v_antimatter'] })) as LuaTable;
    const cfg = (((root.get('cardAreas') as LuaTable).get('jokers') as LuaTable).get('config')) as LuaTable;
    expect(cfg.get('card_limit')).toBe(6);
    expect(cfg.get('temp_limit')).toBe(6);
  });

  it('抓手：round_resets.hands 与 current_round.hands_left = 4 + 1', () => {
    const g = gameOf(gen({ vouchers: ['v_grabber'] }));
    expect(g.round_resets.hands).toBe(5);
    expect(g.current_round.hands_left).toBe(5);
    expect(g.starting_params.hands).toBe(4);   // starting_params 保持面板值（与蓝注弃牌同语义）
  });

  it('清仓特卖：discount_percent = 25；清算（plus）= 50', () => {
    expect(gameOf(gen({ vouchers: ['v_clearance_sale'] })).discount_percent).toBe(25);
    expect(gameOf(gen({ vouchers: ['v_liquidation'] })).discount_percent).toBe(50);
  });

  it('塔罗商人：tarot_rate = 4 × extra(2.4) = 9.6（game.lua 9.6/4 的除法表达式）', () => {
    expect(gameOf(gen({ vouchers: ['v_tarot_merchant'] })).tarot_rate).toBeCloseTo(9.6, 6);
  });

  it('多次重掷：round_resets.reroll_cost = 5 - 1', () => {
    const g = gameOf(gen({ vouchers: ['v_reroll_surplus'] }));
    expect(g.round_resets.reroll_cost).toBe(3);   // extra = 2
  });

  it('库存过剩：shop.joker_max = 2 + 1', () => {
    const g = gameOf(gen({ vouchers: ['v_overstock_norm'] }));
    expect(g.shop.joker_max).toBe(3);
  });

  it('望远镜（用时检查型）：只写标记，无结构副作用', () => {
    const g = gameOf(gen({ vouchers: ['v_telescope'] }));
    expect(uvOf(g)).toEqual(['v_telescope']);
    expect(g.tarot_rate).toBe(4);   // 保持模板默认
  });

  it('与负片小丑的槽位叠加：2 槽 + 1 负片 + 反物质 → jokers card_limit = 4', () => {
    const bytes = generateSave('b_red', 1, { hands: 4, discards: 3, dollars: 4, jokerSlots: 2 },
      undefined, undefined, { items: [{ key: 'j_gift', edition: 'negative' }] }, { keys: ['v_antimatter'] });
    const root = parseLua(inflateRawSync(bytes).toString('utf8')) as LuaTable;
    const cfg = (((root.get('cardAreas') as LuaTable).get('jokers') as LuaTable).get('config')) as LuaTable;
    expect(cfg.get('card_limit')).toBe(4);
  });
});
