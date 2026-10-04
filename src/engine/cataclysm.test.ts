import { describe, expect, it } from 'vitest';
import { getCard, COLLECTIBLE } from '../cards/registry';
import { Game } from './game';

function game() {
  const g = Game.create({ decks: [Array(30).fill('CS2_182'), Array(30).fill('CS2_182')], classes: ['MAGE', 'SHAMAN'], names: ['A', 'B'], ai: [false, false], first: 0, seed: 41 });
  g.apply({ type: 'mulligan', player: 0, replace: [] });
  g.apply({ type: 'mulligan', player: 1, replace: [] });
  for (const p of g.s.players) { p.hand = []; p.mana = p.maxMana = 10; }
  return g;
}
function play(g: Game, id: string, target?: number) {
  const h = g.newHandCard(id);
  g.me.hand.push(h);
  g.me.mana = 10;
  expect(g.apply({ type: 'play', handUid: h.uid, target })).toBe(true);
}
function choose(g: Game, index: number) {
  expect(g.apply({ type: 'choose', index })).toBe(true);
}

describe('Cataclysm additional card effects', () => {
  it('shuffles five expensive minions with doubled printed stats', () => {
    const g = game(); const ids = new Set(g.me.deck.map((h) => h.uid));
    play(g, 'CATA_136');
    const added = g.me.deck.filter((h) => !ids.has(h.uid));
    expect(added).toHaveLength(5);
    for (const h of added) {
      const c = getCard(h.cardId);
      expect(c.type).toBe('MINION'); expect(c.cost).toBeGreaterThanOrEqual(8);
      expect(h.atkBuff).toBe(c.attack); expect(h.hpBuff).toBe(c.health);
    }
  });

  it('a legendary location enables the one-mana spell, ordinary minions do not', () => {
    const g = game(); const spell = g.newHandCard('CATA_308');
    expect(g.costOf(g.me, spell)).toBe(5);
    play(g, 'JAIL_887'); expect(g.costOf(g.me, spell)).toBe(1);
    g.me.locations = []; g.me.board.push(g.makeMinion(0, 'CS2_182'));
    expect(g.costOf(g.me, spell)).toBe(5);
  });

  it('deathrattle triggers the selected end-turn source with its own context', () => {
    const g = game(); play(g, 'CATA_476'); play(g, 'CATA_472');
    expect(g.me.weapon?.cardId).toBe('CATA_472');
    play(g, 'CS2_106'); // replacing the weapon triggers its deathrattle
    expect(g.me.board.map((m) => m.cardId)).toEqual(['CATA_476', 'CATA_476t']);
  });

  it('location damage uses only this turn Fire spells and ignores Spell Damage', () => {
    const g = game(); play(g, 'CATA_584');
    g.me.board.push(g.makeMinion(0, 'EX1_012'));
    play(g, 'CS2_029', g.s.players[1].hero.uid);
    const before = g.s.players[1].hero.hp;
    const location = g.me.locations![0];
    expect(g.apply({ type: 'useLocation', uid: location.uid })).toBe(true);
    expect(g.s.players[1].hero.hp).toBe(before - 6);
    for (let i = 0; i < 4; i++) g.apply({ type: 'endTurn' });
    expect(g.me.playedCardsThisTurn).toEqual([]);
    const next = g.s.players[1].hero.hp;
    expect(g.apply({ type: 'useLocation', uid: location.uid })).toBe(true);
    expect(g.s.players[1].hero.hp).toBe(next - 3);
  });

  it('Destructive Blaze copies only after surviving and deals deathrattle damage', () => {
    const g = game(); play(g, 'CATA_586');
    const first = g.me.board[0];
    expect(g.apply({ type: 'heroPower', target: first.uid })).toBe(true);
    expect(g.me.board).toHaveLength(2);
    expect(g.me.board[1]).toMatchObject({ cardId: 'CATA_586', hp: 3 });
    play(g, 'CS2_029', first.uid);
    expect(g.me.board).toHaveLength(1);
    expect(g.s.players[1].hero.hp).toBe(28);
  });

  it('granted deathrattle summons a minion from its owner hand without its battlecry', () => {
    const g = game(); const victim = g.makeMinion(0, 'CS2_182'); g.me.board.push(victim);
    const held = g.newHandCard('CATA_200'); held.atkBuff = 2; g.me.hand.push(held);
    play(g, 'CATA_610', victim.uid); play(g, 'CS2_029', victim.uid);
    expect(g.me.board.map((m) => m.cardId)).toEqual(['CATA_200']);
    expect(g.atkOf(g.me.board[0])).toBe(getCard('CATA_200').attack! + 2);
    expect(g.s.pendingChoice).toBeNull(); expect(g.me.hand).toHaveLength(0);
  });

  it('enemy Taunt aura disappears when its source dies', () => {
    const g = game(); const enemy = g.makeMinion(1, 'CS2_182'); g.s.players[1].board.push(enemy);
    play(g, 'CATA_898');
    expect(g['hasKw'](enemy, 'TAUNT')).toBe(true);
    play(g, 'CS2_029', g.me.board[0].uid);
    expect(g['hasKw'](enemy, 'TAUNT')).toBe(false);
  });
  it('transforms the selected physical card into a fresh Coin', () => {
    const g = game();
    const a = g.newHandCard('CS2_182'), b = g.newHandCard('CS2_182');
    b.costMod = -2; b.atkBuff = 4;
    g.me.hand.push(a, b);
    play(g, 'CATA_200'); choose(g, 1);
    expect(g.me.hand[0]).toBe(a);
    expect(g.me.hand[1]).toMatchObject({ cardId: 'GAME_005', costMod: 0, atkBuff: 0 });
    expect(g.me.hand).not.toContain(b);
  });

  it('Chamber selects only minions, buffs the selected copy and consumes durability', () => {
    const g = game();
    const spell = g.newHandCard('CS2_029');
    const a = g.newHandCard('CS2_182'), b = g.newHandCard('CS2_182');
    g.me.hand.push(spell, a, b);
    play(g, 'CATA_477');
    expect(g.apply({ type: 'useLocation', uid: g.me.locations![0].uid })).toBe(true);
    expect(g.s.pendingChoice?.options).toEqual(['CS2_182', 'CS2_182']);
    choose(g, 1);
    expect(a.atkBuff).toBe(0); expect(b.atkBuff).toBe(2); expect(b.hpBuff).toBe(2);
    expect(g.me.locations![0]).toMatchObject({ durability: 1, cooldown: 2 });
  });

  it('copies a selected Fel spell including its enchantments', () => {
    const g = game();
    const def = COLLECTIBLE.find((c) => c.type === 'SPELL' && c.spellSchool === 'FEL')!;
    const fel = g.newHandCard(def.id); fel.costMod = -1;
    g.me.hand.push(g.newHandCard('CS2_182'), fel);
    play(g, 'CATA_697');
    expect(g.s.pendingChoice?.options).toEqual([def.id]); choose(g, 0);
    expect(g.me.hand.at(-1)).toMatchObject({ cardId: def.id, costMod: -1 });
    expect(g.me.hand.at(-1)!.uid).not.toBe(fel.uid);
  });

  it('does not consume Chamber durability when no minion is in hand', () => {
    const g = game(); play(g, 'CATA_477');
    g.me.hand.push(g.newHandCard('CS2_029'));
    const location = g.me.locations![0];
    expect(g.apply({ type: 'useLocation', uid: location.uid })).toBe(false);
    expect(location).toMatchObject({ durability: 2, cooldown: 0 });
  });

  it('shuffles the chosen hand card then draws, including when no card can be chosen', () => {
    const g = game();
    const card = g.newHandCard('CS2_029'); g.me.hand.push(card);
    const n = g.me.deck.length;
    play(g, 'CATA_721'); choose(g, 0);
    expect(g.me.deck.length).toBe(n);
    expect([...g.me.deck, ...g.me.hand].filter((h) => h.uid === card.uid)).toHaveLength(1);
    expect(g.me.hand).toHaveLength(1);
    g.me.hand = [];
    play(g, 'CATA_721');
    expect(g.s.pendingChoice).toBeNull(); expect(g.me.hand).toHaveLength(1);
  });

  it('Blackhorn destroys cheap cards in both decks while preserving both hands', () => {
    const g = game();
    for (const p of g.s.players) {
      p.deck = ['GAME_005', 'CS2_171', 'CS2_029'].map((id) => g.newHandCard(id));
      p.hand = [g.newHandCard('GAME_005')];
    }
    play(g, 'CATA_720');
    for (const p of g.s.players) {
      expect(p.deck.map((h) => h.cardId)).toEqual(['CS2_029']);
      expect(p.hand.map((h) => h.cardId)).toEqual(['GAME_005']);
    }
  });

  it('resolves deaths and deathrattle summons between the three damage waves', () => {
    const g = game();
    g.s.players[1].board.push(g.makeMinion(1, 'EX1_556')); // 2/3 Harvest Golem -> 2/1
    const shielded = g.makeMinion(1, 'CS2_182');
    shielded.hp = shielded.maxHp = 6; shielded.keywords.push('DIVINE_SHIELD');
    g.s.players[1].board.push(shielded);
    play(g, 'CATA_491');
    expect(g.s.players[1].board).toEqual([shielded]);
    expect(shielded.hp).toBe(3);
  });

  it('draws once for each minion killed by the one-damage wave', () => {
    const g = game();
    const mine = g.makeMinion(0, 'CS2_182'), theirs = g.makeMinion(1, 'CS2_182');
    mine.hp = theirs.hp = 1;
    g.me.board.push(mine); g.s.players[1].board.push(theirs);
    play(g, 'CATA_526');
    expect(g.me.hand).toHaveLength(2);
    expect(g.me.board).toHaveLength(0); expect(g.s.players[1].board).toHaveLength(0);
  });

  it('summons the Sigil token only at the next own turn start', () => {
    const g = game(); play(g, 'CATA_528');
    expect(g.me.board).toHaveLength(0);
    g.apply({ type: 'endTurn' }); expect(g.s.players[0].board).toHaveLength(0);
    g.apply({ type: 'endTurn' });
    expect(g.me.board[0]).toMatchObject({ cardId: 'CATA_528t', hp: 3 });
    expect(g.me.board[0].keywords).toContain('TAUNT');
  });

  it('summons random minions in 3/2/1-cost order and applies overload', () => {
    const g = game(); play(g, 'CATA_569');
    expect(g.me.board.map((m) => getCard(m.cardId).cost)).toEqual([3, 2, 1]);
    expect(g.me.overloadOwed).toBe(1);
  });

  it('Nozdormu grants a shield or buffs an already shielded minion', () => {
    const g = game();
    const plain = g.makeMinion(0, 'CS2_182'), shielded = g.makeMinion(0, 'CS2_182');
    shielded.keywords.push('DIVINE_SHIELD'); g.me.board.push(plain, shielded);
    const oldHp = shielded.hp; play(g, 'CATA_473');
    g.apply({ type: 'endTurn' });
    expect(plain.keywords).toContain('DIVINE_SHIELD');
    expect(plain.hp).toBe(getCard(plain.cardId).health);
    expect(shielded.hp).toBe(oldHp + 3);
    expect(shielded.keywords).toContain('DIVINE_SHIELD');
  });

  it('summons a Dragon using the source attack and current health', () => {
    const g = game(); play(g, 'CATA_478');
    const source = g.me.board[0]; source.atkBuff += 2; source.hp = 2;
    const attack = g.atkOf(source); g.apply({ type: 'endTurn' });
    const token = g.s.players[0].board.find((m) => m.cardId === 'CATA_478t')!;
    expect(token.hp).toBe(2); expect(g.atkOf(token)).toBe(attack);
  });

  it.each([false, true])('excess damage discount respects Divine Shield (shield=%s)', (shield) => {
    const g = game();
    const target = g.makeMinion(1, 'CS2_182'); target.hp = 2;
    if (shield) target.keywords.push('DIVINE_SHIELD'); g.s.players[1].board.push(target);
    const held = g.newHandCard('CS2_029'); g.me.hand.push(held);
    play(g, 'CATA_978', target.uid);
    expect(held.costMod).toBe(shield ? 0 : -6);
  });

  it('lets the player select the Animal Companion', () => {
    const g = game(); play(g, 'MEND_301');
    const id = g.s.pendingChoice!.options[2]; choose(g, 2);
    expect(g.me.board.some((m) => m.cardId === id)).toBe(true);
    expect(g.me.board).toHaveLength(2);
  });
});
