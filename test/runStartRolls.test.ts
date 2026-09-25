// 新开局预掷复刻的对账测试：模板存档本身就是模板种子（7C95TXA7）新开局的掷点结果
//（game.lua if not saveTable 分支的产物随存档固化），复刻链路必须逐位重现它——
// 任何偏差都说明池构建或 RNG 复刻有错（PROJECT_SPEC.md 5.7）
import { describe, expect, it } from 'vitest';
import { inflateRawSync } from 'node:zlib';
import templateSource from '../src/data/templateSource';
import { LuaTable, parseLua } from '../src/core/luaTable';
import { generateSave } from '../src/core/generate';
import { applyRunStartRolls, type RunStartRolls } from '../src/core/runStartRolls';
import { BOSS_POOL, TAG_POOL, VOUCHER_POOL } from '../src/data/runPools';

const TEMPLATE_SEED = '7C95TXA7';
/** 模板里由开局预掷写入的 pseudorandom 流缓存键（anc1/idol1/cas1/mail1/shuffle/
 *  interest_cap 属其他系统，预掷不消费；seed/hashed_seed 为特殊键） */
const ROLL_CACHE_KEYS = ['boss', 'Voucher1', 'Tag1', 'Tag1_resample2', 'Tag1_resample3'];

function templateGame(): LuaTable {
  return parseLua(templateSource).get('GAME') as LuaTable;
}

/** 参照值：模板里的 blind_choices.Boss / blind_tags / current_round.voucher / 流缓存 */
function expectedFrom(game: LuaTable) {
  const rr = game.get('round_resets') as LuaTable;
  const pr = game.get('pseudorandom') as LuaTable;
  return {
    boss: ((rr.get('blind_choices') as LuaTable).get('Boss')) as string,
    tagSmall: ((rr.get('blind_tags') as LuaTable).get('Small')) as string,
    tagBig: ((rr.get('blind_tags') as LuaTable).get('Big')) as string,
    voucher: ((game.get('current_round') as LuaTable).get('voucher')) as string,
    cache: Object.fromEntries(ROLL_CACHE_KEYS.map(k => [k, pr.get(k) as number])),
  };
}

describe('新开局预掷（模板种子 7C95TXA7 对账）', () => {
  const rolls = applyRunStartRolls(parseLua(templateSource), TEMPLATE_SEED);
  const expected = expectedFrom(templateGame());

  it('Boss / 商店券 / 跳过标签与模板存档一致', () => {
    expect(rolls.boss).toBe(expected.boss);
    expect(rolls.voucher).toBe(expected.voucher);
    expect(rolls.tagSmall).toBe(expected.tagSmall);
    expect(rolls.tagBig).toBe(expected.tagBig);
  });

  it('消费的随机流缓存与模板 pseudorandom 表逐位一致', () => {
    expect(Object.keys(rolls.rngCache).sort()).toEqual(ROLL_CACHE_KEYS.slice().sort());
    for (const [key, value] of Object.entries(expected.cache)) {
      expect(rolls.rngCache[key]).toBe(value);
    }
  });

  it('generateSave 不覆盖种子时整份存档与模板逐字节一致（roundtrip 门禁同源）', () => {
    const lua = new TextDecoder().decode(inflateRawSync(generateSave('b_red')));
    expect(lua).toBe(templateSource);
  });
});

describe('新开局预掷（其他种子）', () => {
  const rollsA: RunStartRolls = applyRunStartRolls(parseLua(templateSource), 'AAAAAAAA');

  it('同一种子两次掷点结果完全一致（确定性）', () => {
    const again = applyRunStartRolls(parseLua(templateSource), 'AAAAAAAA');
    expect(again).toEqual(rollsA);
  });

  it('Boss 落在第一底注候选池（非终局且 min≤1）', () => {
    const eligible = BOSS_POOL.filter(b => !b.showdown && b.min <= 1).map(b => b.key);
    expect(eligible).toContain(rollsA.boss);
  });

  it('商店券落在基础券集合（plus 券开局因 requires 未满足不可见）', () => {
    const baseKeys = VOUCHER_POOL.filter(v => v.requires.length === 0).map(v => v.key);
    expect(baseKeys).toContain(rollsA.voucher);
    expect(rollsA.voucher).not.toBe('UNAVAILABLE');
  });

  it('跳过标签落在第一底注可用标签集合（min_ante≤1）', () => {
    const available = TAG_POOL.filter(t => !t.minAnte || t.minAnte <= 1).map(t => t.key);
    expect(available).toContain(rollsA.tagSmall);
    expect(available).toContain(rollsA.tagBig);
  });

  it('导出存档中的预掷值与按该种子的复刻掷点一致', () => {
    const bytes = generateSave('b_red', 1, { hands: 4, discards: 4, dollars: 4, seed: 'AAAAAAAA' });
    const game = parseLua(new TextDecoder().decode(inflateRawSync(bytes))).get('GAME') as LuaTable;
    const rr = game.get('round_resets') as LuaTable;
    expect(((rr.get('blind_choices') as LuaTable).get('Boss'))).toBe(rollsA.boss);
    expect(((rr.get('blind_tags') as LuaTable).get('Small'))).toBe(rollsA.tagSmall);
    expect(((rr.get('blind_tags') as LuaTable).get('Big'))).toBe(rollsA.tagBig);
    expect(((game.get('current_round') as LuaTable).get('voucher'))).toBe(rollsA.voucher);
    // 掷点后的流缓存写回了存档（游戏内后续同 key 掷点据此续流）
    const pr = game.get('pseudorandom') as LuaTable;
    expect(pr.get('boss')).toBe(rollsA.rngCache.boss);
  });
});
