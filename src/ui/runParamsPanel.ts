// 开局参数面板：种子条（框体上方）+ 出牌 / 弃牌 / 手牌 / 金币（样式复刻游戏对局 HUD 左上角三块）
// 随牌组刷新为真实初始值；数值与种子可手动修改，导出时写入存档
import type { BackDef } from '../data/backs';
import { randomSeed } from '../core/generate';
import { h } from './dom';

export interface RunInit {
  hands: number;
  discards: number;
  handSize: number;
  jokerSlots: number;
  consumableSlots: number;
  dollars: number;
}

/** 无修正基准（misc_functions.lua:1868 get_starting_params）：
 *  4 出牌 / 3 弃牌 / 手牌上限 8 / 5 小丑槽 / 2 消耗品槽 / $4 */
const BASE: RunInit = { hands: 4, discards: 3, handSize: 8, jokerSlots: 5, consumableSlots: 2, dollars: 4 };

/** 牌组的真实开局数值（含蓝注起全局 -1 弃牌） */
export function deckInit(def: BackDef, stake: number): RunInit {
  const num = (key: string): number =>
    typeof def.config[key] === 'number' ? (def.config[key] as number) : 0;
  return {
    hands: BASE.hands + num('hands'),
    discards: BASE.discards + num('discards') - (stake >= 5 ? 1 : 0),
    handSize: BASE.handSize + num('hand_size'),
    jokerSlots: BASE.jokerSlots + num('joker_slot'),
    consumableSlots: BASE.consumableSlots + num('consumable_slot'),
    dollars: BASE.dollars + num('dollars'),
  };
}

const LIMITS: Record<keyof RunInit, [number, number]> = {
  hands: [1, 99],
  discards: [0, 99],
  handSize: [1, 99],
  jokerSlots: [1, 99],       // 小丑槽为 0 时对局无法正常持有小丑，下限取 1
  consumableSlots: [0, 99],
  dollars: [0, 999999],
};

export interface RunParamsPanel {
  root: HTMLElement;
  /** 当前输入值（导出时传给 generateSave） */
  values(): RunInit & { seed: string };
  /** 当前生效的种子（始终为合法值；输入框内未提交的非法内容不计入） */
  seed(): string;
  /** 切换牌组/赌注后：重置数值为对应牌组的真实初始值（种子与牌堆不受影响） */
  refresh(def: BackDef, stake: number): void;
}

export function createRunParamsPanel(initial: RunInit): RunParamsPanel {
  const make = (key: keyof RunInit, cls: string): HTMLInputElement => {
    const [min, max] = LIMITS[key];
    const input = h('input', { class: `param-input ${cls}` }) as HTMLInputElement;
    input.type = 'number';
    input.inputMode = 'numeric';
    input.min = String(min);
    input.max = String(max);
    input.value = String(initial[key]);
    input.addEventListener('change', () => {
      const v = Math.round(Number(input.value));
      input.value = String(Number.isFinite(v) ? Math.min(max, Math.max(min, v)) : initial[key]);
    });
    return input;
  };

  const handsInput = make('hands', 'param-hands');
  const discardsInput = make('discards', 'param-discards');
  const handSizeInput = make('handSize', 'param-handsize');
  const jokerSlotsInput = make('jokerSlots', 'param-jokerslots');
  const consumableSlotsInput = make('consumableSlots', 'param-consumableslots');
  const dollarsInput = make('dollars', 'param-money');

  // 种子：模仿游戏策略生成一个初始值，可编辑（8 位，字符表不含 0/I/O）
  let seed = randomSeed();
  const seedInput = h('input', {
    class: 'seed-input',
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
      h('div', { class: 'param-tile' }, [
        h('span', { class: 'param-label', text: '手牌' }),
        handSizeInput,
      ]),
    ]),
    h('div', { class: 'run-params-row' }, [
      h('div', { class: 'param-tile' }, [
        h('span', { class: 'param-label', text: '小丑' }),
        jokerSlotsInput,
      ]),
      h('div', { class: 'param-tile' }, [
        h('span', { class: 'param-label', text: '消耗牌' }),
        consumableSlotsInput,
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
  const root = h('div', { class: 'run-params-col' }, [seedTile, panel]);

  return {
    root,
    values: () => ({
      hands: Number(handsInput.value),
      discards: Number(discardsInput.value),
      handSize: Number(handSizeInput.value),
      jokerSlots: Number(jokerSlotsInput.value),
      consumableSlots: Number(consumableSlotsInput.value),
      dollars: Number(dollarsInput.value),
      seed: seedInput.value,
    }),
    seed: () => seed,
    refresh(def, stake) {
      initial = deckInit(def, stake);
      handsInput.value = String(initial.hands);
      discardsInput.value = String(initial.discards);
      handSizeInput.value = String(initial.handSize);
      jokerSlotsInput.value = String(initial.jokerSlots);
      consumableSlotsInput.value = String(initial.consumableSlots);
      dollarsInput.value = String(initial.dollars);
      // 程序化赋值不触发 input/change：派发一次 change 让监听方（入口的 N/M 上限等）按新值立即重绘
      root.dispatchEvent(new Event('change', { bubbles: true }));
    },
  };
}
