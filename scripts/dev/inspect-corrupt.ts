import { writeFileSync } from 'node:fs';
import { loadCardDefsXml, parseCardDefs } from '../carddefs';

const xml = await loadCardDefsXml('.cache/CardDefs.xml');
const cards = parseCardDefs(xml);
const corrupt = cards.filter((c) => c.tags.COLLECTIBLE && c.tags.CORRUPT);
const rows = corrupt.map((c) => {
  const name = c.strs.CARDNAME?.enUS;
  const sameName = cards
    .filter((x) =>
      x.id !== c.id &&
      x.strs.CARDNAME?.enUS === name &&
      x.tags.CARD_SET === c.tags.CARD_SET
    )
    .map((x) => ({
      id: x.id,
      dbf: x.dbf,
      collectible: !!x.tags.COLLECTIBLE,
      cost: x.tags.COST,
      type: x.tags.CARDTYPE,
      text: x.strs.CARDTEXT?.enUS,
      textZh: x.strs.CARDTEXT?.zhTW,
      tags: Object.fromEntries(Object.entries(x.tags).filter(([k]) => /CORRUPT|TRANSFORM|LINK|CARD_SET|COST|COLLECTIBLE|CARDTYPE/.test(k))),
      refs: x.refs,
    }))
    .sort((a,b) => a.id.localeCompare(b.id));
  return {
    id: c.id,
    dbf: c.dbf,
    name,
    text: c.strs.CARDTEXT?.enUS,
    cost: c.tags.COST,
    set: c.tags.CARD_SET,
    sameName,
  };
});
writeFileSync('.cache/corrupt.json', JSON.stringify(rows, null, 2));
console.log('Collectible corrupt cards:', rows.length);
