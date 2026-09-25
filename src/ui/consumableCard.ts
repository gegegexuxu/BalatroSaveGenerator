// 消耗牌 / 小丑牌牌面元素：无版本 = 整卡 img；带版本 = 整卡图过一遍游戏版本 shader
// （复用 ui/cardShader 的移植 GLSL；整卡作 base 层 → 对应版本 program，负片再加 negative_shine 一趟）。
// WebGL 不可用或纹理未就绪时回退原图。
import type { ConsumableDef } from '../data/consumables';
import { cardShaderAvailable, paintEdition } from './cardShader';
import { h } from './dom';

/** 牌面渲染的版本集合（= cardShader 的 EditionKey：负片走 negative program；闪箔/镭射/多彩走对应 program） */
export type CardEdition = 'foil' | 'holo' | 'polychrome' | 'negative';

export function consumableCardImage(
  def: ConsumableDef,
  url: string,
  negative: boolean,
  cssClass: string,
): HTMLElement {
  return editionCardImage(def.enName, url, negative ? 'negative' : undefined, cssClass);
}

/** 带版本的整卡渲染（小丑牌用）：edition = undefined 时直接整卡 img */
export function editionCardImage(
  name: string,
  url: string,
  edition: CardEdition | undefined,
  cssClass: string,
): HTMLElement {
  const img = h('img', { class: cssClass, src: url, alt: name }) as HTMLImageElement;
  if (!edition || !cardShaderAvailable()) return img;

  // 源分辨率 142×190，CSS 端 image-rendering: pixelated 拉伸
  const canvas = h('canvas', {
    class: cssClass, 'aria-label': name,
  }) as HTMLCanvasElement;
  canvas.width = 142;
  canvas.height = 190;
  const paint = (): void => {
    const ok = paintEdition(canvas, { base: { img, key: url } }, edition, { t: 0, phase: 0 });
    if (!ok) canvas.replaceWith(img);
  };
  if (img.complete && img.naturalWidth > 0) paint();
  else {
    img.addEventListener('load', paint, { once: true });
    img.addEventListener('error', () => canvas.replaceWith(img), { once: true });
  }
  return canvas;
}
