// 開發用：顯示卡牌的正規化英文敘述，方便撰寫解析規則或覆寫。
// 用法：npx tsx scripts/dev/show.ts EX1_001 "Fireball"
import { loadCardDefsXml, parseCardDefs } from '../carddefs';
import { normalizeText } from '../../src/cards/parser';
const ids = process.argv.slice(2);
(async () => { const raws = parseCardDefs(await loadCardDefsXml('.cache/CardDefs.xml'));
for (const r of raws) if (ids.includes(r.id) || ids.includes(r.strs.CARDNAME?.enUS)) console.log(r.id, '|', r.strs.CARDNAME?.enUS, '|', normalizeText(r.strs.CARDTEXT?.enUS ?? ''), '| ATK', r.tags.ATK, 'HP', r.tags.HEALTH, 'COST', r.tags.COST, r.tags.COLLECTIBLE ? 'C' : '');
})();
