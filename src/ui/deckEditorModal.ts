// 牌组编辑弹窗：复刻游戏 run setup 的「完整牌组」视图，展示工作牌堆（core/deckGen）
// 交互：左键查看/修改单张、右键删除、底部「重置」按牌组规则重建（不自动刷新）
import type { BackDef } from '../data/backs';
import { h, renderDescLine } from './dom';
import { playingCard, SUIT_ORDER, RANK_ORDER, FACE_RANKS } from './playingCard';
import { SUIT_ICON, TALLY_ICON, uiIcon } from './icons';
import type { DeckCard } from '../core/deckGen';

/** 行内排布参数（与 .pcard 的宽度/默认重叠保持一致） */
const CARD_W = 72;
const STEP_DEFAULT = 46;   // 默认步进：相邻牌重叠 26px
const STEP_MIN = 10;       // 最小步进：再密就看不清左上角点数了

export interface DeckEditorModal {
  root: HTMLElement;
  open(def: BackDef, cards: DeckCard[]): void;
  isOpen(): boolean;
}

/** 牌面编辑动作：左键查看详情（在弹窗内改属性）/ 右键删除 / 创建新牌 */
export interface CardEditAction {
  type: 'delete' | 'modify' | 'create';
  card: DeckCard;
}

export interface DeckEditorOptions {
  /** 点击「重置」：按当前牌组规则重建默认牌堆并返回（含种子随机） */
  onReset: () => DeckCard[];
  /** 牌面改动（删除 / 属性修改 / 新建）后返回更新后的牌堆 */
  onEdit: (action: CardEditAction) => DeckCard[];
  /** 打开某张牌的详情（handler.onConfirm = 确定改这张；handler.onCreate = 另存为新牌） */
  openCardDetail: (card: DeckCard, handlers: { onConfirm: () => void; onCreate: (draft: DeckCard) => void }) => void;
  /** 打开「创建卡牌」弹窗（只有取消 / 创建新的） */
  openCreateCard: (handlers: { onCreate: (draft: DeckCard) => void }) => void;
  /** 工作牌堆是否与所选牌组不一致（不一致时提示需要重置） */
  isStale?: () => boolean;
}

export function createDeckEditorModal(opts: DeckEditorOptions): DeckEditorModal {
  const close = (): void => overlay.classList.remove('show');

  const nameEl = h('div', { class: 'deck-editor-deck-name' });
  const descEl = h('div', { class: 'editor-desc' });

  const baseChip = (icon: string, val: number): HTMLElement =>
    h('span', { class: 'deck-base-chip' }, [
      h('img', { class: 'sym-icon', src: uiIcon(icon), alt: icon }) as HTMLImageElement,
      h('span', { class: 'val', text: String(val) }),
    ]);
  const baseGrids = h('div', { class: 'deck-base-panel' });
  const ranksPanel = h('div', { class: 'deck-editor-ranks' });
  const cardsArea = h('div', { class: 'deck-editor-cards' });
  let rows: HTMLDivElement[] = [];
  function renderStats(cards: DeckCard[]): void {
    const count = (pred: (c: DeckCard) => boolean): number => cards.filter(pred).length;
    const faces = count(c => FACE_RANKS.includes(c.rank));
    const numbers = count(c => !['A', ...FACE_RANKS].includes(c.rank));
    const row = (chips: HTMLElement[]): HTMLElement => h('div', { class: 'deck-base-row' }, chips);
    baseGrids.replaceChildren(
      h('div', { class: 'deck-editor-base-title', text: '基础卡牌' }),
      h('div', { class: 'deck-base-rows' }, [
        row([baseChip(TALLY_ICON.ace, count(c => c.rank === 'A'))]),                       // Ace 独占首行
        row([baseChip(TALLY_ICON.face, faces), baseChip(TALLY_ICON.number, numbers)]),
        row([baseChip(SUIT_ICON.S, count(c => c.suit === 'S')), baseChip(SUIT_ICON.H, count(c => c.suit === 'H'))]),
        row([baseChip(SUIT_ICON.C, count(c => c.suit === 'C')), baseChip(SUIT_ICON.D, count(c => c.suit === 'D'))]),
      ]),
    );
    ranksPanel.replaceChildren(...RANK_ORDER.map(rank =>
      h('div', { class: 'deck-rank-cell' }, [
        h('span', { class: 'deck-rank-chip', text: rank }),
        h('span', { class: 'deck-rank-n', text: String(count(c => c.rank === rank)) }),
      ])));
  }

  function renderCards(cards: DeckCard[]): void {
    const sorted = [...cards].sort((a, b) =>
      SUIT_ORDER.indexOf(a.suit) - SUIT_ORDER.indexOf(b.suit) ||
      RANK_ORDER.indexOf(a.rank) - RANK_ORDER.indexOf(b.rank));
    rows = SUIT_ORDER
      .map(suit => ({ suit, list: sorted.filter(c => c.suit === suit) }))
      .map(g => h('div', { class: 'deck-suit-row' },
        g.list.map(card => {
          const el = playingCard(card);
          el.title = '左键查看 / 修改 · 右键删除';
          el.addEventListener('click', () => opts.openCardDetail(card, {
            onConfirm: () => applyEdit({ type: 'modify', card }),
            onCreate: draft => applyEdit({ type: 'create', card: draft }),
          }));
          el.addEventListener('contextmenu', e => {
            e.preventDefault();   // 屏蔽浏览器右键菜单
            applyEdit({ type: 'delete', card });
          });
          return el;
        })) as HTMLDivElement);
    cardsArea.replaceChildren(...rows);
    applyRowFit();
  }

  function applyEdit(action: CardEditAction): void {
    const cards = opts.onEdit(action);
    renderStats(cards);
    renderCards(cards);
    syncResetHint();
  }

  /** 按行宽自适应排布：牌多时加大重叠，避免撑破牌区（最多 52 张同花色） */
  function applyRowFit(): void {
    for (const row of rows) {
      const n = row.childElementCount;
      const avail = row.clientWidth;
      if (n <= 1 || avail <= 0) { row.style.removeProperty('--step'); continue; }
      const fit = Math.floor((avail - CARD_W) / (n - 1));
      row.style.setProperty('--step', `${Math.max(STEP_MIN, Math.min(STEP_DEFAULT, fit))}px`);
    }
  }

  window.addEventListener('resize', () => {
    if (overlay.classList.contains('show')) applyRowFit();
  });

  const resetBtn = h('button', { class: 'deck-editor-reset', text: '重置' });
  /** 牌堆与所选牌组不一致时只改悬停文案（不做视觉高亮） */
  function syncResetHint(): void {
    const stale = opts.isStale?.() ?? false;
    resetBtn.setAttribute('title', stale
      ? '当前牌堆不是该牌组的默认牌堆，点击按当前牌组规则重建（古怪牌组按种子随机生成）'
      : '恢复当前牌组的默认牌堆（古怪牌组按种子随机生成）');
  }
  resetBtn.addEventListener('click', () => {
    const cards = opts.onReset();
    renderStats(cards);
    renderCards(cards);
    syncResetHint();
  });

  const backBtn = h('button', { class: 'deck-editor-back', text: '保存' });
  backBtn.addEventListener('click', close);

  const createBtn = h('button', { class: 'deck-editor-create', text: '创建卡牌' });
  createBtn.setAttribute('title', '新建一张牌（与牌面详情同样的选择方式，不影响已有牌）');
  createBtn.addEventListener('click', () => opts.openCreateCard({
    onCreate: draft => applyEdit({ type: 'create', card: draft }),
  }));

  const actions = h('div', { class: 'deck-editor-actions' }, [resetBtn, createBtn, backBtn]);

  const side = h('div', { class: 'deck-editor-side' }, [
    h('div', { class: 'deck-editor-info' }, [nameEl, descEl, baseGrids]),
    ranksPanel,
  ]);
  const body = h('div', { class: 'deck-editor-body' }, [side, cardsArea]);

  const panel = h('div', { class: 'deck-editor' }, [
    body,
    h('div', { class: 'deck-editor-hint', text: '悬浮高亮 · 左键查看/修改 · 右键删除 · 也可点「创建卡牌」新增' }),
    actions,
  ]);

  const overlay = h('div', { class: 'modal-overlay' }, [panel]);
  overlay.addEventListener('click', e => { if (e.target === overlay) close(); });

  return {
    root: overlay,
    isOpen: () => overlay.classList.contains('show'),
    open(def, cards) {
      nameEl.textContent = def.zhName;
      // 空行分隔与主卡描述一致地省略
      descEl.innerHTML = def.text.filter(l => l !== '').map(l => `<p>${renderDescLine(l, def.vars)}</p>`).join('');
      renderStats(cards);
      renderCards(cards);
      syncResetHint();
      overlay.classList.add('show');
      applyRowFit();   // 显示后再量行宽：隐藏状态下 clientWidth 为 0
    },
  };
}
