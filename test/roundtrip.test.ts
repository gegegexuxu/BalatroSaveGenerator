// 门禁测试（PROJECT_SPEC.md 8.1/8.2）：序列化器必须与原存档逐字节一致
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { inflateRawSync } from 'node:zlib';
import templateSource from '../src/data/templateSource';
import { parseLua, serializeLua, formatG14, quote } from '../src/core/luaTable';
import { deflateSave } from '../src/core/deflate';
import { generateSave } from '../src/core/generate';
import { validateSave } from '../src/core/validate';
import { LuaTable } from '../src/core/luaTable';

const original = readFileSync(new URL('../references/save/template.jkr', import.meta.url));

describe('luaTable 序列化器（强制门禁）', () => {
  it('嵌入模板 = 原 save.jkr 解压结果（模板保真）', () => {
    expect(inflateRawSync(original).toString('utf8')).toBe(templateSource);
  });

  it('解析 → 序列化 = 模板源码逐字符一致（源码层字节保真）', () => {
    expect(serializeLua(parseLua(templateSource))).toBe(templateSource);
  });

  it('压缩产物解压回读 = 序列化源码（压缩层有效性）', () => {
    // 浏览器端（fflate）与 zlib level-1 的 deflate 字节不逐位一致，但均为合法流；
    // 游戏经 love.data.decompress 读取，任何合法 raw deflate 均可加载（PROJECT_SPEC.md 5.3）
    const src = serializeLua(parseLua(templateSource));
    expect(inflateRawSync(deflateSave(src)).toString('utf8')).toBe(src);
  });

  it('数字格式化符合 %.14g', () => {
    expect(formatG14(4)).toBe('4');
    expect(formatG14(0)).toBe('0');
    expect(formatG14(500)).toBe('500');
    expect(formatG14(0.04)).toBe('0.04');
    expect(formatG14(0.004)).toBe('0.004');
    expect(formatG14(0.599651559225)).toBe('0.599651559225');
    expect(formatG14(0.25098039215686)).toBe('0.25098039215686');
    expect(formatG14(-1)).toBe('-1');
  });

  it('%q 转义：换行 = 反斜杠 + 真实换行', () => {
    expect(quote('a"b\\c')).toBe('a\\"b\\\\c');
    expect(quote('x\ny')).toBe('x\\\ny');
    expect(quote('\x01')).toBe('\\001');
  });
});

describe('generateSave（v0.1 仅换牌组）', () => {
  it("generate('b_red') 解压后与模板源码逐字符一致（重建 BACK 无损还原）", () => {
    expect(inflateRawSync(generateSave('b_red')).toString('utf8')).toBe(templateSource);
  });

  it("generate('b_blue')：BACK 与 selected_back_key 正确，其余保持模板值", () => {
    const lua = inflateRawSync(generateSave('b_blue')).toString('utf8');
    const root = parseLua(lua);
    const back = root.get('BACK') as LuaTable;
    expect(back.get('key')).toBe('b_blue');
    expect(back.get('name')).toBe('Blue Deck');
    const sbk = (root.get('GAME') as LuaTable).get('selected_back_key') as LuaTable;
    expect(sbk.get('key')).toBe('b_blue');
    expect(sbk.get('name')).toBe('Blue Deck');
    // v0.1 不应用牌组规则：模板（红色牌组）的数值原样保留
    const game = root.get('GAME') as LuaTable;
    expect(game.get('dollars')).toBe(4);
    expect((game.get('starting_params') as LuaTable).get('discards')).toBe(4);
  });

  it("generate('b_red', 5)（蓝注）：stake 生效且效果字段自洽", () => {
    const lua = inflateRawSync(generateSave('b_red', 5)).toString('utf8');
    const root = parseLua(lua);
    const game = root.get('GAME') as LuaTable;
    expect(game.get('stake')).toBe(5);
    // BACK 与 selected_back_key 的 center.stake 同步
    const center = ((root.get('BACK') as LuaTable).get('effect') as LuaTable).get('center') as LuaTable;
    expect(center.get('stake')).toBe(5);
    expect((game.get('selected_back_key') as LuaTable).get('stake')).toBe(5);
    // 蓝注：弃牌 -1 三处同步（模板红牌组 4 → 3）
    expect((game.get('starting_params') as LuaTable).get('discards')).toBe(3);
    expect((game.get('round_resets') as LuaTable).get('discards')).toBe(3);
    expect((game.get('current_round') as LuaTable).get('discards_left')).toBe(3);
    // 累进 modifiers（game.lua:2049-2058）
    const mods = game.get('modifiers') as LuaTable;
    expect((mods.get('no_blind_reward') as LuaTable).get('Small')).toBe(true);
    expect(mods.get('scaling')).toBe(2);
    expect(mods.get('enable_eternals_in_shop')).toBe(true);
    expect(mods.get('enable_perishables_in_shop')).toBe(undefined);
    expect(mods.get('enable_rentals_in_shop')).toBe(undefined);
  });

  it("generate('b_red', 8)（金注）：全部 modifiers 累进生效", () => {
    const root = parseLua(inflateRawSync(generateSave('b_red', 8)).toString('utf8'));
    const mods = (root.get('GAME') as LuaTable).get('modifiers') as LuaTable;
    expect((mods.get('no_blind_reward') as LuaTable).get('Small')).toBe(true);
    expect(mods.get('scaling')).toBe(3);
    expect(mods.get('enable_eternals_in_shop')).toBe(true);
    expect(mods.get('enable_perishables_in_shop')).toBe(true);
    expect(mods.get('enable_rentals_in_shop')).toBe(true);
    expect(() => validateSave(root)).not.toThrow();
  });

  it('赌注越界被拒绝', () => {
    expect(() => generateSave('b_red', 0)).toThrow(/赌注/);
    expect(() => generateSave('b_red', 9)).toThrow(/赌注/);
    expect(() => generateSave('b_red', 2.5)).toThrow(/赌注/);
  });

  it('全部 15 种可选牌组均可生成且通过校验', () => {
    for (const key of ['b_red','b_blue','b_yellow','b_green','b_black','b_magic','b_nebula','b_ghost','b_abandoned','b_checkered','b_zodiac','b_painted','b_anaglyph','b_plasma','b_erratic']) {
      const lua = inflateRawSync(generateSave(key)).toString('utf8');
      expect(() => validateSave(parseLua(lua))).not.toThrow();
      expect(lua.startsWith('return {')).toBe(true);
    }
  });

  it('未知/omit 牌组抛错', () => {
    expect(() => generateSave('b_challenge')).toThrow();
    expect(() => generateSave('b_nope')).toThrow();
  });
});

describe('generateSave 开局数值覆盖（v0.4）', () => {
  it('出牌/弃牌三处同步，金币两处写入', () => {
    const lua = inflateRawSync(generateSave('b_red', 1, { hands: 6, discards: 2, dollars: 30 })).toString('utf8');
    const root = parseLua(lua);
    const game = root.get('GAME') as LuaTable;
    const sp = game.get('starting_params') as LuaTable;
    const rr = game.get('round_resets') as LuaTable;
    const cr = game.get('current_round') as LuaTable;
    expect(sp.get('hands')).toBe(6);
    expect(rr.get('hands')).toBe(6);
    expect(cr.get('hands_left')).toBe(6);
    expect(sp.get('discards')).toBe(2);
    expect(rr.get('discards')).toBe(2);
    expect(cr.get('discards_left')).toBe(2);
    expect(game.get('dollars')).toBe(30);
    expect(sp.get('dollars')).toBe(30);
    expect(() => validateSave(root)).not.toThrow();
  });

  it('覆盖值在赌注效果之后写入（蓝注 -1 弃牌被面板终值取代）', () => {
    const lua = inflateRawSync(generateSave('b_red', 5, { hands: 4, discards: 5, dollars: 4 })).toString('utf8');
    const root = parseLua(lua);
    const game = root.get('GAME') as LuaTable;
    expect((game.get('starting_params') as LuaTable).get('discards')).toBe(5);
    expect((game.get('round_resets') as LuaTable).get('discards')).toBe(5);
  });

  it('覆盖值越界被拒绝', () => {
    expect(() => generateSave('b_red', 1, { hands: 0, discards: 3, dollars: 4 })).toThrow(/出牌/);
    expect(() => generateSave('b_red', 1, { hands: 4, discards: 1.5, dollars: 4 })).toThrow(/弃牌/);
    expect(() => generateSave('b_red', 1, { hands: 4, discards: 3, dollars: -1 })).toThrow(/金币/);
  });

  it('不传覆盖值时保持模板原值（旧行为不变）', () => {
    const lua = inflateRawSync(generateSave('b_red')).toString('utf8');
    expect(lua).toBe(templateSource);
  });

  it('种子写入 pseudorandom.seed，其余随机流缓存清空（按新种子重派生）', () => {
    const lua = inflateRawSync(generateSave('b_red', 1, { hands: 4, discards: 4, dollars: 4, seed: 'ABCD1234' })).toString('utf8');
    const root = parseLua(lua);
    const pr = ((root.get('GAME') as LuaTable).get('pseudorandom') as LuaTable);
    expect(pr.get('seed')).toBe('ABCD1234');
    expect(pr.get('shuffle')).toBe(undefined);
    expect(pr.get('hashed_seed')).toBe(undefined);
    expect(() => validateSave(root)).not.toThrow();
  });

  it('种子格式不符合规范被拒绝（8 位、不含 0/I/O）', () => {
    expect(() => generateSave('b_red', 1, { hands: 4, discards: 4, dollars: 4, seed: 'ABC01234' })).toThrow(/种子/);  // 含 0
    expect(() => generateSave('b_red', 1, { hands: 4, discards: 4, dollars: 4, seed: 'AICD1234' })).toThrow(/种子/);  // 含 I
    expect(() => generateSave('b_red', 1, { hands: 4, discards: 4, dollars: 4, seed: 'ABCD123' })).toThrow(/种子/);   // 7 位
  });
});

describe('validateSave 防御', () => {
  it('篡改 STATE 后被拒绝', () => {
    const root = parseLua(templateSource);
    root.set('STATE', 3);
    expect(() => validateSave(root)).toThrow(/STATE/);
  });

  it('牌堆数量不一致被拒绝', () => {
    const root = parseLua(templateSource);
    const deck = (root.get('cardAreas') as LuaTable).get('deck') as LuaTable;
    (deck.get('cards') as LuaTable).set(999, (deck.get('cards') as LuaTable).get(1)!);
    expect(() => validateSave(root)).toThrow(/starting_deck_size/);
  });
});
