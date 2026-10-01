// 天梯：牌階、星星、賽季，以及配對到的「玩家」（其實是各有個性的電腦）
import { COLLECTIBLE, PLAYABLE_CLASSES } from '../cards/registry';
import type { AiPersona, Difficulty } from '../engine/ai';
import { CLASS_NAMES } from '../engine/heroes';
import { nextRandom } from '../engine/rng';
import type { CardDef, Race } from '../engine/types';
import { buildDeck, cardAllowed, type HeroClass } from './decks';
import { recordMatch, type Profile } from './profile';

export const LEAGUES = [
  { name: '青銅', color: '#c07a45' },
  { name: '白銀', color: '#c9d2dc' },
  { name: '黃金', color: '#f2c14e' },
  { name: '白金', color: '#7fe3d2' },
  { name: '鑽石', color: '#8fb8ff' },
] as const;
export const LEGEND = { name: '傳說', color: '#ff9b3d' };
export const STARS_PER_RANK = 3;
export const RANKS_PER_LEAGUE = 10;
/** 累積到這麼多星就進入傳說 */
export const LEGEND_STARS = LEAGUES.length * RANKS_PER_LEAGUE * STARS_PER_RANK;
/** 每 5 個牌階有一個保底（不會掉回去） */
const FLOOR_STARS = 5 * STARS_PER_RANK;
/** 鑽石 5 以上沒有連勝加成 */
const NO_STREAK_FROM = (4 * RANKS_PER_LEAGUE + 5) * STARS_PER_RANK;
/** 新賽季退回幾顆星 */
const SEASON_RESET = 12;

export interface LadderState {
  season: string;
  /** 累積的星星（0 = 青銅 10） */
  stars: number;
  /** 傳說名次（還沒到傳說時為 null） */
  legend: number | null;
  /** 目前連勝場數 */
  streak: number;
  /** 本季最高星數（傳說 = LEGEND_STARS） */
  best: number;
  bestLegend: number | null;
  wins: number;
  losses: number;
  /** 上一季結算的獎勵（顯示用） */
  lastReward?: { season: string; gold: number; rank: string };
}

export interface RankInfo {
  /** 0 ～ 4 為一般牌階，5 為傳說 */
  league: number;
  leagueName: string;
  /** 10 ～ 1 */
  rank: number;
  /** 這個牌階已經拿到的星星（0 ～ 2） */
  pips: number;
  label: string;
  color: string;
  legend: number | null;
}

export function seasonOf(date = new Date()): string {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}`;
}

export function seasonName(season: string): string {
  const [y, m] = season.split('-');
  return `${y} 年 ${Number(m)} 月賽季`;
}

export function newLadder(season = seasonOf()): LadderState {
  return { season, stars: 0, legend: null, streak: 0, best: 0, bestLegend: null, wins: 0, losses: 0 };
}

export function rankInfo(stars: number, legend: number | null): RankInfo {
  if (legend !== null || stars >= LEGEND_STARS) {
    const n = legend ?? 0;
    return { league: 5, leagueName: LEGEND.name, rank: 0, pips: 0, label: n ? `傳說 #${n}` : '傳說', color: LEGEND.color, legend: n || null };
  }
  const idx = Math.floor(stars / STARS_PER_RANK);
  const league = Math.floor(idx / RANKS_PER_LEAGUE);
  const rank = RANKS_PER_LEAGUE - (idx % RANKS_PER_LEAGUE);
  const L = LEAGUES[league];
  return { league, leagueName: L.name, rank, pips: stars % STARS_PER_RANK, label: `${L.name} ${rank}`, color: L.color, legend: null };
}

export function ladderRank(l: LadderState): RankInfo {
  return rankInfo(l.stars, l.legend);
}

/** 0（青銅 10）～ 1（傳說） */
export function ladderProgress(stars: number, legend: number | null): number {
  if (legend !== null) return 1;
  return Math.min(1, stars / LEGEND_STARS);
}

export function sanitizeLadder(raw: unknown): LadderState {
  const base = newLadder();
  if (!raw || typeof raw !== 'object') return base;
  const l = raw as Partial<LadderState>;
  const num = (v: unknown, d: number) => (typeof v === 'number' && Number.isFinite(v) ? v : d);
  const stars = Math.max(0, Math.min(LEGEND_STARS, Math.floor(num(l.stars, 0))));
  const legend = typeof l.legend === 'number' && l.legend >= 1 && stars >= LEGEND_STARS ? Math.floor(l.legend) : null;
  return {
    season: typeof l.season === 'string' ? l.season : base.season,
    stars: legend === null && stars >= LEGEND_STARS ? LEGEND_STARS - 1 : stars,
    legend,
    streak: Math.max(0, Math.floor(num(l.streak, 0))),
    best: Math.max(0, Math.floor(num(l.best, stars))),
    bestLegend: typeof l.bestLegend === 'number' ? l.bestLegend : null,
    wins: Math.max(0, Math.floor(num(l.wins, 0))),
    losses: Math.max(0, Math.floor(num(l.losses, 0))),
    lastReward: l.lastReward,
  };
}

// ---------------------------------------------------------------------------
// 賽季
// ---------------------------------------------------------------------------

/** 各牌階的賽季獎勵（依本季最高牌階） */
export const SEASON_REWARD = [40, 80, 120, 180, 250, 400];

/** 換季：依上季最高牌階發獎勵，並把星星退回一些 */
export function ensureSeason(p: Profile, now = new Date()): { profile: Profile; reward: LadderState['lastReward'] | null } {
  const season = seasonOf(now);
  const l = p.ladder ?? newLadder(season);
  if (l.season === season) return { profile: p.ladder ? p : { ...p, ladder: l }, reward: null };
  const played = l.wins + l.losses > 0;
  const bestInfo = rankInfo(l.best, l.best >= LEGEND_STARS ? l.bestLegend : null);
  const gold = played ? SEASON_REWARD[bestInfo.league] : 0;
  const reward = played ? { season: l.season, gold, rank: bestInfo.legend ? `傳說 #${bestInfo.legend}` : bestInfo.label } : null;
  const stars = Math.max(0, Math.floor((Math.min(l.stars, LEGEND_STARS) - SEASON_RESET) / STARS_PER_RANK) * STARS_PER_RANK);
  const next: LadderState = { ...newLadder(season), stars, best: stars, lastReward: reward ?? l.lastReward };
  return { profile: { ...p, gold: p.gold + gold, ladder: next }, reward };
}

// ---------------------------------------------------------------------------
// 勝敗
// ---------------------------------------------------------------------------

export interface LadderChange {
  before: RankInfo;
  after: RankInfo;
  /** 星星增減 */
  stars: number;
  streakBonus: boolean;
  /** 保底讓你沒有掉星 */
  protectedByFloor: boolean;
  /** 晉升訊息（例如「晉升到黃金！」） */
  promoted: string | null;
}

export function applyLadderResult(l: LadderState, result: 'win' | 'loss' | 'draw', rand: () => number = Math.random): { ladder: LadderState; change: LadderChange } {
  const before = ladderRank(l);
  const next: LadderState = { ...l };
  let stars = 0;
  let streakBonus = false;
  let protectedByFloor = false;
  let promoted: string | null = null;
  if (result === 'win') {
    next.wins++;
    next.streak = l.streak + 1;
    if (l.legend !== null) {
      next.legend = Math.max(1, l.legend - legendStep(l.legend, rand));
    } else {
      stars = next.streak >= 3 && l.stars < NO_STREAK_FROM ? 2 : 1;
      streakBonus = stars === 2;
      next.stars = Math.min(LEGEND_STARS, l.stars + stars);
      if (next.stars >= LEGEND_STARS) {
        next.legend = 300 + Math.floor(rand() * 1700);
        promoted = '達成傳說！';
      }
    }
  } else if (result === 'loss') {
    next.losses++;
    next.streak = 0;
    if (l.legend !== null) {
      next.legend = l.legend + legendStep(l.legend, rand);
    } else {
      const floor = Math.floor(l.stars / FLOOR_STARS) * FLOOR_STARS;
      if (l.stars > floor) {
        next.stars = l.stars - 1;
        stars = -1;
      } else protectedByFloor = l.stars > 0;
    }
  }
  const after = ladderRank(next);
  if (!promoted && after.league > before.league) promoted = `晉升到${after.leagueName}！`;
  next.best = Math.max(l.best, next.stars);
  if (next.legend !== null) next.bestLegend = Math.min(l.bestLegend ?? Infinity, next.legend);
  return { ladder: next, change: { before, after, stars, streakBonus, protectedByFloor, promoted } };
}

function legendStep(legend: number, rand: () => number): number {
  return Math.max(1, Math.round(legend * (0.02 + rand() * 0.04)) + Math.floor(rand() * 4));
}

/** 天梯對戰的金幣獎勵 */
export function ladderGold(l: LadderState, result: 'win' | 'loss' | 'draw'): number {
  if (result !== 'win') return 10;
  return 40 + ladderRank(l).league * 10;
}

/** 記錄一場天梯對戰：更新牌階、金幣、戰績 */
export function recordLadderMatch(
  p: Profile,
  result: 'win' | 'loss' | 'draw',
  myClass: HeroClass,
  opponent: LadderOpponent,
  rand: () => number = Math.random,
  now = new Date(),
): { profile: Profile; gold: number; dailyBonus: number; change: LadderChange; seasonReward: LadderState['lastReward'] | null } {
  const season = ensureSeason(p, now);
  const ladder = season.profile.ladder!;
  const base = ladderGold(ladder, result);
  const { ladder: next, change } = applyLadderResult(ladder, result, rand);
  const r = recordMatch(season.profile, result, opponent.difficulty, myClass, opponent.heroClass, undefined, {
    gold: base,
    mode: 'ladder',
    opp: opponent.name,
    rank: change.after.label,
  });
  return { profile: { ...r.profile, ladder: next }, gold: r.gold, dailyBonus: r.dailyBonus, change, seasonReward: season.reward };
}

// ---------------------------------------------------------------------------
// 配對到的對手
// ---------------------------------------------------------------------------

export type DeckKind = 'netdeck' | 'homebrew' | 'meme' | 'random';

export interface LadderOpponent {
  name: string;
  heroClass: HeroClass;
  stars: number;
  legend: number | null;
  rank: RankInfo;
  deck: string[];
  deckKind: DeckKind;
  /** 套牌類型（例如「快攻獵人」「全大哥法師」） */
  deckName: string;
  persona: AiPersona;
  /** 大約相當於哪個練習難度（紀錄用） */
  difficulty: Difficulty;
  /** 配對要等幾秒 */
  queueSeconds: number;
}

const ZH_PREFIX = ['小', '阿', '老', '大', '超級', '無敵', '快樂的', '憂鬱的', '暗夜', '月光', '北極', '深夜', '爆肝', '佛系', '隔壁', '路過的', '會飛的', '不睡覺的', '認真的', '傳說中的'];
const ZH_NOUN = ['火龍', '貓咪', '熊貓', '法師', '獵人', '牧師', '薩滿', '盜賊', '魚人', '奶茶', '布丁', '鹹魚', '雞排', '狼人', '騎士', '小丑', '企鵝', '蘿蔔', '麻糬', '泡麵', '水餃', '豆花', '仙草', '老虎', '德魯伊', '術士', '聖騎', '戰士'];
const ZH_SUFFIX = ['大師', '王', '不會輸', '好想贏', '又輸了', '上傳說', '愛打牌', '本人', '在此', '來了', '別打我', '很強'];
const EN_NAME = ['Dragon', 'Shadow', 'Frost', 'Pepper', 'Mochi', 'Kevin', 'Jason', 'Amy', 'Luna', 'Nova', 'Ace', 'Zed', 'Taco', 'Noob', 'Tiger', 'Wolf', 'Bread', 'Leo', 'Kai', 'Momo', 'Yuki', 'Bobo', 'Sky', 'Milk'];
const EN_SUFFIX = ['Slayer', 'TW', 'GG', 'Main', 'Hunter', 'King', 'xD', 'owo', 'Pro', 'OTK', 'Face', 'Lord', 'Chan'];

function makeName(r: () => number): string {
  const p = <T,>(xs: readonly T[]) => xs[Math.floor(r() * xs.length)];
  const digits = () => String(Math.floor(r() * (r() < 0.5 ? 100 : 10000)));
  switch (Math.floor(r() * 7)) {
    case 0:
      return p(ZH_PREFIX) + p(ZH_NOUN);
    case 1:
      return p(ZH_NOUN) + p(ZH_SUFFIX);
    case 2:
      return p(EN_NAME) + p(EN_SUFFIX);
    case 3:
      return p(EN_NAME) + digits();
    case 4:
      return p(ZH_NOUN) + digits();
    case 5:
      return p(EN_NAME) + (r() < 0.5 ? '_' : '') + p(EN_NAME);
    default:
      return p(ZH_PREFIX) + p(ZH_NOUN) + p(ZH_SUFFIX);
  }
}

const TRIBE_NAMES: Partial<Record<Race, string>> = {
  BEAST: '野獸',
  DEMON: '惡魔',
  DRAGON: '龍',
  ELEMENTAL: '元素',
  MECHANICAL: '機械',
  MURLOC: '魚人',
  PIRATE: '海盜',
  UNDEAD: '不死族',
  TOTEM: '圖騰',
  DRAENEI: '德萊尼',
};

type Recipe = { name: string; filter?: (c: CardDef) => boolean; bias?: (c: CardDef) => number; curve?: Record<number, number>; singleton?: boolean; maxLegendary?: number };

const has = (c: CardDef, k: string) => c.keywords?.includes(k as never) ?? false;
const effectText = (c: CardDef) => JSON.stringify(c.abilities ?? []);

const ARCHETYPES: Record<string, Recipe> = {
  aggro: {
    name: '快攻',
    bias: (c) => (c.cost <= 3 ? 1.5 : 0) + (has(c, 'CHARGE') || has(c, 'RUSH') ? 1 : 0) - (c.cost >= 6 ? 2.5 : 0) + (c.type === 'MINION' ? 0.5 : 0),
    curve: { 0: 1, 1: 7, 2: 8, 3: 6, 4: 4, 5: 2, 6: 1, 7: 1 },
  },
  midrange: { name: '中速', bias: (c) => (c.type === 'MINION' && c.cost >= 2 && c.cost <= 6 ? 0.8 : 0) },
  control: {
    name: '控制',
    bias: (c) =>
      (has(c, 'TAUNT') ? 1.2 : 0) +
      (/"t":"all"/.test(effectText(c)) && /"e":"damage"/.test(effectText(c)) ? 1.5 : 0) +
      (/"e":"(heal|armor|destroy)"/.test(effectText(c)) ? 1 : 0) +
      (c.cost >= 6 ? 0.8 : 0) -
      (c.cost <= 1 ? 1 : 0),
    curve: { 0: 1, 1: 2, 2: 5, 3: 5, 4: 5, 5: 4, 6: 3, 7: 2, 8: 2, 9: 1, 10: 1 },
  },
  spells: { name: '法術', bias: (c) => (c.type === 'SPELL' ? 2.2 : 0) },
};

const MEMES: Recipe[] = [
  { name: '全大哥', filter: (c) => c.cost >= 6, curve: { 6: 10, 7: 10, 8: 10, 9: 10, 10: 10 } },
  { name: '小不點', filter: (c) => c.cost <= 1, curve: { 0: 15, 1: 15 } },
  { name: '傳說收藏家', filter: (c) => c.rarity === 'LEGENDARY', singleton: true, maxLegendary: 30, curve: { 0: 5, 1: 5, 2: 5, 3: 5, 4: 5, 5: 5, 6: 5, 7: 5, 8: 5, 9: 5, 10: 5 } },
  { name: '奇數', filter: (c) => c.cost % 2 === 1, curve: { 1: 8, 3: 8, 5: 7, 7: 5, 9: 3 } },
  { name: '偶數', filter: (c) => c.cost % 2 === 0, curve: { 0: 2, 2: 9, 4: 8, 6: 6, 8: 4, 10: 2 } },
  { name: '嘲諷牆', filter: (c) => has(c, 'TAUNT') },
  { name: '沒有手下的', filter: (c) => c.type !== 'MINION' },
  { name: '單卡', singleton: true },
  { name: '全武器', filter: (c) => c.type === 'WEAPON' || /"e":"(equip|weaponBuff)"/.test(effectText(c)) },
];

function tribeRecipe(cls: HeroClass, r: () => number, strict: boolean): Recipe | null {
  const counts = new Map<Race, number>();
  for (const c of poolFor(cls)) for (const race of c.races ?? []) if (TRIBE_NAMES[race]) counts.set(race, (counts.get(race) ?? 0) + 1);
  const options = [...counts].filter(([, n]) => n >= (strict ? 10 : 14)).map(([race]) => race);
  if (!options.length) return null;
  const race = options[Math.floor(r() * options.length)];
  const isTribe = (c: CardDef) => !!c.races?.includes(race) || !!c.races?.includes('ALL') || effectText(c).includes(`"${race}"`);
  return strict ? { name: `純${TRIBE_NAMES[race]}`, filter: isTribe } : { name: TRIBE_NAMES[race]!, bias: (c) => (isTribe(c) ? 3.5 : 0) };
}

const poolCache = new Map<HeroClass, CardDef[]>();
/** 某職業能用的卡（職業卡與中立卡） */
function poolFor(cls: HeroClass): CardDef[] {
  let pool = poolCache.get(cls);
  if (!pool) {
    pool = COLLECTIBLE.filter((c) => cardAllowed(c, cls, false));
    poolCache.set(cls, pool);
  }
  return pool;
}

function clamp(v: number, lo: number, hi: number) {
  return Math.max(lo, Math.min(hi, v));
}

/** 依照玩家目前的牌階，配對一個「玩家」 */
export function findOpponent(l: Pick<LadderState, 'stars' | 'legend'>, seed = Math.floor(Math.random() * 2 ** 31)): LadderOpponent {
  const rs = { rng: seed || 1 };
  const r = () => nextRandom(rs);
  const gauss = () => (r() + r() + r() - 1.5) * 1.4;

  // 對手的牌階：和你差不多
  let stars = l.stars;
  let legend: number | null = null;
  if (l.legend !== null) {
    legend = Math.max(1, Math.round(l.legend * (0.7 + r() * 0.6) + gauss() * 20));
    stars = LEGEND_STARS;
  } else {
    stars = clamp(l.stars + Math.round(gauss() * 3), 0, LEGEND_STARS - 1);
  }
  const t = ladderProgress(stars, legend);
  const legendBonus = legend !== null ? clamp(1 - legend / 2000, 0, 1) * 0.08 : 0;

  // 套牌：高牌階多半是網路上的強力套牌，低牌階什麼都有
  const weights: [DeckKind, number][] = [
    ['netdeck', 0.12 + 0.72 * t],
    ['homebrew', 0.35 - 0.15 * t],
    ['meme', 0.23 - 0.17 * t],
    ['random', 0.3 - 0.28 * t],
  ];
  let roll = r() * weights.reduce((x, [, w]) => x + w, 0);
  let deckKind: DeckKind = 'netdeck';
  for (const [k, w] of weights) {
    if ((roll -= w) <= 0) {
      deckKind = k;
      break;
    }
  }

  const heroClass = PLAYABLE_CLASSES[Math.floor(r() * PLAYABLE_CLASSES.length)];
  const cls = CLASS_NAMES[heroClass];
  // 低牌階的玩家收藏比較少
  const rarities: CardDef['rarity'][] | undefined = t < 0.15 ? ['FREE', 'COMMON', 'RARE'] : undefined;
  const maxLegendary = t < 0.15 ? 0 : t < 0.4 ? 2 : 5;
  const deckSeed = Math.floor(r() * 1e9);

  let recipe: Recipe;
  let noise: number;
  let archetype = '';
  if (deckKind === 'meme') {
    const tribe = r() < 0.3 ? tribeRecipe(heroClass, r, true) : null;
    recipe = tribe ?? MEMES[Math.floor(r() * MEMES.length)];
    noise = 3;
  } else if (deckKind === 'random') {
    recipe = { name: '亂組的', curve: Object.fromEntries(Array.from({ length: 11 }, (_, i) => [i, 30])) };
    noise = 80;
  } else {
    const keys = ['aggro', 'midrange', 'control', 'spells', 'tribe'];
    archetype = keys[Math.floor(r() * keys.length)];
    recipe = (archetype === 'tribe' ? tribeRecipe(heroClass, r, false) : null) ?? ARCHETYPES[archetype === 'tribe' ? 'midrange' : archetype];
    noise = deckKind === 'netdeck' ? 0.5 + r() * 0.7 : 2.5 + r() * 2.5;
  }
  const deck = buildDeck(heroClass, {
    seed: deckSeed,
    noise,
    rarities,
    maxLegendary: recipe.maxLegendary ?? maxLegendary,
    filter: recipe.filter,
    bias: recipe.bias,
    curve: recipe.curve,
    singleton: recipe.singleton,
  });
  const deckName = recipe.name === '亂組的' ? `亂組的${cls}` : `${recipe.name}${cls}`;

  // 技術：牌階越高越強，但每個人都不一樣（有人被高估、有人被低估）
  let skill = 0.15 + 0.75 * t + legendBonus + gauss() * 0.11;
  if (deckKind === 'random') skill -= 0.12;
  if (deckKind === 'netdeck') skill += 0.04;
  skill = clamp(skill, 0.03, 1);

  let aggression = clamp(gauss() * 0.4, -1, 1);
  if (archetype === 'aggro') aggression = clamp(0.6 + gauss() * 0.2, 0, 1);
  if (archetype === 'control') aggression = clamp(-0.55 + gauss() * 0.2, -1, 0);
  const speedRoll = r() + (skill - 0.5) * 0.4;
  const persona: AiPersona = {
    skill,
    aggression,
    chatty: Math.pow(r(), 1.4),
    concede: clamp(0.25 + r() * 0.6 + t * 0.1, 0, 1),
    speed: speedRoll > 0.72 ? 'fast' : speedRoll < 0.28 ? 'slow' : 'normal',
    rude: r() < 0.06,
    seed: Math.floor(r() * 1e9),
  };
  const difficulty: Difficulty = skill >= 0.66 ? 'hard' : skill >= 0.33 ? 'normal' : 'easy';
  // 高牌階的人比較少，要等比較久
  const queueSeconds = Math.round(2 + r() * 5 + t * t * 8 + (legend !== null ? r() * 10 : 0));

  return {
    name: makeName(r),
    heroClass,
    stars,
    legend,
    rank: rankInfo(stars, legend),
    deck,
    deckKind,
    deckName,
    persona,
    difficulty,
    queueSeconds,
  };
}

export const DECK_KIND_NAMES: Record<DeckKind, string> = {
  netdeck: '主流套牌',
  homebrew: '自組套牌',
  meme: '奇葩套路',
  random: '亂組',
};
