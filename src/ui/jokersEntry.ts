// 小丑牌入口（消耗牌入口下方，横向贯通左列与右列下方：左缘与消耗牌入口对齐，
// 右缘与种子组件右缘对齐，宽 866px）：顶部一行「小丑牌 张数/上限」+「新增小丑牌」
// 按钮（打开图鉴弹窗），下面一块黑底牌区水平排布已有小丑的牌面，左键移除。
// 版本与贴纸都是逐牌属性：加入时刻定制弹窗里的选择（版本由 shader 渲染，
// 贴纸按原素材整卡叠加在牌面上）；负片每张使上限 +1（card.lua:405-417，
// 与消耗区同规则），计数/分母与游戏 HUD 一致。牌多时收缩步进、彼此部分重叠。
import type { JokerDef } from '../data/jokers';
import type { JokerItem, StickerKey } from '../core/jokers';
import { jokerByKey, STICKER_ORDER, stickerLabel } from '../core/jokers';
import { editionCardImage } from './consumableCard';
import { h } from './dom';
import { showToast } from './usageModal';

export interface JokersEntry {
  root: HTMLElement;
  /** 列表或槽位数变化后重绘 */
  render(list: JokerItem[]): void;
}

export interface JokersEntryOptions {
  /** 槽位上限（参数面板的「小丑槽位」，实时读取） */
  capacity: () => number;
  /** 牌面图（assets/joker/<image>） */
  imageUrl: (def: JokerDef) => string | undefined;
  /** 贴纸图标（assets/sticker/<Eternal|Perishable|Rental>.png） */
  stickerUrl: (key: StickerKey) => string | undefined;
  /** 点「新增小丑牌」：打开图鉴弹窗（槽位是否已满在定制弹窗的「创建」时判断） */
  onOpen: () => void;
  /** 左键点某张牌：移除该张（下标 = 工作列表中的位置） */
  onRemove: (index: number) => void;
}

/** 行内排布参数（与 .je-card 的宽度/默认重叠保持一致） */
const CARD_W = 112;
const STEP_DEFAULT = 72;   // 默认步进：相邻牌重叠 40px
const STEP_MIN = 24;       // 最小步进：再密就认不出是哪张牌了
const BLOCK_PAD = 4;       // .je-cards 的内边距，测可用宽度时要扣掉

export function createJokersEntry(opts: JokersEntryOptions): JokersEntry {
  const head = h('div', { class: 'je-head' });
  const editBtn = h('button', { class: 'btn je-edit', text: '新增小丑牌' });
  editBtn.addEventListener('click', () => opts.onOpen());
  const top = h('div', { class: 'je-top' }, [head, editBtn]);
  const cards = h('div', { class: 'je-cards' });

  const root = h('div', { class: 'jokers-entry' }, [top, cards]);

  function render(list: JokerItem[]): void {
    const cap = opts.capacity();
    // 与游戏 HUD 一致（cardarea.lua:265-266 card_count/card_limit）：负片每张使上限 +1，
    // 故分母 = 槽位数 + 负片张数。例：5 槽 + 1 张负片 → 「小丑牌 5 / 6」
    const negCount = list.filter(it => it.edition === 'negative').length;
    head.textContent = `小丑牌 ${list.length} / ${cap + negCount}`;
    head.classList.toggle('je-over', list.length > cap + negCount);   // 调小槽位数后可能超出容量，标红提示

    const tiles = list.map((item, i) => {
      const def = jokerByKey(item.key);
      if (!def) {
        // 数据与资源不同步时的兜底：文字占位（理论上不该出现）
        return h('div', { class: 'je-card' }, [h('span', { class: 'je-fallback', text: item.key })]);
      }
      const url = opts.imageUrl(def);
      const tile = h('div', { class: 'je-card' }, [
        url
          ? editionCardImage(def.enName, url, item.edition, 'je-img')
          : h('span', { class: 'je-fallback', text: def.zhName }),
      ]);
      // 贴纸整卡叠加（素材 142×190 = 牌面同尺寸，直接铺满牌面）
      const stickerOn = (k: StickerKey): boolean =>
        k === 'eternal' ? !!item.eternal : k === 'perishable' ? !!item.perishable : !!item.rental;
      for (const k of STICKER_ORDER.filter(stickerOn)) {
        const u = opts.stickerUrl(k);
        if (u) tile.appendChild(h('img', { class: 'je-sticker', src: u, alt: stickerLabel(k) }) as HTMLImageElement);
      }
      tile.addEventListener('click', () => {
        opts.onRemove(i);
        showToast(`已移除「${def.zhName}」`);
      });
      return tile;
    });

    cards.replaceChildren(...tiles);
    applyRowFit();
  }

  /** 按黑块可用宽度收缩步进：牌多时加大重叠，全部收进黑块（同 consumablesEntry.applyRowFit） */
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
