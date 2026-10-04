import { describe, expect, it } from 'vitest';
import { cardClasses, getCard, poolCards } from '../cards/registry';
import { Game } from './game';

function setup() {
  const g = Game.create({ decks: [Array(30).fill('CS2_182'), Array(30).fill('CS2_182')], classes: ['MAGE', 'SHAMAN'], names: ['A', 'B'], ai: [false, false], first: 0, seed: 91 });
  g.apply({ type: 'mulligan', player: 0, replace: [] });
  g.apply({ type: 'mulligan', player: 1, replace: [] });
  for (const p of g.s.players) { p.hand = []; p.mana = p.maxMana = 10; }
  return g;
}
function play(g: Game, id: string) {
  const card = g.newHandCard(id);
  g.me.hand.push(card);
  expect(g.apply({ type: 'play', handUid: card.uid })).toBe(true);
}

describe('standard expansion missing effects', () => {
  it('Frostbitten Imp freezes itself without asking for a target', () => {
    const g = setup();
    play(g, 'CATA_612');
    expect(g.me.board[0].frozen).toBe(true);
    expect(g.s.pendingChoice).toBeNull();
    expect(g.me.board[0].cardId).toBe('CATA_612');
  });

  it.each([false, true])('Matriarch checks full health at its own turn end (damaged=%s)', (damaged) => {
    const g = setup();
    play(g, 'CATA_305');
    const m = g.me.board[0];
    if (damaged) m.hp--;
    const hp = m.hp;
    const maxHp = m.maxHp;
    g.apply({ type: 'endTurn' });
    expect(m.hp).toBe(hp + (damaged ? 0 : 3));
    expect(m.maxHp).toBe(maxHp + (damaged ? 0 : 3));
    g.apply({ type: 'endTurn' });
    expect(m.maxHp).toBe(maxHp + (damaged ? 0 : 3));
  });

  it('Bronze Keeper summons the official dual-type shielded token', () => {
    const g = setup();
    play(g, 'CATA_476');
    g.apply({ type: 'endTurn' });
    const token = g.s.players[0].board.find((m) => m.cardId === 'CATA_476t')!;
    expect(token).toMatchObject({ hp: 6, maxHp: 6 });
    expect(token.keywords).toContain('DIVINE_SHIELD');
    expect(getCard(token.cardId).races).toEqual(expect.arrayContaining(['ELEMENTAL', 'DRAGON']));
  });

  it('Stormbinder unlocks current and pending overload without refunding spent mana', () => {
    const g = setup();
    play(g, 'CATA_724');
    const owner = g.me;
    expect(owner.overloadOwed).toBe(3);
    owner.overloadLocked = 2;
    owner.mana = 3;
    // A board wipe exercises the deathrattle through the normal death queue.
    g.apply({ type: 'endTurn' });
    play(g, 'JAIL_510');
    expect(owner.overloadLocked).toBe(0);
    expect(owner.overloadOwed).toBe(0);
    expect(owner.mana).toBe(5);
  });

  it('Discover any class retains the other classes in its candidate pool', () => {
    const g = setup();
    const all = g['randomPool']({ type: 'SPELL', cost: 1, anyClass: true }, 0, true);
    expect(all.some((c) => !cardClasses(c).includes('MAGE') && !cardClasses(c).includes('NEUTRAL'))).toBe(true);
    play(g, 'CATA_484');
    expect(g.s.pendingChoice?.options.length).toBe(3);
    for (const id of g.s.pendingChoice!.options) {
      expect(all.some((c) => c.id === id)).toBe(true);
      expect(getCard(id)).toMatchObject({ type: 'SPELL', cost: 1 });
    }
  });

  it('an empty class-restricted Discover pool never falls back to illegal classes', () => {
    const g = setup();
    const pool = { type: 'SPELL' as const, spellSchool: 'FEL' };
    expect(poolCards(pool, 'MAGE', 'SHAMAN').length).toBeGreaterThan(0);
    expect(g['randomPool'](pool, 0, true)).toEqual([]);
    const other = g['randomPool']({ ...pool, otherClass: true }, 0, true);
    expect(other.length).toBeGreaterThan(0);
    expect(other.every((c) => !cardClasses(c).includes('MAGE') && !cardClasses(c).includes('NEUTRAL'))).toBe(true);
  });
});
