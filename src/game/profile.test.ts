import { describe, expect, it } from 'vitest';
import { getCard } from '../cards/registry';
import { validateDeck } from './decks';
import { LEGENDARY_PITY, WIN_REWARD, DAILY_FIRST_WIN_BONUS } from './economy';
import { buyPacks, craftCard, disenchantCard, disenchantExtras, newProfile, openPack, recordMatch, rollPack, sanitizeProfile } from './profile';
import { PACKS, packById } from './sets';

function seeded(seed: number) {
  let s = seed;
  return () => {
    s = (s * 1664525 + 1013904223) % 4294967296;
    return s / 4294967296;
  };
}

describe('存檔', () => {
  it('新玩家有基本卡、金幣、卡包與可用的新手套牌', () => {
    const p = newProfile();
    expect(p.gold).toBeGreaterThan(0);
    expect(p.packs.classic).toBe(3);
    expect(p.decks.length).toBeGreaterThanOrEqual(10);
    for (const d of p.decks) expect(validateDeck(d, p.collection).errors).toEqual([]);
  });

  it('讀取損壞的存檔會回到安全的預設值', () => {
    const p = sanitizeProfile({ gold: 'abc', collection: { NOT_A_CARD: 3 }, decks: [{ name: 'x', heroClass: 'MAGE', cards: ['NOPE'] }] });
    expect(p.gold).toBe(0);
    expect(p.collection.NOT_A_CARD).toBeUndefined();
    expect(p.decks[0].cards).toEqual([]);
  });
});

describe('卡包', () => {
  it('每個卡包都有足夠的卡牌', () => {
    for (const pack of PACKS) {
      const cards = rollPack(pack, 0, seeded(1));
      expect(cards.length).toBe(5);
    }
  });

  it('購買需要金幣，開包會加入收藏', () => {
    let p = newProfile();
    p = { ...p, gold: 250 };
    const r = buyPacks(p, 'classic', 3);
    expect(r.ok).toBe(false);
    const r2 = buyPacks(p, 'classic', 2);
    expect(r2.ok).toBe(true);
    expect(r2.profile.gold).toBe(50);
    expect(r2.profile.packs.classic).toBe(5);
    const o = openPack(r2.profile, 'classic', seeded(3));
    expect(o.cards.length).toBe(5);
    expect(o.profile.packs.classic).toBe(4);
    for (const id of o.cards) expect(o.profile.collection[id]).toBeGreaterThan(0);
  });

  it('每包至少一張稀有以上，保底必出傳說', () => {
    const pack = packById('classic')!;
    for (let i = 0; i < 50; i++) {
      const cards = rollPack(pack, 0, seeded(i));
      expect(cards.some((id) => getCard(id).rarity !== 'COMMON')).toBe(true);
    }
    const cards = rollPack(pack, LEGENDARY_PITY - 1, seeded(9));
    expect(cards.some((id) => getCard(id).rarity === 'LEGENDARY')).toBe(true);
  });
});

describe('合成與分解', () => {
  it('分解獲得奧術之塵，合成消耗奧術之塵', () => {
    let p = newProfile();
    const rare = Object.keys(p.collection).length ? 'EX1_005' : '';
    p = { ...p, collection: { ...p.collection, [rare]: 3 } };
    const d = disenchantCard(p, rare);
    expect(d.ok).toBe(true);
    expect(d.profile.dust).toBeGreaterThan(0);
    expect(d.profile.collection[rare]).toBe(2);
    const c = craftCard({ ...p, dust: 1000 }, rare);
    expect(c.ok).toBe(true);
    expect(c.profile.collection[rare]).toBe(4);
    const x = disenchantExtras(c.profile);
    expect(x.count).toBe(2);
    expect(x.profile.collection[rare]).toBe(2);
  });
});

describe('對戰獎勵', () => {
  it('勝利獲得金幣，每日首勝有額外獎勵', () => {
    const p = newProfile();
    const r1 = recordMatch(p, 'win', 'normal', 'MAGE', 'WARRIOR', '2026-1-1');
    expect(r1.gold).toBe(WIN_REWARD.normal + DAILY_FIRST_WIN_BONUS);
    const r2 = recordMatch(r1.profile, 'win', 'normal', 'MAGE', 'WARRIOR', '2026-1-1');
    expect(r2.gold).toBe(WIN_REWARD.normal);
    expect(r2.profile.wins).toBe(2);
  });
});
