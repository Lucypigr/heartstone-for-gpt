import { describe, expect, it } from 'vitest';
import { getCard, poolCards } from '../cards/registry';
import { Game } from './game';

function game() {
  const g = Game.create({ decks: [Array(30).fill('CS2_182'), Array(30).fill('CS2_182')], classes: ['MAGE', 'PRIEST'], names: ['A', 'B'], ai: [false, false], first: 0, seed: 64 });
  g.apply({ type: 'mulligan', player: 0, replace: [] });
  g.apply({ type: 'mulligan', player: 1, replace: [] });
  for (const p of g.s.players) { p.hand = []; p.mana = p.maxMana = 10; }
  return g;
}
function play(g: Game, cardId: string, target?: number) {
  const card = g.newHandCard(cardId); g.me.hand.push(card); g.me.mana = 10;
  expect(g.apply({ type: 'play', handUid: card.uid, target })).toBe(true);
}
const ids = (g: Game) => g.s.players[0].board.map((m) => m.cardId);

describe('Colossal summon processing', () => {
  it('excludes Colossals from ordinary generation without removing deck-filter eligibility', () => {
    const g = game();
    expect(poolCards({ type: 'MINION', cost: 7 }, 'MAGE', 'PRIEST').some((c) => c.id === 'CATA_488')).toBe(true);
    expect(g['randomPool']({ type: 'MINION', cost: 7 }, 0, false).some((c) => c.id === 'CATA_488')).toBe(false);
    expect(g['randomPool']({ colossal: true }, 0, false).map((c) => c.id)).toContain('CATA_488');
  });
  it('playing Vulcanos produces its two official appendages once', () => {
    const g = game(); play(g, 'CATA_488');
    expect(ids(g)).toEqual(['CATA_488t', 'CATA_488', 'CATA_488t2']);
    expect(g.me.board.map((m) => [g.atkOf(m), m.hp])).toEqual([[1, 5], [4, 8], [1, 5]]);
  });

  it.each([5, 6])('respects the shared seven-slot limit with %s existing occupied slots', (slots) => {
    const g = game(); play(g, 'CATA_477');
    for (let i = 1; i < slots; i++) g.me.board.push(g.makeMinion(0, 'CS2_182'));
    play(g, 'CATA_488');
    expect(g.boardSpaceUsed(0)).toBe(7);
    expect(g.me.board.filter((m) => m.cardId.startsWith('CATA_488t'))).toHaveLength(6 - slots);
    // Creating later space does not resummon ordinary lost appendages.
    g.me.board.shift(); play(g, 'GAME_005');
    expect(g.me.board.filter((m) => m.cardId.startsWith('CATA_488t'))).toHaveLength(6 - slots);
  });

  it('summoning from hand generates parts, without requiring a battlecry', () => {
    const g = game(); const victim = g.makeMinion(0, 'CS2_182'); g.me.board.push(victim);
    play(g, 'CATA_610', victim.uid);
    g.me.hand.push(g.newHandCard('CATA_488'));
    play(g, 'CS2_029', victim.uid);
    expect(ids(g)).toEqual(['CATA_488t', 'CATA_488', 'CATA_488t2']);
  });

  it('a fresh summoned copy generates its own parts and retains copied stats', () => {
    const g = game(); play(g, 'CATA_488');
    const original = g.me.board[1]; original.atkBuff = 2; original.hp = 6;
    play(g, 'UNG_948', original.uid);
    expect(g.me.board).toHaveLength(6);
    const copies = g.me.board.filter((m) => m.cardId === 'CATA_488');
    expect(copies).toHaveLength(2);
    expect(copies.map((m) => [g.atkOf(m), m.hp])).toEqual([[6, 6], [6, 6]]);
    expect(g.me.board.filter((m) => m.cardId.startsWith('CATA_488t'))).toHaveLength(4);
  });

  it('copying a silenced body does not restore its Colossal effect', () => {
    const g = game(); play(g, 'CATA_488'); const original = g.me.board[1];
    play(g, 'EX1_332', original.uid); play(g, 'UNG_948', original.uid);
    expect(g.me.board).toHaveLength(4);
    expect(g.me.board.filter((m) => m.cardId.startsWith('CATA_488t'))).toHaveLength(2);
  });

  it('reborn resummons the body with fresh parts subject to capacity', () => {
    const g = game(); play(g, 'CATA_488');
    const original = g.me.board[1]; original.keywords.push('REBORN'); original.hp = 1;
    play(g, 'CS2_029', original.uid);
    const body = g.me.board.find((m) => m.cardId === 'CATA_488')!;
    expect(body.hp).toBe(1); expect(body.uid).not.toBe(original.uid);
    expect(g.me.board.filter((m) => m.cardId.startsWith('CATA_488t'))).toHaveLength(4);
  });

  it('Vulcanos damages other minions at own turn end, including its plumes', () => {
    const g = game(); play(g, 'CATA_488');
    const enemy = g.makeMinion(1, 'CS2_182'); g.s.players[1].board.push(enemy);
    const hp = enemy.hp;
    g.apply({ type: 'endTurn' });
    expect(g.s.players[0].board.map((m) => m.hp)).toEqual([2, 8, 2]);
    expect(enemy.hp).toBe(hp - 3);
    expect(g.s.players[0].hand).toHaveLength(2);
    for (const h of g.s.players[0].hand) {
      expect(getCard(h.cardId).spellSchool).toBe('FIRE'); expect(h.costMod).toBe(-3);
    }
  });

  it('lethal damage triggers a Plume, while destroying it directly does not', () => {
    const g = game(); play(g, 'CATA_488'); const plume = g.me.board[0];
    play(g, 'CS2_029', plume.uid);
    expect(g.me.hand).toHaveLength(1); expect(g.me.hand[0].costMod).toBe(-3);
    const before = g.me.hand.length;
    play(g, 'JAIL_510');
    expect(g.me.hand).toHaveLength(before);
  });
});
