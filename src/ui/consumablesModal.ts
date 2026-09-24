// 消耗牌图鉴弹窗（v1 仅界面）：分类筛选 + 固定两行 × 最多 8 张的分页牌池（左右箭头翻页，不做滚动条），
// 左键点击即添加（可重复，与真机魔法牌组「愚者×2」一致），已选中的牌显示 ×N 角标。
// 说明框不占位、常驻：只有悬停某张牌时，右侧才浮出一个独立框体显示该牌说明（pointer-events 关掉，避免遮挡引发悬停抖动）。
// 已有消耗牌的展示与移除在主页入口（ui/consumablesEntry）里，本弹窗只负责图鉴与添加。
// 美术与交互沿用牌组编辑弹窗；写入存档留待下一轮（PROJECT_SPEC.md 5.6）。
import type { BackDef } from '../data/backs';
import { type ConsumableDef } from '../data/consumables';
import {
  canAddConsumable, listConsumables, SET_LABELS, SET_ORDER, type SetFilter,
} from '../core/consumables';
import { h, renderDescLine } from './dom';
import { showToast } from './usageModal';

/** 每页 2 行 × 8 张（固定版式：不做滚动条，翻页按钮切换） */
const PAGE_ROWS = 2;
const PAGE_COLS = 8;
const PAGE_SIZE = PAGE_ROWS * PAGE_COLS;

export interface ConsumablesModal {
  root: HTMLElement;
  /** 打开弹窗：keys = 工作列表（仅用于图鉴角标与「重置」判定），def = 当前牌组 */
  open(keys: string[], def: BackDef): void;
  isOpen(): boolean;
}

export interface ConsumablesOptions {
  /** 槽位上限（参数面板的「消耗品」槽位数，实时读取，改了参数立刻生效） */
  capacity: () => number;
  /** 牌面图（assets/{tarot|planet|spectral}/<enName>.png） */
  imageUrl: (def: ConsumableDef) => string | undefined;
  /** 添加 / 重置后同步给主页面保存 */
  onChange: (keys: string[]) => void;
  /** 列表是否与当前牌组默认不一致（不一致时「重置」的悬停文案改为提示） */
  isStale?: () => boolean;
  /** 重置为当前牌组默认，返回新的键列表 */
  onReset: () => string[];
}

/** 行内 #N# 是否都有取值：取不到的（依赖局内数值，如节制的当前小丑售价）整行不上屏 */
function hasAllVars(line: string, vars: (number | string)[]): boolean {
  return [...line.matchAll(/#(\d+)#/g)].every(m => Number(m[1]) <= vars.length);
}

export function createConsumablesModal(opts: ConsumablesOptions): ConsumablesModal {
  const close = (): void => overlay.classList.remove('show');

  let list: string[] = [];
  let deck: BackDef | undefined;
  let filter: SetFilter = 'all';
  let page = 0;

  // ---------- 说明浮框（悬停某张牌时出现，平时不占位） ----------
  const descEl = h('div', { class: 'cm-desc' });
  const descPop = h('div', { class: 'cm-desc-pop' }, [descEl]);

  function showDesc(def: ConsumableDef): void {
    const lines = def.text.filter(l => l !== '' && hasAllVars(l, def.vars));
    const body = lines.length
      ? lines.map(l => `<p>${renderDescLine(l, def.vars)}</p>`).join('')
      : '<p class="cm-desc-hint">（暂无可用文本）</p>';
    descEl.innerHTML = `<p class="cm-desc-name" style="color:${def.colour}">${def.zhName}</p>${body}`;
    descPop.classList.add('show');
  }
  const hideDesc = (): void => { descPop.classList.remove('show'); };

  // ---------- 牌池：固定两行分页 ----------
  const rowEls = [h('div', { class: 'cm-row' }), h('div', { class: 'cm-row' })];
  // 说明浮框挂在牌池内（绝对定位到右上角），不参与布局，故平时不占任何位置
  const rows = h('div', { class: 'cm-pages' }, [...rowEls, descPop]);
  const dots = h('div', { class: 'dots cm-dots' });
  const prevBtn = h('button', { class: 'arrow-btn cm-arrow', text: '◀' });
  const nextBtn = h('button', { class: 'arrow-btn cm-arrow', text: '▶' });
  const view = h('div', { class: 'cm-view' }, [prevBtn, rows, nextBtn]);
  const tabRow = h('div', { class: 'cm-tabs' });

  function countOf(key: string): number {
    return list.filter(k => k === key).length;
  }

  function makeTile(def: ConsumableDef): HTMLElement {
    const url = opts.imageUrl(def);
    const inner: HTMLElement = url
      ? (h('img', { class: 'cm-img', src: url, alt: def.enName }) as HTMLImageElement)
      : h('span', { class: 'cm-fallback', text: def.zhName });
    const tile = h('div', { class: 'ccard' }, [inner]);
    const owned = countOf(def.key);
    if (owned > 1) tile.appendChild(h('span', { class: 'cm-count', text: `×${owned}` }));
    tile.setAttribute('title', `左键添加：${def.zhName}（${SET_LABELS[def.set]}）`);
    tile.addEventListener('click', () => {
      const cap = opts.capacity();
      if (!canAddConsumable(list.length, cap)) {
        showToast(`消耗品槽位已满（${cap}），可在右侧参数面板调大槽位数`);
        return;
      }
      list.push(def.key);
      opts.onChange([...list]);
      renderPages();   // 刷新角标
      syncResetHint();
    });
    tile.addEventListener('mouseenter', () => showDesc(def));
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
    // 两行错序铺牌（游戏图鉴也是按行读），不足一页时后面的格子留空
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
    const entries: [SetFilter, string][] = [['all', '全部'], ...SET_ORDER.map(s => [s, SET_LABELS[s]] as [SetFilter, string])];
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

  // ---------- 操作行 ----------
  const resetBtn = h('button', { class: 'cm-reset', text: '重置' });
  /** 与牌组编辑一致：不入档的差异只改悬停文案（不做视觉高亮） */
  function syncResetHint(): void {
    const stale = opts.isStale?.() ?? false;
    resetBtn.setAttribute('title', stale
      ? '当前消耗牌不是该牌组的默认配置，点击恢复为该牌组开局自带的消耗牌'
      : '恢复当前牌组开局自带的消耗牌（魔法牌组为愚者×2、幽灵牌组为妖法×1，其余牌组为空）');
  }
  resetBtn.addEventListener('click', () => {
    list = opts.onReset();
    page = 0;
    renderPages();
    syncResetHint();
    showToast(`已重置为「${deck?.zhName ?? ''}」的默认消耗牌（${list.length} 张）`);
  });

  const doneBtn = h('button', { class: 'cm-done', text: '完成' });
  doneBtn.addEventListener('click', close);

  const panel = h('div', { class: 'consumables-modal' }, [
    h('div', { class: 'cm-title', text: '消耗牌图鉴' }),
    tabRow,
    view,
    dots,
    h('div', { class: 'cm-hint', text: '左键点击即添加（可重复）· 左右箭头翻页 · 移除请到主页「修改消耗牌」入口 · 数量上限为参数面板的「消耗品」槽位数 · v1 仅界面配置，暂不写入导出存档' }),
    h('div', { class: 'cm-actions' }, [resetBtn, doneBtn]),
  ]);

  const overlay = h('div', { class: 'modal-overlay' }, [panel]);
  overlay.addEventListener('click', e => { if (e.target === overlay) close(); });

  return {
    root: overlay,
    isOpen: () => overlay.classList.contains('show'),
    open(keys, def) {
      list = [...keys];
      deck = def;
      page = 0;
      hideDesc();
      renderTabs();
      renderPages();
      syncResetHint();
      overlay.classList.add('show');
    },
  };
}
