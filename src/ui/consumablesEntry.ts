// 消耗牌入口（左列，牌组 + 赌注下方，宽度与牌组卡背框体对齐）：
// 顶部一行「消耗牌 张数/上限」+「新增消耗牌」按钮（打开图鉴弹窗），
// 下面一块黑底牌区水平排布已有消耗牌的牌面，左键移除。
// 负片是逐牌属性：加入时弹窗里的负片开关开着，这张牌就以负片样式渲染并写负片 edition；
// 负片每张使上限 +1（card.lua:405-417），计数/分母与游戏 HUD 一致。
// 牌多时收缩步进、彼此部分重叠（同牌组编辑弹窗的扑克行）。
import type { ConsumableItem } from '../core/consumables';
import { consumableByKey } from '../core/consumables';
import { consumableCardImage } from './consumableCard';
import { h } from './dom';
import { showToast } from './usageModal';

export interface ConsumablesEntry {
  root: HTMLElement;
  /** 列表或槽位数变化后重绘 */
  render(list: ConsumableItem[]): void;
}

export interface ConsumablesEntryOptions {
  /** 槽位上限（参数面板的「消耗牌」槽位数，实时读取） */
  capacity: () => number;
  /** 牌面图（assets/{tarot|planet|spectral}/<enName>.png） */
  imageUrl: (def: import('../data/consumables').ConsumableDef) => string | undefined;
  /** 点「新增消耗牌」：打开图鉴弹窗（槽位是否已满在弹窗内按非负片数判断） */
  onOpen: () => void;
  /** 左键点某张牌：移除该张（下标 = 工作列表中的位置） */
  onRemove: (index: number) => void;
}

/** 行内排布参数（与 .ce-card 的宽度/默认重叠保持一致） */
const CARD_W = 112;
const STEP_DEFAULT = 72;   // 默认步进：相邻牌重叠 40px
const STEP_MIN = 24;       // 最小步进：再密就认不出是哪张牌了
const BLOCK_PAD = 4;       // .ce-cards 的内边距，测可用宽度时要扣掉

export function createConsumablesEntry(opts: ConsumablesEntryOptions): ConsumablesEntry {
  const head = h('div', { class: 'ce-head' });
  const editBtn = h('button', { class: 'btn ce-edit', text: '新增消耗牌' });
  editBtn.addEventListener('click', () => opts.onOpen());
  const top = h('div', { class: 'ce-top' }, [head, editBtn]);
  const cards = h('div', { class: 'ce-cards' });

  const root = h('div', { class: 'consumables-entry' }, [top, cards]);

  function render(list: ConsumableItem[]): void {
    const cap = opts.capacity();
    // 与游戏 HUD 一致（cardarea.lua:265-266 card_count/card_limit）：负片每张使上限 +1，
    // 故分母 = 槽位数 + 负片张数。例：2 槽 + 1 张负片 → 「消耗牌 1 / 3」
    const negCount = list.filter(it => it.negative).length;
    head.textContent = `消耗牌 ${list.length} / ${cap + negCount}`;
    head.classList.toggle('ce-over', list.length > cap + negCount);   // 调小槽位数后可能超出容量，标红提示

    const tiles = list.map((item, i) => {
      const def = consumableByKey(item.key);
      if (!def) {
        // 数据与资源不同步时的兜底：文字占位（理论上不该出现）
        return h('div', { class: 'ce-card' }, [h('span', { class: 'ce-fallback', text: item.key })]);
      }
      const url = opts.imageUrl(def);
      const tile = h('div', { class: 'ce-card' }, [
        url
          ? consumableCardImage(def, url, item.negative, 'ce-img')
          : h('span', { class: 'ce-fallback', text: def.zhName }),
      ]);
      tile.addEventListener('click', () => {
        opts.onRemove(i);
        showToast(`已移除「${def.zhName}」`);
      });
      return tile;
    });

    cards.replaceChildren(...tiles);
    applyRowFit();
  }

  /** 按黑块可用宽度收缩步进：牌多时加大重叠，全部收进黑块（同 deckEditorModal.applyRowFit） */
  function applyRowFit(): void {
    const n = cards.childElementCount;
    const avail = cards.clientWidth - BLOCK_PAD * 2;
    if (n <= 1 || avail <= 0) { cards.style.removeProperty('--step'); return; }
    const fit = Math.floor((avail - CARD_W) / (n - 1));
    cards.style.setProperty('--step', `${Math.max(STEP_MIN, Math.min(STEP_DEFAULT, fit))}px`);
  }
  window.addEventListener('resize', () => { if (cards.isConnected) applyRowFit(); });

  return { root, render };
}
