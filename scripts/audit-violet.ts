// 比對官方 CardDefs 靜態資料；不把靜態比對誤稱為全部規則驗證。
// 執行：npx tsx scripts/audit-violet.ts（沿用 cards 指令的官方 XML 快取）
import { getCard, hasCard } from '../src/cards/registry';
import { loadCardDefsXml, parseCardDefs } from './carddefs';
import type { Keyword } from '../src/engine/types';

const raw = parseCardDefs(await loadCardDefsXml('.cache/CardDefs.xml'));
const official = raw.filter((r) => r.tags.CARD_SET === 1988 && r.tags.COLLECTIBLE);
const keywords: Keyword[] = ['TAUNT', 'DIVINE_SHIELD', 'CHARGE', 'RUSH', 'WINDFURY', 'STEALTH', 'POISONOUS', 'LIFESTEAL', 'REBORN'];
const failures: { id: string; field: string; expected: unknown; actual: unknown }[] = [];
for (const r of official) {
  if (!hasCard(r.id)) {
    failures.push({ id: r.id, field: 'card', expected: 'present', actual: 'missing' });
    continue;
  }
  const card = getCard(r.id);
  const check = (field: string, expected: unknown, actual: unknown) => {
    if (expected !== actual) failures.push({ id: r.id, field, expected, actual });
  };
  const clean = (s: string | undefined) => (s ?? '').replace(/\r/g, '').trim();
  if (r.tags.CARDTYPE === 39) check('type', 'LOCATION', card.type);
  check('dbfId', r.dbf, card.dbfId);
  check('name', clean(r.strs.CARDNAME?.zhTW), card.name);
  check('nameEn', clean(r.strs.CARDNAME?.enUS), card.nameEn);
  check('text', clean(r.strs.CARDTEXT?.zhTW), card.text);
  check('cost', r.tags.COST ?? 0, card.cost);
  if (card.type === 'LOCATION') check('durability', r.tags.HEALTH, card.health);
  if (card.type === 'MINION' || card.type === 'WEAPON') {
    check('attack', r.tags.ATK ?? 0, card.attack);
    check('health', r.tags.HEALTH ?? r.tags.DURABILITY ?? 1, card.health);
  }
  for (const k of keywords) {
    if (r.tags[k]) check(k, true, card.keywords?.includes(k) ?? false);
  }
}
console.log(JSON.stringify({
  source: 'https://raw.githubusercontent.com/HearthSim/hsdata/master/CardDefs.xml',
  officialCollectibleCards: official.length,
  checkedCards: official.map((r) => r.id).sort(),
  staticMismatches: failures,
  exhaustiveRulesParityVerified: false,
}, null, 2));
if (!official.length || failures.length) process.exitCode = 1;
