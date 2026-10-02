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
    text: c.strs.CARDTEXT?.enUS,
    set: c.tags.CARD_SET,
    collectible: !!c.tags.COLLECTIBLE,
    tags: c.tags,
    refs: c.refs,
  }));
writeFileSync('.cache/corrupt.json', JSON.stringify(rows, null, 2));
console.log(`Corrupt entities: ${rows.length}`);
