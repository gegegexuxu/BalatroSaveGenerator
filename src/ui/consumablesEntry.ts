// 消耗牌入口（挂在参数面板下方，与种子条/参数面板同属右侧参数列）：
// 顶部一行「消耗牌 N / 槽位数」，下面平铺已有消耗牌的牌面（左键移除），底部「修改消耗牌」按钮打开图鉴弹窗。
// 空槽用虚线框占位（沿用本站「虚线 = 可操作」的语汇，见 .param-input 的下虚线）。
import type { ConsumableDef } from '../data/consumables';
import { consumableByKey } from '../core/consumables';
import { h } from './dom';
import { showToast } from './usageModal';

export interface ConsumablesEntry {
  root: HTMLElement;
  /** 列表或槽位数变化后重绘（数量 + 牌面 + 空槽） */
  render(list: string[]): void;
}

export interface ConsumablesEntryOptions {
  /** 槽位上限（参数面板的「消耗品」槽位数，实时读取） */
  capacity: () => number;
  /** 牌面图（assets/{tarot|planet|spectral}/<enName>.png） */
  imageUrl: (def: ConsumableDef) => string | undefined;
  /** 点「修改消耗牌」：打开图鉴弹窗 */
  onOpen: () => void;
  /** 左键点某张牌：移除该张（下标 = 工作列表中的位置） */
  onRemove: (index: number) => void;
}

/** 空槽最多画到 6 个：槽位数可填到 99，逐个画占位会把右列顶得过高 */
const MAX_SLOTS = 6;

export function createConsumablesEntry(opts: ConsumablesEntryOptions): ConsumablesEntry {
  const head = h('div', { class: 'ce-head' });
  const editBtn = h('button', { class: 'btn ce-edit', text: '修改消耗牌' });
  editBtn.addEventListener('click', () => opts.onOpen());
  // 计数与按钮同处一行：入口只占参数面板下方一条窄带，尽量不挤压 720p 的单屏排布
  const top = h('div', { class: 'ce-top' }, [head, editBtn]);
  const cards = h('div', { class: 'ce-cards' });

  const root = h('div', { class: 'consumables-entry' }, [top, cards]);

  function render(list: string[]): void {
    const cap = opts.capacity();
    head.textContent = `消耗牌 ${list.length} / ${cap}`;
    head.classList.toggle('ce-over', list.length > cap);   // 调小槽位数后可能超出容量，标红提示

    const tiles: HTMLElement[] = list.map((key, i) => {
      const def = consumableByKey(key);
      if (!def) return h('div', { class: 'ce-slot ce-empty', text: key });
      const url = opts.imageUrl(def);
      const tile = h('div', { class: 'ce-card' }, [
        url
          ? (h('img', { class: 'ce-img', src: url, alt: def.enName }) as HTMLImageElement)
          : h('span', { class: 'ce-fallback', text: def.zhName }),
      ]);
      tile.setAttribute('title', `左键移除：${def.zhName}`);
      tile.addEventListener('click', () => {
        opts.onRemove(i);
        showToast(`已移除「${def.zhName}」`);
      });
      return tile;
    });

    // 空槽补齐到「槽位数」（至少与已选数量等量），超过 MAX_SLOTS 就只画到上限
    const total = Math.min(Math.max(cap, list.length), MAX_SLOTS);
    for (let i = tiles.length; i < total; i++) tiles.push(h('div', { class: 'ce-slot' }));

    cards.replaceChildren(...tiles);
    editBtn.setAttribute('title', '打开消耗牌图鉴：左键点击即添加，可重复；重置可恢复当前牌组的默认消耗牌');
  }

  return { root, render };
}
