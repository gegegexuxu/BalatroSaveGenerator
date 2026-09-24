// 消耗牌图鉴弹窗：分类筛选 + 两行 × 每行 6 张分页牌池；点牌即选入并关闭，「返回」不选任何牌。
// 「负片开启/关闭」开关也在本弹窗：开 = 牌池整卡按负片样式预览，此刻点选的牌带负片入列；
// 关 = 原样预览，点选的牌不带负片（负片是逐牌属性，加入时刻的开关状态决定）。
// 悬停说明框由 showDesc 动态定位；已有消耗牌的展示与移除在主页入口（ui/consumablesEntry）；
// 存档写入见 core/saveDeck.applyConsumablesToSave（PROJECT_SPEC.md 5.6）。
import { type ConsumableDef } from '../data/consumables';
import { type ConsumableItem } from '../core/consumables';
import {
  canAddConsumable, listConsumables, SET_LABELS, SET_ORDER,
} from '../core/consumables';
import { h, renderDescLine } from './dom';
import { showToast } from './usageModal';
import { consumableCardImage } from './consumableCard';

/** 每页 2 行 × 6 张（固定版式：不做滚动条，翻页按钮切换） */
const PAGE_ROWS = 2;
const PAGE_COLS = 6;
const PAGE_SIZE = PAGE_ROWS * PAGE_COLS;

export interface ConsumablesModal {
  root: HTMLElement;
  /** 打开弹窗：items = 工作列表（仅用于 ×N 角标） */
  open(items: ConsumableItem[]): void;
  isOpen(): boolean;
}

export interface ConsumablesOptions {
  /** 槽位上限（参数面板的「消耗牌」槽位数，实时读取；仅作点牌时的兜底判断） */
  capacity: () => number;
  /** 负片开关当前状态（开 = 牌池按负片预览，点选的牌带负片） */
  negative: () => boolean;
  /** 点「负片开启/关闭」：切换开关（调用方负责重绘本弹窗与主页入口） */
  onToggleNegative: () => void;
  /** 牌面图（assets/{tarot|planet|spectral}/<enName>.png） */
  imageUrl: (def: ConsumableDef) => string | undefined;
  /** 选中某张牌：主页面按当前开关状态把它加进工作列表并重绘入口；调用后弹窗自动关闭 */
  onPick: (key: string) => void;
}

/** 行内 #N# 是否都有取值：取不到的（依赖局内数值，如节制的当前小丑售价）整行不上屏 */
function hasAllVars(line: string, vars: (number | string)[]): boolean {
  return [...line.matchAll(/#(\d+)#/g)].every(m => Number(m[1]) <= vars.length);
}

export function createConsumablesModal(opts: ConsumablesOptions): ConsumablesModal {
  const close = (): void => overlay.classList.remove('show');

  let items: ConsumableItem[] = [];
  let filter = 'Tarot' as import('../data/consumables').ConsumableSet;   // 默认塔罗牌
  let page = 0;

  // ---------- 说明浮框（悬停某张牌时出现，平时不占位） ----------
  const descEl = h('div', { class: 'cm-desc' });
  const descPop = h('div', { class: 'cm-desc-pop' }, [descEl]);

  function showDesc(def: ConsumableDef, tile: HTMLElement): void {
    const lines = def.text.filter(l => l !== '' && hasAllVars(l, def.vars));
    const body = lines.length
      ? lines.map(l => `<p>${renderDescLine(l, def.vars)}</p>`).join('')
      : '<p class="cm-desc-hint">（暂无可用文本）</p>';
    descEl.innerHTML = `<p class="cm-desc-name" style="color:${def.colour}">${def.zhName}</p>${body}`;
    descPop.classList.add('show');
    // 动态定位：贴在悬停牌的左右两侧（右侧放不下就换到左侧），顶部与牌对齐并夹在牌池内
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
  const rowEls = [h('div', { class: 'cm-row' }), h('div', { class: 'cm-row' })];
  // 说明浮框挂在牌池内（绝对定位），不参与布局
  const rows = h('div', { class: 'cm-pages' }, [...rowEls, descPop]);
  const dots = h('div', { class: 'dots cm-dots' });
  const prevBtn = h('button', { class: 'arrow-btn cm-arrow', text: '◀' });
  const nextBtn = h('button', { class: 'arrow-btn cm-arrow', text: '▶' });
  const view = h('div', { class: 'cm-view' }, [prevBtn, rows, nextBtn]);
  const tabRow = h('div', { class: 'cm-tabs' });

  function countOf(key: string): number {
    return items.filter(it => it.key === key).length;
  }

  function makeTile(def: ConsumableDef): HTMLElement {
    const url = opts.imageUrl(def);
    const inner: HTMLElement = url
      ? consumableCardImage(def, url, opts.negative(), 'cm-img')
      : h('span', { class: 'cm-fallback', text: def.zhName });
    const tile = h('div', { class: 'ccard' }, [inner]);
    const owned = countOf(def.key);
    if (owned > 1) tile.appendChild(h('span', { class: 'cm-count', text: `×${owned}` }));
    tile.addEventListener('click', () => {
      const cap = opts.capacity();
      // 负片牌使上限 +1（card.lua:405-417）：有效上限 = 槽位数 + 已有负片张数；
      // 再点一张负片上限还会涨，故负片永远可加，普通牌按有效上限判断
      const negCount = items.filter(it => it.negative).length;
      const effective = cap + negCount;
      if (!opts.negative() && !canAddConsumable(items.length, effective)) {
        showToast(`消耗牌已达上限（${items.length}/${effective}）——开「负片」可继续添加，或调大参数面板的槽位数`);
        return;
      }
      opts.onPick(def.key);
      showToast(opts.negative() ? `已添加「${def.zhName}」（负片）` : `已添加「${def.zhName}」`);
      close();
    });
    tile.addEventListener('mouseenter', () => showDesc(def, tile));
    tile.addEventListener('mouseleave', hideDesc);
    return tile;
  }

  function pageCount(total: number): number {
    return Math.max(1, Math.ceil(total / PAGE_SIZE));
  }

  function renderPages(): void {
    const all = listConsumables(filter);
    const pages = pageCount(all.length);
    page = Math.min(page, pages - 1);
    // 两行铺牌，不足一页时后面的格子留空
    for (let r = 0; r < PAGE_ROWS; r++) {
      const slice = all.slice((page * PAGE_ROWS + r) * PAGE_COLS, (page * PAGE_ROWS + r + 1) * PAGE_COLS);
      rowEls[r].replaceChildren(...slice.map(makeTile));
    }
    // 只有一页时不显示翻页控件（用 visibility 收起，避免牌池宽度跳动）
    const paged = pages > 1;
    prevBtn.classList.toggle('cm-nav-hidden', !paged);
    nextBtn.classList.toggle('cm-nav-hidden', !paged);
    prevBtn.disabled = page === 0;
    nextBtn.disabled = page === pages - 1;
    dots.replaceChildren(...Array.from({ length: pages }, (_, i) =>
      h('div', { class: `dot${i === page ? ' active' : ''}` })));
    dots.classList.toggle('cm-nav-hidden', !paged);
  }

  function turn(delta: number): void {
    const pages = pageCount(listConsumables(filter).length);
    page = Math.max(0, Math.min(pages - 1, page + delta));
    hideDesc();
    renderPages();
  }
  prevBtn.addEventListener('click', () => turn(-1));
  nextBtn.addEventListener('click', () => turn(1));

  function renderTabs(): void {
    const entries = SET_ORDER.map(s => [s, SET_LABELS[s]] as const);
    tabRow.replaceChildren(...entries.map(([value, label]) => {
      const tab = h('button', {
        class: `cm-tab cm-tab-${value.toLowerCase()}${value === filter ? ' active' : ''}`,
        text: label,
      });
      tab.addEventListener('click', () => {
        filter = value;
        page = 0;   // 换分类回到第一页
        hideDesc();
        renderTabs();
        renderPages();
      });
      return tab;
    }));
  }

  // ---------- 操作行：负片开关（仅影响之后点选的牌）+「返回」不选任何牌 ----------
  const negBtn = h('button', { class: 'btn cm-neg', text: '负片关闭' });
  negBtn.addEventListener('click', () => opts.onToggleNegative());
  const backBtn = h('button', { class: 'cm-back', text: '返回' });
  backBtn.addEventListener('click', close);

  function syncNegBtn(): void {
    const on = opts.negative();
    negBtn.textContent = on ? '负片开启' : '负片关闭';
    negBtn.classList.toggle('on', on);
  }

  const panel = h('div', { class: 'consumables-modal' }, [
    tabRow,
    view,
    dots,
    h('div', { class: 'cm-actions' }, [negBtn, backBtn]),
  ]);

  const overlay = h('div', { class: 'modal-overlay' }, [panel]);
  overlay.addEventListener('click', e => { if (e.target === overlay) close(); });

  return {
    root: overlay,
    isOpen: () => overlay.classList.contains('show'),
    open(list) {
      items = [...list];
      page = 0;
      hideDesc();
      renderTabs();
      renderPages();
      syncNegBtn();
      overlay.classList.add('show');
    },
  };
}
