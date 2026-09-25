// 优惠券的界面逻辑：牌池查询、升级对（requires）补齐、已拥有集合运算。
// 数据由 scripts/extractData.mjs 生成（src/data/vouchers.ts）；存档写入见 core/saveDeck.applyVouchersToSave。
// 效果生效模型（PROJECT_SPEC.md 5.10）：续档时游戏不重放 Card.apply_to_run，
// 用时检查型券只靠 used_vouchers 标记生效；结构改写型券由 saveDeck 把效果写进存档状态。
import { VOUCHERS, type VoucherDef } from '../data/vouchers';

/** 按游戏 order 取全部券（神形符/岩穴符已在提取层排除：ante 回退券，对 ante-1 存档无意义） */
export function listVouchers(): VoucherDef[] {
  return VOUCHERS;
}

export function voucherByKey(key: string): VoucherDef | undefined {
  return VOUCHERS.find(v => v.key === key);
}

/**
 * 工作列表里的一张优惠券（只记 key；used_vouchers 是集合，同一张券重复无意义）。
 * 效果的落盘在 saveDeck.applyVouchersToSave：标记 + 结构改写（水晶球 +1 消耗槽等）。
 */
export interface VoucherItem {
  key: string;
}

/**
 * 补齐升级对：plus 券依赖基础券（common_events.lua:1993 requires 上架条件，
 * 游戏里 plus 只可能和基础券同时存在）。picked plus → 连基础券一起入列（已拥有则跳过）。
 */
export function withRequiredBases(keys: string[]): string[] {
  const owned = new Set(keys);
  for (const key of keys) {
    const def = voucherByKey(key);
    for (const req of def?.requires ?? []) {
      if (!owned.has(req)) owned.add(req);
    }
  }
  // 按游戏 order 排序（基础券 order < plus），保证 saveDeck 顺序应用升级效果
  return VOUCHERS.filter(v => owned.has(v.key)).map(v => v.key);
}

/** 券在已拥有集合中是否存在（used_vouchers 语义：同一张券唯一） */
export function hasVoucher(keys: string[], key: string): boolean {
  return keys.includes(key);
}

/**
 * 牌组自带的起始优惠券（back.lua apply_to_run：config.voucher 单张 / config.vouchers 数组）：
 * 魔法 = 水晶球、星云 = 望远镜、黄道 = 塔罗商人 + 星球商人 + 库存过剩，其余为空。
 * 未知 key（提取与数据不同步时）直接丢弃。
 */
export function deckDefaultVouchers(def: import('../data/backs').BackDef): string[] {
  const cfg = def.config as Record<string, unknown>;
  const out: string[] = [];
  if (typeof cfg.voucher === 'string') out.push(cfg.voucher);
  if (cfg.vouchers && typeof cfg.vouchers === 'object') {
    out.push(...Object.values(cfg.vouchers).filter((v): v is string => typeof v === 'string'));
  }
  return out.filter(k => voucherByKey(k) !== undefined);
}

/** 移除某张券后级联清理：plus 券的 requires 链断裂即失效（游戏里 plus 只与基础券共存），一并移除 */
export function pruneBrokenRequires(keys: string[]): string[] {
  const set = new Set(keys);
  let changed = true;
  while (changed) {
    changed = false;
    for (const key of [...set]) {
      const def = voucherByKey(key);
      if (def && def.requires.length > 0 && !def.requires.every(r => set.has(r))) {
        set.delete(key);
        changed = true;
      }
    }
  }
  return VOUCHERS.filter(v => set.has(v.key)).map(v => v.key);
}
