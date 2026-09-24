import zlib, re, os

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(HERE)  # 仓库根（Web/）

src = open(os.path.join(HERE, 'analyze_save.py'), encoding='utf-8').read().split("assert s.startswith")[0]
ns = {'__file__': os.path.join(HERE, 'analyze_save.py')}  # exec 的代码头依赖 __file__
exec(src, ns)

orig = open(os.path.join(ROOT, 'references/save/template.jkr'), 'rb').read()
decomp = zlib.decompress(orig, -15).decode('latin-1')
BS = chr(92)  # backslash

def parse_table(s, pos):
    assert s[pos] == '{'; pos += 1; out = {}
    while True:
        while s[pos] in ' \t\r\n,': pos += 1
        if s[pos] == '}': return out, pos + 1
        assert s[pos] == '['
        pos += 1
        if s[pos] == '"': key, pos = ns['parse_string'](s, pos)
        else:
            m = re.match(r'-?\d+', s[pos:]); key = int(m.group(0)); pos += m.end()
        assert s[pos] == ']'; pos += 1; assert s[pos] == '='; pos += 1
        if s[pos] == '{': val, pos = parse_table(s, pos)
        elif s[pos] == '"': val, pos = ns['parse_string'](s, pos)
        else:
            m = re.match(r'-?\d+\.?\d*(?:e[-+]?\d+)?|true|false', s[pos:])
            t = m.group(0); pos += m.end()
            val = (t == 'true') if t in ('true', 'false') else (float(t) if ('.' in t or 'e' in t) else int(t))
        out[key] = val

t, _ = parse_table(decomp, len('return '))

def fmt(x):
    if isinstance(x, bool): return 'true' if x else 'false'
    if isinstance(x, int): return str(x)
    return '%.14g' % x

def q(s):
    out = ['"']
    for ch in s:
        if ch == '"': out.append(BS + '"')
        elif ch == BS: out.append(BS + BS)
        elif ch == '\n': out.append(BS + '\n')
        elif ch == '\r': out.append(BS + '\r')
        else:
            o = ord(ch)
            if o < 32 or o == 127: out.append(BS + '%03d' % o)
            else: out.append(ch)
    out.append('"'); return ''.join(out)

def pack(d):
    return '{' + ''.join(
        (('[%s]' % q(k)) if isinstance(k, str) else ('[%d]' % k)) + '=' +
        (pack(v) if isinstance(v, dict) else (q(v) if isinstance(v, str) else fmt(v))) + ','
        for k, v in d.items()) + '}'

out_b = ('return ' + pack(t)).encode('latin-1')
a = decomp.encode('latin-1')
print('source byte-identical:', out_b == a, len(a), len(out_b))
comp = zlib.compressobj(1, zlib.DEFLATED, -15)
recomp = comp.compress(out_b) + comp.flush()
print('file byte-identical:', recomp == orig, len(recomp), len(orig))
if out_b != a:
    for i, (x, y) in enumerate(zip(a, out_b)):
        if x != y:
            print('first diff at', i)
            print('orig :', repr(a[max(0,i-50):i+50]))
            print('new  :', repr(out_b[max(0,i-50):i+50]))
            break
