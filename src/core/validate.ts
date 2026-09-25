// 生成前结构断言（PROJECT_SPEC.md 5.8）：断言失败直接抛错，不产出文件
import { LuaTable } from './luaTable';
import { EDITIONS } from '../data/cardMods';
import { EDITION_VALUE_FIELD } from './saveDeck';

function need(cond: unknown, msg: string): void {
  if (!cond) throw new Error(`存档校验失败: ${msg}`);
}

export function validateSave(root: LuaTable): void {
  need(root.get('STATE') === 7, 'STATE 应为 7（盲注选择界面）');
  need(root.get('VERSION') === '1.0.1o-FULL', 'VERSION 应为 1.0.1o-FULL');

  const game = root.get('GAME');
  need(game instanceof LuaTable, '缺少 GAME 表');
  const g = game as LuaTable;
  need(g.get('round') === 0, 'GAME.round 应为 0');
  const rr = g.get('round_resets') as LuaTable;
  need(rr instanceof LuaTable && rr.get('ante') === 1, 'round_resets.ante 应为 1（起始底注未开放）');
  const blindAnte = rr.get('blind_ante');
  need(blindAnte === undefined || blindAnte === rr.get('ante'),
    `round_resets.blind_ante(${blindAnte}) 应与 ante(${rr.get('ante')}) 一致`);

  // 赌注（v0.3）：等级与效果字段必须自洽
  const stake = g.get('stake');
  need(stake === Math.trunc(stake as number) && (stake as number) >= 1 && (stake as number) <= 8,
    `GAME.stake 应为 1-8 整数（当前 ${stake}）`);
  const backC = ((root.get('BACK') as LuaTable).get('effect') as LuaTable).get('center') as LuaTable;
  const sbk = g.get('selected_back_key') as LuaTable;
  need(backC.get('stake') === stake && sbk.get('stake') === stake,
    'BACK.effect.center.stake 与 GAME.selected_back_key.stake 应与 GAME.stake 一致');
  if ((stake as number) >= 5) {
    const d1 = (g.get('starting_params') as LuaTable).get('discards');
    const d2 = rr.get('discards');
    const d3 = (g.get('current_round') as LuaTable).get('discards_left');
    need(d1 === d2 && d2 === d3, `蓝注及以上弃牌数应三处同步（${d1}/${d2}/${d3}）`);
  }

  const areas = root.get('cardAreas') as LuaTable;
  need(areas instanceof LuaTable, '缺少 cardAreas 表');
  for (const name of ['jokers', 'consumeables', 'deck', 'play', 'hand', 'discard']) {
    need(areas.get(name) instanceof LuaTable, `缺少牌区 ${name}`);
  }
  const deck = areas.get('deck') as LuaTable;
  const cards = deck.get('cards') as LuaTable;
  const deckCfg = deck.get('config') as LuaTable;
  const n = cards.entries.size;
  need(n > 0, '牌堆不能为空');
  need(g.get('starting_deck_size') === n, `starting_deck_size(${g.get('starting_deck_size')}) 应等于牌堆张数(${n})`);
  need(deckCfg.get('card_limit') === n && deckCfg.get('temp_limit') === n, 'deck 区 card_limit/temp_limit 应等于牌堆张数');

  // 版本（v1.2）：互斥单值 —— 恰好一个标记为 true、type 与之一致、数值项取自中心 config.extra
  for (const [, node] of cards.entries) {
    const ed = (node as LuaTable).get('edition');
    if (ed === undefined) continue;
    need(ed instanceof LuaTable, 'edition 应为表');
    const et = ed as LuaTable;
    const marked = EDITIONS.map(e => e.key).filter(k => et.get(k) === true);
    need(marked.length === 1, `edition 应恰好标记一个版本（当前 ${marked.length} 个）`);
    need(marked[0] !== 'negative', '扑克牌不应有负片版本（负片仅作用于小丑与消耗品，游戏内扑克牌无法获得）');
    need(et.get('type') === marked[0], `edition.type(${et.get('type')}) 应与标记(${marked[0]}) 一致`);
    const def = EDITIONS.find(e => e.key === marked[0])!;
    const field = EDITION_VALUE_FIELD[marked[0]];
    if (field) {
      need(et.get(field) === def.config.extra,
        `${marked[0]} 的 ${field}(${et.get(field)}) 应等于中心 config.extra(${def.config.extra})`);
    }
  }

  // 槽位数（v1.1）：starting_params 与对应牌区容量必须同步（读档时游戏不再从 starting_params 派生）。
  // jokers / consumeables 的 card_limit 还要 +负片张数（card.lua:405-417），在各区单列断言
  const sp = g.get('starting_params') as LuaTable;

  // 小丑牌区（v2）：结构按附录 D.3；版本含 闪箔/镭射/多彩/负片；card_limit = 槽位数 + 负片张数
  const jokerArea = areas.get('jokers') as LuaTable;
  const jokerCards = jokerArea.get('cards') as LuaTable;
  const jokerCfg = jokerArea.get('config') as LuaTable;
  need(jokerCfg.get('card_count') === jokerCards.entries.size, 'jokers.card_count 应等于实际张数');
  {
    let prevJRank = 0;
    let jokerNegCount = 0;
    for (const [, node] of jokerCards.entries) {
      const t = node as LuaTable;
      const sf = t.get('save_fields');
      need(sf instanceof LuaTable && typeof (sf as LuaTable).get('center') === 'string'
        && String((sf as LuaTable).get('center')).startsWith('j_'),
        '小丑 save_fields.center 应为 j_* key');
      need(t.get('added_to_deck') === true, '小丑 added_to_deck 应为 true');
      const rank = t.get('rank');
      need(rank === prevJRank + 1, `小丑 rank 应连续 1..n（当前 ${rank}）`);
      prevJRank = rank as number;
      // 贴纸（card.lua:506-523）：永恒/易腐互斥；租用令 cost=1（set_cost）且售价 = max(1, floor/2)，
      // 此时 base_cost（中心定义价）≠ cost 是预期行为
      const jokerAbility = t.get('ability') as LuaTable;
      need(jokerAbility instanceof LuaTable, '小丑 ability 应为表');
      const eternal = jokerAbility.get('eternal') === true;
      const perishable = jokerAbility.get('perishable') === true;
      const rental = jokerAbility.get('rental') === true;
      need(!(eternal && perishable), '小丑不应同时带永恒与易腐贴纸（card.lua:508/515 互斥）');
      if (perishable) {
        need(jokerAbility.get('perish_tally') === 5,
          `易腐小丑 perish_tally(${jokerAbility.get('perish_tally')}) 应为开局值 5（G.GAME.perishable_rounds）`);
      }
      if (rental) {
        need(t.get('cost') === 1, `租用小丑 cost(${t.get('cost')}) 应为 1（card.lua:381 set_cost）`);
        need(t.get('sell_cost') === 1, `租用小丑 sell_cost(${t.get('sell_cost')}) 应为 1（card.lua:382）`);
      } else {
        need(t.get('base_cost') === t.get('cost'), '小丑 base_cost 应等于 cost（租用小丑例外，cost=1）');
      }
      const ed = t.get('edition');
      if (ed !== undefined) {
        need(ed instanceof LuaTable, '小丑 edition 应为表');
        const et = ed as LuaTable;
        const marked = EDITIONS.map(e => e.key).filter(k => et.get(k) === true);
        need(marked.length === 1, `小丑 edition 应恰好标记一个版本（当前 ${marked.length} 个）`);
        need(et.get('type') === marked[0], `小丑 edition.type(${et.get('type')}) 应与标记(${marked[0]}) 一致`);
        const edDef = EDITIONS.find(e => e.key === marked[0])!;
        const field = EDITION_VALUE_FIELD[marked[0]];
        if (field) {
          need(et.get(field) === edDef.config.extra,
            `小丑版本 ${marked[0]} 的 ${field}(${et.get(field)}) 应等于中心 config.extra(${edDef.config.extra})`);
        }
        if (marked[0] === 'negative') jokerNegCount++;
      }
    }
    const jokerSlots = sp.get('joker_slots') as number;
    const jokerLimit = jokerCfg.get('card_limit') as number;
    need(jokerLimit === jokerSlots + jokerNegCount,
      `jokers.card_limit(${jokerLimit}) 应为 槽位数(${jokerSlots}) + 负片张数(${jokerNegCount})`);
    need(jokerCfg.get('temp_limit') === Math.max(jokerCards.entries.size, jokerLimit),
      `jokers.temp_limit(${jokerCfg.get('temp_limit')}) 应为 max(张数, card_limit)（cardarea.lua:266）`);
    need(jokerCards.entries.size - jokerNegCount <= jokerSlots,
      `非负片小丑张数(${jokerCards.entries.size - jokerNegCount}) 不应超过槽位数(${jokerSlots})`);
  }

  // 消耗牌区（v2）：结构按附录 D，版本仅负片；card_limit = 槽位数 + 负片张数
  const consArea = areas.get('consumeables') as LuaTable;
  const consCards = consArea.get('cards') as LuaTable;
  const consCfg = consArea.get('config') as LuaTable;
  need(consCfg.get('card_count') === consCards.entries.size,
    'consumeables.card_count 应等于实际张数');
  let prevRank = 0;
  let negativeCount = 0;
  for (const [, node] of consCards.entries) {
    const t = node as LuaTable;
    const sf = t.get('save_fields');
    need(sf instanceof LuaTable && typeof (sf as LuaTable).get('center') === 'string'
      && String((sf as LuaTable).get('center')).startsWith('c_'),
      '消耗牌 save_fields.center 应为 c_* key');
    need(t.get('base_cost') === t.get('cost'), '消耗牌 base_cost 应等于 cost');
    need(t.get('sell_cost') === Math.floor((t.get('cost') as number) / 2),
      `消耗牌 sell_cost(${t.get('sell_cost')}) 应为 floor(cost/2)`);
    need(t.get('added_to_deck') === true, '消耗牌 added_to_deck 应为 true');
    const rank = t.get('rank');
    need(rank === prevRank + 1, `消耗牌 rank 应连续 1..n（当前 ${rank}）`);
    prevRank = rank as number;
    const ed = t.get('edition');
    if (ed !== undefined) {
      need(ed instanceof LuaTable, '消耗牌 edition 应为表');
      const et = ed as LuaTable;
      need(et.get('negative') === true && et.get('type') === 'negative',
        '消耗牌仅支持负片版本（edition 应为 negative/type）');
      negativeCount++;
    }
  }
  const consSlots = sp.get('consumable_slots') as number;
  const consLimit = consCfg.get('card_limit') as number;
  need(consLimit === consSlots + negativeCount,
    `consumeables.card_limit(${consLimit}) 应为 槽位数(${consSlots}) + 负片张数(${negativeCount})`);
  need(consCfg.get('temp_limit') === Math.max(consCards.entries.size, consLimit),
    `consumeables.temp_limit(${consCfg.get('temp_limit')}) 应为 max(张数, card_limit)（cardarea.lua:266）`);
  need(consCards.entries.size - negativeCount <= consSlots,
    `非负片消耗牌张数(${consCards.entries.size - negativeCount}) 不应超过槽位数(${consSlots})`);

  const back = root.get('BACK') as LuaTable;
  need(back instanceof LuaTable && typeof back.get('name') === 'string' && back.get('name') !== '', 'BACK.name 不能为空（游戏按名称查牌组）');
  need(sbk.get('key') === back.get('key'), 'GAME.selected_back_key（center 表）的 key 应与 BACK.key 一致');
}
