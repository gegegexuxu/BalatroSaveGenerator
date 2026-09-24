import './style/main.css';
import { BACKS } from './data/backs';
import { STAKES } from './data/stakes';
import { generateSave } from './core/generate';
import { blankCard, defaultDeckCards, renumberDeck, type DeckCard } from './core/deckGen';
import { createDeckSwitcher } from './ui/deckSwitcher';
import { createStakeSwitcher } from './ui/stakeSwitcher';
import { createRunParamsPanel, deckInit } from './ui/runParamsPanel';
import { createDeckEditorModal, type CardEditAction } from './ui/deckEditorModal';
import { createCardDetailModal } from './ui/cardDetailModal';
import { createUsageModal, autoShowOnce, showToast } from './ui/usageModal';
import { h } from './ui/dom';

const deckImages = import.meta.glob('../assets/decks/*.png', {
  eager: true,
  query: '?url',
  import: 'default',
}) as Record<string, string>;
const chipImages = import.meta.glob('../assets/stakes/*.png', {
  eager: true,
  query: '?url',
  import: 'default',
}) as Record<string, string>;

const imageUrl = (enName: string): string | undefined =>
  deckImages[`../assets/decks/${enName}.png`];
const chipUrl = (file: string): string | undefined =>
  chipImages[`../assets/stakes/${file}`];

const selectable = BACKS.filter(b => !b.omit);

// ---------- 页面骨架 ----------
const header = h('header', { class: 'app-header' }, [
  h('div', { class: 'app-titles' }, [
    h('h1', { class: 'app-title', text: '小丑牌存档生成器' }),
    h('div', { class: 'app-sub', text: 'Balatro Save Generator · 开局存档' }),
  ]),
]);

const exportBtn = h('button', { class: 'btn btn-blue btn-export', text: '导出存档' });
const helpBtn = h('button', { class: 'btn btn-ghost', text: '使用说明' });
const actions = h('div', { class: 'actions' }, [exportBtn, helpBtn]);

const footer = h('footer', { class: 'app-footer', text: '适用游戏版本 1.0.1o · 导出 save.jkr · 放入 %APPDATA%\\Balatro\\<存档位> 后点「继续游戏」' });

let currentDeck = selectable[0];
let currentStake = 1;
// 工作牌堆：只在点「重置」时按当前牌组规则重建（切换牌组 / 改种子都不自动刷新），导出时写入存档
let workingCards: DeckCard[] = [];
/** 当前工作牌堆对应的牌组 key（与 currentDeck 不一致 = 牌堆需要重置） */
let deckSource = currentDeck.key;
/** 是否手工增删过牌面（重置后清零） */
let deckEdited = false;
const runParams = createRunParamsPanel(deckInit(selectable[0], 1));
const cardDetail = createCardDetailModal();
const deckEditor = createDeckEditorModal({
  onReset: () => {
    rebuildDeck();
    showToast(`已重置为「${currentDeck.zhName}」默认牌组（${workingCards.length} 张）`);
    return workingCards;
  },
  onEdit: editDeck,
  openCardDetail: (card, handlers) =>
    cardDetail.open({ card, mode: 'edit', onConfirm: handlers.onConfirm, onCreate: handlers.onCreate }),
  openCreateCard: handlers =>
    cardDetail.open({ card: blankCard(), mode: 'create', onCreate: handlers.onCreate }),
  isStale: () => deckSource !== currentDeck.key || deckEdited,
});
const deckSwitcher = createDeckSwitcher(selectable, imageUrl, 0, def => {
  currentDeck = def;
  runParams.refresh(def, currentStake);
  // 牌堆保持原样（不自动按新牌组重建）；弹窗开着时只同步牌组名与描述
  if (deckEditor.isOpen()) deckEditor.open(def, workingCards);
}, () => deckEditor.open(currentDeck, workingCards));

/** 按当前牌组与种子重建默认牌堆（含古怪牌组的种子随机与开局洗牌） */
function rebuildDeck(): void {
  workingCards = defaultDeckCards(currentDeck, runParams.seed());
  deckSource = currentDeck.key;
  deckEdited = false;
  deckSwitcher.setCount(workingCards.length);
}
rebuildDeck();

/** 牌堆手工编辑：右键删除；左键详情里的属性改动（type='modify'，牌对象已就地改好）；
 *  「创建新的」新增一张（type='create'，不影响原有牌） */
function editDeck({ type, card }: CardEditAction): DeckCard[] {
  if (type === 'modify') {
    deckEdited = true;
    return workingCards;
  }
  if (type === 'create') {
    workingCards.push({ ...card });          // 追加到牌堆末尾（编号按新顺序重排）
    renumberDeck(workingCards);
    deckEdited = true;
    deckSwitcher.setCount(workingCards.length);
    showToast(`已创建新卡牌，当前牌堆 ${workingCards.length} 张`);
    return workingCards;
  }
  const i = workingCards.indexOf(card);
  if (i < 0) return workingCards;
  if (workingCards.length <= 1) {
    showToast('牌堆至少要保留 1 张牌');
    return workingCards;
  }
  workingCards.splice(i, 1);
  renumberDeck(workingCards);
  deckEdited = true;
  deckSwitcher.setCount(workingCards.length);
  return workingCards;
}
const stakeSwitcher = createStakeSwitcher(chipUrl, 1, stake => {
  currentStake = stake;
  runParams.refresh(currentDeck, stake);
});
const modal = createUsageModal();

const app = document.getElementById('app')!;
app.append(
  h('div', { class: 'app' }, [
    header,
    actions,
    h('div', { class: 'switchers' }, [
      h('div', { class: 'switchers-col' }, [deckSwitcher.root, stakeSwitcher.root]),
      runParams.root,
    ]),
    footer,
  ]),
  modal.root,
  deckEditor.root,
  cardDetail.root,
  h('div', { class: 'toast', 'aria-live': 'polite' }),
);

// ---------- 交互 ----------
function exportSave(): void {
  try {
    const bytes = generateSave(currentDeck.key, currentStake, runParams.values(), workingCards);
    const blob = new Blob([bytes as BlobPart], { type: 'application/octet-stream' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'save.jkr';
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 5000);
    const note = deckSource !== currentDeck.key
      ? '（牌堆未重置，仍为原牌组配置）'
      : deckEdited ? '（牌堆已手工调整）' : '';
    showToast(`已导出 save.jkr（${currentDeck.zhName} · ${STAKES[currentStake - 1].zhName} · ${workingCards.length} 张牌）${note}`);
  } catch (err) {
    showToast(`导出失败：${err instanceof Error ? err.message : String(err)}`);
  }
}

exportBtn.addEventListener('click', exportSave);
helpBtn.addEventListener('click', () => modal.open());

document.addEventListener('keydown', e => {
  if (modal.root.classList.contains('show')) return;
  if (cardDetail.root.classList.contains('show')) return;   // 详情弹窗打开时方向键不切牌组
  if (e.target instanceof HTMLInputElement) return; // 参数输入框内方向键用于调数值
  if (e.key === 'ArrowLeft') deckSwitcher.prev();
  if (e.key === 'ArrowRight') deckSwitcher.next();
  if (e.key === 'ArrowUp') { e.preventDefault(); stakeSwitcher.next(); }
  if (e.key === 'ArrowDown') { e.preventDefault(); stakeSwitcher.prev(); }
});

autoShowOnce(modal);
