// 小丑牌图鉴弹窗：稀有度页签（普通/罕见/稀有/传奇，G.C.RARITY 配色）+ 两行 × 每行 6 张分页牌池；
// 点牌**不直接入列**，而是打开单卡定制弹窗（ui/jokerDetailModal：版本 + 永恒/易腐/租用贴纸），
// 定制完成才加入工作列表；「返回」关闭图鉴。
// 悬停说明框由 showDesc 动态定位（#N# 取不到的行不上屏，同消耗牌）；已有小丑的展示与
// 移除在主页入口（ui/jokersEntry）；存档写入见 core/saveDeck.applyJokersToSave（PROJECT_SPEC.md 5.9）。
import { JOKER_RARITY_COLOUR, type JokerDef } from '../data/jokers';
import { listJokers, RARITY_ORDER, rarityLabel, type JokerItem } from '../core/jokers';
import { h, renderDescLine } from './dom';

/** 每页 2 行 × 6 张（固定版式：不做滚动条，翻页按钮切换，同消耗牌图鉴） */
const PAGE_ROWS = 2;
const PAGE_COLS = 6;
const PAGE_SIZE = PAGE_ROWS * PAGE_COLS;

export interface JokersModal {
  root: HTMLElement;
  /** 打开弹窗：items = 工作列表（仅用于 ×N 角标） */
  open(items: JokerItem[]): void;
  isOpen(): boolean;
}

export interface JokersOptions {
  /** 牌面图（assets/joker/<image>） */
  imageUrl: (def: JokerDef) => string | undefined;
  /** 点某张牌：打开该小丑的单卡定制弹窗（版本/贴纸在定制弹窗里选，不入列） */
  onOpenDetail: (def: JokerDef) => void;
}

/** 行内 #N# 是否都有取值：null = 静态取不到（依赖局内数值，如当前回合的偶像牌）整行不上屏 */
function hasAllVars(line: string, vars: (number | string | null)[]): boolean {
  return [...line.matchAll(/#(\d+)#/g)].every(m => {
    const v = vars[Number(m[1]) - 1];
    return v !== null && v !== undefined;
  });
}

export function createJokersModal(opts: JokersOptions): JokersModal {
  const close = (): void => overlay.classList.remove('show');

  let items: JokerItem[] = [];
  let filter: number = RARITY_ORDER[0];   // 默认普通
  let page = 0;

  // ---------- 说明浮框（悬停某张牌时出现，平时不占位） ----------
  const descEl = h('div', { class: 'jm-desc' });
  const descPop = h('div', { class: 'jm-desc-pop' }, [descEl]);

  function showDesc(def: JokerDef, tile: HTMLElement): void {
    const lines = def.text.filter(l => l !== '' && hasAllVars(l, def.vars));
    // 通过过滤的行其占位符必有值；null 只会出现在未使用的位置，渲染前补空串
    const vars = def.vars.map(v => (v === null ? '' : v));
    const body = lines.length
      ? lines.map(l => `<p>${renderDescLine(l, vars)}</p>`).join('')
      : '<p class="jm-desc-hint">（暂无可用文本）</p>';
    descEl.innerHTML = `<p class="jm-desc-name" style="color:${def.colour}">${def.zhName}</p>${body}`;
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
  const rowEls = [h('div', { class: 'jm-row' }), h('div', { class: 'jm-row' })];
  // 说明浮框挂在牌池内（绝对定位），不参与布局
  const rows = h('div', { class: 'jm-pages' }, [...rowEls, descPop]);
  const dots = h('div', { class: 'dots jm-dots' });
  const prevBtn = h('button', { class: 'arrow-btn jm-arrow', text: '◀' });
  const nextBtn = h('button', { class: 'arrow-btn jm-arrow', text: '▶' });
  const view = h('div', { class: 'jm-view' }, [prevBtn, rows, nextBtn]);
  const tabRow = h('div', { class: 'jm-tabs' });

  function countOf(key: string): number {
    return items.filter(it => it.key === key).length;
  }

  function makeTile(def: JokerDef): HTMLElement {
    const url = opts.imageUrl(def);
    const inner: HTMLElement = url
      ? h('img', { class: 'jm-img', src: url, alt: def.enName })
      : h('span', { class: 'jm-fallback', text: def.zhName });
    const tile = h('div', { class: 'jcard' }, [inner]);
    const owned = countOf(def.key);
    if (owned > 1) tile.appendChild(h('span', { class: 'jm-count', text: `×${owned}` }));
    tile.addEventListener('click', () => {
      hideDesc();
      opts.onOpenDetail(def);   // 打开单卡定制弹窗（版本/贴纸在那里选）
    });
    tile.addEventListener('mouseenter', () => showDesc(def, tile));
    tile.addEventListener('mouseleave', hideDesc);
    return tile;
  }

  function pageCount(total: number): number {
    return Math.max(1, Math.ceil(total / PAGE_SIZE));
  }

  function renderPages(): void {
    const all = listJokers(filter);
    const pages = pageCount(all.length);
    page = Math.min(page, pages - 1);
    // 两行铺牌，不足一页时后面的格子留空
    for (let r = 0; r < PAGE_ROWS; r++) {
      const slice = all.slice((page * PAGE_ROWS + r) * PAGE_COLS, (page * PAGE_ROWS + r + 1) * PAGE_COLS);
      rowEls[r].replaceChildren(...slice.map(makeTile));
    }
    // 只有一页时不显示翻页控件（用 visibility 收起，避免牌池宽度跳动）
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
    const pages = pageCount(listJokers(filter).length);
    page = Math.max(0, Math.min(pages - 1, page + delta));
    hideDesc();
    renderPages();
  }
  prevBtn.addEventListener('click', () => turn(-1));
  nextBtn.addEventListener('click', () => turn(1));

  function renderTabs(): void {
    tabRow.replaceChildren(...RARITY_ORDER.map(rarity => {
      const tab = h('button', {
        class: `jm-tab${rarity === filter ? ' active' : ''}`,
        text: rarityLabel(rarity),
      });
      // 页签底色 = G.C.RARITY 稀有度色（数据来自提取脚本，避免 CSS 里硬编码）
      tab.style.setProperty('--tab-colour', JOKER_RARITY_COLOUR[rarity] ?? '#ffffff');
      tab.addEventListener('click', () => {
        filter = rarity;
        page = 0;   // 换稀有度回到第一页
        hideDesc();
        renderTabs();
        renderPages();
      });
      return tab;
    }));
  }

  // ---------- 操作行：只有「返回」关闭图鉴 ----------
  const backBtn = h('button', { class: 'jm-back', text: '返回' });
  backBtn.addEventListener('click', close);

  const panel = h('div', { class: 'jokers-modal' }, [
    tabRow,
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
      items = [...list];
      page = 0;
      hideDesc();
      renderTabs();
      renderPages();
      overlay.classList.add('show');
    },
  };
}
