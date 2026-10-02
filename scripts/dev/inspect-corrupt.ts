import { writeFileSync } from 'node:fs';
import { loadCardDefsXml, parseCardDefs } from '../carddefs';

const xml = await loadCardDefsXml('.cache/CardDefs.xml');
const cards = parseCardDefs(xml);
const rows = cards
  .filter((c) => c.tags.CORRUPT || c.tags.CORRUPTED)
  .map((c) => ({
    id: c.id,
    dbf: c.dbf,
    name: c.strs.CARDNAME?.enUS,
    zh: c.strs.CARDNAME?.zhTW,
    text: c.strs.CARDTEXT?.enUS,
    textZh: c.strs.CARDTEXT?.zhTW,
    set: c.tags.CARD_SET,
    cost: c.tags.COST,
    collectible: !!c.tags.COLLECTIBLE,
    corrupt: !!c.tags.CORRUPT,
    corrupted: !!c.tags.CORRUPTED,
    tags: Object.fromEntries(Object.entries(c.tags).filter(([k]) => /CORRUPT|TRANSFORM|LINK|CARD_SET|COST|COLLECTIBLE/.test(k))),
    refs: c.refs,
  }))
  .sort((a,b) => a.id.localeCompare(b.id));
writeFileSync('.cache/corrupt.json', JSON.stringify(rows, null, 2));
console.log('Corrupt entities:', rows.length);
