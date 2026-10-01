// 電腦對手的套牌
import type { Difficulty } from '../engine/ai';
import { buildDeck, type HeroClass } from './decks';

export function makeAiDeck(cls: HeroClass, difficulty: Difficulty, seed: number): string[] {
  switch (difficulty) {
    case 'easy':
      return buildDeck(cls, { seed, noise: 9, rarities: ['FREE', 'COMMON'], maxLegendary: 0 });
    case 'normal':
      return buildDeck(cls, { seed, noise: 4, rarities: ['FREE', 'COMMON', 'RARE', 'EPIC'], maxLegendary: 1 });
    case 'hard':
      return buildDeck(cls, { seed, noise: 0.8, maxLegendary: 4 });
  }
}
