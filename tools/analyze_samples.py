import zlib, os, json, sys

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(HERE)  # 仓库根（Web/）
SAMPLE = lambda f: os.path.join(ROOT, 'references/save/sample', f)

src = open(os.path.join(HERE, 'analyze_save.py'), encoding='utf-8').read().split("assert s.startswith")[0]
ns = {'__file__': os.path.join(HERE, 'analyze_save.py')}  # exec 的代码头依赖 __file__
exec(src, ns)

FILES = {
    'ghost':   SAMPLE('ghost_initial.jkr'),
    'painted': SAMPLE('painted_initial.jkr'),
    'nebula':  SAMPLE('nebula_initial.jkr'),
    'red':     SAMPLE('red_initial.jkr'),
    'red_jokers': SAMPLE('red_round1_jokers.jkr'),
    'magic':   SAMPLE('magic_initial.jkr'),
}

def parse_file(path):
    data = open(path, 'rb').read()
    s = zlib.decompress(data, -15).decode('latin-1')
    t, _ = ns['parse_table'](s, len('return '))
    return t

for name, path in FILES.items():
    t = parse_file(path)
    g = t['GAME']
    ca = t['cardAreas']
    print(f'===== {name} ({os.path.basename(path)}) =====')
    print(' BACK:', t['BACK']['key'], '| STATE:', t['STATE'], '| round:', g['round'],
          '| ante:', g['round_resets']['ante'], '| VERSION:', t['VERSION'])
    sp = g['starting_params']
    print(' starting_params:', {k: sp[k] for k in ['dollars','hands','discards','hand_size','joker_slots','consumable_slots','reroll_cost']})
    print(' round_resets.h/d:', g['round_resets']['hands'], g['round_resets']['discards'],
          '| current_round:', g['current_round']['hands_left'], g['current_round']['discards_left'])
    print(' dollars:', g['dollars'], '| spectral_rate:', g['spectral_rate'],
          '| tarot/planet_rate:', g['tarot_rate'], g['planet_rate'], '| shop:', g['shop'])
    print(' used_vouchers:', g['used_vouchers'])
    print(' modifiers:', g.get('modifiers'))
    print(' areas: deck=%d hand=%d jokers=%d consumeables=%d' % (
        len(ca['deck']['cards']), len(ca['hand']['cards']),
        len(ca['jokers']['cards']), len(ca['consumeables']['cards'])))
    print(' limits: hand=%s jokers=%s consumeables=%s deck=%s' % (
        ca['hand']['config']['card_limit'], ca['jokers']['config']['card_limit'],
        ca['consumeables']['config']['card_limit'], ca['deck']['config']['card_limit']))
    print(' starting_deck_size:', g['starting_deck_size'], '| blind_states:', g['round_resets']['blind_states'])
    # 牌堆构成统计
    suits = {}
    for c in ca['deck']['cards'].values():
        s = c['save_fields']['card'][:1]
        r = c['save_fields']['card'][2:]
        suits[s] = suits.get(s, 0) + 1
    ranks = sorted(set(c['save_fields']['card'][2:] for c in ca['deck']['cards'].values()))
    print(' suits:', suits, '| ranks:', ranks)
    print()

# 消耗品完整结构（魔法/幽灵）
for name in ['magic', 'ghost']:
    t = parse_file(FILES[name])
    cards = t['cardAreas']['consumeables']['cards']
    print(f'===== {name} 消耗品完整结构 =====')
    for idx, c in (cards.items() if isinstance(cards, dict) else enumerate(cards)):
        print(f' -- card[{idx}] --')
        print(json.dumps({k: v for k, v in c.items()}, ensure_ascii=False, indent=1, default=str)[:2600])
    print()

# 小丑完整结构
t = parse_file(FILES['red_jokers'])
print('===== red_jokers 小丑完整结构 =====')
for idx, c in t['cardAreas']['jokers']['cards'].items():
    print(f' -- joker[{idx}] --')
    print(json.dumps(c, ensure_ascii=False, indent=1, default=str)[:3200])
print()
print('red_jokers 其它字段: round=', t['GAME']['round'], 'hands=', t['GAME']['current_round']['hands_left'])
