// 死代码扫描（一次性工具）：找出「生产代码零引用」的导出符号与 CSS 类
import fs from 'node:fs';
import path from 'node:path';

const toPosix = p => p.split(path.sep).join('/');

function walk(dir, exts, acc = []) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) walk(p, exts, acc);
    else if (exts.some(x => e.name.endsWith(x))) acc.push(toPosix(p));
  }
  return acc;
}

const srcFiles = walk('src', ['.ts', '.css']);
const testFiles = fs.existsSync('test') ? walk('test', ['.ts']) : [];
const contents = new Map();
for (const f of [...srcFiles, ...testFiles]) contents.set(f, fs.readFileSync(f, 'utf8'));
contents.set('index.html', fs.readFileSync('index.html', 'utf8'));

const countWord = (text, word) => {
  const re = new RegExp(`(?<![A-Za-z0-9_$])${word.replace(/\$/g, '\\$')}(?![A-Za-z0-9_$])`, 'g');
  return (text.match(re) ?? []).length;
};

// ---------- 1. 导出符号 ----------
const declRe = /^export\s+(?:declare\s+)?(?:async\s+)?(?:function|const|let|var|class|type|interface|enum)\s+([A-Za-z0-9_$]+)/gm;
const rows = [];
for (const f of srcFiles.filter(x => x.endsWith('.ts'))) {
  const text = contents.get(f);
  for (const m of text.matchAll(declRe)) {
    const name = m[1];
    let prod = 0;
    for (const [g, u] of contents) {
      if (!g.endsWith('.ts') || g.startsWith('test/')) continue;   // 测试引用单独统计
      const hits = countWord(u, name);
      prod += g === f ? Math.max(0, hits - 1) : hits;
    }
    let test = 0;
    for (const g of testFiles) test += countWord(contents.get(g), name);
    if (prod === 0) rows.push({ file: f, name, testRefs: test });
  }
}
console.log('=== 生产代码零引用的导出符号 ===');
if (!rows.length) console.log('(无)');
for (const r of rows) console.log(`  ${r.file}  ${r.name}${r.testRefs ? `  [测试引用 ${r.testRefs}]` : ''}`);

// ---------- 2. CSS 类 ----------
const css = contents.get('src/style/main.css');
const allText = [...contents].filter(([g]) => g.endsWith('.ts') || g === 'index.html')
  .map(([, u]) => u).join('\n');
const classRe = /\.([a-z][a-z0-9-]*)/g;
const classes = new Set();
for (const m of css.matchAll(classRe)) classes.add(m[1]);
const unusedCss = [];
for (const c of classes) {
  // 只检查我们自己写的类名（跳过 font-face/url/十六进制色值等误匹配）
  if (countWord(allText, c) === 0) unusedCss.push(c);
}
console.log('\n=== CSS 里零引用的类名（含响应式/伪类选择器）===');
if (!unusedCss.length) console.log('(无)');
else console.log('  ' + unusedCss.join(', '));

console.log('\n=== 未被任何模块导入的 src 文件（孤儿模块）===');
const specRe = /(?:from|import)\s*\(?\s*['"]([^'"]+)['"]/g;
const importedFiles = new Set();
for (const [g, u] of contents) {
  if (!g.endsWith('.ts')) continue;
  const dir = path.posix.dirname(g);
  for (const m of u.matchAll(specRe)) {
    const spec = m[1];
    if (!spec.startsWith('.')) continue;   // 只解析相对导入
    const resolved = path.posix.normalize(path.posix.join(dir, spec));
    importedFiles.add(resolved);
    importedFiles.add(resolved + '.ts');
    importedFiles.add(resolved + '/index.ts');
  }
}
const orphan = [];
for (const f of srcFiles.filter(x => x.endsWith('.ts'))) {
  if (f === 'src/main.ts' || f.endsWith('.d.ts')) continue;
  if (!importedFiles.has(f)) orphan.push(f);
}
if (!orphan.length) console.log('(无)');
else console.log('  ' + orphan.join(', '));

// ---------- 3. 资源文件是否被引用 ----------
const assets = walk('assets', ['.png']).map(p => p.replace(/^assets\//, ''));
const unusedAssets = [];
for (const a of assets) {
  const base = a.split('/').pop();
  const stem = base.replace(/\.png$/, '');
  const referenced = contents.get('src/main.ts').includes(stem) || allText.includes(stem) ||
    allText.includes(a) || allText.includes(`../assets/${a}`);
  if (!referenced) unusedAssets.push(a);
}
console.log('\n=== 未被代码引用的资源（按文件名主干匹配，glob 动态导入的目录可能误报）===');
if (!unusedAssets.length) console.log('(无)');
else console.log('  ' + unusedAssets.join(', '));
