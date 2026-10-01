// 穩定性測試：每張可收藏卡都實際打出一次，並讓電腦互打完整對局
import { describe, expect, it } from 'vitest';
import { COLLECTIBLE, PLAYABLE_CLASSES } from '../cards/registry';
import { buildDeck } from '../game/decks';
import { legalActions, playAiTurn } from './ai';
import { Game } from './game';
import type { Minion, PlayerId } from './state';

function setupBoard(g: Game) {
  const put = (id: string, pid: PlayerId) => {
    const m: Minion = g.makeMinion(pid, id);
    m.sleeping = false;
    g.s.players[pid].board.push(m);
  };
  put('CS2_182', 0);
  put('EX1_029', 0);
  put('CS2_182', 1);
  put('CS1_042', 1);
  g.recalcAuras();
}

describe('每張卡都能打出', () => {
  it('打出全部可收藏卡不會發生錯誤', () => {
    const failures: string[] = [];
    let seed = 1;
    for (const card of COLLECTIBLE) {
      try {
        const g = Game.create({
          decks: [Array(30).fill('CS2_182'), Array(30).fill('CS2_182')],
          classes: ['MAGE', 'PRIEST'],
          names: ['A', 'B'],
          ai: [true, true],
          seed: seed++,
          first: 0,
        });
        g.apply({ type: 'mulligan', player: 0, replace: [] });
        g.apply({ type: 'mulligan', player: 1, replace: [] });
        setupBoard(g);
        const p = g.s.players[0];
        p.mana = p.maxMana = 10;
        const hc = g.newHandCard(card.id);
        p.hand.push(hc);
        const plays = legalActions(g).filter((a) => a.type === 'play' && a.handUid === hc.uid);
        if (plays.length) expect(g.apply(plays[Math.floor(plays.length / 2)])).toBe(true);
        g.apply({ type: 'endTurn' });
        playAiTurn(g, 'normal');
        playAiTurn(g, 'normal');
      } catch (e) {
        failures.push(`${card.id} ${card.nameEn}: ${(e as Error).message}`);
      }
    }
    expect(failures).toEqual([]);
  }, 180000);
});

describe('電腦對戰', () => {
  it('電腦互打的對局都能正常結束', () => {
    for (let i = 0; i < 8; i++) {
      const c0 = PLAYABLE_CLASSES[(i * 3) % PLAYABLE_CLASSES.length];
      const c1 = PLAYABLE_CLASSES[(i * 5 + 1) % PLAYABLE_CLASSES.length];
      const g = Game.create({
        decks: [buildDeck(c0, { seed: i + 1, noise: 4 }), buildDeck(c1, { seed: i + 100, noise: 4 })],
        classes: [c0, c1],
        names: ['A', 'B'],
        ai: [true, true],
        seed: 1000 + i,
      });
      g.apply({ type: 'mulligan', player: 0, replace: [] });
      g.apply({ type: 'mulligan', player: 1, replace: [] });
      let turns = 0;
      while (g.s.phase === 'play' && turns < 120) {
        playAiTurn(g, i % 2 ? 'normal' : 'easy');
        turns++;
      }
      expect(g.s.phase).toBe('over');
    }
  }, 120000);
});
