// 開發用：列出有某個標籤的可收藏卡。用法：npx tsx scripts/dev/tagged.ts ECHO
import { loadCardDefsXml, parseCardDefs } from '../carddefs';
import { normalizeText } from '../../src/cards/parser';
const tag = process.argv[2];
(async () => {
  const raws = parseCardDefs(await loadCardDefsXml('.cache/CardDefs.xml'));
  for (const r of raws)
    if (r.tags[tag] && r.tags.COLLECTIBLE)
      console.log(r.id, '|', r.tags.CARD_SET, '|', r.strs.CARDNAME?.enUS, '|', r.strs.CARDNAME?.zhTW, '| C', r.tags.COST, r.tags.ATK ?? '', r.tags.HEALTH ?? '', '|', normalizeText(r.strs.CARDTEXT?.enUS ?? ''));
})();
