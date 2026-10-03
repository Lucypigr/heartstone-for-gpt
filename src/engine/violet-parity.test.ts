import { describe, expect, it } from 'vitest';
import { getCard } from '../cards/registry';
import { Game } from './game';

function game() {
  const g = Game.create({ decks: [Array(30).fill('CS2_182'), Array(30).fill('CS2_182')], classes: ['ROGUE', 'PRIEST'], names: ['A', 'B'], ai: [false, false], seed: 17, first: 0 });
  g.apply({ type: 'mulligan', player: 0, replace: [] });
  g.apply({ type: 'mulligan', player: 1, replace: [] });
  g.me.hand = [];
  g.me.mana = g.me.maxMana = 10;
  return g;
}
function give(g: Game, id: string) {
  const h = g.newHandCard(id);
  g.me.hand.push(h);
  return h;
}
function put(g: Game, id: string, owner: 0 | 1) {
  const m = g.makeMinion(owner, id);
  m.sleeping = false;
  g.s.players[owner].board.push(m);
  g.recalcAuras();
  return m;
}

describe('紫羅蘭堡官方卡面回歸', () => {
  it.each(['CAP_406', 'JAIL_035', 'JAIL_311', 'JAIL_384'])('%s 保留官方嘲諷', (id) => {
    const g = game();
    const guard = put(g, id, 1);
    const attacker = put(g, 'CS2_182', 0);
    expect(g.hasKw(guard, 'TAUNT')).toBe(true);
    expect(g.check({ type: 'attack', attacker: attacker.uid, target: g.s.players[1].hero.uid }).ok).toBe(false);
  });

  it('伊莉妲具有生命竊取，實際攻擊會治療英雄', () => {
    const g = game();
    const m = put(g, 'JAIL_719', 0);
    g.me.hero.hp = 10;
    expect(g.apply({ type: 'attack', attacker: m.uid, target: g.s.players[1].hero.uid })).toBe(true);
    expect(g.me.hero.hp).toBe(10 + g.atkOf(m));
  });

  it('逃脫大師沒有卡面未記載的潛行', () => {
    const g = game();
    const m = put(g, 'JAIL_030', 1);
    const attacker = put(g, 'CS2_182', 0);
    expect(g.hasKw(m, 'STEALTH')).toBe(false);
    expect(g.check({ type: 'attack', attacker: attacker.uid, target: m.uid }).ok).toBe(true);
  });

  it('開鎖人只能對敵方手下造成傷害，零法力時數字為零', () => {
    const g = game();
    const h = give(g, 'JAIL_501');
    const friendly = put(g, 'CS2_182', 0);
    const enemy = put(g, 'CS2_200', 1);
    expect(g.check({ type: 'play', handUid: h.uid, target: g.s.players[1].hero.uid }).ok).toBe(false);
    expect(g.check({ type: 'play', handUid: h.uid, target: friendly.uid }).ok).toBe(false);
    g.me.mana = 0;
    expect(g.costOf(g.me, h)).toBe(0);
    expect(g.handStats(0, h)).toEqual({ atk: 0, hp: 0 });
    expect(g.apply({ type: 'play', handUid: h.uid, target: enemy.uid })).toBe(true);
    expect(enemy.hp).toBe(getCard('CS2_200').health);
  });

  it.each([9, 10])('致命食譜在 %i 顆法力水晶時正確處理兩張牌', (mana) => {
    const g = game();
    g.me.maxMana = g.me.mana = mana;
    g.me.deck = [g.newHandCard('CS2_182'), g.newHandCard('CS2_200')];
    const h = give(g, 'JAIL_866');
    expect(g.apply({ type: 'play', handUid: h.uid })).toBe(true);
    expect(g.me.hand).toHaveLength(2);
    for (const card of g.me.hand) expect([card.atkBuff, card.hpBuff]).toEqual(mana >= 10 ? [3, 3] : [0, 0]);
  });

  it('R4T-C4TCH3R 只抽回曾複製的法術，不抽牌堆頂的手下', () => {
    const g = game();
    g.me.deck = [g.newHandCard('CS2_029')];
    const h = give(g, 'JAIL_882');
    expect(g.apply({ type: 'play', handUid: h.uid })).toBe(true);
    expect(g.me.deck.filter((c) => c.cardId === 'CS2_029')).toHaveLength(2);
    g.me.deck.push(g.newHandCard('CS2_182'));
    const source = g.me.board.find((m) => m.cardId === 'JAIL_882')!;
    const spell = give(g, 'EX1_308'); // 靈魂之火：殺死友方 R4T-C4TCH3R
    g.me.mana = 10;
    expect(g.apply({ type: 'play', handUid: spell.uid, target: source.uid })).toBe(true);
    expect(g.me.hand.some((c) => c.cardId === 'CS2_029')).toBe(true);
    expect(g.me.deck.at(-1)?.cardId).toBe('CS2_182');
  });

  it('滋事者只累積自己在手牌或牌堆期間打出的 2 法力卡', () => {
    const g = game();
    g.me.cardsPlayedForTwoMana = 8; // 取得此卡之前的出牌不應計入
    const watcher = give(g, 'JAIL_470');
    const inDeck = g.newHandCard('JAIL_470');
    g.me.deck = [inDeck];
    const spell = give(g, 'CS2_024'); // 實際支付 2 法力的寒冰箭。
    expect(g.apply({ type: 'play', handUid: spell.uid, target: g.s.players[1].hero.uid })).toBe(true);
    expect(watcher.twoManaCardsSeen).toBe(1);
    expect(inDeck.twoManaCardsSeen).toBe(1);
    const hp = g.s.players[1].hero.hp;
    expect(g.apply({ type: 'play', handUid: watcher.uid })).toBe(true);
    expect(g.s.players[1].hero.hp).toBe(hp - 2);
  });

  it('黑掌鞭索的折扣識別不同造型的幸運幣', () => {
    const g = game();
    const whip = give(g, 'JAIL_503');
    give(g, 'JAIL_COIN1');
    give(g, 'LOE_COIN');
    expect(g.costOf(g.me, whip)).toBe(Math.max(0, getCard('JAIL_503').cost - 2));
  });

  it('阿雅的替代效果也替代玉蓮幫莊家生成的幸運幣', () => {
    const g = game();
    g.me.coinReplacement = 'JAIL_504t';
    const bookie = put(g, 'JAIL_720', 0);
    const spell = give(g, 'CS2_029');
    expect(g.apply({ type: 'play', handUid: spell.uid, target: bookie.uid })).toBe(true);
    expect(g.me.hand.map((h) => h.cardId)).toContain('JAIL_504t');
    expect(g.me.hand.map((h) => h.cardId)).not.toContain('JAIL_COIN1');
  });

  it('卡札克斯傷害藥水使用指定目標與法傷，冰凍只選敵方手下', () => {
    const g = game();
    const mage = put(g, 'CS2_182', 0);
    mage.spellDamage = 2;
    const potion = give(g, 'JAIL_504t3p');
    potion.trialEffects = ['potion_damage', 'potion_freeze'];
    expect(g.check({ type: 'play', handUid: potion.uid }).ok).toBe(false);
    expect(g.apply({ type: 'play', handUid: potion.uid, target: g.s.players[1].hero.uid })).toBe(true);
    expect(g.s.players[1].hero.hp).toBe(25);
    expect(g.s.players[1].hero.frozen).toBe(false);
  });

  it('卡札克斯的2/2惡魔是官方無額外效果的衍生卡', () => {
    const g = game();
    const potion = give(g, 'JAIL_504t3p');
    potion.trialEffects = ['potion_demon22', 'potion_armor'];
    expect(g.apply({ type: 'play', handUid: potion.uid })).toBe(true);
    expect(g.me.board).toHaveLength(1);
    expect(g.me.board[0]).toMatchObject({ cardId: 'CFM_621_m4', baseAtk: 2, baseHp: 2, abilities: [] });
    expect(g.me.hero.armor).toBe(4);
  });

});
