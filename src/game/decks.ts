// 套牌規則與自動組牌（新手套牌 / 電腦套牌）
import { cardClasses, COLLECTIBLE, getCard } from '../cards/registry';
import { nextRandom, shuffle } from '../engine/rng';
import type { Ability, Amount, CardClass, CardDef, Effect, Runes } from '../engine/types';

export const DECK_SIZE = 30;

/** 阿薩琳娜的 20 張自組牌；另外 20 張在開局時複製自對手。 */
export function deckSize(cards: readonly string[]): number {
  return cards.includes('JAIL_430') ? 20 : DECK_SIZE;
}

export type HeroClass = Exclude<CardClass, 'NEUTRAL'>;

export interface Deck {
  id: string;
  name: string;
  heroClass: HeroClass;
  /** 不限職業：可以放入任何職業的卡 */
  freeform: boolean;
  cards: string[];
  /** 紫羅蘭堡組牌副牌：key = 規則破壞者卡牌 ID */
  sideboards?: Record<string, string[]>;
}

export function maxCopies(def: CardDef): number {
  return def.rarity === 'LEGENDARY' ? 1 : 2;
}

export function cardAllowed(def: CardDef, heroClass: HeroClass, freeform: boolean): boolean {
  if (!def.collectible) return false;
  if (freeform) return true;
  const classes = cardClasses(def);
  return classes.includes('NEUTRAL') || classes.includes(heroClass);
}

export const MAX_RUNES = 3;
export const RUNE_KINDS = ['blood', 'frost', 'unholy'] as const;
export const RUNE_NAMES: Record<keyof Runes, string> = { blood: '血魄', frost: '冰霜', unholy: '穢邪' };

/** 套牌需要的符文：每種符文取卡牌中最高的需求 */
export function deckRunes(cards: string[]): Required<Runes> {
  const r = { blood: 0, frost: 0, unholy: 0 };
  for (const id of new Set(cards)) {
    let def: CardDef;
    try {
      def = getCard(id);
    } catch {
      continue;
    }
    for (const k of RUNE_KINDS) r[k] = Math.max(r[k], def.runes?.[k] ?? 0);
  }
  return r;
}

export function runeTotal(r: Runes): number {
  return (r.blood ?? 0) + (r.frost ?? 0) + (r.unholy ?? 0);
}

/** 放入這張卡後符文是否仍在 3 個以內 */
export function runesFit(current: Runes, def: CardDef): boolean {
  if (!def.runes) return true;
  let total = 0;
  for (const k of RUNE_KINDS) total += Math.max(current[k] ?? 0, def.runes[k] ?? 0);
  return total <= MAX_RUNES;
}

export interface DeckProblem {
  ok: boolean;
  errors: string[];
}

export function validateDeck(deck: Deck, owned?: Record<string, number>): DeckProblem {
  const errors: string[] = [];
  const size = deckSize(deck.cards);
  if (deck.cards.length !== size) errors.push(`套牌需要剛好 ${size} 張（目前 ${deck.cards.length} 張）`);
  const counts = new Map<string, number>();
  for (const id of deck.cards) counts.set(id, (counts.get(id) ?? 0) + 1);
  for (const [id, n] of counts) {
    let def: CardDef;
    try {
      def = getCard(id);
    } catch {
      errors.push(`未知卡牌 ${id}`);
      continue;
    }
    if (n > maxCopies(def)) errors.push(`【${def.name}】最多只能放 ${maxCopies(def)} 張`);
    if (!cardAllowed(def, deck.heroClass, deck.freeform)) errors.push(`【${def.name}】不屬於此職業`);
    if (owned && (owned[id] ?? 0) < n) errors.push(`你沒有足夠的【${def.name}】`);
  }
  if (deck.cards.includes('JAIL_397')) {
    const picks = deck.sideboards?.JAIL_397 ?? [];
    if (picks.length !== 1) errors.push('【Commander Beatrix】需要選擇 1 張聖騎士或中立的 2 費手下');
    for (const id of picks) {
      const c = getCard(id);
      if (c.type !== 'MINION' || c.cost !== 2 || !cardAllowed(c, 'PALADIN', false)) errors.push('Beatrix 副牌只能是聖騎士或中立的 2 費手下');
      if (deck.cards.includes(id)) errors.push('Beatrix 副牌手下不能同時放在主牌組');
    }
  }
  if (deck.cards.includes('JAIL_831')) {
    const picks = deck.sideboards?.JAIL_831 ?? [];
    if (picks.length !== 3 || new Set(picks).size !== 3) errors.push('【King of the Underbelly】需要選擇 3 張不同的違禁野獸');
    for (const id of picks) {
      const c = getCard(id);
      const classes = cardClasses(c);
      if (c.type !== 'MINION' || !(c.races?.includes('BEAST') || c.races?.includes('ALL')) || classes.includes('HUNTER') || classes.includes('NEUTRAL')) {
        errors.push('Underbelly 副牌只能選非獵人、非中立職業的野獸');
      }
    }
  }
  const runes = deckRunes(deck.cards);
  if (runeTotal(runes) > MAX_RUNES) {
    const need = RUNE_KINDS.filter((k) => runes[k]).map((k) => `${RUNE_NAMES[k]}×${runes[k]}`).join('、');
    errors.push(`符文最多 ${MAX_RUNES} 個（目前需要 ${need}）`);
  }
  return { ok: errors.length === 0, errors };
}

/** 單一效果的大致價值（以「一點身材」為單位） */
function effectValue(e: Effect): number {
  const amt = (a: Amount | undefined) => (typeof a === 'number' ? a : a ? 2.5 : 0);
  switch (e.e) {
    case 'damage': {
      const n = amt(e.amount);
      if (e.target.t === 'all') return n * (e.target.filter.side === 'enemy' ? 2.2 : 0.8);
      if (e.target.t === 'hero') return e.target.side === 'friendly' ? -n * 0.5 : n * 0.6;
      if (e.target.t === 'self') return -n * 0.6;
      return n * 1.1;
    }
    case 'splitDamage':
      return amt(e.amount) * 0.9;
    case 'launchDiscount':
      return e.amount * 0.4;
    case 'launchStarship':
      return 6;
    case 'delayed':
      return e.effects.reduce((x, f) => x + effectValue(f), 0) * 0.7;
    case 'cthunBuff':
      return (e.atk + e.hp) * 0.45 + (e.taunt ? 0.5 : 0);
    case 'heal':
    case 'armor':
      return amt('amount' in e ? e.amount : 0) * 0.4;
    case 'buff': {
      const v = amt(e.atk) + amt(e.hp) + (e.keywords?.length ?? 0) * 1.2;
      const mult = e.target.t === 'all' ? 2.2 : 1;
      return (e.temp ? v * 0.4 : v) * mult;
    }
    case 'draw':
      return (e.who === 'self' ? 1.6 : e.who === 'both' ? 0.3 : -1.2) * amt(e.count);
    case 'summon':
    case 'summonRandom':
      return (e.who === 'opponent' ? -2.5 : 2.5) * e.count;
    case 'summonCopy':
      return 3 * e.count;
    case 'destroy':
      return e.target.t === 'all' ? 4 : e.target.t === 'self' ? -2 : 4.5;
    case 'silence':
    case 'freeze':
      return 1.2;
    case 'steal':
      return 6;
    case 'transform':
    case 'transformRandom':
      return 3;
    case 'returnToHand':
      return 1.5;
    case 'discover':
      return 1.8;
    case 'addCard':
    case 'addRandom':
    case 'addCopy':
      return 1.2 * ('count' in e ? e.count : 1);
    case 'equip':
      return 3;
    case 'heroAttack':
      return e.amount * 0.6;
    case 'mana':
      return e.kind === 'destroy' ? -2 : e.amount * 1.2;
    case 'discard':
      return -1.5 * Math.min(e.count, 3);
    case 'handBuff':
      return (e.atk + e.hp) * (e.scope === 'all' ? 1.5 : 0.8);
    case 'weaponBuff':
      return (e.atk ?? 0) + (e.dur ?? 0);
    case 'cond':
      return e.then.reduce((x, f) => x + effectValue(f), 0) * 0.6;
    case 'repeat':
      return e.effects.reduce((x, f) => x + effectValue(f), 0) * 2;
    default:
      return 1;
  }
}

function abilityValue(a: Ability): number {
  const v = a.effects.reduce((x, e) => x + effectValue(e), 0) * (a.cond ? 0.6 : 1);
  switch (a.on.k) {
    case 'play':
      return v;
    case 'deathrattle':
      return v * 0.85;
    case 'secret':
      return v * 0.8;
    case 'turnEnd':
    case 'turnStart':
      return v * (a.on.whose === 'mine' || a.on.whose === 'each' ? 1.6 : 0.5);
    default:
      return v * (a.once ? 0.6 : 1.1);
  }
}

/** 粗略的卡牌強度（自動組牌用）：卡牌價值減去費用的期望值 */
export function cardQuality(def: CardDef): number {
  let value = (def.abilities ?? []).reduce((x, a) => x + abilityValue(a), 0);
  if (def.chooseOne) value += Math.max(...def.chooseOne.map((o) => o.abilities.reduce((x, a) => x + abilityValue(a), 0)), 0) + 0.5;
  value += (def.auras ?? []).reduce((x, a) => x + ((a.atk ?? 0) + (a.hp ?? 0) + (a.keywords?.length ?? 0)) * (a.scope === 'adjacent' ? 1.2 : 2), 0);
  value += (def.spellDamage ?? 0) * 1.5;
  let q: number;
  if (def.type === 'MINION') {
    const atk = def.attack ?? 0;
    const hp = def.health ?? 0;
    value += atk + hp;
    for (const k of def.keywords ?? []) {
      if (k === 'CANT_ATTACK') value -= atk * 0.9;
      else if (k === 'DIVINE_SHIELD') value += atk * 0.8 + 0.5;
      else if (k === 'CHARGE') value += atk * 0.6;
      else if (k === 'RUSH') value += atk * 0.4;
      else if (k === 'WINDFURY') value += atk * 0.6;
      else if (k === 'TAUNT') value += hp * 0.25;
      else if (k === 'LIFESTEAL') value += atk * 0.5;
      else if (k === 'POISONOUS') value += 2;
      else value += 0.8;
    }
    if (def.enrage) value += def.enrage.atk * 0.4;
    q = value - (def.cost * 2 + 1);
  } else if (def.type === 'LOCATION') {
    value += (def.locationEffects ?? []).reduce((n, e) => n + effectValue(e), 0) * (def.health ?? 1);
    q = value - def.cost;
  } else if (def.type === 'WEAPON') {
    value += (def.attack ?? 0) * (def.health ?? 0) * 0.9;
    q = value - (def.cost * 2 + 0.5);
  } else if (def.type === 'HERO') {
    // 英雄卡：戰吼 + 護甲 + 更強的英雄能力
    value += (def.armor ?? 0) * 0.5 + 6;
    q = value - (def.cost * 1.6 + 0.6);
  } else {
    q = value - (def.cost * 1.6 + 0.6);
  }
  // 回音：後期有多餘法力時可以重複使用
  if (def.keywords?.includes('ECHO')) q += 1 + Math.max(0, value - def.cost) * 0.3;
  // 星艦組件：之後還能組裝成星艦
  if (def.starshipPiece) q += ((def.attack ?? 0) + (def.health ?? 0)) * 0.3;
  if (def.overload) q -= def.overload * 1.2;
  if (def.costRule) q += 1;
  return q;
}

/** 理想費用曲線（每個費用的張數上限） */
const CURVE: Record<number, number> = { 0: 1, 1: 4, 2: 6, 3: 6, 4: 5, 5: 4, 6: 3, 7: 2, 8: 2, 9: 1, 10: 1 };

export interface BuildOptions {
  seed: number;
  /** 補滿既有套牌時的張數上限。 */
  size?: number;
  /** 0 = 完全依強度；越大越隨機 */
  noise: number;
  /** 最多幾張傳說 */
  maxLegendary?: number;
  /** 只能使用這些稀有度 */
  rarities?: CardDef['rarity'][];
  /** 可用卡牌數量（例如玩家的收藏） */
  owned?: Record<string, number>;
  /** 已經佔用的符文（補滿既有套牌時） */
  runes?: Runes;
  /** 只從符合條件的卡中挑選（不夠 30 張時才用其他卡補滿） */
  filter?: (c: CardDef) => boolean;
  /** 額外的偏好分數（例如偏好低費或某個種族） */
  bias?: (c: CardDef) => number;
  /** 每個費用的張數上限，預設為均衡的曲線 */
  curve?: Record<number, number>;
  /** 每張卡只放一張 */
  singleton?: boolean;
}

export function buildDeck(heroClass: HeroClass, opts: BuildOptions): string[] {
  const rng = { rng: opts.seed };
  const base = COLLECTIBLE.filter((c) => {
    if (!cardAllowed(c, heroClass, false)) return false;
    if (opts.rarities && !opts.rarities.includes(c.rarity)) return false;
    if (opts.owned && !opts.owned[c.id]) return false;
    return true;
  });
  const score = (c: CardDef) =>
    cardQuality(c) + (cardClasses(c).includes(heroClass) ? 0.6 : 0) + (opts.bias?.(c) ?? 0) + (nextRandom(rng) - 0.5) * opts.noise;
  const rank = (cards: CardDef[]) =>
    cards
      .map((c) => ({ c, score: score(c) }))
      .sort((a, b) => b.score - a.score)
      .map((x) => x.c);
  const scored = rank(opts.filter ? base.filter(opts.filter) : base);
  const curve = opts.curve ?? CURVE;
  const copiesOf = (c: CardDef) => Math.min(opts.singleton ? 1 : maxCopies(c), opts.owned ? opts.owned[c.id] ?? 0 : 2);
  const deck: string[] = [];
  const capacity = () => Math.min(opts.size ?? DECK_SIZE, deckSize(deck));
  const perCost = new Map<number, number>();
  let legendaries = 0;
  const runes: Required<Runes> = { blood: 0, frost: 0, unholy: 0, ...opts.runes };
  const takeRunes = (c: CardDef) => {
    for (const k of RUNE_KINDS) runes[k] = Math.max(runes[k], c.runes?.[k] ?? 0);
  };
  const add = (c: CardDef, respectCurve: boolean) => {
    if (!runesFit(runes, c)) return;
    if (deck.length >= deckSize([...deck, c.id])) return;
    const have = deck.filter((x) => x === c.id).length;
    for (let i = have; i < copiesOf(c) && deck.length < capacity(); i++) {
      const cost = Math.min(c.cost, 10);
      if (respectCurve && (perCost.get(cost) ?? 0) >= (curve[cost] ?? 1)) return;
      if (c.rarity === 'LEGENDARY') {
        if (legendaries >= (opts.maxLegendary ?? 3)) return;
        legendaries++;
      }
      takeRunes(c);
      deck.push(c.id);
      perCost.set(cost, (perCost.get(cost) ?? 0) + 1);
    }
  };
  const fill = (cards: CardDef[]) => {
    for (const c of cards) {
      if (deck.length >= capacity()) break;
      add(c, true);
    }
    for (const c of cards) {
      if (deck.length >= capacity()) break;
      if (!deck.includes(c.id)) add(c, false);
    }
    // 卡不夠時（收藏太少）重複補滿
    for (const c of cards) {
      if (deck.length >= capacity()) break;
      if (deck.length >= deckSize([...deck, c.id])) continue;
      const have = deck.filter((x) => x === c.id).length;
      const limit = copiesOf(c);
      if (have >= limit || !runesFit(runes, c)) continue;
      takeRunes(c);
      for (let i = have; i < limit && deck.length < capacity(); i++) deck.push(c.id);
    }
  };
  fill(scored);
  // 主題卡不夠 30 張時，用一般的卡補滿
  if (deck.length < capacity() && opts.filter) fill(rank(base));
  return shuffle(rng, deck).sort((a, b) => getCard(a).cost - getCard(b).cost);
}

export function deckCurve(cards: string[]): number[] {
  const curve = Array(8).fill(0);
  for (const id of cards) curve[Math.min(7, getCard(id).cost)]++;
  return curve;
}
