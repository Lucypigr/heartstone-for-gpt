import { describe, expect, it } from 'vitest';
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
});
