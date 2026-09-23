// 赌注选择组件：底框 + 左右箭头 + 中央筹码 + 底部页点指示（与牌组切换器同款）
// （样式复刻游戏 run setup 的 stake_option：筹码 + 效果描述框）
import { STAKES } from '../data/stakes';
import { h, renderDescLine } from './dom';
import { MIN_STAKE, MAX_STAKE } from '../core/generate';

export interface StakeSwitcher {
  root: HTMLElement;
  prev(): void;
  next(): void;
}

export function createStakeSwitcher(
  chipUrl: (file: string) => string | undefined,
  initial: number,
  onChange: (stake: number) => void,
): StakeSwitcher {
  let stake = Math.min(MAX_STAKE, Math.max(MIN_STAKE, initial));

  const bigImg = h('img', { class: 'stake-chip-img', alt: '赌注筹码' }) as HTMLImageElement;
  const chipBlock = h('div', { class: 'stake-chip-block' }, [bigImg]);

  const nameEl = h('span', { class: 'deck-name' });
  const descEl = h('div', { class: 'info-desc info-desc-compact' });
  const info = h('div', { class: 'info-panel' }, [
    h('div', { class: 'info-title-bar' }, [nameEl]),
    descEl,
  ]);

  const inner = h('div', { class: 'stage-inner stage-inner-compact' }, [chipBlock, info]);
  const stage = h('section', { class: 'stage stage-compact', 'aria-label': '赌注选择' }, [inner]);

  const prevBtn = h('button', { class: 'arrow-btn arrow-btn-sm', 'aria-label': '降低赌注', text: '◀' });
  const nextBtn = h('button', { class: 'arrow-btn arrow-btn-sm', 'aria-label': '提高赌注', text: '▶' });

  const dots = STAKES.map(() => h('span', { class: 'dot' }));
  const dotsRow = h('div', { class: 'dots', 'aria-label': '赌注页点' }, dots);

  function render(): void {
    const def = STAKES[stake - 1];
    bigImg.src = chipUrl(def.chipFile) ?? '';
    nameEl.textContent = def.zhName;
    descEl.innerHTML = def.text.map(l => `<p>${l === '' ? '&nbsp;' : renderDescLine(l)}</p>`).join('');
    dots.forEach((d, i) => d.classList.toggle('active', i === stake - 1));
  }

  function setStake(n: number): void {
    // 循环切换：白注（1）向左回金注（8），金注向右回白注
    const span = MAX_STAKE - MIN_STAKE + 1;
    const next = ((((n - MIN_STAKE) % span) + span) % span) + MIN_STAKE;
    if (next === stake) return;
    stake = next;
    render();
    onChange(stake);
  }

  prevBtn.addEventListener('click', () => setStake(stake - 1));
  nextBtn.addEventListener('click', () => setStake(stake + 1));

  const row = h('div', { class: 'selector-row' }, [prevBtn, stage, nextBtn]);
  const root = h('div', { class: 'stake-switcher' }, [row, dotsRow]);

  render();
  return {
    root,
    prev: () => setStake(stake - 1),
    next: () => setStake(stake + 1),
  };
}
