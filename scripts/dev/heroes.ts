// 開發用：列出所有英雄卡、其英雄能力與解析結果
import { loadCardDefsXml, parseCardDefs } from '../carddefs';
import { normalizeText } from '../../src/cards/parser';
(async () => {
  const raws = parseCardDefs(await loadCardDefsXml('.cache/CardDefs.xml'));
  const byId = new Map(raws.map((r) => [r.id, r]));
  const heroes = raws.filter((r) => r.tags.COLLECTIBLE && r.tags.CARDTYPE === 3 && ![17, 1646].includes(r.tags.CARD_SET));
  for (const h of heroes) {
    const bp = h.refs.HERO_POWER ? byId.get(h.refs.HERO_POWER) : undefined;
    console.log(`${h.id}\t${h.tags.CARD_SET}\tcost ${h.tags.COST} armor ${h.tags.ARMOR ?? 0}\t${h.strs.CARDNAME.enUS} / ${h.strs.CARDNAME.zhTW}\n   TEXT: ${normalizeText(h.strs.CARDTEXT?.enUS ?? '')}\n   POWER ${bp?.id} (${bp?.tags.COST}): ${normalizeText(bp?.strs.CARDTEXT?.enUS ?? '')}`);
  }
  console.log('total', heroes.length);
})();
