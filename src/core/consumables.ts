// 消耗牌（塔罗 / 星球 / 幻灵）的界面逻辑：牌池查询、牌组默认、槽位容量判断。
// 数据由 scripts/extractData.mjs 生成（src/data/consumables.ts）；存档侧写入留待下一轮（PROJECT_SPEC.md 5.6）。
import { CONSUMABLES, type ConsumableDef, type ConsumableSet } from '../data/consumables';
import type { BackDef } from '../data/backs';

/** 分类顺序与筛选顺序一致（塔罗 / 星球 / 幻灵） */
export const SET_ORDER: readonly ConsumableSet[] = ['Tarot', 'Planet', 'Spectral'];

/** 分类中文名：与游戏 zh_CN 的 b_tarot_cards / b_planet_cards / b_spectral_cards 一致 */
export const SET_LABELS: Record<ConsumableSet, string> = {
  Tarot: '塔罗牌',
  Planet: '星球牌',
  Spectral: '幻灵牌',
};

/** 按分类取牌池（保持游戏 order 顺序） */
export function listConsumables(set: ConsumableSet): ConsumableDef[] {
  return filterBySet(set);
}

function filterBySet(set: ConsumableSet): ConsumableDef[] {
  return CONSUMABLES.filter(c => c.set === set);
}

export function consumableByKey(key: string): ConsumableDef | undefined {
  return CONSUMABLES.find(c => c.key === key);
}

/**
 * 牌组的默认起始消耗牌。依据 back.lua 的 apply_to_run：`config.consumables` 是
 * `{[序号] = 中心 key}` 的数组式表（如魔法牌组 `{1='c_fool', 2='c_fool'}`、幽灵牌组 `{1='c_hex'}`）。
 * 未知 key（提取脚本与牌组数据不同步时）直接丢弃，避免界面出现无图无名的空位。
 */
export function deckDefaultConsumables(def: BackDef): string[] {
  const cfg = def.config.consumables;
  if (!cfg || typeof cfg !== 'object' || Array.isArray(cfg)) return [];
  return Object.entries(cfg as Record<string, unknown>)
    .sort((a, b) => Number(a[0]) - Number(b[0]))
    .map(([, key]) => key)
    .filter((key): key is string => typeof key === 'string' && consumableByKey(key) !== undefined);
}

/** 工作列表里的一张消耗牌：key = 中心 key；negative = 加入时负片开关是否开着（写档带负片 edition） */
export interface ConsumableItem {
  key: string;
  negative: boolean;
}

/** 槽位硬上限判断：已达上限时不能再添加（上限 = 参数面板的「消耗牌」槽位数） */
export function canAddConsumable(count: number, capacity: number): boolean {
  return count < capacity;
}
