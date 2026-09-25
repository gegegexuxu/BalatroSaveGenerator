// 优惠券入口（右列参数面板下方 = 消耗牌右侧的空白区）：头部「优惠券 数量」+「新增优惠券」按钮
// （打开图鉴弹窗），下面黑底区两行横排已选券的小图（券面 142:190 比例缩小，上下均分），
// 每行券多时收缩步进重叠（同消耗牌入口），左键移除。入口随右列拉伸贴底，底边与消耗牌入口对齐。
// 优惠券无槽位上限（used_vouchers 是集合语义）；移除基础券时级联移除依赖它的 plus 券
// （requires 链断裂即失效，同 core/vouchers.pruneBrokenRequires）。
// 写入导出存档：used_vouchers 标记 + 结构效果落盘（core/saveDeck.applyVouchersToSave，5.10）。
import type { VoucherDef } from '../data/vouchers';
import type { VoucherItem } from '../core/vouchers';
import { voucherByKey } from '../core/vouchers';
import { h } from './dom';

export interface VouchersEntry {
  root: HTMLElement;
  /** 列表变化后重绘 */
  render(list: VoucherItem[]): void;
}

export interface VouchersEntryOptions {
  /** 券面图（assets/voucher/<image>） */
  imageUrl: (def: VoucherDef) => string | undefined;
  /** 点「新增优惠券」：打开图鉴弹窗 */
  onOpen: () => void;
  /** 左键点某张券：请求移除该张（传 key 而非下标——入口展示按 order 排序，与内部集合顺序无关；
   *  牌组自带券是否可移除由调用方判定并提示） */
  onRemove: (key: string) => void;
}

/** 行内排布参数（与 .vo-card 的宽度/默认间隙保持一致） */
const CARD_W = 70;
const STEP_DEFAULT = 76;   // 默认步进：相邻留 6px 间隙
const STEP_MIN = 16;       // 最小步进：再密就认不出是哪张券了

export function createVouchersEntry(opts: VouchersEntryOptions): VouchersEntry {
  const head = h('div', { class: 'vo-head' });
  const editBtn = h('button', { class: 'btn vo-edit', text: '新增优惠券' });
  editBtn.addEventListener('click', () => opts.onOpen());
  const top = h('div', { class: 'vo-top' }, [head, editBtn]);
  const row1 = h('div', { class: 'vo-row' });
  const row2 = h('div', { class: 'vo-row' });
  const cards = h('div', { class: 'vo-cards' }, [row1, row2]);

  const root = h('div', { class: 'vouchers-entry' }, [top, cards]);

  function render(list: VoucherItem[]): void {
    head.textContent = `优惠券 ${list.length}`;
    const tiles = list.map(item => {
      const def = voucherByKey(item.key);
      if (!def) {
        return h('div', { class: 'vo-card' }, [h('span', { class: 'vo-fallback', text: item.key })]);
      }
      const url = opts.imageUrl(def);
      const tile = h('div', { class: 'vo-card' }, [
        url ? h('img', { class: 'vo-img', src: url, alt: def.enName })
            : h('span', { class: 'vo-fallback', text: def.zhName }),
      ]);
      tile.addEventListener('click', () => opts.onRemove(item.key));
      return tile;
    });
    // 上下两行均分（3+2、4+3……），比填满第一行再溢出更整齐
    const half = Math.ceil(tiles.length / 2);
    row1.replaceChildren(...tiles.slice(0, half));
    row2.replaceChildren(...tiles.slice(half));
    applyRowFit();
  }

  /** 按每行可用宽度收缩步进：券多时加大重叠，全部收进两行黑块（同 consumablesEntry.applyRowFit） */
  function applyRowFit(): void {
    for (const row of [row1, row2]) {
      const n = row.childElementCount;
      const avail = row.clientWidth;
      if (n <= 1 || avail <= 0) { row.style.removeProperty('--step'); continue; }
      const fit = Math.floor((avail - CARD_W) / (n - 1));
      row.style.setProperty('--step', `${Math.max(STEP_MIN, Math.min(STEP_DEFAULT, fit))}px`);
    }
  }
  window.addEventListener('resize', () => { if (cards.isConnected) applyRowFit(); });

  return { root, render };
}
