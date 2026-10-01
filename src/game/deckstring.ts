// 爐石戰記牌組代碼（deckstring）的編碼 / 解碼
// 格式：base64( 0, 版本, 賽制, 英雄數, 英雄 dbfId…, 單張數, dbfId…, 兩張數, dbfId…, N 張數, (dbfId, 張數)… )
// 可以直接貼上 hsreplay.net 或遊戲內複製的牌組代碼。
import { cardByDbf, cardClasses, classOfHeroDbf, getCard, HEROES } from '../cards/registry';
import type { Deck, HeroClass } from './decks';

function writeVarint(out: number[], n: number) {
  let v = n;
  while (v >= 0x80) {
    out.push((v & 0x7f) | 0x80);
    v = Math.floor(v / 128);
  }
  out.push(v);
}

function toBase64(bytes: number[]): string {
  let bin = '';
  for (const b of bytes) bin += String.fromCharCode(b);
  return btoa(bin);
}

function fromBase64(s: string): number[] {
  const bin = atob(s.replace(/-/g, '+').replace(/_/g, '/'));
  return Array.from(bin, (c) => c.charCodeAt(0));
}

export function encodeDeck(deck: Deck): string {
  const counts = new Map<number, number>();
  for (const id of deck.cards) {
    const dbf = getCard(id).dbfId;
    counts.set(dbf, (counts.get(dbf) ?? 0) + 1);
  }
  const singles = [...counts].filter(([, n]) => n === 1).map(([d]) => d).sort((a, b) => a - b);
  const doubles = [...counts].filter(([, n]) => n === 2).map(([d]) => d).sort((a, b) => a - b);
  const many = [...counts].filter(([, n]) => n > 2).sort((a, b) => a[0] - b[0]);
  const out: number[] = [0];
  writeVarint(out, 1); // 版本
  writeVarint(out, 1); // 狂野
  writeVarint(out, 1);
  writeVarint(out, HEROES[deck.heroClass].heroDbf);
  writeVarint(out, singles.length);
  for (const d of singles) writeVarint(out, d);
  writeVarint(out, doubles.length);
  for (const d of doubles) writeVarint(out, d);
  writeVarint(out, many.length);
  for (const [d, n] of many) {
    writeVarint(out, d);
    writeVarint(out, n);
  }
  return toBase64(out);
}

export interface DecodedDeck {
  heroClass: HeroClass;
  cards: string[];
  /** 遊戲尚未支援、被略過的卡片張數 */
  unsupported: number;
  name?: string;
}

/** 解析牌組代碼；可接受整段從遊戲複製的文字（會自動找出代碼那一行） */
export function decodeDeck(input: string): DecodedDeck {
  const lines = input.split(/\r?\n/).map((l) => l.trim());
  const nameLine = lines.find((l) => l.startsWith('###'));
  const code = lines.find((l) => l && !l.startsWith('#') && /^[A-Za-z0-9+/=_-]{8,}$/.test(l));
  if (!code) throw new Error('找不到牌組代碼');
  const bytes = fromBase64(code);
  let i = 0;
  const read = () => {
    let result = 0;
    let shift = 1;
    for (;;) {
      if (i >= bytes.length) throw new Error('牌組代碼不完整');
      const b = bytes[i++];
      result += (b & 0x7f) * shift;
      if (!(b & 0x80)) return result;
      shift *= 128;
    }
  };
  if (read() !== 0) throw new Error('不是有效的牌組代碼');
  read(); // 版本
  read(); // 賽制
  const heroCount = read();
  const heroDbfs: number[] = [];
  for (let k = 0; k < heroCount; k++) heroDbfs.push(read());
  const entries: [number, number][] = [];
  for (const copies of [1, 2]) {
    const n = read();
    for (let k = 0; k < n; k++) entries.push([read(), copies]);
  }
  const nMany = read();
  for (let k = 0; k < nMany; k++) {
    const d = read();
    entries.push([d, read()]);
  }

  const cards: string[] = [];
  let unsupported = 0;
  for (const [dbf, n] of entries) {
    const def = cardByDbf(dbf);
    if (!def || !def.collectible) {
      unsupported += n;
      continue;
    }
    for (let k = 0; k < n; k++) cards.push(def.id);
  }

  let heroClass = heroDbfs.map(classOfHeroDbf).find((c): c is HeroClass => !!c) ?? null;
  if (!heroClass) {
    // 找不到英雄時，用卡牌中最多的職業判斷
    const tally = new Map<HeroClass, number>();
    for (const id of cards) for (const c of cardClasses(getCard(id))) if (c !== 'NEUTRAL') tally.set(c, (tally.get(c) ?? 0) + 1);
    heroClass = [...tally].sort((a, b) => b[1] - a[1])[0]?.[0] ?? 'MAGE';
  }
  return { heroClass, cards, unsupported, name: nameLine?.replace(/^###\s*/, '') || undefined };
}
