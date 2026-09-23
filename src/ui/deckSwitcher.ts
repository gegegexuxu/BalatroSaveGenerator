// 牌组切换组件：底框 + 左右箭头 + 中央当前牌组（PROJECT_SPEC.md 3.3）
import type { BackDef } from '../data/backs';
import { h, renderDescLine } from './dom';

export interface DeckSwitcher {
  root: HTMLElement;
  onChange: (def: BackDef) => void;
  prev(): void;
  next(): void;
}

export function createDeckSwitcher(
  decks: BackDef[],
  imageUrl: (enName: string) => string | undefined,
  initial: number,
  onChange: (def: BackDef) => void,
  onEditDeck?: () => void,
): DeckSwitcher {
  let index = initial;

  const img = h('img', { class: 'deck-img', alt: '牌组卡背' }) as HTMLImageElement;
  const nameEl = h('span', { class: 'deck-name' });
  const descEl = h('div', { class: 'info-desc' });
  const dots = decks.map(() => h('span', { class: 'dot' }));

  // 卡面即「修改牌组」入口：深色底板覆盖文字 + 卡内底部张数（复刻游戏 run setup 的「查看牌组」卡）
  const editLabel = h('span', { class: 'deck-edit-label' }, [
    h('span', { text: '修改' }),
    h('span', { text: '牌组' }),
  ]);
  const editCount = h('span', { class: 'deck-count', text: '52 / 52' });
  const frame = h('div', { class: 'deck-frame' }, [img, editLabel, editCount]);
  frame.setAttribute('role', 'button');
  frame.setAttribute('tabindex', '0');
  frame.setAttribute('aria-label', '修改牌组');
  frame.addEventListener('click', () => onEditDeck?.());
  frame.addEventListener('keydown', e => {
    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault();
      onEditDeck?.();
    }
  });
  const titleBar = h('div', { class: 'info-title-bar' }, [nameEl]);
  const info = h('div', { class: 'info-panel' }, [titleBar, descEl]);
  const inner = h('div', { class: 'stage-inner' }, [frame, info]);
  const stage = h('section', { class: 'stage', 'aria-label': '牌组选择' }, [inner]);
  const dotsRow = h('div', { class: 'dots' }, dots);

  const prevBtn = h('button', { class: 'arrow-btn', 'aria-label': '上一个牌组', text: '◀' });
  const nextBtn = h('button', { class: 'arrow-btn', 'aria-label': '下一个牌组', text: '▶' });

  function render(): void {
    const def = decks[index];
    img.src = imageUrl(def.enName) ?? '';
    nameEl.textContent = def.zhName;
    // 游戏原文用空行分隔奖励与代价，卡面较小时直接省略空行
    descEl.innerHTML = def.text.filter(l => l !== '').map(l => `<p>${renderDescLine(l, def.vars)}</p>`).join('');
    dots.forEach((d, i) => d.classList.toggle('active', i === index));
  }

  function move(delta: number): void {
    index = (index + delta + decks.length) % decks.length;
    render();
    onChange(decks[index]);
  }

  prevBtn.addEventListener('click', () => move(-1));
  nextBtn.addEventListener('click', () => move(1));

  const row = h('div', { class: 'selector-row' }, [prevBtn, stage, nextBtn]);
  const root = h('div', { class: 'deck-switcher' }, [row, dotsRow]);

  render();
  return {
    root,
    onChange,
    prev: () => move(-1),
    next: () => move(1),
  };
}
