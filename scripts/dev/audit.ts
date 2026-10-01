// 開發用：隨機抽樣已支援的卡，對照英文敘述與解析結果
import { loadCardDefsXml, parseCardDefs } from '../carddefs';
import { normalizeText } from '../../src/cards/parser';
import data from '../../src/data/cards.json';
(async () => {
  const raws = parseCardDefs(await loadCardDefsXml('.cache/CardDefs.xml'));
  const en = new Map(raws.map((r) => [r.id, normalizeText(r.strs.CARDTEXT?.enUS ?? '')]));
  const cards = (data as any).cards.filter((c: any) => c.collectible && en.get(c.id));
  let seed = Number(process.argv[2] ?? 1);
  const rnd = () => ((seed = (seed * 1103515245 + 12345) % 2147483648) / 2147483648);
  const n = Number(process.argv[3] ?? 40);
  for (let i = 0; i < n; i++) {
    const c = cards[Math.floor(rnd() * cards.length)];
    const eff = JSON.stringify({ k: c.keywords, a: c.abilities, au: c.auras, t: c.target, sd: c.spellDamage, ov: c.overload, en: c.enrage, co: c.chooseOne?.map((o: any) => o.abilities), cr: c.costRule })
      .replace(/"spell":false,?/g, '').replace(/"who":"self",?/g, '').replace(/,}/g, '}');
    console.log(`${c.id} [${c.type}] ${en.get(c.id)}\n    => ${eff}`);
  }
})();
