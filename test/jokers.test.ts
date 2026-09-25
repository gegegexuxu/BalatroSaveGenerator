// 小丑牌数据与界面逻辑（PROJECT_SPEC.md 5.7）：数据形状、素材齐备、#N# 静态取值边界、
// 稀有度分组与槽位规则。数据由 scripts/extractData.mjs 生成（src/data/jokers.ts），
// 此处校验生成结果与游戏数据一致（同消耗牌 test/consumables.test.ts 的门禁思路）。
import { describe, it, expect } from 'vitest';
import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { JOKERS, JOKER_RARITY_COLOUR, JOKER_RARITY_ZH } from '../src/data/jokers';
import {
  canAddJoker, jokerByKey, listJokers, JOKER_EDITIONS, RARITY_ORDER, rarityLabel,
} from '../src/core/jokers';

const assetPath = (rel: string): string => fileURLToPath(new URL(`../assets/${rel}`, import.meta.url));
const byRarity = (rarity: number) => JOKERS.filter(j => j.rarity === rarity);

/** #N# 静态取不到的占位（动态/每回合随机值）：提取脚本尽力取值的已知边界，
 *  对应描述行由界面省略（hasAllVars）。此列表扩大 = 取值质量回退，需先改提取脚本。 */
const UNRESOLVED_ALLOWED: Record<string, string> = {
  j_diet_cola: '#1#',               // 中心无 config，数值硬编码在计分代码
  j_loyalty_card: '#3#',            // 忠诚卡当前状态（局内循环）
  j_mail: '#2#',                    // 每回合随机的邮寄牌点数
  j_ancient: '#2#',                 // 每回合随机的远古牌花色
  j_castle: '#2#',                  // 每回合随机的城堡牌花色
  j_idol: '#2# #3#',                // 每回合随机的偶像牌点数/花色
  j_drivers_license: '#2#',         // 人头牌计数（局内累计）
};

function unresolvedPlaceholders(d: (typeof JOKERS)[number]): string {
  return [...d.text.join('').matchAll(/#(\d+)#/g)]
    .map(m => `#${m[1]}#`)
    .filter(ph => d.vars[Number(ph.slice(1, -1)) - 1] === null)
    .sort()
    .join(' ');
}

describe('小丑牌数据（提取自 game.lua / zh_CN.lua / card.lua loc_vars）', () => {
  it('共 150 张：普通 61 / 罕见 64 / 稀有 20 / 传奇 5', () => {
    expect(JOKERS).toHaveLength(150);
    expect(byRarity(1)).toHaveLength(61);
    expect(byRarity(2)).toHaveLength(64);
    expect(byRarity(3)).toHaveLength(20);
    expect(byRarity(4)).toHaveLength(5);
  });

  it('key 唯一，order 全局唯一且升序（= 游戏牌池顺序）', () => {
    expect(new Set(JOKERS.map(j => j.key)).size).toBe(JOKERS.length);
    expect(new Set(JOKERS.map(j => j.order)).size).toBe(JOKERS.length);
    const orders = JOKERS.map(j => j.order);
    expect(orders).toEqual([...orders].sort((a, b) => a - b));
  });

  it('rarity 只取 1-4，售价在 1-20 之间（信用卡最低 1，传奇最高 20）', () => {
    for (const j of JOKERS) expect([1, 2, 3, 4]).toContain(j.rarity);
    expect(Math.min(...JOKERS.map(j => j.cost))).toBe(1);   // 信用卡 $1
    expect(Math.max(...JOKERS.map(j => j.cost))).toBe(20);
  });

  it('图集坐标在 Jokers.png 的 10 列 × 16 行网格内；稀有度配色 = G.C.RARITY', () => {
    for (const j of JOKERS) {
      expect(j.pos.x).toBeGreaterThanOrEqual(0);
      expect(j.pos.x).toBeLessThanOrEqual(9);
      expect(j.pos.y).toBeGreaterThanOrEqual(0);
      expect(j.pos.y).toBeLessThanOrEqual(15);
    }
    expect(JOKER_RARITY_COLOUR).toEqual({ 1: '#009dff', 2: '#4bc292', 3: '#fe5f55', 4: '#b26cbb' });
    for (const j of JOKERS) expect(j.colour).toBe(JOKER_RARITY_COLOUR[j.rarity]);
  });

  it('每条都有中文名、英文名与描述文本，素材文件名 = 英文名 + .png（Driver\'s License 例外 = Driver.png）', () => {
    for (const j of JOKERS) {
      expect(j.zhName, j.key).toBeTruthy();
      expect(j.enName, j.key).toBeTruthy();
      expect(j.text.length, j.key).toBeGreaterThan(0);
      const want = j.key === 'j_drivers_license' ? 'Driver.png' : `${j.enName}.png`;
      expect(j.image, j.key).toBe(want);
    }
  });

  it('vars 覆盖文本用到的全部占位序号（结构完整）', () => {
    for (const j of JOKERS) {
      const max = Math.max(0, ...[...j.text.join('').matchAll(/#(\d+)#/g)].map(m => Number(m[1])));
      expect(j.vars.length, `${j.key} 需要 ${max} 个取值位置，只有 ${j.vars.length} 个`).toBeGreaterThanOrEqual(max);
    }
  });

  it('静态取不到的占位只出现在已知边界清单内（取值质量门禁）', () => {
    for (const j of JOKERS) {
      const unresolved = unresolvedPlaceholders(j);
      if (unresolved === '') continue;
      expect(UNRESOLVED_ALLOWED, `${j.key} 出现未清单化的取值失败 ${unresolved}`).toHaveProperty(j.key);
      expect(unresolved, `${j.key} 的取值失败集合变化：${unresolved}`).toBe(UNRESOLVED_ALLOWED[j.key]);
    }
    // 清单里的键必须仍然存在且确实失败（游戏更新后取值成功时应从清单移除）
    for (const [key, ph] of Object.entries(UNRESOLVED_ALLOWED)) {
      const d = jokerByKey(key);
      expect(d, `${key} 不在小丑数据里`).toBeDefined();
      expect(unresolvedPlaceholders(d!), `${key} 已能全部静态取值，请从 UNRESOLVED_ALLOWED 移除`).toBe(ph);
    }
  });

  it('静态取值抽样：贪婪小丑 [3, 方片]、八号球 [1, 4]、绿色小丑 [1, 1, 0]（当前倍率开局 0）', () => {
    expect(jokerByKey('j_greedy_joker')!.vars).toEqual([3, '方片']);
    expect(jokerByKey('j_8_ball')!.vars).toEqual([1, 4]);
    expect(jokerByKey('j_green_joker')!.vars).toEqual([1, 1, 0]);
    expect(jokerByKey('j_jolly')!.vars).toEqual([8, '对子']);
  });

  it('素材齐备：assets/joker/<image> 都在', () => {
    for (const j of JOKERS) {
      const p = assetPath(`joker/${j.image}`);
      expect(existsSync(p), `缺少素材 ${p}`).toBe(true);
    }
  });

  it('稀有度页签与顺序：普通/罕见/稀有/传奇，RARITY_ORDER 与数据一致', () => {
    expect(RARITY_ORDER).toEqual([1, 2, 3, 4]);
    expect(rarityLabel(1)).toBe('普通');
    expect(rarityLabel(2)).toBe('罕见');
    expect(rarityLabel(3)).toBe('稀有');
    expect(rarityLabel(4)).toBe('传奇');
    expect(JOKER_RARITY_ZH[1]).toBe('普通');
  });
});

describe('牌池查询与槽位规则', () => {
  it('listJokers：按稀有度取牌池（61/64/20/5），不传 = 全部', () => {
    expect(listJokers(1)).toHaveLength(61);
    expect(listJokers(4)).toHaveLength(5);
    expect(listJokers()).toHaveLength(150);
  });

  it('jokerByKey 能查到已知牌，未知键返回 undefined', () => {
    expect(jokerByKey('j_joker')?.zhName).toBe('小丑');
    expect(jokerByKey('j_wrathful_joker')?.enName).toBe('Wrathful Joker');
    expect(jokerByKey('j_nope')).toBeUndefined();
  });

  it('槽位硬上限按非负片张数判断（负片不占槽位，card.lua:687）', () => {
    expect(canAddJoker(0, 0)).toBe(false);
    expect(canAddJoker(1, 2)).toBe(true);
    expect(canAddJoker(2, 2)).toBe(false);
    expect(canAddJoker(5, 5)).toBe(false);
  });

  it('JOKER_EDITIONS 顺序 = 图鉴分段顺序（闪箔/镭射/多彩/负片）', () => {
    expect(JOKER_EDITIONS).toEqual(['foil', 'holo', 'polychrome', 'negative']);
  });
});
