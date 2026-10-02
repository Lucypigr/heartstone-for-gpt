// 卡牌資料庫：載入產生的 cards.json，並套用手動覆寫 / 自訂卡牌
import data from '../data/cards.json';
import type { CardClass, CardDef, Pool } from '../engine/types';
import { CUSTOM_CARDS } from './custom';
import { OVERRIDES } from './overrides';

export interface HeroInfo {
  hero: string;
  heroDbf: number;
  name: string;
  power: { id: string; name: string; text: string; cost: number };
}

interface CardData {
  build?: string;
  heroes: Record<string, HeroInfo>;
  aliases?: Record<string, string>;
  heroSkins?: Record<string, string>;
  cards: CardDef[];
}

const raw = data as unknown as CardData;

export const DATA_BUILD = raw.build ?? '';

export const CARDS: Record<string, CardDef> = {};
for (const c of raw.cards) CARDS[c.id] = c;
for (const [id, patch] of Object.entries(OVERRIDES)) {
  if (!CARDS[id]) continue;
  const { heroPower, tokens: _tokens, ...rest } = patch;
  const base = CARDS[id];
  CARDS[id] = { ...base, ...rest, heroPower: heroPower && base.heroPower ? { ...base.heroPower, ...heroPower } : base.heroPower };
}
for (const c of CUSTOM_CARDS) CARDS[c.id] = { ...c, custom: true };

export const HEROES = raw.heroes as Record<Exclude<CardClass, 'NEUTRAL'>, HeroInfo>;

export const PLAYABLE_CLASSES = Object.keys(HEROES) as Exclude<CardClass, 'NEUTRAL'>[];

/** 所有可收藏（可放進套牌 / 卡包會掉落）的卡 */
export const COLLECTIBLE: CardDef[] = Object.values(CARDS).filter((c) => c.collectible);

export function getCard(id: string): CardDef {
  const c = CARDS[id];
  if (!c) throw new Error(`未知卡牌：${id}`);
  return c;
}

const BY_DBF = new Map<number, string>();
for (const c of Object.values(CARDS)) BY_DBF.set(c.dbfId, c.id);
for (const [dbf, id] of Object.entries(raw.aliases ?? {})) if (!BY_DBF.has(Number(dbf))) BY_DBF.set(Number(dbf), id);

/** 用 dbfId 找卡（牌組代碼用；會把核心 / 傳統等重複版本對應到遊戲收錄的版本） */
export function cardByDbf(dbf: number): CardDef | null {
  const id = BY_DBF.get(dbf);
  return id ? CARDS[id] : null;
}

/** 英雄卡（含造型）的 dbfId → 職業 */
export function classOfHeroDbf(dbf: number): Exclude<CardClass, 'NEUTRAL'> | null {
  return (raw.heroSkins?.[String(dbf)] as Exclude<CardClass, 'NEUTRAL'>) ?? null;
}

export function hasCard(id: string): boolean {
  return id in CARDS;
}

export function cardClasses(c: CardDef): CardClass[] {
  return c.classes?.length ? c.classes : [c.cardClass];
}

/** 依卡池條件篩選可收藏卡（發現 / 隨機產生卡牌用） */
export function poolCards(pool: Pool, ownClass: CardClass, oppClass: CardClass): CardDef[] {
  return COLLECTIBLE.filter((c) => {
    if (pool.type && c.type !== pool.type) return false;
    if (pool.race && !(c.races?.includes(pool.race) || c.races?.includes('ALL'))) return false;
    if (pool.cost !== undefined && c.cost !== pool.cost) return false;
    if (pool.minCost !== undefined && c.cost < pool.minCost) return false;
    if (pool.maxCost !== undefined && c.cost > pool.maxCost) return false;
    if (pool.rarity && c.rarity !== pool.rarity) return false;
    if (pool.keyword && !c.keywords?.includes(pool.keyword)) return false;
    if (pool.hasDeathrattle && !c.abilities?.some((a) => a.on.k === 'deathrattle')) return false;
    if (pool.hasBattlecry && !(c.type === 'MINION' && c.abilities?.some((a) => a.on.k === 'play'))) return false;
    if (pool.isSecret && !c.secret) return false;
    if (pool.spellSchool && c.spellSchool !== pool.spellSchool) return false;
    if (pool.starshipPiece && !c.starshipPiece) return false;
    if (pool.rune && !c.runes?.[pool.rune]) return false;
    if (pool.spendsCorpses && !JSON.stringify(c.abilities ?? []).includes('"spendCorpses')) return false;
    if (pool.terran && !c.terran) return false;
    if (pool.otherClass) {
      const classes = cardClasses(c);
      if (classes.includes('NEUTRAL') || classes.includes(ownClass)) return false;
    }
    if (pool.cls) {
      const want = pool.cls === 'own' ? ownClass : pool.cls === 'opponent' ? oppClass : pool.cls;
      if (!cardClasses(c).includes(want)) return false;
    }
    return true;
  });
}
