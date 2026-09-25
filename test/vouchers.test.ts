// 优惠券数据与界面逻辑（PROJECT_SPEC.md 5.10）：数据形状、升级对完整性、素材齐备、
// 基础券补齐与级联清理。数据由 scripts/extractData.mjs 生成（src/data/vouchers.ts）。
import { describe, it, expect } from 'vitest';
import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { BACKS } from '../src/data/backs';
import { VOUCHERS } from '../src/data/vouchers';
import { deckDefaultVouchers, listVouchers, voucherByKey, withRequiredBases, pruneBrokenRequires } from '../src/core/vouchers';

const back = (key: string) => BACKS.find(b => b.key === key)!;

const assetPath = (rel: string): string => fileURLToPath(new URL(`../assets/${rel}`, import.meta.url));

describe('优惠券数据（提取自 game.lua / zh_CN.lua）', () => {
  it('共 30 张：16 对基础/加强券（神形符/岩穴符两张 ante 回退券不收录）', () => {
    expect(VOUCHERS).toHaveLength(30);
    expect(VOUCHERS.filter(v => v.requires.length === 0)).toHaveLength(15);   // 基础券
    expect(VOUCHERS.filter(v => v.requires.length > 0)).toHaveLength(15);     // 加强券
    expect(voucherByKey('v_hieroglyph')).toBeUndefined();
    expect(voucherByKey('v_petroglyph')).toBeUndefined();
  });

  it('key 唯一，order 全局唯一且升序（= 游戏牌池顺序）', () => {
    expect(new Set(VOUCHERS.map(v => v.key)).size).toBe(VOUCHERS.length);
    expect(new Set(VOUCHERS.map(v => v.order)).size).toBe(VOUCHERS.length);
    const orders = VOUCHERS.map(v => v.order);
    expect(orders).toEqual([...orders].sort((a, b) => a - b));
  });

  it('售价统一 10；每条都有中文名与描述文本', () => {
    for (const v of VOUCHERS) {
      expect(v.cost, v.key).toBe(10);
      expect(v.zhName, v.key).toBeTruthy();
      expect(v.text.length, v.key).toBeGreaterThan(0);
    }
  });

  it('升级对完整：plus 券的 requires 指向数据内存在的基础券，且基础券 order 在前', () => {
    for (const v of VOUCHERS) {
      for (const req of v.requires) {
        const base = voucherByKey(req);
        expect(base, `${v.key} 的基础券 ${req} 不在数据里`).toBeDefined();
        expect(base!.order, `${v.key} 的基础券 ${req} 应排在它前面`).toBeLessThan(v.order);
      }
    }
    // 抽样：清算依赖清仓特卖、反物质依赖空白
    expect(voucherByKey('v_liquidation')!.requires).toEqual(['v_clearance_sale']);
    expect(voucherByKey('v_antimatter')!.requires).toEqual(['v_blank']);
  });

  it('素材文件名 = 英文名 + .png（Director\'s Cut 例外 = Director.png），且文件都在', () => {
    for (const v of VOUCHERS) {
      const want = v.key === 'v_directors_cut' ? 'Director.png' : `${v.enName}.png`;
      expect(v.image, v.key).toBe(want);
      expect(existsSync(assetPath(`voucher/${v.image}`)), `缺少素材 ${want}`).toBe(true);
    }
  });

  it('分类色 = G.C.VOUCHER（#cb724c）', () => {
    for (const v of VOUCHERS) expect(v.colour).toBe('#cb724c');
  });
});

describe('牌池查询与升级对运算', () => {
  it('listVouchers 返回全部 30 张；voucherByKey 查已知券/未知键', () => {
    expect(listVouchers()).toHaveLength(30);
    expect(voucherByKey('v_crystal_ball')?.zhName).toBe('水晶球');
    expect(voucherByKey('v_nope')).toBeUndefined();
  });

  it('withRequiredBases：选 plus 自动带上基础券（已拥有不重复），选基础券不变', () => {
    expect(withRequiredBases(['v_liquidation'])).toEqual(['v_clearance_sale', 'v_liquidation']);
    expect(withRequiredBases(['v_clearance_sale'])).toEqual(['v_clearance_sale']);
    // 链式：同时选 清仓特卖+清算+摇钱树（摇钱树依赖种子基金）→ 全链补齐
    expect(withRequiredBases(['v_clearance_sale', 'v_liquidation', 'v_money_tree']))
      .toEqual(['v_clearance_sale', 'v_liquidation', 'v_seed_money', 'v_money_tree']);
  });

  it('牌组自带券（back.lua apply_to_run）：魔法水晶球 / 星云望远镜 / 黄道三张，其余为空', () => {
    expect(deckDefaultVouchers(back('b_magic'))).toEqual(['v_crystal_ball']);
    expect(deckDefaultVouchers(back('b_nebula'))).toEqual(['v_telescope']);
    expect(deckDefaultVouchers(back('b_zodiac')))
      .toEqual(['v_tarot_merchant', 'v_planet_merchant', 'v_overstock_norm']);
    expect(deckDefaultVouchers(back('b_red'))).toEqual([]);
  });

  it('pruneBrokenRequires：移除基础券时级联移除依赖它的 plus 券', () => {
    const all = withRequiredBases(['v_liquidation', 'v_antimatter']);
    expect(pruneBrokenRequires(all.filter(k => k !== 'v_clearance_sale')))
      .toEqual(['v_blank', 'v_antimatter']);   // 清算随清仓特卖一起被移除（结果按游戏 order 排序）
  });
});
