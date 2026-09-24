import re, sys, os

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(HERE)  # 仓库根（Web/）

# 用法: python tools/analyze_save.py <解码后的 .lua 转储>
# 默认指向仓库外工作区的 Save/dec/save_dec.lua（个人转储，不入库）
path = sys.argv[1] if len(sys.argv) > 1 else os.path.join(ROOT, '..', 'Save', 'dec', 'save_dec.lua')
s = open(path, encoding='utf-8').read()

def parse_table(s, pos):
    """Parse a Lua table literal starting at s[pos]=='{'. Returns (dict, new_pos)."""
    assert s[pos] == '{'
    pos += 1
    out = {}
    while True:
        while s[pos] in ' \t\r\n,': pos += 1
        if s[pos] == '}': return out, pos + 1
        assert s[pos] == '[', f'expected key at {pos}: {s[pos:pos+30]!r}'
        pos += 1
        if s[pos] == '"':
            key, pos = parse_string(s, pos)
        else:
            m = re.match(r'-?\d+', s[pos:])
            key = int(m.group(0)); pos += m.end()
        assert s[pos] == ']'; pos += 1
        assert s[pos] == '='; pos += 1
        if s[pos] == '{':
            val, pos = parse_table(s, pos)
        elif s[pos] == '"':
            val, pos = parse_string(s, pos)
        else:
            m = re.match(r'-?\d+\.?\d*(?:e[-+]?\d+)?|true|false', s[pos:])
            t = m.group(0)
            val = t if t in ('true', 'false') else (float(t) if ('.' in t or 'e' in t) else int(t))
            pos += m.end()
        out[key] = val

def parse_string(s, pos):
    assert s[pos] == '"'
    pos += 1
    buf = []
    while True:
        c = s[pos]
        if c == '\\':
            n = s[pos + 1]
            if n == '\n': buf.append('\n'); pos += 2  # Lua %q newline escape
            elif n in ('"', '\\', '\n'): buf.append(n); pos += 2
            elif n == 'r': buf.append('\r'); pos += 2
            elif n == 'n': buf.append('\n'); pos += 2
            elif n.isdigit():
                m = re.match(r'\d+', s[pos + 1:]); buf.append(chr(int(m.group(0)))); pos += 1 + m.end()
            else: buf.append(n); pos += 2
        elif c == '"':
            return ''.join(buf), pos + 1
        else:
            buf.append(c); pos += 1

assert s.startswith('return ')
t, _ = parse_table(s, len('return '))

def brief(v, depth=0):
    if isinstance(v, dict):
        if depth == 0: return '{' + ', '.join(f'{k}: {brief(x, depth+1)}' for k, x in list(v.items())[:40]) + '}'
        kk = list(v.keys())
        return '{' + ', '.join(str(k) for k in kk[:12]) + ('...' if len(kk) > 12 else '') + '}'
    if isinstance(v, str): return repr(v[:60])
    if isinstance(v, list): return f'[{len(v)} items]'
    return str(v)

print('TOP:', brief(t))
print()
print('GAME keys:', list(t['GAME'].keys()))
print()
game = t['GAME']
for k in ['dollars', 'hands', 'discards', 'ante', 'round', 'blind', 'current_round', 'joker_buffer', 'starting_deck', 'selected_back', 'seed', 'hashed_seed', 'challenge', 'stake', 'vouchers', 'used_vouchers', 'banked_at_round', 'fast_mod', 'comments', 'reserve_billing_text', 'seed_string']:
    if k in game: print(f'GAME.{k} =', brief(game[k], 0 if not isinstance(game[k], dict) else 1))
print()
print('GAME.blind:', game.get('blind'))
print('GAME.current_round:', game.get('current_round'))
print('BACK:', brief(t['BACK']))
print('BLIND:', brief(t['BLIND']))
print('cardAreas keys:', list(t['cardAreas'].keys()))
for k, v in t['cardAreas'].items():
    print(f'  cardAreas.{k}: {len(v.get("cards", {}))} cards, config={ {kk: vv for kk, vv in v.get("config", {}).items() if kk != "card_count"} }')
print('tags:', t.get('tags'))
print('STATE:', t.get('STATE'))
