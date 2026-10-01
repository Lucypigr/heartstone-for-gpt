import { describe, expect, it } from 'vitest';
import { buildDeck } from './decks';
import { decodeDeck, encodeDeck } from './deckstring';

describe('牌組代碼', () => {
  it('編碼後再解碼會得到相同的套牌', () => {
    const cards = buildDeck('PALADIN', { seed: 5, noise: 1 });
    const code = encodeDeck({ id: 'x', name: 'x', heroClass: 'PALADIN', freeform: false, cards });
    const back = decodeDeck(code);
    expect(back.heroClass).toBe('PALADIN');
    expect([...back.cards].sort()).toEqual([...cards].sort());
    expect(back.unsupported).toBe(0);
  });

  it('可以解析官方格式的代碼（含名稱與註解）', () => {
    const text = '### 我的獵人\n# Class: Hunter\n#\nAAECAR8GxwPJBLsFmQfZB/gIDI0B2AGoArUDhwSSBe0G6wfbCe0JgQr+DAA=\n#\n# To use this deck, copy it to your clipboard';
    const d = decodeDeck(text);
    expect(d.heroClass).toBe('HUNTER');
    expect(d.name).toBe('我的獵人');
    expect(d.cards.length + d.unsupported).toBe(30);
  });

  it('無效的代碼會拋出錯誤', () => {
    expect(() => decodeDeck('hello')).toThrow();
  });
});
