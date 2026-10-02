import { describe, expect, it } from 'vitest';
import { legalActions } from '../engine/ai';
import { Game } from '../engine/game';
import type { Minion } from '../engine/state';
import { getCard, hasCard } from './registry';

const SHATTER_CARDS = [
  'CATA_134', // Wildwood Circle
  'CATA_820', // Supply Run
  'CATA_489', // Arcane Flow
  'CATA_479', // Flight Maneuvers
  'CATA_306', // Schism
];

describe('2026《浩劫與重生》：碎裂套牌完整性', () => {
  it('五張可收藏碎裂牌全部被引擎收錄，且左右碎片都存在', () => {
    const missing = SHATTER_CARDS.filter((id) => !hasCard(id));
    expect(missing).toEqual([]);

    for (const id of SHATTER_CARDS) {
      const card = getCard(id);
      expect(card.shatter, id).toBeDefined();
      expect(hasCard(card.shatter!.left), card.shatter!.left).toBe(true);
      expect(hasCard(card.shatter!.right), card.shatter!.right).toBe(true);
    }
  });

  it('五張碎裂牌的十個碎片都能單獨合法施放', () => {
    const failures: string[] = [];

    for (const rootId of SHATTER_CARDS) {
      const root = getCard(rootId);
      const fragments = [root.shatter!.left, root.shatter!.right];

      for (const fragmentId of fragments) {
        const g = Game.create({
          decks: [Array(30).fill('CS2_182'), Array(30).fill('CS2_182')],
          classes: ['MAGE', 'PRIEST'],
          names: ['A', 'B'],
          ai: [false, false],
          seed: 7,
          first: 0,
        });
        g.apply({ type: 'mulligan', player: 0, replace: [] });
        g.apply({ type: 'mulligan', player: 1, replace: [] });

        const p = g.s.players[0];
        p.hand = [];
        p.mana = p.maxMana = 10;

        const friendly: Minion = g.makeMinion(0, 'CS2_182');
        friendly.sleeping = false;
        p.board.push(friendly);
        const enemy: Minion = g.makeMinion(1, 'CS2_182');
        enemy.sleeping = false;
        g.s.players[1].board.push(enemy);
        g.recalcAuras();

        const hc = g.newHandCard(fragmentId);
        p.hand.push(hc);
        const actions = legalActions(g).filter((a) => a.type === 'play' && a.handUid === hc.uid);
        if (!actions.length || !g.apply(actions[0])) failures.push(fragmentId);
      }
    }

    expect(failures).toEqual([]);
  });
});
