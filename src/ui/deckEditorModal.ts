// 牌组编辑弹窗：复刻游戏 run setup 的「完整牌组」视图
// v0.1 仅静态展示：牌面/强化底板用真实资产，牌组数据来自真实存档模板；具体编辑功能后续实现
import type { BackDef } from '../data/backs';
import { h, renderDescLine } from './dom';
import { deckCards } from '../core/saveDeck';

const faceImages = import.meta.glob('../../assets/cards/*.png', {
  eager: true, query: '?url', import: 'default',
}) as Record<string, string>;
const enhImages = import.meta.glob('../../assets/enhancement/*.png', {
  eager: true, query: '?url', import: 'default',
}) as Record<string, string>;
const faceUrl = (file: string): string | undefined => faceImages[`../../assets/cards/${file}.png`];
const enhUrl = (file: string): string | undefined => enhImages[`../../assets/enhancement/${file}.png`];

const SUIT_META: Record<string, { sym: string; red: boolean }> = {
  S: { sym: '♠', red: false },
  H: { sym: '♥', red: true },
  C: { sym: '♣', red: false },
  D: { sym: '♦', red: true },
};

function playingCard(suit: string, rank: string, enhancement?: string): HTMLDivElement {
  const face = faceUrl(`${suit}_${rank}`);
  const base = enhancement ? enhUrl(enhancement) : undefined;
  const kids: HTMLElement[] = [];
  if (base) kids.push(h('img', { class: 'pcard-base', src: base, alt: '' }) as HTMLImageElement);
  if (face) {
    kids.push(h('img', { class: 'pcard-face', src: face, alt: `${suit}${rank}` }) as HTMLImageElement);
  } else {
    // 牌面图缺失时退化为文字
    const meta = SUIT_META[suit];
    kids.push(h('span', { class: `pcard-fallback${meta.red ? ' pcard-red' : ''}`, text: `${rank}${meta.sym}` }));
  }
  return h('div', { class: `pcard${base ? ' pcard-enhanced' : ''}` }, kids) as HTMLDivElement;
}

export interface DeckEditorModal {
  root: HTMLElement;
  open(def: BackDef): void;
}

export function createDeckEditorModal(): DeckEditorModal {
  const close = (): void => overlay.classList.remove('show');

  const nameEl = h('div', { class: 'deck-editor-deck-name' });
  const descEl = h('div', { class: 'editor-desc' });

  // 全部统计由真实存档牌组数据计算
  const cards = deckCards();
  const count = (pred: (c: { suit: string; rank: string }) => boolean): number =>
    cards.filter(pred).length;

  const baseChip = (sym: string, val: number): HTMLElement =>
    h('span', { class: 'deck-base-chip' }, [
      h('span', { class: 'sym', text: sym }),
      h('span', { class: 'val', text: String(val) }),
    ]);
  const faces = count(c => ['K', 'Q', 'J'].includes(c.rank));
  const numbers = count(c => !['A', 'K', 'Q', 'J'].includes(c.rank));
  const basePanel = h('div', { class: 'deck-editor-base' }, [
    h('div', { class: 'deck-editor-base-title', text: '基础卡牌' }),
    h('div', { class: 'deck-base-grid' }, [
      baseChip('A', count(c => c.rank === 'A')),
      baseChip('K', faces),
      baseChip('#', numbers),
    ]),
    h('div', { class: 'deck-base-grid' }, [
      baseChip('♠', count(c => c.suit === 'S')),
      baseChip('♥', count(c => c.suit === 'H')),
    ]),
    h('div', { class: 'deck-base-grid' }, [
      baseChip('♣', count(c => c.suit === 'C')),
      baseChip('♦', count(c => c.suit === 'D')),
    ]),
  ]);

  const rankCell = (rank: string): HTMLElement =>
    h('div', { class: 'deck-rank-cell' }, [
      h('span', { class: 'deck-rank-chip', text: rank }),
      h('span', { class: 'deck-rank-n', text: String(count(c => c.rank === rank)) }),
    ]);
  const rankOrder = ['A', 'K', 'Q', 'J', 'T', '9', '8', '7', '6', '5', '4', '3', '2'];
  const ranksPanel = h('div', { class: 'deck-editor-ranks' }, rankOrder.map(rankCell));

  const cardsArea = h('div', { class: 'deck-editor-cards' },
    Object.keys(SUIT_META).map(suit =>
      h('div', { class: 'deck-suit-row' },
        cards.filter(c => c.suit === suit).map(c => playingCard(c.suit, c.rank, c.enhancement)))));

  const backBtn = h('button', { class: 'deck-editor-back', text: '确定' });
  backBtn.addEventListener('click', close);

  // 底部操作行：「完整牌组」标题标 + 确定按钮并排（等高）
  const actions = h('div', { class: 'deck-editor-actions' }, [
    h('div', { class: 'deck-editor-banner', text: '完整牌组' }),
    backBtn,
  ]);

  const side = h('div', { class: 'deck-editor-side' }, [nameEl, descEl, basePanel, ranksPanel]);
  const body = h('div', { class: 'deck-editor-body' }, [side, cardsArea]);

  const panel = h('div', { class: 'deck-editor' }, [
    body,
    actions,
  ]);

  const overlay = h('div', { class: 'modal-overlay' }, [panel]);
  overlay.addEventListener('click', e => { if (e.target === overlay) close(); });

  return {
    root: overlay,
    open(def) {
      nameEl.textContent = def.zhName;
      // 空行分隔与主卡描述一致地省略
      descEl.innerHTML = def.text.filter(l => l !== '').map(l => `<p>${renderDescLine(l, def.vars)}</p>`).join('');
      overlay.classList.add('show');
    },
  };
}
