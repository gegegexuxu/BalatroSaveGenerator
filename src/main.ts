import './style/main.css';
import logoUrl from '../assets/ui/balatro.png';
import { BACKS } from './data/backs';
import { STAKES } from './data/stakes';
import { generateSave } from './core/generate';
import { createDeckSwitcher } from './ui/deckSwitcher';
import { createStakeSwitcher } from './ui/stakeSwitcher';
import { createRunParamsPanel, deckInit } from './ui/runParamsPanel';
import { createDeckEditorModal } from './ui/deckEditorModal';
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
  h('img', { class: 'app-logo', src: logoUrl, alt: 'Balatro' }),
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
const runParams = createRunParamsPanel(deckInit(selectable[0], 1));
const deckEditor = createDeckEditorModal();
const deckSwitcher = createDeckSwitcher(selectable, imageUrl, 0, def => {
  currentDeck = def;
  runParams.refresh(def, currentStake);
}, () => deckEditor.open(currentDeck));
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
  h('div', { class: 'toast', 'aria-live': 'polite' }),
);

// ---------- 交互 ----------
function exportSave(): void {
  try {
    const bytes = generateSave(currentDeck.key, currentStake, runParams.values());
    const blob = new Blob([bytes as BlobPart], { type: 'application/octet-stream' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'save.jkr';
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 5000);
    showToast(`已导出 save.jkr（${currentDeck.zhName} · ${STAKES[currentStake - 1].zhName}）`);
  } catch (err) {
    showToast(`导出失败：${err instanceof Error ? err.message : String(err)}`);
  }
}

exportBtn.addEventListener('click', exportSave);
helpBtn.addEventListener('click', () => modal.open());

document.addEventListener('keydown', e => {
  if (modal.root.classList.contains('show')) return;
  if (e.target instanceof HTMLInputElement) return; // 参数输入框内方向键用于调数值
  if (e.key === 'ArrowLeft') deckSwitcher.prev();
  if (e.key === 'ArrowRight') deckSwitcher.next();
  if (e.key === 'ArrowUp') { e.preventDefault(); stakeSwitcher.next(); }
  if (e.key === 'ArrowDown') { e.preventDefault(); stakeSwitcher.prev(); }
});

autoShowOnce(modal);
