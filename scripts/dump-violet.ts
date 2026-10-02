import { readFileSync, writeFileSync } from 'node:fs';
import { parseCardDefs } from './carddefs';

const xml = readFileSync('.cache/CardDefs.xml', 'utf8');
const raws = parseCardDefs(xml)
  .filter((r) => r.tags.CARD_SET === 1988 || /^(?:JAIL|CAP)_/.test(r.id))
  .map((r) => ({
    id: r.id,
    dbf: r.dbf,
    tags: r.tags,
    refs: r.refs,
    nameEn: r.strs.CARDNAME?.enUS ?? '',
    nameZh: r.strs.CARDNAME?.zhTW ?? '',
    textEn: r.strs.CARDTEXT?.enUS ?? '',
    textZh: r.strs.CARDTEXT?.zhTW ?? '',
  }))
  .sort((a, b) => a.id.localeCompare(b.id));

writeFileSync('violet-hold-entities.json', JSON.stringify(raws, null, 2));
console.log('VIOLET_HOLD_ENTITIES=' + raws.length);
