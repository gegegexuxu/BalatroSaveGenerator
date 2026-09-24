// 牌面渲染：底板（空白/增强）+ 牌面 + 蜡封三层叠加，两处弹窗共用
// 尺寸由 CSS 变量 --card-w/--card-h 控制（见 main.css .pcard）
import { h } from './dom';
import { ENHANCEMENTS, SEALS } from '../data/cardMods';
import { cardShaderAvailable, paintEdition, cardPhase, type CardLayers, type EditionKey } from './cardShader';
import type { RankChar, SuitChar } from '../core/deckGen';

const faceImages = import.meta.glob('../../assets/cards/*.png', {
  eager: true, query: '?url', import: 'default',
}) as Record<string, string>;
const enhImages = import.meta.glob('../../assets/enhancement/*.png', {
  eager: true, query: '?url', import: 'default',
}) as Record<string, string>;
const sealImages = import.meta.glob('../../assets/seal/*.png', {
  eager: true, query: '?url', import: 'default',
}) as Record<string, string>;

export const SUIT_SYM: Record<string, string> = { S: '♠', H: '♥', C: '♣', D: '♦' };
export const SUIT_ZH: Record<string, string> = { S: '黑桃', H: '红桃', C: '梅花', D: '方块' };
/** 牌面展示顺序：花色 黑桃/红桃/梅花/方块，点数 A→2（与游戏牌组视图一致） */
export const SUIT_ORDER: SuitChar[] = ['S', 'H', 'C', 'D'];
export const RANK_ORDER: RankChar[] = ['A', 'K', 'Q', 'J', 'T', '9', '8', '7', '6', '5', '4', '3', '2'];
export const FACE_RANKS: RankChar[] = ['K', 'Q', 'J'];

export function sealImage(key: string | undefined): string | undefined {
  const def = key ? SEALS.find(s => s.key === key) : undefined;
  return def ? sealImages[`../../assets/seal/${def.image}`] : undefined;
}

export interface CardFace {
  suit: string;
  rank: string;
  /** 增强 key（m_glass 等） */
  enhancement?: string;
  seal?: string;
  /** 版本 key（foil / holo / polychrome / negative） */
  edition?: string;
}

/** playingCard 选项：animate = 持续重绘 shader（详情弹窗的大牌；编辑器里的 52 张小牌用静态快照） */
export interface PlayingCardOptions {
  animate?: boolean;
}

/** 空白牌底板（无增强时使用，来自 Resources/enhancement/Normal.png） */
const PLAIN_BASE = 'Normal.png';

/** 每张牌的固定 shader 相位（复刻游戏按牌 ID 定相位：card.lua:4350），同花色同点数恒定 */
function cardPhaseOf(face: CardFace): number {
  const key = `${face.suit}${face.rank}`;
  let hash = 0;
  for (let i = 0; i < key.length; i++) hash = (hash * 31 + key.charCodeAt(i)) % 100000;
  return cardPhase(hash + 1);
}

/** 把牌面画进 shader canvas：按 .pcard 的实际显示尺寸 × DPR 定像素尺寸 */
function paintShaderCard(
  card: HTMLElement,
  canvas: HTMLCanvasElement,
  layers: CardLayers,
  edition: string,
  t: number,
  phase: number,
): boolean {
  const rect = card.getBoundingClientRect();
  if (rect.width < 1 || rect.height < 1) return false;   // 尚未布局
  const dpr = window.devicePixelRatio || 1;
  const w = Math.round(rect.width * dpr);
  const h = Math.round(rect.height * dpr);
  if (canvas.width !== w) canvas.width = w;
  if (canvas.height !== h) canvas.height = h;
  return paintEdition(canvas, layers, edition as EditionKey, { t, phase });
}

export function playingCard(face: CardFace, opts: PlayingCardOptions = {}): HTMLDivElement {
  const faceUrl = faceImages[`../../assets/cards/${face.suit}_${face.rank}.png`];
  const baseFile = face.enhancement
    ? ENHANCEMENTS.find(e => e.key === face.enhancement)?.image
    : PLAIN_BASE;
  const base = baseFile ? enhImages[`../../assets/enhancement/${baseFile}`] : undefined;
  const seal = sealImage(face.seal);
  const kids: HTMLElement[] = [];
  const baseImg = base ? h('img', { class: 'pcard-base', src: base, alt: '' }) as HTMLImageElement : undefined;
  const faceImg = faceUrl
    ? h('img', { class: 'pcard-face', src: faceUrl, alt: `${face.suit}${face.rank}` }) as HTMLImageElement
    : undefined;
  if (baseImg) kids.push(baseImg);
  if (faceImg) {
    kids.push(faceImg);
  } else {
    const red = face.suit === 'H' || face.suit === 'D';
    kids.push(h('span', { class: `pcard-fallback${red ? ' pcard-red' : ''}`, text: `${face.rank}${SUIT_SYM[face.suit] ?? ''}` }));
  }

  // 版本层：插在牌面之上、蜡封之下（游戏里蜡封最后画）
  let shaderCanvas: HTMLCanvasElement | undefined;
  if (face.edition && cardShaderAvailable()) {
    shaderCanvas = h('canvas', { class: 'pcard-shader' }) as HTMLCanvasElement;
    kids.push(shaderCanvas);
  }
  if (seal) kids.push(h('img', { class: 'pcard-seal', src: seal, alt: '' }) as HTMLImageElement);

  const card = h('div', { class: `pcard${face.enhancement ? ' pcard-enhanced' : ''}${seal ? ' pcard-sealed' : ''}` }, kids) as HTMLDivElement;
  if (!shaderCanvas || !face.edition) return card;

  const edition = face.edition;
  const layers: CardLayers = { base: baseImg ? { img: baseImg, key: base } : null, face: faceImg ? { img: faceImg, key: faceUrl } : null };
  const phase = cardPhaseOf(face);
  const animate = opts.animate === true;
  let finished = false;
  let pending = false;
  let tries = 0;

  const tryPaint = (): boolean =>
    card.isConnected && paintShaderCard(card, shaderCanvas!, layers, edition, performance.now() / 1000, phase);

  const tick = (): void => {
    pending = false;
    if (finished || !card.isConnected) return;
    finished = tryPaint();
    if (finished && !animate) return;          // 静态快照：出图即止
    if (!finished && ++tries > 60) return;     // 纹理长期不就绪 → 放弃（保留普通 img）
    schedule();
  };

  // rAF 在后台标签页会被暂停，故用定时器兜底推进；pending 去重避免两条路各排一次
  const schedule = (): void => {
    if (pending) return;
    pending = true;
    requestAnimationFrame(tick);
    window.setTimeout(() => { if (pending) tick(); }, 200);
  };

  // 微任务里首绘：调用方（replaceChildren 等）已把元素插入 DOM，此处同步出图，
  // 不依赖 rAF，因此后台标签页里也能一次画好（编辑器 52 张静态牌就靠这一发）
  queueMicrotask(() => {
    finished = tryPaint();
    if (!finished || animate) schedule();
  });
  return card;
}
