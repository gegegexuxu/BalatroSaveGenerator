// 消耗牌牌面元素：普通 = 整卡 img；负片 = 整卡图过一遍游戏 negative shader
// （复用 ui/cardShader 的移植 GLSL；整卡作 base 层 → negative + negative_shine 两趟）。
// WebGL 不可用或纹理未就绪时回退原图。
import type { ConsumableDef } from '../data/consumables';
import { cardShaderAvailable, paintEdition } from './cardShader';
import { h } from './dom';

export function consumableCardImage(
  def: ConsumableDef,
  url: string,
  negative: boolean,
  cssClass: string,
): HTMLElement {
  const img = h('img', { class: cssClass, src: url, alt: def.enName }) as HTMLImageElement;
  if (!negative || !cardShaderAvailable()) return img;

  // 源分辨率 142×190，CSS 端 image-rendering: pixelated 拉伸
  const canvas = h('canvas', {
    class: cssClass, 'aria-label': def.enName,
  }) as HTMLCanvasElement;
  canvas.width = 142;
  canvas.height = 190;
  const paint = (): void => {
    const ok = paintEdition(canvas, { base: { img, key: url } }, 'negative', { t: 0, phase: 0 });
    if (!ok) canvas.replaceWith(img);
  };
  if (img.complete && img.naturalWidth > 0) paint();
  else {
    img.addEventListener('load', paint, { once: true });
    img.addEventListener('error', () => canvas.replaceWith(img), { once: true });
  }
  return canvas;
}
