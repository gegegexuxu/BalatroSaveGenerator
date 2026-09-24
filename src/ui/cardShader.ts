// 卡牌「版本」shader：把 Code/resources/shaders/*.fs 的 LOVE GLSL 移植到 WebGL（PROJECT_SPEC §5.7）
// 移植三条约定：
//   ① dissolve = 0（正常显示）时 dissolve_mask() 为恒等函数 → 解散/burn_colour 逻辑不移植，只留效果主体；
//   ② 卡面是独立 PNG（非图集）→ texture_details = (0,0,W,H)、image_details = (W,H)，shader 内 uv 退化为 texture_coords；
//   ③ 纹理不做 sRGB 转换（与游戏一致，直出 RGBA8）；顶点倾斜已定案不做，故顶点着色器只画平板四边形。
// 架构：全部牌面共用一个离屏 WebGL context —— 受限的是 context 数量，program 数量不受限，
// 每张牌按自己的版本 useProgram 切换即可；结果 blit 到每张牌各自的 2D canvas（2D canvas 无数量限制）。
// 版本可用范围：扑克牌只走 foil/holo/polychrome；negative/negative_shine 保留给 v2「起始小丑」
//（负片仅作用于小丑与消耗品，扑克牌不开放，理由见 core/saveDeck.ts:buildEdition）。

export type EditionKey = 'foil' | 'holo' | 'polychrome' | 'negative';

/** 可作为 WebGL 纹理源的图（不含 SVGImageElement —— 它不是合法的 TexImageSource） */
export type LayerImage = HTMLImageElement | HTMLCanvasElement | HTMLVideoElement | ImageBitmap;

/** 一层牌面纹理：底板（增强底板）与牌面（点数花色），可为空 */
export interface CardLayer {
  img: LayerImage;
  /** 纹理源地址（用作缓存键）；省略时按对象身份缓存 */
  key?: string;
}

export interface CardLayers {
  base?: CardLayer | null;
  face?: CardLayer | null;
}

/** 绘制输入：与游戏一致的参数取自 card.lua:4348-4350（去掉倾斜项后 param.x = t/28、param.y = t） */
export interface EditionPaint {
  /** 真实时间（秒）；静态快照可传任意固定值 */
  t: number;
  /** 每张牌的固定相位（游戏里 time = 123.33412*(ID/1.14212)%3000） */
  phase?: number;
}

const VERT_SRC = `#ifdef GL_FRAGMENT_PRECISION_HIGH
precision highp float;
#else
precision mediump float;
#endif
attribute vec2 a_pos;
varying vec2 v_uv;
void main() {
  // LOVE 的纹理坐标原点在左上，WebGL 在左下 → 翻转 y，保持与游戏同向
  v_uv = vec2(a_pos.x*0.5 + 0.5, 0.5 - a_pos.y*0.5);
  gl_Position = vec4(a_pos, 0., 1.);
}`;

/** 与 game.lua 各 shader 完全一致的公共头部（uniform 名保持原名，便于与原文件逐行对照） */
const PRELUDE = `#ifdef GL_FRAGMENT_PRECISION_HIGH
precision highp float;
#else
precision mediump float;
#endif
varying vec2 v_uv;
uniform sampler2D u_tex;
uniform vec4 texture_details;
uniform vec2 image_details;
uniform float time;
`;

/** hue/RGB/HSL：四个 shader 的公共辅助段（原文 54-96 行，逐字移植，number → float） */
const HELPERS = `
float hue(float s, float t, float h)
{
	float hs = mod(h, 1.)*6.;
	if (hs < 1.) return (t-s) * hs + s;
	if (hs < 3.) return t;
	if (hs < 4.) return (t-s) * (4.-hs) + s;
	return s;
}

vec4 RGB(vec4 c)
{
	if (c.y < 0.0001)
		return vec4(vec3(c.z), c.a);

	float t = (c.z < .5) ? c.y*c.z + c.z : -c.y*c.z + (c.y+c.z);
	float s = 2.0 * c.z - t;
	return vec4(hue(s,t,c.x + 1./3.), hue(s,t,c.x), hue(s,t,c.x - 1./3.), c.w);
}

vec4 HSL(vec4 c)
{
	float low = min(c.r, min(c.g, c.b));
	float high = max(c.r, max(c.g, c.b));
	float delta = high - low;
	float sum = high+low;

	vec4 hsl = vec4(.0, .0, .5 * sum, c.a);
	if (delta == .0)
		return hsl;

	hsl.y = (hsl.z < .5) ? delta / sum : delta / (2.0 - sum);

	if (high == c.r)
		hsl.x = (c.g - c.b) / delta;
	else if (high == c.g)
		hsl.x = (c.b - c.r) / delta + 2.0;
	else
		hsl.x = (c.r - c.g) / delta + 4.0;

	hsl.x = mod(hsl.x / 6., 1.);
	return hsl;
}
`;

/** foil.fs effect() 主体（98-124 行），dissolve_mask 恒等故直接返回 tex */
const FOIL_BODY = `
void main() {
	vec4 tex = texture2D(u_tex, v_uv);
	vec2 uv = (((v_uv)*(image_details)) - texture_details.xy*texture_details.ba)/texture_details.ba;
	vec2 adjusted_uv = uv - vec2(0.5, 0.5);
	adjusted_uv.x = adjusted_uv.x*texture_details.b/texture_details.a;

	float low = min(tex.r, min(tex.g, tex.b));
	float high = max(tex.r, max(tex.g, tex.b));
	float delta = min(high, max(0.5, 1. - low));

	float fac = max(min(2.*sin((length(90.*adjusted_uv) + foil.r*2.) + 3.*(1.+0.8*cos(length(113.1121*adjusted_uv) - foil.r*3.121))) - 1. - max(5.-length(90.*adjusted_uv), 0.), 1.), 0.);
	vec2 rotater = vec2(cos(foil.r*0.1221), sin(foil.r*0.3512));
	float angle = dot(rotater, adjusted_uv)/(length(rotater)*length(adjusted_uv));
	float fac2 = max(min(5.*cos(foil.g*0.3 + angle*3.14*(2.2+0.9*sin(foil.r*1.65 + 0.2*foil.g))) - 4. - max(2.-length(20.*adjusted_uv), 0.), 1.), 0.);
	float fac3 = 0.3*max(min(2.*sin(foil.r*5. + uv.x*3. + 3.*(1.+0.5*cos(foil.r*7.))) - 1., 1.), -1.);
	float fac4 = 0.3*max(min(2.*sin(foil.r*6.66 + uv.y*3.8 + 3.*(1.+0.5*cos(foil.r*3.414))) - 1., 1.), -1.);

	float maxfac = max(max(fac, max(fac2, max(fac3, max(fac4, 0.0)))) + 2.2*(fac+fac2+fac3+fac4), 0.);

	tex.r = tex.r-delta + delta*maxfac*0.3;
	tex.g = tex.g-delta + delta*maxfac*0.3;
	tex.b = tex.b + delta*maxfac*1.9;
	tex.a = min(tex.a, 0.3*tex.a + 0.9*min(0.5, maxfac*0.1));

	gl_FragColor = tex;
}`;

/** holo.fs effect() 主体（97-133 行） */
const HOLO_BODY = `
void main() {
	vec4 tex = texture2D(u_tex, v_uv);
	vec2 uv = (((v_uv)*(image_details)) - texture_details.xy*texture_details.ba)/texture_details.ba;
	vec4 hsl = HSL(0.5*tex + 0.5*vec4(0.,0.,1.,tex.a));

	float t = holo.y*7.221 + time;
	vec2 floored_uv = (floor((uv*texture_details.ba)))/texture_details.ba;
	vec2 uv_scaled_centered = (floored_uv - 0.5) * 250.;

	vec2 field_part1 = uv_scaled_centered + 50.*vec2(sin(-t / 143.6340), cos(-t / 99.4324));
	vec2 field_part2 = uv_scaled_centered + 50.*vec2(cos( t / 53.1532),  cos( t / 61.4532));
	vec2 field_part3 = uv_scaled_centered + 50.*vec2(sin(-t / 87.53218), sin(-t / 49.0000));

	float field = (1.+ (
		cos(length(field_part1) / 19.483) + sin(length(field_part2) / 33.155) * cos(field_part2.y / 15.73) +
		cos(length(field_part3) / 27.193) * sin(field_part3.x / 21.92) ))/2.;

	float res = (.5 + .5* cos( (holo.x) * 2.612 + ( field + -.5 ) *3.14));

	float low = min(tex.r, min(tex.g, tex.b));
	float high = max(tex.r, max(tex.g, tex.b));
	float delta = 0.2+0.3*(high- low) + 0.1*high;

	float gridsize = 0.79;
	float fac = 0.5*max(max(max(0., 7.*abs(cos(uv.x*gridsize*20.))-6.),max(0., 7.*cos(uv.y*gridsize*45. + uv.x*gridsize*20.)-6.)), max(0., 7.*cos(uv.y*gridsize*45. - uv.x*gridsize*20.)-6.));

	hsl.x = hsl.x + res + fac;
	hsl.y = hsl.y*1.3;
	hsl.z = hsl.z*0.6+0.4;

	tex = (1.-delta)*tex + delta*RGB(hsl)*vec4(0.9,0.8,1.2,tex.a);

	if (tex.a < 0.7) tex.a = tex.a/3.;

	gl_FragColor = tex;
}`;

/** polychrome.fs effect() 主体（97-128 行） */
const POLYCHROME_BODY = `
void main() {
	vec4 tex = texture2D(u_tex, v_uv);
	vec2 uv = (((v_uv)*(image_details)) - texture_details.xy*texture_details.ba)/texture_details.ba;

	float low = min(tex.r, min(tex.g, tex.b));
	float high = max(tex.r, max(tex.g, tex.b));
	float delta = high - low;

	float saturation_fac = 1. - max(0., 0.05*(1.1-delta));

	vec4 hsl = HSL(vec4(tex.r*saturation_fac, tex.g*saturation_fac, tex.b, tex.a));

	float t = polychrome.y*2.221 + time;
	vec2 floored_uv = (floor((uv*texture_details.ba)))/texture_details.ba;
	vec2 uv_scaled_centered = (floored_uv - 0.5) * 50.;

	vec2 field_part1 = uv_scaled_centered + 50.*vec2(sin(-t / 143.6340), cos(-t / 99.4324));
	vec2 field_part2 = uv_scaled_centered + 50.*vec2(cos( t / 53.1532),  cos( t / 61.4532));
	vec2 field_part3 = uv_scaled_centered + 50.*vec2(sin(-t / 87.53218), sin(-t / 49.0000));

	float field = (1.+ (
		cos(length(field_part1) / 19.483) + sin(length(field_part2) / 33.155) * cos(field_part2.y / 15.73) +
		cos(length(field_part3) / 27.193) * sin(field_part3.x / 21.92) ))/2.;

	float res = (.5 + .5* cos( (polychrome.x) * 2.612 + ( field + -.5 ) *3.14));
	hsl.x = hsl.x+ res + polychrome.y*0.04;
	hsl.y = min(0.6,hsl.y+0.5);

	tex.rgb = RGB(hsl).rgb;

	if (tex.a < 0.7) tex.a = tex.a/3.;

	gl_FragColor = tex;
}`;

/** negative.fs effect() 主体（97-115 行）：负片底色 */
const NEGATIVE_BODY = `
void main() {
	vec4 tex = texture2D(u_tex, v_uv);
	vec2 uv = (((v_uv)*(image_details)) - texture_details.xy*texture_details.ba)/texture_details.ba;

	vec4 SAT = HSL(tex);

	if (negative.g > 0.0 || negative.g < 0.0) {
		SAT.b = (1.-SAT.b);
	}
	SAT.r = -SAT.r+0.2;

	tex = RGB(SAT) + 0.8*vec4(79./255., 99./255.,103./255.,0.);

	if (tex.a < 0.7) tex.a = tex.a/3.;

	gl_FragColor = tex;
}`;

/** negative_shine.fs effect() 主体（54-79 行）：负片表面流光（只叠在底板上） */
const NEGATIVE_SHINE_BODY = `
void main() {
	vec4 tex = texture2D(u_tex, v_uv);
	vec2 uv = (((v_uv)*(image_details)) - texture_details.xy*texture_details.ba)/texture_details.ba;

	float low = min(tex.r, min(tex.g, tex.b));
	float high = max(tex.r, max(tex.g, tex.b));
	float delta = high-low -0.1;

	float fac = 0.8 + 0.9*sin(11.*uv.x+4.32*uv.y + negative_shine.r*12. + cos(negative_shine.r*5.3 + uv.y*4.2 - uv.x*4.));
	float fac2 = 0.5 + 0.5*sin(8.*uv.x+2.32*uv.y + negative_shine.r*5. - cos(negative_shine.r*2.3 + uv.x*8.2));
	float fac3 = 0.5 + 0.5*sin(10.*uv.x+5.32*uv.y + negative_shine.r*6.111 + sin(negative_shine.r*5.3 + uv.y*3.2));
	float fac4 = 0.5 + 0.5*sin(3.*uv.x+2.32*uv.y + negative_shine.r*8.111 + sin(negative_shine.r*1.3 + uv.y*11.2));
	float fac5 = sin(0.9*16.*uv.x+5.32*uv.y + negative_shine.r*12. + cos(negative_shine.r*5.3 + uv.y*4.2 - uv.x*4.));

	float maxfac = 0.7*max(max(fac, max(fac2, max(fac3,0.0))) + (fac+fac2+fac3*fac4), 0.);

	tex.rgb = tex.rgb*0.5 + vec3(0.4, 0.4, 0.8);

	tex.r = tex.r-delta + delta*maxfac*(0.7 + fac5*0.27) - 0.1;
	tex.g = tex.g-delta + delta*maxfac*(0.7 - fac5*0.27) - 0.1;
	tex.b = tex.b-delta + delta*maxfac*0.7 - 0.1;
	tex.a = tex.a*(0.5*max(min(1., max(0.,0.3*max(low*0.2, delta)+ min(max(maxfac*0.1,0.), 0.4)) ), 0.) + 0.15*maxfac*(0.1+delta));

	gl_FragColor = tex;
}`;

/** 普通绘制（无效果）：闪箔/镭射/多彩是**叠加**在正常牌面之上的，负片则是取代普通绘制 */
const PLAIN_BODY = `
void main() {
	gl_FragColor = texture2D(u_tex, v_uv);
}`;

/** 每个 program 的名称 = 效果名（uniform 里那对 vec2 与 shader 同名，游戏里亦然） */
type ProgramName = EditionKey | 'negative_shine' | 'plain';

const FRAG_SRC: Record<ProgramName, { body: string; param?: string }> = {
  plain: { body: PLAIN_BODY },
  foil: { body: FOIL_BODY, param: 'foil' },
  holo: { body: HOLO_BODY, param: 'holo' },
  polychrome: { body: POLYCHROME_BODY, param: 'polychrome' },
  negative: { body: NEGATIVE_BODY, param: 'negative' },
  negative_shine: { body: NEGATIVE_SHINE_BODY, param: 'negative_shine' },
};

/**
 * 合成次序严格对应游戏 card.lua:4414-4472：
 * - 闪箔/镭射/多彩：先正常画底板与牌面，再把同名 shader 层叠加其上（半透明叠加，故不能替代普通绘制）；
 * - 负片：`negative` 取代普通绘制（底板 + 牌面），随后 `negative_shine` 再叠在底板上（最后画 = 最上层）。
 */
const PASSES: Record<EditionKey, [keyof CardLayers, ProgramName][]> = {
  foil: [['base', 'plain'], ['face', 'plain'], ['base', 'foil'], ['face', 'foil']],
  holo: [['base', 'plain'], ['face', 'plain'], ['base', 'holo'], ['face', 'holo']],
  polychrome: [['base', 'plain'], ['face', 'plain'], ['base', 'polychrome'], ['face', 'polychrome']],
  negative: [['base', 'negative'], ['face', 'negative'], ['base', 'negative_shine']],
};

interface Program {
  program: WebGLProgram;
  uTex: WebGLUniformLocation | null;
  uTextureDetails: WebGLUniformLocation | null;
  uImageDetails: WebGLUniformLocation | null;
  uTime: WebGLUniformLocation | null;
  uParam: WebGLUniformLocation | null;
}

let gl: WebGLRenderingContext | null | undefined;
let programs: Record<ProgramName, Program> | undefined;
let quadBuf: WebGLBuffer | null = null;
const texCache = new Map<string, WebGLTexture>();

function compile(source: string, type: number): WebGLShader | null {
  const g = gl as WebGLRenderingContext;
  const sh = g.createShader(type);
  if (!sh) return null;
  g.shaderSource(sh, source);
  g.compileShader(sh);
  if (!g.getShaderParameter(sh, gl!.COMPILE_STATUS)) {
    console.error('cardShader 编译失败:', g.getShaderInfoLog(sh));
    g.deleteShader(sh);
    return null;
  }
  return sh;
}

function buildProgram(name: ProgramName): Program | null {
  const g = gl as WebGLRenderingContext;
  const { body, param } = FRAG_SRC[name];
  const src = `${PRELUDE}${param ? `uniform vec2 ${param};\n` : ''}${HELPERS}${body}`;
  const vs = compile(VERT_SRC, g.VERTEX_SHADER);
  const fs = compile(src, g.FRAGMENT_SHADER);
  if (!vs || !fs) return null;
  const program = g.createProgram();
  g.attachShader(program, vs);
  g.attachShader(program, fs);
  g.bindAttribLocation(program, 0, 'a_pos');
  g.linkProgram(program);
  g.deleteShader(vs);
  g.deleteShader(fs);
  if (!g.getProgramParameter(program, g.LINK_STATUS)) {
    console.error('cardShader 链接失败:', g.getProgramInfoLog(program));
    return null;
  }
  return {
    program,
    uTex: g.getUniformLocation(program, 'u_tex'),
    uTextureDetails: g.getUniformLocation(program, 'texture_details'),
    uImageDetails: g.getUniformLocation(program, 'image_details'),
    uTime: g.getUniformLocation(program, 'time'),
    uParam: param ? g.getUniformLocation(program, param) : null,
  };
}

/** 惰性初始化：用到才建 context（WebGL 不可用时返回 false，调用方回落到普通 img 渲染） */
function ensureGl(): boolean {
  if (gl !== undefined) return gl !== null;
  gl = null;
  programs = undefined;
  try {
    const canvas = document.createElement('canvas');
    const ctx = canvas.getContext('webgl', { alpha: true, premultipliedAlpha: false, antialias: false })
      ?? (canvas.getContext('experimental-webgl') as WebGLRenderingContext | null);
    if (!ctx) return false;
    gl = ctx;
    quadBuf = ctx.createBuffer();
    ctx.bindBuffer(ctx.ARRAY_BUFFER, quadBuf);
    // 两个三角形覆盖整个裁剪空间（顶点顺序无关，不剔除背面）
    ctx.bufferData(ctx.ARRAY_BUFFER, new Float32Array([-1, -1, 1, -1, -1, 1, -1, 1, 1, -1, 1, 1]), ctx.STATIC_DRAW);
    const built = {} as Record<ProgramName, Program>;
    for (const name of Object.keys(FRAG_SRC) as ProgramName[]) {
      const p = buildProgram(name);
      if (!p) { gl = null; return false; }
      built[name] = p;
    }
    programs = built;
    return true;
  } catch (err) {
    console.error('cardShader 初始化失败:', err);
    gl = null;
    return false;
  }
}

/** WebGL 是否可用（UI 据此决定是否给牌面挂 canvas 层） */
export function cardShaderAvailable(): boolean {
  return ensureGl();
}

function textureFor(layer: CardLayer): WebGLTexture | null {
  const g = gl as WebGLRenderingContext;
  const key = layer.key ?? String(texCache.size);
  const hit = texCache.get(key);
  if (hit) return hit;
  const img = layer.img;
  if (img instanceof HTMLImageElement && (!img.complete || img.naturalWidth === 0)) return null;
  const tex = g.createTexture();
  g.bindTexture(g.TEXTURE_2D, tex);
  try {
    g.texImage2D(g.TEXTURE_2D, 0, g.RGBA, g.RGBA, g.UNSIGNED_BYTE, img);
  } catch {
    g.deleteTexture(tex);
    return null;
  }
  // 卡牌是像素画，游戏同样用最近邻（CSS 侧 image-rendering: pixelated）
  g.texParameteri(g.TEXTURE_2D, g.TEXTURE_MIN_FILTER, g.NEAREST);
  g.texParameteri(g.TEXTURE_2D, g.TEXTURE_MAG_FILTER, g.NEAREST);
  g.texParameteri(g.TEXTURE_2D, g.TEXTURE_WRAP_S, g.CLAMP_TO_EDGE);
  g.texParameteri(g.TEXTURE_2D, g.TEXTURE_WRAP_T, g.CLAMP_TO_EDGE);
  texCache.set(key, tex);
  return tex;
}

function layerDims(layer: CardLayer): [number, number] {
  const img = layer.img;
  const w = img instanceof HTMLVideoElement ? img.videoWidth
    : img instanceof HTMLImageElement ? img.naturalWidth
    : img.width;
  const h = img instanceof HTMLVideoElement ? img.videoHeight
    : img instanceof HTMLImageElement ? img.naturalHeight
    : img.height;
  return [w || 1, h || 1];
}

/**
 * 把某个版本效果画到目标 canvas 上（目标需已设定像素尺寸，见调用方 DPR 处理）。
 * 返回 false 表示未绘制（WebGL 不可用 / 纹理未就绪），调用方应保留普通 img 兜底。
 */
export function paintEdition(
  target: HTMLCanvasElement,
  layers: CardLayers,
  edition: EditionKey,
  paint: EditionPaint,
): boolean {
  if (!ensureGl() || !programs) return false;
  const g = gl as WebGLRenderingContext;
  const dstCtx = target.getContext('2d');
  if (!dstCtx) return false;

  const w = target.width;
  const h = target.height;
  const src = g.canvas as HTMLCanvasElement;
  if (src.width !== w || src.height !== h) {   // 尺寸变化才重建绘图缓冲（同一尺寸的牌共用一次）
    src.width = w;
    src.height = h;
  }
  g.viewport(0, 0, w, h);
  g.clearColor(0, 0, 0, 0);
  g.clear(g.COLOR_BUFFER_BIT);
  g.enable(g.BLEND);
  g.blendFunc(g.SRC_ALPHA, g.ONE_MINUS_SRC_ALPHA);
  g.bindBuffer(g.ARRAY_BUFFER, quadBuf);
  g.enableVertexAttribArray(0);
  g.vertexAttribPointer(0, 2, g.FLOAT, false, 0, 0);

  // 与游戏 card.lua:4348-4350 一致；倾斜项已定案不做，故 x 只剩时间项
  const param: [number, number] = [paint.t / 28, paint.t];
  const phase = paint.phase ?? 0;
  let drew = false;

  for (const [layerName, programName] of PASSES[edition]) {
    const layer = layers[layerName];
    if (!layer) continue;
    const tex = textureFor(layer);
    if (!tex) continue;
    const [tw, th] = layerDims(layer);
    const p = programs[programName];
    g.useProgram(p.program);
    g.activeTexture(g.TEXTURE0);
    g.bindTexture(g.TEXTURE_2D, tex);
    g.uniform1i(p.uTex, 0);
    // 独立 PNG（非图集）下的退化值：texture_details = (0,0,W,H)、image_details = (W,H)
    g.uniform4f(p.uTextureDetails, 0, 0, tw, th);
    g.uniform2f(p.uImageDetails, tw, th);
    g.uniform1f(p.uTime, phase);
    g.uniform2f(p.uParam, param[0], param[1]);
    g.drawArrays(g.TRIANGLES, 0, 6);
    drew = true;
  }
  if (!drew) return false;

  dstCtx.clearRect(0, 0, w, h);
  dstCtx.drawImage(src, 0, 0);
  return true;
}

/** 按 ID 复刻游戏的每张牌固定相位（card.lua:4350 的 time 表达式） */
export function cardPhase(id: number): number {
  return 123.33412 * (id / 1.14212) % 3000;
}
