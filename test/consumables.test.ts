// 消耗牌数据与界面逻辑（PROJECT_SPEC.md 8.1）：数据形状、素材齐备、牌组默认与槽位规则。
// 数据由 scripts/extractData.mjs 生成（src/data/consumables.ts），此处校验生成结果与游戏数据一致。
import { describe, it, expect } from 'vitest';
import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { CONSUMABLES, type ConsumableSet } from '../src/data/consumables';
import { BACKS } from '../src/data/backs';
import {
  canAddConsumable, consumableByKey, deckDefaultConsumables, listConsumables, SET_LABELS, SET_ORDER,
} from '../src/core/consumables';

const assetPath = (rel: string): string => fileURLToPath(new URL(`../assets/${rel}`, import.meta.url));
const bySet = (set: ConsumableSet) => CONSUMABLES.filter(c => c.set === set);
const back = (key: string) => BACKS.find(b => b.key === key)!;

describe('消耗牌数据（提取自 game.lua / zh_CN.lua）', () => {
  it('三类共 52 张：塔罗 22 / 星球 12 / 幻灵 18', () => {
    expect(CONSUMABLES).toHaveLength(52);
    expect(bySet('Tarot')).toHaveLength(22);
    expect(bySet('Planet')).toHaveLength(12);
    expect(bySet('Spectral')).toHaveLength(18);
  });

  it('key 唯一，order 在分类内为 1..n 连续（= 游戏牌池顺序）', () => {
    expect(new Set(CONSUMABLES.map(c => c.key)).size).toBe(CONSUMABLES.length);
    for (const set of SET_ORDER) {
      expect(bySet(set).map(c => c.order)).toEqual(bySet(set).map((_, i) => i + 1));
    }
  });

  it('售价：塔罗 3 / 星球 3 / 幻灵 4；仅灵魂与黑洞为未解锁', () => {
    for (const c of bySet('Tarot')) expect(c.cost).toBe(3);
    for (const c of bySet('Planet')) expect(c.cost).toBe(3);
    for (const c of bySet('Spectral')) expect(c.cost).toBe(4);
    expect(CONSUMABLES.filter(c => c.hidden).map(c => c.key)).toEqual(['c_soul', 'c_black_hole']);
  });

  it('图集坐标在 Tarots.png 的 10×6 网格内，且三条目录的分类色与 G.C.SECONDARY_SET 一致', () => {
    for (const c of CONSUMABLES) {
      expect(c.pos.x).toBeGreaterThanOrEqual(0);
      expect(c.pos.x).toBeLessThanOrEqual(9);
      expect(c.pos.y).toBeGreaterThanOrEqual(0);
      expect(c.pos.y).toBeLessThanOrEqual(5);
    }
    const colours: Record<ConsumableSet, string> = {
      Tarot: '#a782d1', Planet: '#13afce', Spectral: '#4584fa',
    };
    for (const set of SET_ORDER) for (const c of bySet(set)) expect(c.colour).toBe(colours[set]);
  });

  it('每条都有中文名与描述文本，素材文件名 = 英文名 + .png', () => {
    for (const c of CONSUMABLES) {
      expect(c.zhName, c.key).toBeTruthy();
      expect(c.text.length, c.key).toBeGreaterThan(0);
      expect(c.image, c.key).toBe(`${c.enName}.png`);
    }
  });

  it('描述里的 #N# 占位符都有静态取值（否则该行会被界面省略）', () => {
    for (const c of CONSUMABLES) {
      const max = Math.max(0, ...[...c.text.join('').matchAll(/#(\d+)#/g)].map(m => Number(m[1])));
      expect(c.vars.length, `${c.key} 需要 ${max} 个取值，只有 ${c.vars.length} 个`).toBeGreaterThanOrEqual(max);
    }
  });

  it('素材齐备：assets/{tarot|planet|spectral}/<英文名>.png 都在', () => {
    for (const c of CONSUMABLES) {
      const p = assetPath(`${c.set.toLowerCase()}/${c.image}`);
      expect(existsSync(p), `缺少素材 ${p}`).toBe(true);
    }
  });

  it('分类中文名与游戏 zh_CN 一致（Spectral = 幻灵牌）', () => {
    expect(SET_LABELS).toEqual({ Tarot: '塔罗牌', Planet: '星球牌', Spectral: '幻灵牌' });
  });
});

describe('牌池查询与牌组默认', () => {
  it('listConsumables：按分类取牌池，数量塔罗 22 / 星球 12 / 幻灵 18', () => {
    expect(listConsumables('Tarot')).toHaveLength(22);
    expect(listConsumables('Planet')).toHaveLength(12);
    expect(listConsumables('Spectral')).toHaveLength(18);
  });

  it('consumableByKey 能查到已知牌，未知键返回 undefined', () => {
    expect(consumableByKey('c_fool')?.zhName).toBe('愚者');
    expect(consumableByKey('c_hex')?.zhName).toBe('妖法');
    expect(consumableByKey('c_nope')).toBeUndefined();
  });

  it('牌组默认消耗牌：魔法 = 愚者×2、幽灵 = 妖法×1、其余为空（backs.ts 的 config.consumables）', () => {
    expect(deckDefaultConsumables(back('b_magic'))).toEqual(['c_fool', 'c_fool']);
    expect(deckDefaultConsumables(back('b_ghost'))).toEqual(['c_hex']);
    expect(deckDefaultConsumables(back('b_red'))).toEqual([]);
    expect(deckDefaultConsumables(back('b_nebula'))).toEqual([]);
  });

  it('槽位硬上限：达到槽位数即不可再添加', () => {
    expect(canAddConsumable(0, 0)).toBe(false);
    expect(canAddConsumable(1, 2)).toBe(true);
    expect(canAddConsumable(2, 2)).toBe(false);
  });
});
