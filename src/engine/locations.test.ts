import { describe, expect, it } from 'vitest';
import { getCard } from '../cards/registry';
import { legalActions } from './ai';
import { Game } from './game';

function game() {
  const g = Game.create({ decks: [Array(30).fill('CS2_182'), Array(30).fill('CS2_182')], classes: ['WARLOCK', 'MAGE'], names: ['A', 'B'], ai: [false, false], first: 0, seed: 91 });
  g.apply({ type: 'mulligan', player: 0, replace: [] });
  g.apply({ type: 'mulligan', player: 1, replace: [] });
  for (const p of g.s.players) { p.hand = []; p.mana = p.maxMana = 10; }
  return g;
}
function play(g: Game, id: string) {
  const card = g.newHandCard(id);
  g.me.hand.push(card);
  g.me.mana = 10;
  expect(g.apply({ type: 'play', handUid: card.uid })).toBe(true);
  return card;
}
function round(g: Game) {
  expect(g.apply({ type: 'endTurn' })).toBe(true);
  expect(g.apply({ type: 'endTurn' })).toBe(true);
}

describe('地標共用規則', () => {
  it.each([['JAIL_511', 2], ['JAIL_877', 2], ['JAIL_887', 3], ['JAIL_987', 3]] as const)('%s 是有正確耐久的地標，可立即啟動', (id, health) => {
    const g = game();
    play(g, id);
    if (id === 'JAIL_887') g.me.hand.push(g.newHandCard('CS2_182'));
    expect(getCard(id)).toMatchObject({ type: 'LOCATION', health });
    expect(g.me.board).toHaveLength(0);
    expect(g.me.locations).toHaveLength(1);
    expect(g.canUseLocation(g.me.locations![0].uid).ok).toBe(true);
    expect(legalActions(g)).toContainEqual({ type: 'useLocation', uid: g.me.locations![0].uid });
  });

  it('地標佔七格場地、不能被攻擊／法術指定，且不被手下清場消滅', () => {
    const g = game();
    play(g, 'JAIL_877');
    const location = g.me.locations![0];
    for (let i = 0; i < 6; i++) g.me.board.push(g.makeMinion(0, 'CS2_182'));
    expect(g.boardSpaceUsed(0)).toBe(7);
    const extra = g.newHandCard('JAIL_987'); g.me.hand.push(extra);
    expect(g.canPlay(extra.uid).ok).toBe(false);
    extra.cardId = 'CS2_182';
    expect(g.canPlay(extra.uid).ok).toBe(false);
    const fireball = g.newHandCard('CS2_029'); g.me.hand.push(fireball);
    expect(g.check({ type: 'play', handUid: fireball.uid, target: location.uid }).ok).toBe(false);
    expect(g.canAttack(location.uid)).toBe(false);
    play(g, 'JAIL_510'); // 殲滅只作用於手下
    expect(g.me.locations![0]).toMatchObject({ uid: location.uid, durability: 2 });
  });

  it('啟動不花法力，冷卻兩個自己的回合，最後一次移除地標', () => {
    const g = game();
    play(g, 'JAIL_877');
    const location = g.me.locations![0];
    g.me.mana = 0;
    expect(g.apply({ type: 'useLocation', uid: location.uid })).toBe(true);
    expect(g.me.mana).toBe(0);
    expect(location).toMatchObject({ durability: 1, cooldown: 2 });
    expect(g.apply({ type: 'useLocation', uid: location.uid })).toBe(false);
    round(g);
    expect(g.canUseLocation(location.uid).ok).toBe(false);
    round(g);
    expect(g.canUseLocation(location.uid).ok).toBe(true);
    expect(g.apply({ type: 'useLocation', uid: location.uid })).toBe(true);
    expect(g.me.locations).toHaveLength(0);
    expect(g.me.board.filter((m) => m.cardId === 'JAIL_877t')).toHaveLength(2);
  });

  it('非擁有者回合不能啟動地標', () => {
    const g = game(); play(g, 'JAIL_987');
    const uid = g.me.locations![0].uid;
    g.apply({ type: 'endTurn' });
    expect(g.apply({ type: 'useLocation', uid })).toBe(false);
  });
});

describe('四張紫羅蘭堡地標', () => {
  it('孤寂尖塔依手牌數召喚惡魔，立即攻擊敵方手下', () => {
    const g = game(); play(g, 'JAIL_511');
    g.me.hand = Array.from({ length: 5 }, () => g.newHandCard('CS2_182'));
    const enemy = g.makeMinion(1, 'CS2_182'); g.s.players[1].board.push(enemy);
    expect(g.apply({ type: 'useLocation', uid: g.me.locations![0].uid })).toBe(true);
    const demon = g.me.board.find((m) => m.cardId === 'JAIL_511t')!;
    expect(demon).toMatchObject({ baseAtk: 1, atkBuff: 4, maxHp: 5, hp: 1 });
    expect(g.s.players[1].board).toHaveLength(0);
    expect(g.s.players[1].hero.hp).toBe(30);
  });

  it('孤寂尖塔在空手時生成的零生命惡魔會死亡', () => {
    const g = game(); play(g, 'JAIL_511');
    expect(g.apply({ type: 'useLocation', uid: g.me.locations![0].uid })).toBe(true);
    expect(g.me.board).toHaveLength(0);
  });

  it('城底區網路的2/1野獸具有實際抽牌亡語', () => {
    const g = game(); play(g, 'JAIL_877');
    g.apply({ type: 'useLocation', uid: g.me.locations![0].uid });
    const rat = g.me.board[0];
    expect(rat).toMatchObject({ cardId: 'JAIL_877t', baseAtk: 2, maxHp: 1 });
    expect(getCard(rat.cardId).races).toContain('BEAST');
    const fireball = g.newHandCard('CS2_029'); g.me.hand.push(fireball); g.me.mana = 10;
    expect(g.apply({ type: 'play', handUid: fireball.uid, target: rat.uid })).toBe(true);
    expect(g.me.hand.map((h) => h.cardId)).toEqual(['CS2_182']);
  });

  it('低警戒區的薩滿手下跨回合保持鎖定，必須打另一張牌才解鎖', () => {
    const g = game(); play(g, 'JAIL_987');
    g.apply({ type: 'useLocation', uid: g.me.locations![0].uid });
    const locked = g.me.hand[0];
    expect(getCard(locked.cardId)).toMatchObject({ type: 'MINION', cardClass: 'SHAMAN' });
    expect(g.canPlay(locked.uid).ok).toBe(false);
    round(g);
    expect(locked.locationLocked).toBe(true);
    play(g, 'GAME_005');
    expect(locked.locationLocked).toBe(false);
    g.me.mana = 10;
    expect(g.canPlay(locked.uid).ok).toBe(true);
  });

  it('舒拉邁特的牢獄必須棄牌，第三次啟動釋放舒拉邁特並免費重播', () => {
    const g = game(); play(g, 'JAIL_887');
    const location = g.me.locations![0];
    expect(g.canUseLocation(location.uid).ok).toBe(false);
    for (let i = 0; i < 3; i++) {
      g.me.hand = [g.newHandCard('CS2_182')];
      expect(g.apply({ type: 'useLocation', uid: location.uid })).toBe(true);
      expect(g.s.pendingChoice?.options).toEqual(['CS2_182']);
      expect(g.apply({ type: 'choose', index: 0 })).toBe(true);
      expect(g.me.hand).toHaveLength(0);
      expect(g.me.board.filter((m) => m.cardId === 'JAIL_887t3')).toHaveLength(i + 1);
      if (i < 2) { round(g); round(g); }
    }
    expect(g.me.locations).toHaveLength(0);
    const zuramat = g.me.board.find((m) => m.cardId === 'JAIL_887t2')!;
    expect(zuramat).toMatchObject({ baseAtk: 8, maxHp: 8 });
    expect(zuramat.prisonCards).toHaveLength(3);
    g.me.mana = 0;
    g.apply({ type: 'endTurn' });
    expect(g.s.players[0].board.filter((m) => m.cardId === 'CS2_182')).toHaveLength(1);
    expect(g.s.players[0].mana).toBe(0);
  });

  it('舒拉邁特重播戰吼不要求手牌空位或法力', () => {
    const g = game();
    const m = g.makeMinion(0, 'JAIL_887t2');
    m.prisonCards = [g.newHandCard('CS2_189')]; // 精靈弓箭手的戰吼
    g.me.board.push(m);
    g.me.hand = Array.from({ length: 10 }, () => g.newHandCard('CS2_182'));
    g.me.mana = 0;
    g.apply({ type: 'endTurn' });
    expect(g.s.players[0].hand).toHaveLength(10);
    expect(g.s.players[0].board.some((x) => x.cardId === 'CS2_189')).toBe(true);
    const damaged = g.s.players.flatMap((p) => [p.hero, ...p.board]).some((c) => c.hp < ('maxHp' in c ? c.maxHp : 30));
    expect(damaged).toBe(true);
  });

  it('舒拉邁特免費施放棄掉的法術，隨機選擇合法目標', () => {
    const g = game();
    const zuramat = g.makeMinion(0, 'JAIL_887t2');
    zuramat.prisonCards = [g.newHandCard('CS2_029')];
    g.me.board.push(zuramat);
    g.me.mana = 0;
    const before = g.s.players[0].hero.hp + g.s.players[1].hero.hp + zuramat.hp;
    expect(g.apply({ type: 'endTurn' })).toBe(true);
    expect(g.s.pendingChoice).toBeNull();
    expect(g.s.players[0].mana).toBe(0);
    expect(g.s.players[0].spellsCastThisGame).toBe(1);
    expect(g.s.players[0].hero.hp + g.s.players[1].hero.hp + zuramat.hp).toBe(before - 6);
  });


  it('複製舒拉邁特時保留牢獄棄牌效果，但資料不共用可變陣列', () => {
    const g = game();
    const source = g.makeMinion(0, 'JAIL_887t2');
    source.prisonCards = [g.newHandCard('CS2_182')];
    source.keywords.push('REBORN');
    g.me.board.push(source);
    const specialist = g.newHandCard('CAP_804'); g.me.hand.push(specialist);
    expect(g.apply({ type: 'play', handUid: specialist.uid, target: source.uid })).toBe(true);
    const copy = g.me.board.find((m) => m.cardId === source.cardId && m.uid !== source.uid)!;
    expect(copy.prisonCards).toEqual(source.prisonCards);
    expect(copy.prisonCards).not.toBe(source.prisonCards);
  });

});
