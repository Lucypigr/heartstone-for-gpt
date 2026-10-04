// Read-only inventory: enumerate the source first, including unsupported card types.
// Example: npx tsx scripts/audit-coverage.ts --sets=1637,1946,1952,1957,1980,1988
// A set inventory does NOT establish current format legality or effect correctness.
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { CARDS, cardByDbf } from '../src/cards/registry';
import { parseCardDefs } from './carddefs';

const arg = process.argv.find((x) => x.startsWith('--sets='))?.slice(7);
if (!arg || !/^\d+(,\d+)*$/.test(arg)) {
  throw new Error('Specify explicit source set IDs with --sets=1637,1946,...');
}
const sets = new Set(arg.split(',').map(Number));
const xml = readFileSync('.cache/CardDefs.xml', 'utf8');
const raw = parseCardDefs(xml);
const official = raw.filter((r) => r.tags.COLLECTIBLE && sets.has(r.tags.CARD_SET));
for (const set of sets) {
  if (!official.some((r) => r.tags.CARD_SET === set)) throw new Error(`No collectible cards found for set ${set}`);
}
const clean = (s: string | undefined) => (s ?? '').replace(/\r/g, '').trim();
const rows = official.map((r) => {
  const card = CARDS[r.id] ?? cardByDbf(r.dbf);
  const mismatches: string[] = [];
  if (card) {
    const expected: Record<string, unknown> = {
      name: clean(r.strs.CARDNAME?.zhTW), nameEn: clean(r.strs.CARDNAME?.enUS),
      text: clean(r.strs.CARDTEXT?.zhTW), cost: r.tags.COST ?? 0,
      type: ({ 3: 'HERO', 4: 'MINION', 5: 'SPELL', 7: 'WEAPON', 39: 'LOCATION' } as Record<number, string>)[r.tags.CARDTYPE],
    };
    if ([4, 7].includes(r.tags.CARDTYPE)) {
      expected.attack = r.tags.ATK ?? 0;
      expected.health = r.tags.HEALTH ?? r.tags.DURABILITY ?? 1;
    }
    if (r.tags.CARDTYPE === 39) expected.health = r.tags.HEALTH;
    for (const [key, value] of Object.entries(expected)) {
      if (card[key as keyof typeof card] !== value) mismatches.push(key);
    }
  }
  return {
    id: r.id, dbfId: r.dbf, set: r.tags.CARD_SET,
    name: clean(r.strs.CARDNAME?.zhTW), nameEn: clean(r.strs.CARDNAME?.enUS),
    text: clean(r.strs.CARDTEXT?.enUS), sourceType: r.tags.CARDTYPE,
    implementationId: card?.id ?? null,
    status: !card ? 'missing' : mismatches.length ? 'static-mismatch' : 'present-unverified-effects',
    mismatches,
  };
});
console.log(JSON.stringify({
  source: 'https://raw.githubusercontent.com/HearthSim/hsdata/master/CardDefs.xml',
  build: /build="(\d+)"/.exec(xml)?.[1],
  sha256: createHash('sha256').update(xml).digest('hex'),
  formatLegalityVerified: false,
  exhaustiveRulesParityVerified: false,
  summary: [...sets].sort((a, b) => a - b).map((set) => {
    const cards = rows.filter((r) => r.set === set);
    return {
      set, official: cards.length,
      present: cards.filter((r) => r.implementationId).length,
      missing: cards.filter((r) => !r.implementationId).length,
      staticMismatch: cards.filter((r) => r.mismatches.length).length,
    };
  }),
  cards: rows,
}, null, 2));
