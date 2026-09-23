// 开局参数面板：出牌 / 弃牌 / 金币（样式复刻游戏对局 HUD 左上角三块）+ 种子（框体下方）
// 随牌组刷新为真实初始值；数值与种子可手动修改，导出时写入存档
import type { BackDef } from '../data/backs';
import { randomSeed } from '../core/generate';
import { h } from './dom';

export interface RunInit {
  hands: number;
  discards: number;
  dollars: number;
}

/** 无修正基准（game.lua start_run）：4 次出牌、3 次弃牌、$4 */
const BASE: RunInit = { hands: 4, discards: 3, dollars: 4 };

/** 牌组的真实开局数值（含蓝注起全局 -1 弃牌） */
export function deckInit(def: BackDef, stake: number): RunInit {
  const num = (key: string): number =>
    typeof def.config[key] === 'number' ? (def.config[key] as number) : 0;
  return {
    hands: BASE.hands + num('hands'),
    discards: BASE.discards + num('discards') - (stake >= 5 ? 1 : 0),
    dollars: BASE.dollars + num('dollars'),
  };
}

const LIMITS: Record<keyof RunInit, [number, number]> = {
  hands: [1, 99],
  discards: [0, 99],
  dollars: [0, 999999],
};

export interface RunParamsPanel {
  root: HTMLElement;
  /** 当前输入值（导出时传给 generateSave） */
  values(): RunInit & { seed: string };
  /** 切换牌组/赌注后：重置数值为对应牌组的真实初始值（种子不受影响） */
  refresh(def: BackDef, stake: number): void;
}

export function createRunParamsPanel(initial: RunInit): RunParamsPanel {
  const make = (key: keyof RunInit, cls: string): HTMLInputElement => {
    const input = h('input', { class: `param-input ${cls}`, title: '点击修改' }) as HTMLInputElement;
    input.type = 'number';
    input.inputMode = 'numeric';
    input.value = String(initial[key]);
    input.addEventListener('change', () => {
      const [min, max] = LIMITS[key];
      const v = Math.round(Number(input.value));
      input.value = String(Number.isFinite(v) ? Math.min(max, Math.max(min, v)) : initial[key]);
    });
    return input;
  };

  const handsInput = make('hands', 'param-hands');
  const discardsInput = make('discards', 'param-discards');
  const dollarsInput = make('dollars', 'param-money');

  // 种子：模仿游戏策略生成一个初始值，可编辑（8 位，字符表不含 0/I/O）
  let seed = randomSeed();
  const seedInput = h('input', {
    class: 'seed-input',
    title: '游戏种子：8 位，不含 0 / I / O',
  }) as HTMLInputElement;
  seedInput.type = 'text';
  seedInput.maxLength = 8;
  seedInput.spellcheck = false;
  seedInput.value = seed;
  seedInput.addEventListener('input', () => {
    const cleaned = seedInput.value.toUpperCase().replace(/[^1-9A-HJ-NP-Z]/g, '').slice(0, 8);
    if (cleaned !== seedInput.value) seedInput.value = cleaned;
  });
  seedInput.addEventListener('change', () => {
    if (!/^[1-9A-HJ-NP-Z]{8}$/.test(seedInput.value)) seedInput.value = seed;   // 无效则回退
    else seed = seedInput.value;
  });

  const panel = h('div', { class: 'run-params', 'aria-label': '开局参数' }, [
    h('div', { class: 'run-params-row' }, [
      h('div', { class: 'param-tile' }, [
        h('span', { class: 'param-label', text: '出牌' }),
        handsInput,
      ]),
      h('div', { class: 'param-tile' }, [
        h('span', { class: 'param-label', text: '弃牌' }),
        discardsInput,
      ]),
    ]),
    h('div', { class: 'param-tile param-tile-money' }, [
      h('span', { class: 'param-money-sign', text: '$' }),
      dollarsInput,
    ]),
  ]);
  const seedTile = h('div', { class: 'seed-tile' }, [
    h('span', { class: 'seed-label', text: '种子' }),
    seedInput,
  ]);
  const root = h('div', { class: 'run-params-col' }, [panel, seedTile]);

  return {
    root,
    values: () => ({
      hands: Number(handsInput.value),
      discards: Number(discardsInput.value),
      dollars: Number(dollarsInput.value),
      seed: seedInput.value,
    }),
    refresh(def, stake) {
      initial = deckInit(def, stake);
      handsInput.value = String(initial.hands);
      discardsInput.value = String(initial.discards);
      dollarsInput.value = String(initial.dollars);
    },
  };
}
