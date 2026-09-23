// Lua 表字面量解析器 + STR_PACK 兼容序列化器（PROJECT_SPEC.md 5.3）
// 表示法：LuaTable = 保持插入序的键值表（Map），数字键与字符串键可混用。
// 序列化必须与游戏的 string.format('%q') / tostring(%.14g) 输出逐字节一致。

export type LuaValue = number | string | boolean | LuaTable;

export class LuaTable {
  readonly entries = new Map<string | number, LuaValue>();

  get(key: string | number): LuaValue | undefined {
    return this.entries.get(key);
  }

  set(key: string | number, value: LuaValue): this {
    this.entries.set(key, value);
    return this;
  }

  /** 供断言/调试：以普通对象视图读取（仅只读场景） */
  toPlain(): Record<string, unknown> {
    const out: Record<string, unknown> = {};
    for (const [k, v] of this.entries) {
      out[String(k)] = v instanceof LuaTable ? v.toPlain() : v;
    }
    return out;
  }
}

// ---------- 解析 ----------

class Cursor {
  pos = 0;
  constructor(readonly src: string) {}
  ws(): void {
    while (this.pos < this.src.length && /\s/.test(this.src[this.pos])) this.pos++;
  }
}

/** 解析 STR_PACK 产物 `return {...}`，要求消耗全部输入 */
export function parseLua(src: string): LuaTable {
  const c = new Cursor(src);
  c.ws();
  if (!src.startsWith('return', c.pos)) throw new Error('期望以 "return " 开头');
  c.pos += 'return'.length;
  const t = parseTable(c);
  c.ws();
  if (c.pos !== src.length) throw new Error(`表结束后仍有残余输入 @${c.pos}`);
  return t;
}

function parseTable(c: Cursor): LuaTable {
  c.ws();
  if (c.src[c.pos] !== '{') throw new Error(`期望 '{' @${c.pos}: ${c.src.slice(c.pos, c.pos + 30)}`);
  c.pos++;
  const t = new LuaTable();
  for (;;) {
    c.ws();
    if (c.src[c.pos] === '}') { c.pos++; return t; }
    if (c.src[c.pos] !== '[') throw new Error(`期望键 '[' @${c.pos}: ${c.src.slice(c.pos, c.pos + 30)}`);
    c.pos++;
    let key: string | number;
    if (c.src[c.pos] === '"') key = parseString(c);
    else {
      const m = /^-?\d+/.exec(c.src.slice(c.pos));
      if (!m) throw new Error(`坏数字键 @${c.pos}`);
      key = Number(m[0]);
      c.pos += m[0].length;
    }
    c.ws();
    if (c.src[c.pos] !== ']') throw new Error(`期望 ']' @${c.pos}`);
    c.pos++;
    c.ws();
    if (c.src[c.pos] !== '=') throw new Error(`期望 '=' @${c.pos}`);
    c.pos++;
    t.set(key, parseValue(c));
    c.ws();
    if (c.src[c.pos] === ',') c.pos++;
  }
}

function parseValue(c: Cursor): LuaValue {
  c.ws();
  const ch = c.src[c.pos];
  if (ch === '{') return parseTable(c);
  if (ch === '"') return parseString(c);
  const m = /^-?\d+\.?\d*(?:e[-+]?\d+)?|^true|^false/.exec(c.src.slice(c.pos));
  if (!m) throw new Error(`坏值 @${c.pos}: ${c.src.slice(c.pos, c.pos + 30)}`);
  c.pos += m[0].length;
  return m[0] === 'true' ? true : m[0] === 'false' ? false : Number(m[0]);
}

/** 解析 Lua 双引号字符串（仅接受 %q 会产出的转义形式） */
function parseString(c: Cursor): string {
  const s = c.src;
  let pos = c.pos + 1; // 跳过开头 "
  let out = '';
  for (;;) {
    const ch = s[pos];
    if (ch === '"') { c.pos = pos + 1; return out; }
    if (ch === '\\') {
      const n = s[pos + 1];
      if (n === '\n') { out += '\n'; pos += 2; }           // %q: 反斜杠 + 真实换行
      else if (n === '\r') { out += '\r'; pos += 2; }
      else if (n === '"') { out += '"'; pos += 2; }
      else if (n === '\\') { out += '\\'; pos += 2; }
      else if (n >= '0' && n <= '9') {                     // \ddd 十进制控制字符
        out += String.fromCharCode(Number(s.slice(pos + 1, pos + 4)));
        pos += 4;
      } else throw new Error(`未知转义 @${pos}: ${s.slice(pos, pos + 4)}`);
    } else {
      out += ch;
      pos++;
    }
  }
}

// ---------- 序列化 ----------

/** 序列化为 `return {...}`（与 STR_PACK 输出逐字节一致，键序 = 插入序） */
export function serializeLua(root: LuaTable): string {
  return 'return ' + emitTable(root);
}

function emitTable(t: LuaTable): string {
  let out = '{';
  for (const [k, v] of t.entries) {
    out += (typeof k === 'string' ? `["${quote(k)}"]` : `[${k}]`) + '=' + emitValue(v) + ',';
  }
  return out + '}';
}

function emitValue(v: LuaValue): string {
  if (v instanceof LuaTable) return emitTable(v);
  if (typeof v === 'string') return `"${quote(v)}"`;
  if (typeof v === 'boolean') return v ? 'true' : 'false';
  return formatG14(v);
}

/** Lua string.format('%q') 转义规则 */
export function quote(s: string): string {
  let out = '';
  for (const ch of s) {
    const code = ch.codePointAt(0)!;
    if (ch === '"') out += '\\"';
    else if (ch === '\\') out += '\\\\';
    else if (ch === '\n') out += '\\\n';
    else if (ch === '\r') out += '\\\r';
    else if (code < 32 || code === 127) out += '\\' + String(code).padStart(3, '0');
    else out += ch;
  }
  return out;
}

/** Lua 数字字符串化（%.14g）：整数无小数点，浮点最多 14 位有效数字并去尾零 */
export function formatG14(x: number): string {
  if (!Number.isFinite(x)) throw new Error(`非法数字: ${x}`);
  if (Number.isInteger(x) && Math.abs(x) < 1e21) return String(x);
  const exp = Math.floor(Math.log10(Math.abs(x)));
  if (exp < -4 || exp >= 14) {
    let [mant, e] = x.toPrecision(14).split('e');
    if (mant.includes('.')) mant = mant.replace(/0+$/, '').replace(/\.$/, '');
    const ei = Number(e);
    return `${mant}e${ei < 0 ? '-' : '+'}${String(Math.abs(ei)).padStart(2, '0')}`;
  }
  let s = x.toFixed(Math.min(20, 13 - exp));
  if (s.includes('.')) s = s.replace(/0+$/, '').replace(/\.$/, '');
  return s;
}
