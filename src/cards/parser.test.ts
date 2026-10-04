import { describe, expect, it } from 'vitest';
import { parseCardText, parsePool, Unsupported, type ParseEnv } from './parser';
import type { CardType } from '../engine/types';

const env: ParseEnv = { findToken: (q) => `TOKEN:${q.name}:${q.atk ?? ''}/${q.hp ?? ''}` };
const parse = (textEn: string, cardType: CardType = 'MINION') => parseCardText({ textEn, cardType }, env);

describe('卡牌敘述解析', () => {
  it('distinguishes explicit any-class and other-class generation', () => {
    expect(parsePool('a 1-Cost spell from any class')).toMatchObject({ type: 'SPELL', cost: 1, anyClass: true });
    expect(parsePool('a spell from another class')).toMatchObject({ type: 'SPELL', otherClass: true });
  });
  it('戰吼造成傷害：可選目標', () => {
    const r = parse('<b>Battlecry:</b> Deal 3 damage.');
    expect(r.abilities[0].on).toEqual({ k: 'play' });
    expect(r.abilities[0].effects[0]).toMatchObject({ e: 'damage', target: { t: 'chosen' }, amount: 3 });
    expect(r.target).toEqual({ filter: { type: 'character', side: 'any' }, optional: true });
  });

  it('法術傷害標記 $ 會受法術傷害加成', () => {
    const r = parse('Deal $6 damage.', 'SPELL');
    expect(r.abilities[0].effects[0]).toMatchObject({ e: 'damage', amount: 6, spell: true });
    expect(r.target?.optional).toBeUndefined();
  });

  it('橫掃：主要目標與其他敵人', () => {
    const r = parse('Deal $4 damage to an enemy and $1 damage to all other enemies.', 'SPELL');
    const [a, b] = r.abilities[0].effects;
    expect(a).toMatchObject({ e: 'damage', amount: 4, target: { t: 'chosen' } });
    expect(b).toMatchObject({ e: 'damage', amount: 1, target: { t: 'all', filter: { side: 'enemy', excludeChosen: true } } });
    expect(r.target?.filter).toEqual({ type: 'character', side: 'enemy' });
  });

  it('連擊「改為」會讓原本效果只在沒有連擊時觸發', () => {
    const r = parse('Deal $2 damage. <b>Combo:</b> Deal $4 damage instead.', 'SPELL');
    expect(r.abilities[0].cond).toEqual({ c: 'not', cond: { c: 'combo' } });
    expect(r.abilities[1].cond).toEqual({ c: 'combo' });
    expect(r.abilities[1].effects[0]).toMatchObject({ amount: 4 });
  });

  it('光環與關鍵字', () => {
    const r = parse('<b>Taunt</b>\nYour other minions have +1/+1.');
    expect(r.keywords).toEqual(['TAUNT']);
    expect(r.auras).toEqual([{ scope: 'otherFriendly', atk: 1, hp: 1 }]);
  });

  it('召喚衍生卡', () => {
    const r = parse('<b>Deathrattle:</b> Summon two 2/3 Spirit Wolves with <b>Taunt</b>.');
    expect(r.abilities[0].effects[0]).toMatchObject({ e: 'summon', count: 2, card: 'TOKEN:Spirit Wolves:2/3' });
  });

  it('觸發型能力中的「另一個友方手下」視為隨機', () => {
    const r = parse('At the end of your turn, give another friendly minion +2/+2.');
    expect(r.abilities[0].effects[0]).toMatchObject({ target: { t: 'random', count: 1, filter: { side: 'friendly', excludeSelf: true } } });
    expect(r.target).toBeUndefined();
  });

  it('條件式戰吼', () => {
    const r = parse("<b>Battlecry:</b> If you're holding a Dragon, deal 3 damage.");
    expect(r.abilities[0].effects[0]).toMatchObject({ e: 'cond', cond: { c: 'holding', race: 'DRAGON' } });
    expect(r.target?.when).toEqual({ c: 'holding', race: 'DRAGON' });
  });

  it('激怒、費用規則、潛行一回合', () => {
    expect(parse('Has +3 Attack while damaged.').enrage).toEqual({ atk: 3 });
    expect(parse("Costs (1) less for each Beast you've summoned this game.").costRule).toEqual({ per: 'summonedRace', amount: 1, race: 'BEAST' });
    const st = parse('<b>Stealth</b> for 1 turn.');
    expect(st.abilities[0].effects[0]).toMatchObject({ e: 'buff', keywords: ['STEALTH'], untilNextTurn: true });
  });

  it('已腐化版本的 Corrupted 顯示標記不會被當成效果', () => {
    const r = parse('<b>Corrupted</b>\n<b>Battlecry:</b> Draw a card.');
    expect(r.abilities[0].on).toEqual({ k: 'play' });
    expect(r.abilities[0].effects[0]).toMatchObject({ e: 'draw', count: 1, who: 'self' });
  });

  it('榮譽擊殺會解析成獨立的精準致死觸發', () => {
    const r = parse('<b>Honorable Kill:</b> Gain +2 Attack.');
    expect(r.abilities[0].on).toEqual({ k: 'honorableKill' });
    expect(r.abilities[0].effects[0]).toMatchObject({ e: 'buff', target: { t: 'self' }, atk: 2 });
  });

  it('紫羅蘭堡通用卡池、條件與群體目標', () => {
    expect(parsePool('a spell that costs (5) or more')).toEqual({ type: 'SPELL', minCost: 5 });

    const summon = parse('Summon a 2-Cost Taunt minion.', 'SPELL');
    expect(summon.abilities[0].effects[0]).toMatchObject({
      e: 'summonRandom',
      count: 1,
      pool: { type: 'MINION', cost: 2, keyword: 'TAUNT' },
    });

    const deckSize = parse('Battlecry: If your deck has 25 or more cards, draw a card.');
    expect(deckSize.abilities[0].effects[0]).toMatchObject({ e: 'cond', cond: { c: 'deckSize', op: '>=', n: 25 } });

    const noNeutral = parse('Battlecry: If your deck has no Neutral cards, draw a card.');
    expect(noNeutral.abilities[0].effects[0]).toMatchObject({ e: 'cond', cond: { c: 'deckNoNeutral' } });

    const group = parse('Battlecry: Give your damaged minions +1/+2.');
    expect(group.abilities[0].effects[0]).toMatchObject({ e: 'buff', target: { t: 'all', filter: { side: 'friendly', damaged: true } } });

    const aura = parse('All friendly minions are Poisonous.');
    expect(aura.auras).toEqual([{ scope: 'friendlyMinions', keywords: ['POISONOUS'] }]);
  });

  it('看不懂的敘述會回報不支援', () => {
    expect(() => parse('Swap your hand with your opponent\'s hand.')).toThrow(Unsupported);
    expect(() => parse('<b>Battlecry:</b> Do something weird.')).toThrow(Unsupported);
  });
});
