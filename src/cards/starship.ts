// 星艦（無垠黑暗）
// 打出或召喚星艦組件時，組件會組裝進你的星艦；花 5 點法力「發射」後，星艦以手下的形式登場，
// 擁有所有組件的攻擊力、生命值、關鍵字與效果。
import type { StarshipPiece } from '../engine/state';
import type { CardClass, CardDef } from '../engine/types';
import { getCard } from './registry';

export const LAUNCH_COST = 5;

/** 各職業的星艦（官方資料 GDB_100t2 ~ t9；人類職業為戰巡艦） */
const STARSHIP_BY_CLASS: Partial<Record<CardClass, string>> = {
  DEATHKNIGHT: 'GDB_100t4',
  DEMONHUNTER: 'GDB_100t5',
  DRUID: 'GDB_100t6',
  HUNTER: 'GDB_100t7',
  ROGUE: 'GDB_100t8',
  WARLOCK: 'GDB_100t9',
  PALADIN: 'SC_999t',
  SHAMAN: 'SC_999t',
  WARRIOR: 'SC_999t',
};

export const STARSHIP_IDS = ['GDB_100t2', ...new Set(Object.values(STARSHIP_BY_CLASS))];

export function starshipIdFor(cls: CardClass): string {
  return STARSHIP_BY_CLASS[cls] ?? 'GDB_100t2';
}

const cache = new Map<string, CardDef>();

/** 星艦的卡牌定義：組件的數值、關鍵字與效果全部加總（出牌 / 發射時的效果除外） */
export function starshipDef(shipId: string, pieces: StarshipPiece[]): CardDef {
  const key = shipId + '|' + pieces.map((p) => `${p.id}:${p.atk}:${p.hp}`).join(',');
  const hit = cache.get(key);
  if (hit) return hit;
  const base = getCard(shipId);
  const defs = pieces.map((p) => getCard(p.id));
  const strip = (t: string) => t.replace(/\[x\]/g, '').split('@')[0].replace(/<b>星艦組件<\/b>/g, '').trim();
  const texts = [...new Set(defs.map((d) => strip(d.text)).filter(Boolean))];
  const def: CardDef = {
    ...base,
    type: 'MINION',
    cost: LAUNCH_COST,
    attack: pieces.reduce((x, p) => x + p.atk, 0),
    health: pieces.reduce((x, p) => x + p.hp, 0),
    races: base.races,
    text: [`由 ${pieces.length} 個組件組成`, ...texts].join('\n'),
    keywords: [...new Set(defs.flatMap((d) => d.keywords ?? []))],
    // 戰吼與發射效果只在打出 / 發射時觸發，星艦本身保留其他能力（亡語、觸發效果…）
    abilities: defs.flatMap((d) => (d.abilities ?? []).filter((a) => a.on.k !== 'play' && a.on.k !== 'launch')),
    auras: defs.flatMap((d) => d.auras ?? []),
    spellDamage: defs.reduce((x, d) => x + (d.spellDamage ?? 0), 0) || undefined,
    target: undefined,
    starship: true,
    starshipPiece: false,
    collectible: false,
  };
  cache.set(key, def);
  return def;
}
