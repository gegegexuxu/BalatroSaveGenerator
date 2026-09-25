// 优惠券图鉴弹窗：单牌池（无页签，按游戏 order 排列）两行 × 每行 6 张分页；悬停说明框；
// 已拥有的券置灰、点击提示；点未拥有的券 = 选入工作列表并关闭（plus 券由 main 自动补基础券）。
// 已选券的展示与移除在主页入口（ui/vouchersEntry）；写入见 core/saveDeck.applyVouchersToSave（5.10）。
import type { VoucherDef } from '../data/vouchers';
import { listVouchers, type VoucherItem } from '../core/vouchers';
import { h, renderDescLine } from './dom';
import { showToast } from './usageModal';

/** 每页 2 行 × 6 张（同小丑/消耗牌图鉴版式） */
const PAGE_ROWS = 2;
const PAGE_COLS = 6;
const PAGE_SIZE = PAGE_ROWS * PAGE_COLS;

/** 行内 #N# 是否都有取值（同小丑图鉴规则） */
function hasAllVars(line: string, vars: (number | string | null)[]): boolean {
  return [...line.matchAll(/#(\d+)#/g)].every(m => {
    const v = vars[Number(m[1]) - 1];
    return v !== null && v !== undefined;
  });
}

export interface VouchersModal {
  root: HTMLElement;
  /** 打开弹窗：items = 工作列表（已拥有的置灰） */
  open(items: VoucherItem[]): void;
  isOpen(): boolean;
}

export interface VouchersOptions {
  /** 券面图（assets/voucher/<image>） */
  imageUrl: (def: VoucherDef) => string | undefined;
  /** 点未拥有的券：加入工作列表（plus 自动补基础券）并关闭；已拥有的由弹窗内提示，不回调 */
  onPick: (key: string) => void;
}

export function createVouchersModal(opts: VouchersOptions): VouchersModal {
  const close = (): void => overlay.classList.remove('show');

  let owned = new Set<string>();
  let page = 0;

  // ---------- 说明浮框（悬停某张券时出现，平时不占位） ----------
  const descEl = h('div', { class: 'jm-desc' });
  const descPop = h('div', { class: 'jm-desc-pop' }, [descEl]);

  function showDesc(def: VoucherDef, tile: HTMLElement): void {
    const lines = def.text.filter(l => l !== '' && hasAllVars(l, def.vars));
    const vars = def.vars.map(v => (v === null ? '' : v));
    const body = lines.length
      ? lines.map(l => `<p>${renderDescLine(l, vars)}</p>`).join('')
      : '<p class="jm-desc-hint">（暂无可用文本）</p>';
    descEl.innerHTML = `<p class="jm-desc-name" style="color:${def.colour}">${def.zhName}</p>${body}`;
    descPop.classList.add('show');
    const POP_GAP = 8;
    const pool = rows.getBoundingClientRect();
    const rect = tile.getBoundingClientRect();
    const popW = descPop.offsetWidth;
    const popH = descPop.offsetHeight;
    let left: number;
    if (pool.right - rect.right - POP_GAP >= popW) {
      left = rect.right - pool.left + POP_GAP;
    } else {
      left = rect.left - pool.left - POP_GAP - popW;
    }
    left = Math.max(4, Math.min(left, pool.width - popW - 4));
    const top = Math.max(4, Math.min(rect.top - pool.top, pool.height - popH - 4));
    descPop.style.left = `${Math.round(left)}px`;
    descPop.style.top = `${Math.round(top)}px`;
  }
  const hideDesc = (): void => { descPop.classList.remove('show'); };

  // ---------- 牌池：固定两行分页 ----------
  const rowEls = [h('div', { class: 'jm-row' }), h('div', { class: 'jm-row' })];
  const rows = h('div', { class: 'jm-pages' }, [...rowEls, descPop]);
  const dots = h('div', { class: 'dots jm-dots' });
  const prevBtn = h('button', { class: 'arrow-btn jm-arrow', text: '◀' });
  const nextBtn = h('button', { class: 'arrow-btn jm-arrow', text: '▶' });
  const view = h('div', { class: 'jm-view' }, [prevBtn, rows, nextBtn]);

  function makeTile(def: VoucherDef): HTMLElement {
    const url = opts.imageUrl(def);
    const inner: HTMLElement = url
      ? h('img', { class: 'jm-img', src: url, alt: def.enName })
      : h('span', { class: 'jm-fallback', text: def.zhName });
    const tile = h('div', { class: 'jcard' }, [inner]);
    if (owned.has(def.key)) {
      tile.classList.add('vo-owned');
      tile.addEventListener('click', () => showToast(`已拥有「${def.zhName}」`));
    } else {
      tile.addEventListener('click', () => {
        hideDesc();
        opts.onPick(def.key);
        showToast(`已选入「${def.zhName}」`);
        close();
      });
    }
    tile.addEventListener('mouseenter', () => showDesc(def, tile));
    tile.addEventListener('mouseleave', hideDesc);
    return tile;
  }

  function pageCount(total: number): number {
    return Math.max(1, Math.ceil(total / PAGE_SIZE));
  }

  function renderPages(): void {
    const all = listVouchers();
    const pages = pageCount(all.length);
    page = Math.min(page, pages - 1);
    for (let r = 0; r < PAGE_ROWS; r++) {
      const slice = all.slice((page * PAGE_ROWS + r) * PAGE_COLS, (page * PAGE_ROWS + r + 1) * PAGE_COLS);
      rowEls[r].replaceChildren(...slice.map(makeTile));
    }
    const paged = pages > 1;
    prevBtn.classList.toggle('jm-nav-hidden', !paged);
    nextBtn.classList.toggle('jm-nav-hidden', !paged);
    prevBtn.disabled = page === 0;
    nextBtn.disabled = page === pages - 1;
    dots.replaceChildren(...Array.from({ length: pages }, (_, i) =>
      h('div', { class: `dot${i === page ? ' active' : ''}` })));
    dots.classList.toggle('jm-nav-hidden', !paged);
  }

  function turn(delta: number): void {
    const pages = pageCount(listVouchers().length);
    page = Math.max(0, Math.min(pages - 1, page + delta));
    hideDesc();
    renderPages();
  }
  prevBtn.addEventListener('click', () => turn(-1));
  nextBtn.addEventListener('click', () => turn(1));

  const backBtn = h('button', { class: 'jm-back', text: '返回' });
  backBtn.addEventListener('click', close);

  const panel = h('div', { class: 'vouchers-modal' }, [
    view,
    dots,
    h('div', { class: 'jm-actions' }, [backBtn]),
  ]);

  const overlay = h('div', { class: 'modal-overlay' }, [panel]);
  overlay.addEventListener('click', e => { if (e.target === overlay) close(); });

  return {
    root: overlay,
    isOpen: () => overlay.classList.contains('show'),
    open(list) {
      owned = new Set(list.map(it => it.key));
      page = 0;
      hideDesc();
      renderPages();
      overlay.classList.add('show');
    },
  };
}
