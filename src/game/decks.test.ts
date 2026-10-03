import { describe, expect, it } from 'vitest';
import { COLLECTIBLE, getCard } from '../cards/registry';
import { buildDeck, deckRunes, deckSize, MAX_RUNES, runesFit, runeTotal, validateDeck, type Deck } from './decks';

const deck = (cards: string[]): Deck => ({ id: 't', name: 't', heroClass: 'DEATHKNIGHT', freeform: false, cards });
const NEUTRAL = COLLECTIBLE.filter((c) => c.cardClass === 'NEUTRAL' && c.rarity !== 'LEGENDARY' && !c.classes).slice(0, 15);
const fill = (cards: string[]) => [...cards, ...NEUTRAL.flatMap((c) => [c.id, c.id])].slice(0, 30);

describe('死亡騎士符文', () => {
  it('每種符文取最高需求，總數不能超過 3', () => {
    // 冰霜巨龍之怒 ❄❄❄ + 凜冬號角 ❄❄ → 只需要 ❄❄❄
    expect(deckRunes(['RLK_063', 'RLK_042'])).toEqual({ blood: 0, frost: 3, unholy: 0 });
    expect(validateDeck(deck(fill(['RLK_063', 'RLK_063', 'RLK_042', 'RLK_042']))).ok).toBe(true);
    // 冰霜巨龍之怒 ❄❄❄ + 屍爆術 🩸🩸 → 5 個符文
    const bad = validateDeck(deck(fill(['RLK_063', 'RLK_035'])));
    expect(bad.ok).toBe(false);
    expect(bad.errors.some((e) => e.includes('符文'))).toBe(true);
  });

  it('runesFit 判斷能不能再放一張卡', () => {
    const cur = deckRunes(['RLK_035']); // 🩸🩸
    expect(runesFit(cur, getCard('RLK_101'))).toBe(true); // ❄
    expect(runesFit(cur, getCard('RLK_042'))).toBe(false); // ❄❄
    expect(runesFit(cur, getCard('CS2_182'))).toBe(true);
  });

  it('自動組的死亡騎士套牌符文不超過 3 個', () => {
    for (let seed = 1; seed <= 20; seed++) {
      const cards = buildDeck('DEATHKNIGHT', { seed, noise: 6 });
      expect(cards.length).toBe(30);
      expect(runeTotal(deckRunes(cards))).toBeLessThanOrEqual(MAX_RUNES);
      expect(validateDeck(deck(cards)).ok).toBe(true);
    }
  });

  it('補滿時會遵守既有的符文', () => {
    const cards = buildDeck('DEATHKNIGHT', { seed: 7, noise: 6, runes: { frost: 3 } });
    const r = deckRunes(cards);
    expect(r.blood + r.unholy).toBe(0);
  });
});


describe('阿薩琳娜的 20 張組牌規則', () => {
  const priest = (cards: string[]): Deck => ({ id: 'azalina', name: '阿薩琳娜', heroClass: 'PRIEST', freeform: false, cards });
  const filler = NEUTRAL.flatMap((c) => [c.id, c.id]);

  it('需要 20 張自組牌，不能拿普通的 30 張牌組隨機刪牌', () => {
    expect(validateDeck(priest(['JAIL_430', ...filler.slice(0, 19)])).ok).toBe(true);
    const invalid = validateDeck(priest(['JAIL_430', ...filler.slice(0, 29)]));
    expect(invalid.ok).toBe(false);
    expect(invalid.errors).toContain('套牌需要剛好 20 張（目前 30 張）');
    expect(validateDeck(priest(filler.slice(0, 20))).ok).toBe(false);
    expect(validateDeck(priest(filler)).ok).toBe(true);
  });

  it('自動組牌保留阿薩琳娜並遵守其張數限制', () => {
    const cards = buildDeck('PRIEST', { seed: 7, noise: 0, bias: (c) => c.id === 'JAIL_430' ? 1000 : 0 });
    expect(cards).toContain('JAIL_430');
    expect(cards).toHaveLength(20);
    expect(validateDeck(priest(cards)).ok).toBe(true);
    expect(deckSize(cards.filter((id) => id !== 'JAIL_430'))).toBe(30);
  });
});
