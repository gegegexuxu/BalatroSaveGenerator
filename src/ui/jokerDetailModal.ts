// 小丑牌单卡定制弹窗（图鉴点牌后进入，结构与扑克详情弹窗一致，复用 .cd-* 样式）：
// 中间大图预览（版本 shader + 贴纸整卡叠加），左侧三组左右箭头切换：
//   版本（无/闪箔/镭射/多彩/负片）、永恒/易腐（互斥循环 无→永恒卡→易腐，card.lua:508/515）、租用（无/租用）。
// 循环组按 compat 过滤不可用态（game.lua eternal/perishable_compat，全部不可用则禁用箭头）；
// 底部「创建」入列、「返回」丢弃。存档写入见 core/saveDeck.buildJokerCard 的贴纸规则（PROJECT_SPEC.md 5.9）。
import { EDITIONS, EDITION_PULSE } from '../data/cardMods';
import type { JokerDef } from '../data/jokers';
import {
  JOKER_EDITIONS, stickerColour, stickerLabel,
  STICKER_ORDER, type JokerItem, type StickerKey,
} from '../core/jokers';
import { h } from './dom';
import { showToast } from './usageModal';
import { editionCardImage, type CardEdition } from './consumableCard';

/** 循环取值：list 首位为「无」，dir = ±1（到边界回绕） */
function cycle<T>(list: T[], cur: T, dir: 1 | -1): T {
  const i = list.findIndex(v => v === cur);
  return list[(i + dir + list.length) % list.length];
}

const EDITION_LIST: (CardEdition | undefined)[] = [undefined, ...JOKER_EDITIONS];

export interface JokerDetailModal {
  root: HTMLElement;
  /** 打开定制弹窗：def = 图鉴点中的小丑；imageUrl = 牌面图（assets/joker/<image>）；
   *  canAdd() 返回不可添加的原因（null = 可添加），创建时先问 canAdd，不通过则 toast 且弹窗保持打开；
   *  onConfirm 拿到完整草稿入列 */
  open(opts: {
    def: JokerDef;
    imageUrl: (def: JokerDef) => string | undefined;
    canAdd: () => string | null;
    stickerUrl: (key: StickerKey) => string | undefined;
    onConfirm: (item: JokerItem) => void;
  }): void;
}

interface JokerDraft {
  edition: CardEdition | undefined;
  eternal: boolean;
  perishable: boolean;
  rental: boolean;
}

export function createJokerDetailModal(): JokerDetailModal {
  let def: JokerDef | undefined;
  let draft: JokerDraft | undefined;
  let imageUrl: (def: JokerDef) => string | undefined = () => undefined;
  let canAdd: () => string | null = () => null;
  let stickerUrl: (key: StickerKey) => string | undefined = () => undefined;
  let onConfirm: (item: JokerItem) => void = () => {};

  function close(): void {
    overlay.classList.remove('show');
  }

  const editionVal = h('span', { class: 'cd-value' });
  const stakeVal = h('span', { class: 'cd-value' });
  const rentalVal = h('span', { class: 'cd-value' });
  const cardCell = h('div', { class: 'cd-card-cell' });
  const cardFace = h('div', { class: 'jd-face' });

  const arrow = (glyph: '◀' | '▶', onClick: () => void): HTMLButtonElement => {
    const btn = h('button', { class: 'cd-arrow', text: glyph }) as HTMLButtonElement;
    btn.setAttribute('aria-label', glyph === '◀' ? '上一项' : '下一项');
    btn.addEventListener('click', onClick);
    return btn;
  };

  /** 一组「组名 ◀ ▶ 值槽」平铺进 .cd-grid（与扑克详情一致，不用包裹 div，否则破坏网格列） */
  const group = (
    name: string,
    valueEl: HTMLElement,
    arrows: readonly [HTMLButtonElement, HTMLButtonElement],
  ): HTMLElement[] => [h('span', { class: 'cd-group', text: name }), ...arrows, valueEl];

  const editionArrows: readonly [HTMLButtonElement, HTMLButtonElement] = [
    arrow('◀', () => { draft!.edition = cycle(EDITION_LIST, draft!.edition, -1); render(); }),
    arrow('▶', () => { draft!.edition = cycle(EDITION_LIST, draft!.edition, 1); render(); }),
  ];
  /** 永恒/易腐是互斥的同类型贴纸（card.lua:508/515，后设的会被拒），合成一组循环：
   *  无 → 永恒卡 → 易腐（按 compat 过滤不可用态）；租用可与两者叠加，独立一组 */
  let stickerStates: (StickerKey | undefined)[] = [];
  const cycleSticker = (dir: 1 | -1): void => {
    const cur: StickerKey | undefined = draft!.eternal ? 'eternal' : draft!.perishable ? 'perishable' : undefined;
    const next = cycle(stickerStates, cur, dir);
    draft!.eternal = next === 'eternal';
    draft!.perishable = next === 'perishable';
    render();
  };
  const stakeArrows: readonly [HTMLButtonElement, HTMLButtonElement] = [
    arrow('◀', () => cycleSticker(-1)),
    arrow('▶', () => cycleSticker(1)),
  ];
  const rentalArrows: readonly [HTMLButtonElement, HTMLButtonElement] = [
    arrow('◀', () => { draft!.rental = !draft!.rental; render(); }),
    arrow('▶', () => { draft!.rental = !draft!.rental; render(); }),
  ];

  // 网格布局同扑克详情（.cd-grid）：组名/左箭头 | 牌面 | 右箭头/值槽，牌面跨全部组行居中
  const grid = h('div', { class: 'cd-grid joker-detail' }, [
    ...group('版本', editionVal, editionArrows),
    ...group('永恒/易腐', stakeVal, stakeArrows),
    ...group('租用', rentalVal, rentalArrows),
    cardCell,
  ]);

  /** 创建 = 容量检查通过后把草稿交给外部入列（版本/贴纸都是逐牌属性） */
  const createBtn = h('button', { class: 'cd-btn cd-create', text: '创建' });
  createBtn.addEventListener('click', () => {
    if (!def || !draft) return;
    const blocked = canAdd();
    if (blocked) {
      showToast(blocked);
      return;   // 弹窗保持打开，草稿不丢
    }
    close();
    onConfirm({
      key: def.key,
      edition: draft.edition,
      eternal: draft.eternal || undefined,
      perishable: draft.perishable || undefined,
      rental: draft.rental || undefined,
    });
  });

  /** 返回 = 丢弃草稿（不新增） */
  const backBtn = h('button', { class: 'cd-btn cd-cancel', text: '返回' });
  backBtn.addEventListener('click', close);

  const panel = h('div', { class: 'card-detail' }, [
    h('div', { class: 'cd-body' }, [
      grid,
      h('div', { class: 'cd-actions' }, [createBtn, backBtn]),   // 返回固定最右
    ]),
  ]);

  const overlay = h('div', { class: 'modal-overlay cd-overlay' }, [panel]);
  // 点遮罩关闭 = 丢弃草稿（不新增）
  overlay.addEventListener('click', e => { if (e.target === overlay) close(); });

  /** 值槽：有物品时按游戏徽章色填充（create_badge：底色 = 物品色、文字纯白），无物品时中性深色槽。
   *  版本徽章传呼吸节奏（与扑克详情的版本槽一致） */
  const setValue = (el: HTMLElement, text: string, colour?: string, pulse?: boolean): void => {
    el.textContent = text;
    el.classList.toggle('cd-value-item', !!colour);
    el.classList.toggle('cd-value-item--pulse', !!colour && !!pulse);
    if (colour) el.style.setProperty('--pill', colour);
    else el.style.removeProperty('--pill');
    if (colour && pulse) {
      el.style.setProperty('--pill-warm', EDITION_PULSE.warm);
      el.style.setProperty('--pill-mid', EDITION_PULSE.mid);
      el.style.setProperty('--pill-cool', EDITION_PULSE.cool);
      el.style.setProperty('--pill-period', `${EDITION_PULSE.period}s`);
    }
  };

  function render(): void {
    if (!def || !draft) return;
    const c = draft;
    // 永恒/易腐循环组：compat 双双拒绝时禁用箭头（只剩「无」）
    for (const a of stakeArrows) a.disabled = !def.eternal_compat && !def.perishable_compat;
    // 大图：版本 shader 静态快照 + 贴纸整卡叠加（贴纸素材 142×190 = 小丑牌同尺寸，位置 0,0 覆盖）
    const src = imageUrl(def);
    const stickerOn = (k: StickerKey): boolean =>
      k === 'eternal' ? c.eternal : k === 'perishable' ? c.perishable : c.rental;
    cardFace.replaceChildren(
      src ? editionCardImage(def.enName, src, c.edition, 'jd-img')
          : h('span', { class: 'je-fallback', text: def.zhName }),
      ...STICKER_ORDER.filter(stickerOn).map(k => {
        const u = stickerUrl(k);
        return u ? h('img', { class: 'jd-sticker', src: u, alt: stickerLabel(k) }) as HTMLImageElement
                 : h('span', { class: 'jd-sticker', text: stickerLabel(k) });
      }),
    );
    cardCell.replaceChildren(cardFace);

    const edition = c.edition ? EDITIONS.find(e => e.key === c.edition) : undefined;
    setValue(editionVal, edition?.zhName ?? '无', edition?.colour, !!edition);
    const stake: StickerKey | undefined = c.eternal ? 'eternal' : c.perishable ? 'perishable' : undefined;
    setValue(stakeVal, stake ? stickerLabel(stake) : '无', stake ? stickerColour(stake) : undefined);
    setValue(rentalVal, c.rental ? stickerLabel('rental') : '无', c.rental ? stickerColour('rental') : undefined);
  }

  return {
    root: overlay,
    open(opts) {
      def = opts.def;
      imageUrl = opts.imageUrl;
      canAdd = opts.canAdd;
      stickerUrl = opts.stickerUrl;
      onConfirm = opts.onConfirm;
      draft = { edition: undefined, eternal: false, perishable: false, rental: false };
      stickerStates = [undefined,
        ...(def.eternal_compat ? ['eternal'] as const : []),
        ...(def.perishable_compat ? ['perishable'] as const : [])];
      render();
      overlay.classList.add('show');
    },
  };
}
