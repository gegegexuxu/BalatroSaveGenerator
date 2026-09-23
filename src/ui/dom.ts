/** 轻量 DOM 构建助手 */
export function h<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  attrs: Partial<{
    class: string; text: string; html: string; src: string; alt: string;
    title: string; 'aria-label': string; 'aria-live': string;
  }> = {},
  children: HTMLElement[] = [],
): HTMLElementTagNameMap[K] {
  const el = document.createElement(tag);
  if (attrs.class) el.className = attrs.class;
  if (attrs.text !== undefined) el.textContent = attrs.text;
  if (attrs.html !== undefined) el.innerHTML = attrs.html;
  if (attrs.src) el.setAttribute('src', attrs.src);
  if (attrs.alt) el.setAttribute('alt', attrs.alt);
  if (attrs.title) el.setAttribute('title', attrs.title);
  if (attrs['aria-label']) el.setAttribute('aria-label', attrs['aria-label']);
  if (attrs['aria-live']) el.setAttribute('aria-live', attrs['aria-live']);
  for (const c of children) el.appendChild(c);
  return el;
}

/** 游戏描述文本标记 → HTML（PROJECT_SPEC.md 附录 C 色值）
 *  标记语法：{C:name} 开色、{s:0.8} 开小字、{C:name,s:0.8} 组合、{} 关闭最近一个，
 *  行尾未关闭的自动闭合；#N# 先行替换为 vars */
const COLORS: Record<string, string> = {
  red: 'var(--c-red)', blue: 'var(--c-blue)', money: 'var(--c-money)',
  attention: 'var(--c-important)', gold: 'var(--c-gold)', purple: 'var(--c-purple)',
  green: 'var(--c-green)', orange: 'var(--c-orange)', white: '#ffffff',
  inactive: '#9aa5a6',
  tarot: 'var(--set-tarot)', planet: 'var(--set-planet)', spectral: 'var(--set-spectral)',
  voucher: 'var(--set-voucher)', joker: 'var(--set-joker)',
  spades: '#374649', hearts: '#FE5F55', clubs: '#424e54', diamonds: '#FE5F55',
};

function esc(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

export function renderDescLine(line: string, vars: (number | string)[] = []): string {
  let src = line;
  vars.forEach((v, i) => { src = src.replaceAll(`#${i + 1}#`, String(v)); });
  let out = '';
  let unclosed = 0;
  let last = 0;
  for (const m of src.matchAll(/\{([^{}]*)\}/g)) {
    out += esc(src.slice(last, m.index));
    if (m[1] === '') {
      if (unclosed > 0) { out += '</span>'; unclosed--; }
    } else {
      const cm = /^C:(\w+)/.exec(m[1]);
      if (cm) { out += `<span style="color:${COLORS[cm[1]] ?? 'inherit'}">`; unclosed++; }
      if (/(?:^|,)s:[\d.]+/.test(m[1])) { out += '<span class="desc-small">'; unclosed++; }
    }
    last = m.index + m[0].length;
  }
  out += esc(src.slice(last));
  while (unclosed > 0) { out += '</span>'; unclosed--; }
  return out;
}
