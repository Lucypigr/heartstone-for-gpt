// 玩家存檔：金幣、奧術之塵、收藏、套牌、未開卡包、戰績
// 所有函式都回傳新的 Profile（不修改原本的物件），方便 React 更新。
import { COLLECTIBLE, getCard, hasCard, PLAYABLE_CLASSES } from '../cards/registry';
import type { Difficulty } from '../engine/ai';
import { CLASS_NAMES } from '../engine/heroes';
import type { Rarity } from '../engine/types';
import { buildDeck, maxCopies, type Deck, type HeroClass } from './decks';
import { sanitizeLadder, type LadderState } from './ladder';
import {
  CARDS_PER_PACK,
  CRAFT_COST,
  DAILY_FIRST_WIN_BONUS,
  DISENCHANT_VALUE,
  LEGENDARY_PITY,
  LOSS_REWARD,
  RARITY_ODDS,
  STARTING_GOLD,
  STARTING_PACKS,
  WIN_REWARD,
} from './economy';
import { packById, type PackType } from './sets';

export interface MatchRecord {
  date: string;
  result: 'win' | 'loss' | 'draw';
  difficulty: Difficulty;
  gold: number;
  myClass: HeroClass;
  oppClass: HeroClass;
  /** 天梯對戰 */
  mode?: 'ladder';
  /** 對手名稱（天梯） */
  opp?: string;
  /** 賽後的牌階（天梯） */
  rank?: string;
}

export interface Profile {
  version: 1;
  gold: number;
  dust: number;
  collection: Record<string, number>;
  decks: Deck[];
  packs: Record<string, number>;
  pity: Record<string, number>;
  wins: number;
  losses: number;
  lastDailyWin: string | null;
  history: MatchRecord[];
  settings: { aiSpeed: 'slow' | 'normal' | 'fast' };
  ladder?: LadderState;
}

export type Rand = () => number;

export function newId(): string {
  return Math.random().toString(36).slice(2, 10);
}

export function newProfile(): Profile {
  const collection: Record<string, number> = {};
  for (const c of COLLECTIBLE) if (c.rarity === 'FREE') collection[c.id] = 2;
  const decks: Deck[] = PLAYABLE_CLASSES.map((cls) => ({
    id: newId(),
    name: `基本套牌 - ${CLASS_NAMES[cls]}`,
    heroClass: cls,
    freeform: false,
    cards: buildDeck(cls, { seed: 7, noise: 0, owned: collection, maxLegendary: 0 }),
  })).filter((d) => d.cards.length === 30);
  return {
    version: 1,
    gold: STARTING_GOLD,
    dust: 0,
    collection,
    decks,
    packs: { ...STARTING_PACKS },
    pity: {},
    wins: 0,
    losses: 0,
    lastDailyWin: null,
    history: [],
    settings: { aiSpeed: 'normal' },
  };
}

/** 讀取存檔並修正不合法的資料（例如卡牌資料更新後消失的卡） */
export function sanitizeProfile(raw: unknown): Profile {
  const base = newProfile();
  if (!raw || typeof raw !== 'object') return base;
  const p = raw as Partial<Profile>;
  const collection: Record<string, number> = {};
  for (const [id, n] of Object.entries(p.collection ?? {})) {
    if (hasCard(id) && getCard(id).collectible && typeof n === 'number' && n > 0) collection[id] = Math.floor(n);
  }
  const decks = (p.decks ?? [])
    .filter((d) => d && typeof d.name === 'string' && PLAYABLE_CLASSES.includes(d.heroClass))
    .map((d) => ({ ...d, freeform: !!d.freeform, cards: (d.cards ?? []).filter((id) => hasCard(id)) }));
  return {
    ...base,
    ...p,
    version: 1,
    gold: Math.max(0, Number(p.gold) || 0),
    dust: Math.max(0, Number(p.dust) || 0),
    collection,
    decks,
    packs: { ...(p.packs ?? {}) },
    pity: { ...(p.pity ?? {}) },
    history: (p.history ?? []).slice(-30),
    settings: { ...base.settings, ...(p.settings ?? {}) },
    ladder: p.ladder ? sanitizeLadder(p.ladder) : undefined,
  };
}

// ---------------------------------------------------------------------------
// 商店與卡包
// ---------------------------------------------------------------------------

export function buyPacks(p: Profile, packId: string, count: number): { ok: boolean; profile: Profile; error?: string } {
  const pack = packById(packId);
  if (!pack) return { ok: false, profile: p, error: '找不到卡包' };
  const cost = pack.price * count;
  if (p.gold < cost) return { ok: false, profile: p, error: '金幣不足' };
  return {
    ok: true,
    profile: { ...p, gold: p.gold - cost, packs: { ...p.packs, [packId]: (p.packs[packId] ?? 0) + count } },
  };
}

export function packPool(pack: PackType) {
  return COLLECTIBLE.filter((c) => c.rarity !== 'FREE' && (pack.sets.length === 0 || pack.sets.includes(c.set)));
}

export function rollPack(pack: PackType, pity: number, rand: Rand): string[] {
  const pool = packPool(pack);
  const byRarity: Record<string, string[]> = {};
  for (const c of pool) (byRarity[c.rarity] ??= []).push(c.id);
  const rarities: Rarity[] = [];
  for (let i = 0; i < CARDS_PER_PACK; i++) {
    const r = rand();
    rarities.push(RARITY_ODDS.find(([, odds]) => r < odds)?.[0] ?? 'COMMON');
  }
  if (!rarities.some((r) => r !== 'COMMON')) rarities[CARDS_PER_PACK - 1] = 'RARE';
  if (pity + 1 >= LEGENDARY_PITY && !rarities.includes('LEGENDARY')) rarities[CARDS_PER_PACK - 1] = 'LEGENDARY';
  const order: Rarity[] = ['LEGENDARY', 'EPIC', 'RARE', 'COMMON'];
  const out: string[] = [];
  for (const rarity of rarities) {
    let idx = order.indexOf(rarity);
    let list: string[] = [];
    while (idx < order.length) {
      list = (byRarity[order[idx]] ?? []).filter((id) => !(order[idx] === 'LEGENDARY' && out.includes(id)));
      if (list.length) break;
      idx++;
    }
    if (!list.length) list = pool.map((c) => c.id);
    out.push(list[Math.floor(rand() * list.length)]);
  }
  return out;
}

export function openPack(p: Profile, packId: string, rand: Rand = Math.random): { ok: boolean; profile: Profile; cards: string[] } {
  const pack = packById(packId);
  if (!pack || (p.packs[packId] ?? 0) <= 0) return { ok: false, profile: p, cards: [] };
  const pity = p.pity[packId] ?? 0;
  const cards = rollPack(pack, pity, rand);
  const gotLegendary = cards.some((id) => getCard(id).rarity === 'LEGENDARY');
  const collection = { ...p.collection };
  for (const id of cards) collection[id] = (collection[id] ?? 0) + 1;
  return {
    ok: true,
    cards,
    profile: {
      ...p,
      collection,
      packs: { ...p.packs, [packId]: p.packs[packId] - 1 },
      pity: { ...p.pity, [packId]: gotLegendary ? 0 : pity + 1 },
    },
  };
}

// ---------------------------------------------------------------------------
// 合成 / 分解
// ---------------------------------------------------------------------------

export function craftCard(p: Profile, cardId: string): { ok: boolean; profile: Profile; error?: string } {
  const def = getCard(cardId);
  if (def.rarity === 'FREE') return { ok: false, profile: p, error: '基本卡無法合成' };
  const cost = CRAFT_COST[def.rarity];
  if (p.dust < cost) return { ok: false, profile: p, error: '奧術之塵不足' };
  return { ok: true, profile: { ...p, dust: p.dust - cost, collection: { ...p.collection, [cardId]: (p.collection[cardId] ?? 0) + 1 } } };
}

export function disenchantCard(p: Profile, cardId: string): { ok: boolean; profile: Profile; error?: string } {
  const def = getCard(cardId);
  const have = p.collection[cardId] ?? 0;
  if (def.rarity === 'FREE') return { ok: false, profile: p, error: '基本卡無法分解' };
  if (have <= 0) return { ok: false, profile: p, error: '沒有這張卡' };
  const collection = { ...p.collection, [cardId]: have - 1 };
  if (collection[cardId] <= 0) delete collection[cardId];
  // 套牌中超過擁有數量的卡會被移除
  const decks = p.decks.map((d) => {
    const inDeck = d.cards.filter((id) => id === cardId).length;
    const left = collection[cardId] ?? 0;
    if (inDeck <= left) return d;
    let remove = inDeck - left;
    return { ...d, cards: d.cards.filter((id) => !(id === cardId && remove-- > 0)) };
  });
  return { ok: true, profile: { ...p, dust: p.dust + DISENCHANT_VALUE[def.rarity], collection, decks } };
}

/** 分解所有超過套牌上限的多餘卡牌 */
export function disenchantExtras(p: Profile): { profile: Profile; dust: number; count: number } {
  const collection = { ...p.collection };
  let dust = 0;
  let count = 0;
  for (const [id, n] of Object.entries(collection)) {
    const def = getCard(id);
    if (def.rarity === 'FREE') continue;
    const extra = n - maxCopies(def);
    if (extra > 0) {
      dust += extra * DISENCHANT_VALUE[def.rarity];
      count += extra;
      collection[id] = maxCopies(def);
    }
  }
  return { profile: { ...p, collection, dust: p.dust + dust }, dust, count };
}

// ---------------------------------------------------------------------------
// 對戰結果
// ---------------------------------------------------------------------------

export function today(): string {
  const d = new Date();
  return `${d.getFullYear()}-${d.getMonth() + 1}-${d.getDate()}`;
}

export function recordMatch(
  p: Profile,
  result: 'win' | 'loss' | 'draw',
  difficulty: Difficulty,
  myClass: HeroClass,
  oppClass: HeroClass,
  date = today(),
  extra: { gold?: number; mode?: 'ladder'; opp?: string; rank?: string } = {},
): { profile: Profile; gold: number; dailyBonus: number } {
  const { gold: baseGold, ...info } = extra;
  let gold = baseGold ?? (result === 'win' ? WIN_REWARD[difficulty] : LOSS_REWARD[difficulty]);
  let dailyBonus = 0;
  let lastDailyWin = p.lastDailyWin;
  if (result === 'win' && p.lastDailyWin !== date) {
    dailyBonus = DAILY_FIRST_WIN_BONUS;
    lastDailyWin = date;
  }
  gold += dailyBonus;
  const record: MatchRecord = { date: new Date().toISOString(), result, difficulty, gold, myClass, oppClass, ...info };
  return {
    gold,
    dailyBonus,
    profile: {
      ...p,
      gold: p.gold + gold,
      wins: p.wins + (result === 'win' ? 1 : 0),
      losses: p.losses + (result === 'loss' ? 1 : 0),
      lastDailyWin,
      history: [...p.history, record].slice(-30),
    },
  };
}

// ---------------------------------------------------------------------------
// 套牌
// ---------------------------------------------------------------------------

export function saveDeck(p: Profile, deck: Deck): Profile {
  const exists = p.decks.some((d) => d.id === deck.id);
  return { ...p, decks: exists ? p.decks.map((d) => (d.id === deck.id ? deck : d)) : [...p.decks, deck] };
}

export function deleteDeck(p: Profile, deckId: string): Profile {
  return { ...p, decks: p.decks.filter((d) => d.id !== deckId) };
}
