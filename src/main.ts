import './style/main.css';
import { BACKS } from './data/backs';
import { STAKES } from './data/stakes';
import type { ConsumableDef } from './data/consumables';
import { generateSave } from './core/generate';
import { blankCard, defaultDeckCards, renumberDeck, type DeckCard } from './core/deckGen';
import { deckDefaultConsumables, type ConsumableItem } from './core/consumables';
import { createDeckSwitcher } from './ui/deckSwitcher';
import { createStakeSwitcher } from './ui/stakeSwitcher';
import { createRunParamsPanel, deckInit } from './ui/runParamsPanel';
import { createDeckEditorModal, type CardEditAction } from './ui/deckEditorModal';
import { createCardDetailModal } from './ui/cardDetailModal';
import { createConsumablesModal } from './ui/consumablesModal';
import { createConsumablesEntry } from './ui/consumablesEntry';
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
// 消耗牌素材按牌组类型分目录（assets/tarot|planet|spectral/<英文名>.png，文件名含空格）
const consumableImages = import.meta.glob('../assets/{tarot,planet,spectral}/*.png', {
  eager: true,
  query: '?url',
  import: 'default',
}) as Record<string, string>;

const imageUrl = (enName: string): string | undefined =>
  deckImages[`../assets/decks/${enName}.png`];
const chipUrl = (file: string): string | undefined =>
  chipImages[`../assets/stakes/${file}`];
const consumableUrl = (def: ConsumableDef): string | undefined =>
  consumableImages[`../assets/${def.set.toLowerCase()}/${def.image}`];

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
// 工作消耗牌（逐牌记录）：随牌组切换按该牌组默认重建（魔法 = 愚者×2、幽灵 = 妖法×1，其余为空）。
// v2 起写入导出存档（PROJECT_SPEC.md 5.6）；负片是逐牌属性——加入时刻弹窗负片开关的状态
let workingConsumables: ConsumableItem[] = [];
let consumablesNegative = false;   // 负片开关当前状态（弹窗内切换；不随弹窗开关重置）
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
});
// 消耗牌弹窗（图鉴）：点牌即选入工作列表并自动关闭（带不带负片看加入时刻的开关状态）
const consumables = createConsumablesModal({
  capacity: () => runParams.values().consumableSlots,
  negative: () => consumablesNegative,
  imageUrl: consumableUrl,
  onToggleNegative: () => {
    consumablesNegative = !consumablesNegative;
    consumables.open(workingConsumables);   // 重开本弹窗：按钮文案与牌池预览跟随开关
  },
  onPick: key => setConsumables([...workingConsumables, { key, negative: consumablesNegative }]),
});
// 消耗牌入口：挂在左列（牌组 + 赌注）下方，宽度与它们对齐，牌面可以放得更大
const consumablesEntry = createConsumablesEntry({
  capacity: () => runParams.values().consumableSlots,
  imageUrl: consumableUrl,
  onOpen: () => consumables.open(workingConsumables),
  onRemove: index => {
    const items = [...workingConsumables];
    items.splice(index, 1);
    setConsumables(items);
  },
});
// 槽位数可手改：面板里数值一变就重绘入口（N / M 计数与按钮禁用状态都要跟着变）。
// input 与 change 都听：边打字边反映，失焦提交时再兜一次
for (const type of ['input', 'change'] as const) {
  runParams.root.addEventListener(type, () => consumablesEntry.render(workingConsumables));
}
const deckSwitcher = createDeckSwitcher(selectable, imageUrl, 0, def => {
  currentDeck = def;
  runParams.refresh(def, currentStake);
  rebuildConsumables();   // 消耗牌是牌组派生状态，与参数面板一起随牌组切换
  // 牌堆保持原样（不自动按新牌组重建）；弹窗开着时只同步牌组名与描述
  if (deckEditor.isOpen()) deckEditor.open(def, workingCards);
  if (consumables.isOpen()) consumables.open(workingConsumables);
}, () => deckEditor.open(currentDeck, workingCards));

/** 按当前牌组与种子重建默认牌堆（含古怪牌组的种子随机与开局洗牌） */
function rebuildDeck(): void {
  workingCards = defaultDeckCards(currentDeck, runParams.seed());
  deckSource = currentDeck.key;
  deckEdited = false;
  deckSwitcher.setCount(workingCards.length);
}
rebuildDeck();

/** 消耗牌列表的唯一写入口：同步工作状态与入口展示（弹窗持有自己的副本，关闭后以这里为准） */
function setConsumables(items: ConsumableItem[]): void {
  workingConsumables = items;
  consumablesEntry.render(workingConsumables);
}

/** 按当前牌组的默认起始消耗牌重建列表（取自 backs.ts 的 config.consumables，见 core/consumables） */
function rebuildConsumables(): void {
  setConsumables(deckDefaultConsumables(currentDeck).map(key => ({ key, negative: false })));
}
rebuildConsumables();

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
      h('div', { class: 'switchers-col' }, [deckSwitcher.root, stakeSwitcher.root, consumablesEntry.root]),
      runParams.root,
    ]),
    footer,
  ]),
  modal.root,
  deckEditor.root,
  cardDetail.root,
  consumables.root,
  h('div', { class: 'toast', 'aria-live': 'polite' }),
);

// ---------- 交互 ----------
function exportSave(): void {
  try {
    const bytes = generateSave(currentDeck.key, currentStake, runParams.values(), workingCards, {
      items: workingConsumables,
    });
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

// 全站屏蔽浏览器右键菜单：右键在卡牌上是「快速删除」，菜单弹出会打断操作。
// 输入框内保留系统菜单（右键粘贴仍可用）
document.addEventListener('contextmenu', e => {
  if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement) return;
  e.preventDefault();
});

document.addEventListener('keydown', e => {
  if (modal.root.classList.contains('show')) return;
  if (cardDetail.root.classList.contains('show')) return;   // 详情弹窗打开时方向键不切牌组
  if (deckEditor.root.classList.contains('show')) return;   // 牌组编辑弹窗打开时方向键不切牌组
  if (consumables.root.classList.contains('show')) return;  // 消耗牌弹窗打开时方向键不切牌组
  if (e.target instanceof HTMLInputElement) return; // 参数输入框内方向键用于调数值
  if (e.key === 'ArrowLeft') deckSwitcher.prev();
  if (e.key === 'ArrowRight') deckSwitcher.next();
  if (e.key === 'ArrowUp') { e.preventDefault(); stakeSwitcher.next(); }
  if (e.key === 'ArrowDown') { e.preventDefault(); stakeSwitcher.prev(); }
});

autoShowOnce(modal);
