// 讀取 HearthSim 的 CardDefs.xml（hsreplay.net / HearthstoneJSON 所使用的同一份官方卡牌資料）
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';

export const CARDDEFS_URL = 'https://raw.githubusercontent.com/HearthSim/hsdata/master/CardDefs.xml';

export interface RawCard {
  id: string;
  dbf: number;
  /** 數值型標籤（名稱 -> 值） */
  tags: Record<string, number>;
  /** 在地化字串標籤：CARDNAME / CARDTEXT / FLAVORTEXT … */
  strs: Record<string, { enUS: string; zhTW: string }>;
  /** 參照其他卡牌的標籤（例如 HERO_POWER） */
  refs: Record<string, string>;
}

function decode(s: string): string {
  return s
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&#(\d+);/g, (_, n) => String.fromCodePoint(Number(n)))
    .replace(/&#x([0-9a-fA-F]+);/g, (_, n) => String.fromCodePoint(parseInt(n, 16)))
    .replace(/&amp;/g, '&');
}

export async function loadCardDefsXml(cachePath: string): Promise<string> {
  if (!existsSync(cachePath)) {
    console.log(`下載 ${CARDDEFS_URL} ...`);
    const res = await fetch(CARDDEFS_URL);
    if (!res.ok) throw new Error(`下載 CardDefs.xml 失敗：HTTP ${res.status}`);
    const text = await res.text();
    mkdirSync(dirname(cachePath), { recursive: true });
    writeFileSync(cachePath, text);
  }
  return readFileSync(cachePath, 'utf8');
}

export function parseCardDefs(xml: string): RawCard[] {
  const cards: RawCard[] = [];
  const entityRe = /<Entity CardID="([^"]*)" ID="(\d+)"[^>]*>([\s\S]*?)<\/Entity>/g;
  const locRe = /<Tag enumID="(\d+)"(?: name="([^"]*)")? type="LocString">([\s\S]*?)<\/Tag>/g;
  const tagRe = /<Tag (?:cardID="([^"]*)" )?enumID="(\d+)"(?: name="([^"]*)")? type="(\w+)" value="(-?\d+)"\s*\/>/g;
  let m: RegExpExecArray | null;
  while ((m = entityRe.exec(xml))) {
    const body = m[3];
    const card: RawCard = { id: m[1], dbf: Number(m[2]), tags: {}, strs: {}, refs: {} };
    let t: RegExpExecArray | null;
    locRe.lastIndex = 0;
    while ((t = locRe.exec(body))) {
      const name = t[2] || t[1];
      const en = /<enUS>([\s\S]*?)<\/enUS>/.exec(t[3]);
      const zh = /<zhTW>([\s\S]*?)<\/zhTW>/.exec(t[3]);
      card.strs[name] = { enUS: en ? decode(en[1]) : '', zhTW: zh ? decode(zh[1]) : '' };
    }
    tagRe.lastIndex = 0;
    while ((t = tagRe.exec(body))) {
      const name = t[3] || t[2];
      if (t[4] === 'Card' && t[1]) card.refs[name] = t[1];
      if (t[4] !== 'String' && t[4] !== 'LocString') card.tags[name] = Number(t[5]);
    }
    cards.push(card);
  }
  return cards;
}
