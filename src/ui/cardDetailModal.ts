// 扑克详情弹窗：中间展示牌面，左右五组切换箭头（点数/花色/增强/蜡封/版本）
// 编辑只作用于副本，出口按钮按模式区分：
//   mode='edit'   → 取消 / 创建新的 / 确定（确定才写回被点的那张）
//   mode='create' → 取消 / 创建新的（无「确定」）
// 版本（闪箔/镭射/多彩/负片）由 ui/cardShader.ts 移植的 shader 实时预览（项目规范 §5.7）
import { h } from './dom';
import { playingCard, RANK_ORDER, SUIT_ORDER, SUIT_ZH } from './playingCard';
import { SUIT_ICON, uiIcon } from './icons';
import { ENHANCEMENTS, SEALS, EDITIONS, EDITION_PULSE } from '../data/cardMods';
import type { DeckCard, RankChar } from '../core/deckGen';

export interface CardDetailModal {
  root: HTMLElement;
  open(opts: CardDetailOptions): void;
}

export interface CardDetailOptions {
  /** 编辑模式下为被点的牌；创建模式下为新建牌的初值（通常 blankCard()） */
  card: DeckCard;
  mode: 'edit' | 'create';
  /** edit 模式专属：点「确定」时先把草稿写回 card，再回调 */
  onConfirm?: () => void;
  /** 点「创建新的」：按当前草稿新增一张（不影响原有牌） */
  onCreate: (draft: DeckCard) => void;
}

/** 循环取值：list 首位为「无」，dir = ±1（到边界回绕） */
function cycle<T>(list: T[], cur: T, dir: 1 | -1): T {
  const i = list.findIndex(v => v === cur);
  return list[(i + dir + list.length) % list.length];
}

const ENH_LIST: (string | undefined)[] = [undefined, ...ENHANCEMENTS.map(e => e.key)];
const SEAL_LIST: (string | undefined)[] = [undefined, ...SEALS.map(s => s.key)];
/** 版本互斥单值（card.lua:387 set_edition 是 elseif 链），首位为「无」。
 *  扑克牌只列 闪箔/镭射/多彩：负片仅作用于小丑与消耗品，游戏内扑克牌无法获得（详见 core/saveDeck.ts）*/
const EDITION_LIST: (string | undefined)[] = [undefined, ...EDITIONS.filter(e => e.key !== 'negative').map(e => e.key)];
/** 升序循环：右箭头 = 增大（RANK_ORDER 是递减的展示序，不能直接拿来循环） */
const RANK_LIST: RankChar[] = [...RANK_ORDER].reverse();
const rankLabel = (r: string): string => (r === 'T' ? '10' : r);

export function createCardDetailModal(): CardDetailModal {
  let card: DeckCard | undefined;     // 原牌对象（edit 模式：确定时写回）
  let draft: DeckCard | undefined;    // 编辑副本
  let confirm: () => void = () => {};
  let create: (draft: DeckCard) => void = () => {};

  function close(): void {
    overlay.classList.remove('show');
  }

  const rankVal = h('span', { class: 'cd-value' });
  const suitVal = h('span', { class: 'cd-value cd-value-icon' });
  const enhVal = h('span', { class: 'cd-value' });
  const sealVal = h('span', { class: 'cd-value' });
  const editionVal = h('span', { class: 'cd-value' });
  const cardCell = h('div', { class: 'cd-card-cell' });

  /** 箭头只改草稿：牌堆要等「确定」/「创建新的」才落盘 */
  function changed(): void {
    render();
  }

  const arrow = (glyph: '◀' | '▶', cls: string, onClick: () => void): HTMLElement => {
    const btn = h('button', { class: `cd-arrow ${cls}`, text: glyph });
    btn.setAttribute('aria-label', glyph === '◀' ? '上一项' : '下一项');
    btn.addEventListener('click', onClick);
    return btn;
  };

  const group = (key: string, name: string, prev: () => void, next: () => void, valueEl: HTMLElement): HTMLElement[] => [
    h('span', { class: 'cd-group', text: name }),
    arrow('◀', `cd-prev cd-${key}`, prev),
    arrow('▶', `cd-next cd-${key}`, next),
    valueEl,
  ];

  const grid = h('div', { class: 'cd-grid' }, [
    ...group('rank', '点数', () => { draft!.rank = cycle(RANK_LIST, draft!.rank, -1); changed(); },
      () => { draft!.rank = cycle(RANK_LIST, draft!.rank, 1); changed(); }, rankVal),
    ...group('suit', '花色', () => { draft!.suit = cycle([...SUIT_ORDER], draft!.suit, -1); changed(); },
      () => { draft!.suit = cycle([...SUIT_ORDER], draft!.suit, 1); changed(); }, suitVal),
    ...group('enh', '增强', () => { draft!.enhancement = cycle(ENH_LIST, draft!.enhancement, -1); changed(); },
      () => { draft!.enhancement = cycle(ENH_LIST, draft!.enhancement, 1); changed(); }, enhVal),
    ...group('seal', '蜡封', () => { draft!.seal = cycle(SEAL_LIST, draft!.seal, -1); changed(); },
      () => { draft!.seal = cycle(SEAL_LIST, draft!.seal, 1); changed(); }, sealVal),
    ...group('edition', '版本', () => { draft!.edition = cycle(EDITION_LIST, draft!.edition, -1); changed(); },
      () => { draft!.edition = cycle(EDITION_LIST, draft!.edition, 1); changed(); }, editionVal),
    cardCell,
  ]);

  /** 写回原牌对象（保持引用不变，牌组编辑器据此重绘）并通知外部 */
  const okBtn = h('button', { class: 'cd-btn cd-confirm', text: '确定' });
  okBtn.addEventListener('click', () => {
    if (!card || !draft) return;
    card.suit = draft.suit;
    card.rank = draft.rank;
    card.enhancement = draft.enhancement;
    card.seal = draft.seal;
    card.edition = draft.edition;
    close();
    confirm();
  });

  /** 新增一张，原有牌不受影响 */
  const createBtn = h('button', { class: 'cd-btn cd-create', text: '创建新的' });
  createBtn.addEventListener('click', () => {
    if (!draft) return;
    const made = { ...draft };
    close();
    create(made);
  });

  const cancelBtn = h('button', { class: 'cd-btn cd-cancel', text: '取消' });
  cancelBtn.addEventListener('click', close);

  const titleEl = h('div', { class: 'cd-title', text: '扑克详情' });

  const panel = h('div', { class: 'card-detail' }, [
    titleEl,
    h('div', { class: 'cd-body' }, [
      grid,
      h('div', { class: 'cd-actions' }, [cancelBtn, createBtn, okBtn]),
    ]),
  ]);

  const overlay = h('div', { class: 'modal-overlay cd-overlay' }, [panel]);
  // 点遮罩关闭 = 取消（丢弃草稿）
  overlay.addEventListener('click', e => { if (e.target === overlay) close(); });

  /** 值槽：有物品时用游戏配色填充（create_badge：底色 = 物品色、文字纯白），无物品时回到中性深色槽。
   *  传 pulse 时底色按游戏节奏呼吸——版本徽章在游戏里是逐帧变色的（见 EDITION_PULSE 注释）。*/
  const setValue = (el: HTMLElement, text: string, colour?: string, pulse?: typeof EDITION_PULSE): void => {
    el.textContent = text;
    el.classList.toggle('cd-value-item', !!colour);
    el.classList.toggle('cd-value-item--pulse', !!colour && !!pulse);
    if (colour) el.style.setProperty('--pill', colour);
    else el.style.removeProperty('--pill');
    if (colour && pulse) {
      el.style.setProperty('--pill-warm', pulse.warm);
      el.style.setProperty('--pill-mid', pulse.mid);
      el.style.setProperty('--pill-cool', pulse.cool);
      el.style.setProperty('--pill-period', `${pulse.period}s`);
    }
  };

  function render(): void {
    const c = draft;
    if (!c) return;
    cardCell.replaceChildren(playingCard({
      suit: c.suit,
      rank: c.rank,
      enhancement: c.enhancement,
      seal: c.seal,
      edition: c.edition,
    }, { animate: true }));   // 详情弹窗只有一张牌：满帧动画（编辑器里 52 张用静态快照）
    rankVal.textContent = rankLabel(c.rank);
    // 花色只显示图标（中文名放 alt/title，不占版面）
    const suitIconSrc = uiIcon(SUIT_ICON[c.suit]);
    const suitZh = SUIT_ZH[c.suit];
    suitVal.replaceChildren(
      ...(suitIconSrc ? [h('img', { class: 'cd-icon', src: suitIconSrc, alt: suitZh }) as HTMLImageElement] : [h('span', { text: suitZh })]),
    );
    suitVal.title = suitZh;
    const enh = c.enhancement ? ENHANCEMENTS.find(e => e.key === c.enhancement) : undefined;
    const seal = c.seal ? SEALS.find(s => s.key === c.seal) : undefined;
    const edition = c.edition ? EDITIONS.find(e => e.key === c.edition) : undefined;
    setValue(enhVal, enh?.zhName ?? c.enhancement ?? '无', enh?.colour);
    setValue(sealVal, seal?.zhName ?? c.seal ?? '无', seal?.colour);
    setValue(editionVal, edition?.zhName ?? c.edition ?? '无', edition?.colour, edition ? EDITION_PULSE : undefined);
  }

  return {
    root: overlay,
    open(opts) {
      card = opts.card;
      draft = { ...opts.card };            // 编辑副本：确定/创建才落到牌堆，取消即丢弃
      confirm = opts.onConfirm ?? (() => {});
      create = opts.onCreate;
      titleEl.textContent = opts.mode === 'edit' ? '扑克详情' : '创建卡牌';
      okBtn.style.display = opts.mode === 'edit' ? '' : 'none';   // 创建模式没有「确定」
      render();
      overlay.classList.add('show');
    },
  };
}
