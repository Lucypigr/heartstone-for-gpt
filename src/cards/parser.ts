// ============================================================================
// 卡牌敘述解析器：把官方英文卡牌敘述轉換成效果 DSL。
// 採「整張卡完全看得懂才收錄」的策略：只要有一句無法解析，就回報不支援，
// 以免遊戲中出現效果錯誤的卡牌。
// ============================================================================
import type {
  Ability,
  Amount,
  Aura,
  CardClass,
  CardType,
  Condition,
  DynAmount,
  Effect,
  Filter,
  Keyword,
  Pool,
  Race,
  SecretEvent,
  TargetExpr,
  TargetReq,
  Trig,
} from '../engine/types';

export class Unsupported extends Error {}

function fail(reason: string): never {
  throw new Unsupported(reason);
}

// ---------------------------------------------------------------------------
// 基礎詞彙
// ---------------------------------------------------------------------------

const KEYWORD_WORDS: Record<string, Keyword> = {
  taunt: 'TAUNT',
  'divine shield': 'DIVINE_SHIELD',
  charge: 'CHARGE',
  rush: 'RUSH',
  windfury: 'WINDFURY',
  'mega-windfury': 'MEGA_WINDFURY',
  stealth: 'STEALTH',
  poisonous: 'POISONOUS',
  lifesteal: 'LIFESTEAL',
  reborn: 'REBORN',
  elusive: 'ELUSIVE',
  immune: 'IMMUNE',
  tradeable: 'TRADEABLE',
  echo: 'ECHO',
  twinspell: 'TWINSPELL',
};

const KEYWORD_RE = '(?:Mega-Windfury|Divine Shield|Taunt|Charge|Rush|Windfury|Stealth|Poisonous|Lifesteal|Reborn|Elusive|Immune)';

const RACE_WORDS: Record<string, Race> = {
  beast: 'BEAST',
  beasts: 'BEAST',
  demon: 'DEMON',
  demons: 'DEMON',
  dragon: 'DRAGON',
  dragons: 'DRAGON',
  elemental: 'ELEMENTAL',
  elementals: 'ELEMENTAL',
  mech: 'MECHANICAL',
  mechs: 'MECHANICAL',
  murloc: 'MURLOC',
  murlocs: 'MURLOC',
  pirate: 'PIRATE',
  pirates: 'PIRATE',
  totem: 'TOTEM',
  totems: 'TOTEM',
  naga: 'NAGA',
  nagas: 'NAGA',
  undead: 'UNDEAD',
  quilboar: 'QUILBOAR',
  draenei: 'DRAENEI',
};
const RACE_RE = '(?:Beasts?|Demons?|Dragons?|Elementals?|Mechs?|Murlocs?|Pirates?|Totems?|Nagas?|Undead|Quilboar|Draenei)';

const CLASS_WORDS: Record<string, CardClass> = {
  'death knight': 'DEATHKNIGHT',
  'demon hunter': 'DEMONHUNTER',
  druid: 'DRUID',
  hunter: 'HUNTER',
  mage: 'MAGE',
  paladin: 'PALADIN',
  priest: 'PRIEST',
  rogue: 'ROGUE',
  shaman: 'SHAMAN',
  warlock: 'WARLOCK',
  warrior: 'WARRIOR',
};
const CLASS_RE = '(?:Death Knight|Demon Hunter|Druid|Hunter|Mage|Paladin|Priest|Rogue|Shaman|Warlock|Warrior)';

const SCHOOL_RE = '(?:Arcane|Fel|Fire|Frost|Holy|Nature|Shadow)';

const NUM_WORDS: Record<string, number> = {
  a: 1,
  an: 1,
  one: 1,
  two: 2,
  three: 3,
  four: 4,
  five: 5,
  six: 6,
  seven: 7,
  eight: 8,
  nine: 9,
  ten: 10,
};
const COUNT_RE = '(?:an?|one|two|three|four|five|six|seven|eight|nine|ten|\\d+)';

function num(s: string): number {
  const k = s.toLowerCase();
  if (k in NUM_WORDS) return NUM_WORDS[k];
  const n = Number(s.replace('$', ''));
  if (Number.isNaN(n)) fail(`不是數字：${s}`);
  return n;
}

function race(s: string): Race {
  const r = RACE_WORDS[s.toLowerCase()];
  if (!r) fail(`未知種族：${s}`);
  return r;
}

// ---------------------------------------------------------------------------
// 文字正規化
// ---------------------------------------------------------------------------

export function normalizeText(en: string): string {
  let t = en.split('@')[0];
  t = t
    .replace(/\[x\]/g, '')
    .replace(/<\/?[bi]>/g, '')
    .replace(/[\n_ ]/g, ' ')
    .replace(/’/g, "'")
    .replace(/\$[ad]?(\d+)/g, '$$$1')
    .replace(/#(\d+)/g, '$1')
    .replace(/\s+/g, ' ')
    .replace(/\bALL\b/g, 'all')
    .replace(/\s*\(\+\d+ Attack\/\+\d+ Health\)/g, '')
    // 「加入手牌（來自對手的職業）」→ 一般的寫法
    .replace(/ to your hand \(from your opponent's class\)/g, " from your opponent's class to your hand")
    // 動態文字：翠玉魔像的大小、白銀之手新兵（1/1）
    .replace(/\ba\{1\} \{0\} /g, 'a ')
    .replace(/\{0\} (Silver Hand Recruits?)/g, '1/1 $1')
    .replace(/Summon a basic Totem/g, 'Summon a random basic Totem')
    .trim();
  return t;
}

/** 依句號切句（引號內不切） */
export function splitSentences(t: string): string[] {
  const out: string[] = [];
  let cur = '';
  let inQuote = false;
  for (let i = 0; i < t.length; i++) {
    const ch = t[i];
    if (ch === '"') inQuote = !inQuote;
    cur += ch;
    if (!inQuote && (ch === '.' || ch === '!') && (i + 1 === t.length || t[i + 1] === ' ')) {
      out.push(cur.trim());
      cur = '';
    }
  }
  if (cur.trim()) out.push(cur.trim());
  return out.map((s) => s.replace(/[.!]$/, '').trim()).filter(Boolean);
}

// ---------------------------------------------------------------------------
// 解析情境
// ---------------------------------------------------------------------------

export interface TokenQuery {
  name: string;
  type?: CardType;
  atk?: number;
  hp?: number;
  keywords?: Keyword[];
}

export interface ParseEnv {
  /** 依名稱尋找衍生卡（token），回傳卡牌 ID */
  findToken(q: TokenQuery): string | null;
}

export interface ParsedCard {
  keywords: Keyword[];
  abilities: Ability[];
  auras: Aura[];
  target?: TargetReq;
  spellDamage?: number;
  overload?: number;
  enrage?: { atk: number };
  secret?: boolean;
  costRule?: { per: DynAmount | 'otherCardsInHand' | 'minionsOnBoard'; amount: number; race?: Race };
  /** 引用到的衍生卡 ID */
  tokens: string[];
  starshipPiece?: boolean;
  noCorpse?: boolean;
  castsWhenDrawn?: boolean;
  costsHealth?: boolean;
  costsCorpses?: boolean;
}

interface Ctx {
  env: ParseEnv;
  cardType: CardType;
  out: ParsedCard;
  /** 目前能力是否為出牌時（戰吼 / 法術）的能力 */
  isPlay: boolean;
  /** 本能力內最後一個目標（供 it / them 使用） */
  last?: TargetExpr;
  /** 出牌目標篩選 */
  chosen?: Filter;
  /** 目前是否在觸發型能力（it = 事件對象） */
  inTrigger: boolean;
  /** 本能力內最後一組目標（供 them 使用） */
  lastExprs?: TargetExpr[];
  /** 最後處理的是否為召喚（it = 召喚物） */
  lastWasSummon?: boolean;
  /** 本能力的條件（例如連擊 → 目標只在條件成立時需要） */
  abilityCond?: Condition;
}

// ---------------------------------------------------------------------------
// 目標片語
// ---------------------------------------------------------------------------

type TargetParse = { exprs: TargetExpr[]; chosen?: Filter; rest: string };

type TargetRule = [RegExp, (m: RegExpExecArray, ctx: Ctx) => { exprs: TargetExpr[]; chosen?: Filter }];

const all = (filter: Filter) => ({ exprs: [{ t: 'all', filter } as TargetExpr] });
const rnd = (filter: Filter, count = 1) => ({ exprs: [{ t: 'random', filter, count } as TargetExpr] });
const chosen = (filter: Filter) => ({ exprs: [{ t: 'chosen' } as TargetExpr], chosen: filter });

function sideWord(w: string | undefined): Filter['side'] {
  if (!w) return 'any';
  const k = w.trim().toLowerCase();
  if (k === 'friendly' || k === 'your' || k === 'your other' || k === 'other friendly') return 'friendly';
  if (k === 'enemy' || k === "your opponent's") return 'enemy';
  return 'any';
}

const TARGET_RULES: TargetRule[] = [
  // --- 英雄 ---
  [/^your hero/, () => ({ exprs: [{ t: 'hero', side: 'friendly' }] })],
  [/^(?:the enemy hero|your opponent's hero|the opposing hero|your opponent)(?![a-z'])/, () => ({ exprs: [{ t: 'hero', side: 'enemy' }] })],
  [/^(?:each hero|both heroes)/, () => ({ exprs: [{ t: 'hero', side: 'both' }] })],
  // --- 自己 / 它 ---
  [/^(?:this minion|itself|this character)/, () => ({ exprs: [{ t: 'self' }] })],
  [/^them(?![a-z'])/, (_m, ctx) => ({ exprs: ctx.lastExprs && !ctx.lastWasSummon ? ctx.lastExprs : [itRef(ctx)] })],
  [/^(?:it|that minion|that character)(?![a-z'])/, (_m, ctx) => ({ exprs: [itRef(ctx)] })],
  // --- 選擇目標（含相鄰） ---
  [
    /^(an? (?:enemy |friendly )?minion) and (?:its neighbors|the minions next to it|minions next to it|adjacent ones)/,
    (m) => {
      const side = /enemy/.test(m[1]) ? 'enemy' : /friendly/.test(m[1]) ? 'friendly' : 'any';
      return {
        exprs: [{ t: 'chosen' }, { t: 'adjacent', of: 'chosen' }],
        chosen: { type: 'minion', side },
      };
    },
  ],
  [/^(?:a|another) friendly minion/, () => chosen({ type: 'minion', side: 'friendly', excludeSelf: true })],
  [/^another minion/, () => chosen({ type: 'minion', side: 'any', excludeSelf: true })],
  [/^an enemy minion with (\d+) or (less|more) Attack/, (m) => chosen(atkFilter({ type: 'minion', side: 'enemy' }, m[1], m[2]))],
  [/^a minion with (\d+) or (less|more) Attack/, (m) => chosen(atkFilter({ type: 'minion', side: 'any' }, m[1], m[2]))],
  [/^a damaged enemy minion/, () => chosen({ type: 'minion', side: 'enemy', damaged: true })],
  [/^an undamaged enemy minion/, () => chosen({ type: 'minion', side: 'enemy', undamaged: true })],
  [/^an enemy minion with Taunt/, () => chosen({ type: 'minion', side: 'enemy', keyword: 'TAUNT' })],
  [/^a friendly minion from the battlefield/, () => chosen({ type: 'minion', side: 'friendly', excludeSelf: true })],
  [/^an enemy minion/, () => chosen({ type: 'minion', side: 'enemy' })],
  [/^a damaged minion/, () => chosen({ type: 'minion', damaged: true })],
  [/^an undamaged minion/, () => chosen({ type: 'minion', undamaged: true })],
  [/^an? (?:enemy )?minion/, (m) => chosen({ type: 'minion', side: /enemy/.test(m[0]) ? 'enemy' : 'any' })],
  [/^(?:a|another) friendly character/, () => chosen({ type: 'character', side: 'friendly' })],
  [/^(?:an enemy character|an enemy)(?![a-z])/, () => chosen({ type: 'character', side: 'enemy' })],
  [/^a character/, () => chosen({ type: 'character', side: 'any' })],
  [
    new RegExp(`^(?:a|another) (friendly |enemy )?(${RACE_RE})(?![a-z])`),
    (m) => chosen({ type: 'minion', side: sideWord(m[1]), race: race(m[2]), excludeSelf: true }),
  ],
  // --- 相鄰 ---
  [
    /^(?:adjacent minions|the minions next to (?:it|this)|minions next to (?:it|this)|its neighbors|adjacent ones)/,
    (_m, ctx) => ({ exprs: [{ t: 'adjacent', of: ctx.chosen ? 'chosen' : 'self' }] }),
  ],
  // --- 隨機 ---
  [
    new RegExp(`^(${COUNT_RE}) random (enemy |friendly |other friendly |other )?(minions?|characters?|enem(?:y|ies)|${RACE_RE})(?![a-z])`),
    (m) => {
      const count = num(m[1]);
      const sideW = (m[2] || '').trim();
      const noun = m[3].toLowerCase();
      const filter: Filter = { side: 'any', type: 'minion' };
      if (sideW === 'enemy') filter.side = 'enemy';
      if (sideW === 'friendly' || sideW === 'other friendly') filter.side = 'friendly';
      if (sideW === 'other friendly' || sideW === 'other') filter.excludeSelf = true;
      if (noun.startsWith('enem')) {
        filter.side = 'enemy';
        filter.type = 'character';
      } else if (noun.startsWith('character')) filter.type = 'character';
      else if (!noun.startsWith('minion')) filter.race = race(m[3]);
      return rnd(filter, count);
    },
  ],
  [
    /^(?:another|a) random friendly minion/,
    (m) => rnd({ type: 'minion', side: 'friendly', excludeSelf: m[0].startsWith('another') }),
  ],
  [/^another random minion/, () => rnd({ type: 'minion', side: 'any', excludeSelf: true })],
  // --- 群體 ---
  [/^all other characters/, () => all({ type: 'character', side: 'any', excludeSelf: true })],
  [/^all characters/, () => all({ type: 'character', side: 'any' })],
  [/^all other enemies/, () => all({ type: 'character', side: 'enemy', excludeChosen: true })],
  [/^all other enemy minions/, () => all({ type: 'minion', side: 'enemy', excludeChosen: true })],
  [/^(?:all enemies|all enemy characters)/, () => all({ type: 'character', side: 'enemy' })],
  [/^(?:all friendly characters|your characters)/, () => all({ type: 'character', side: 'friendly' })],
  [/^all your other minions/, () => all({ type: 'minion', side: 'friendly', excludeSelf: true })],
  [/^all other minions/, () => all({ type: 'minion', side: 'any', excludeSelf: true })],
  [/^all minions with (\d+) or (less|more) Attack/, (m) => all(atkFilter({ type: 'minion', side: 'any' }, m[1], m[2]))],
  [/^your damaged minions/, () => all({ type: 'minion', side: 'friendly', damaged: true })],
  [/^all damaged minions/, () => all({ type: 'minion', side: 'any', damaged: true })],
  [/^all minions/, () => all({ type: 'minion', side: 'any' })],
  [
    /^(?:all enemy minions|enemy minions|your opponent's minions)/,
    () => all({ type: 'minion', side: 'enemy' }),
  ],
  [
    /^(?:all other friendly minions|your other minions|other friendly minions)/,
    () => all({ type: 'minion', side: 'friendly', excludeSelf: true }),
  ],
  [/^(?:all friendly minions|your minions|friendly minions)/, () => all({ type: 'minion', side: 'friendly' })],
  [
    new RegExp(`^(?:all |your )?(other |friendly |enemy |other friendly )?(${RACE_RE})(?![a-z])`),
    (m) => {
      if (!/^(all|your)/.test(m[0]) && !m[1]) fail('race group');
      const w = (m[1] || '').trim();
      const side: Filter['side'] = m[0].startsWith('your') || w.includes('friendly') ? 'friendly' : w === 'enemy' ? 'enemy' : 'any';
      return all({ type: 'minion', side, race: race(m[2]), excludeSelf: w.includes('other') || undefined });
    },
  ],
];

function atkFilter(base: Filter, n: string, dir: string): Filter {
  return dir === 'less' ? { ...base, maxAttack: Number(n) } : { ...base, minAttack: Number(n) };
}

function itRef(ctx: Ctx): TargetExpr {
  if (ctx.last && !ctx.lastWasSummon) return ctx.last;
  return { t: 'it' };
}

/** 從字串開頭解析目標片語（取最長者） */
function parseTarget(s: string, ctx: Ctx): TargetParse | null {
  let best: { len: number; res: { exprs: TargetExpr[]; chosen?: Filter } } | null = null;
  for (const [re, build] of TARGET_RULES) {
    const m = re.exec(s);
    if (!m) continue;
    const after = s.slice(m[0].length);
    if (after && !/^[\s,.]/.test(after)) continue;
    let res;
    try {
      res = build(m, ctx);
    } catch (e) {
      if (e instanceof Unsupported) continue;
      throw e;
    }
    if (!best || m[0].length > best.len) best = { len: m[0].length, res };
  }
  if (!best) return null;
  return { ...best.res, rest: s.slice(best.len) };
}

function registerChosen(ctx: Ctx, f: Filter | undefined) {
  if (!f) return;
  if (!ctx.isPlay) fail('非出牌能力使用選擇目標');
  if (ctx.chosen) {
    if (JSON.stringify(ctx.chosen) !== JSON.stringify(f)) fail('多個不同的選擇目標');
    return;
  }
  ctx.chosen = f;
}

function useTarget(ctx: Ctx, tp: TargetParse): TargetExpr[] {
  let exprs = tp.exprs;
  if (tp.chosen && !ctx.isPlay) {
    // 觸發型能力中的「另一個友方手下」= 隨機一個
    if (exprs.some((e) => e.t === 'adjacent')) fail('非出牌能力的相鄰目標');
    const filter = tp.chosen;
    exprs = exprs.map((e) => (e.t === 'chosen' ? ({ t: 'random', filter, count: 1 } as TargetExpr) : e));
  } else registerChosen(ctx, tp.chosen);
  if (exprs.length === 1) ctx.last = exprs[0];
  else ctx.last = { t: 'chosen' };
  ctx.lastExprs = exprs;
  ctx.lastWasSummon = false;
  return exprs;
}

/** 需要目標卻沒寫明時（如「造成 3 點傷害」）預設為選擇任一角色 */
function defaultChosen(ctx: Ctx, filter: Filter = { type: 'character', side: 'any' }): TargetExpr {
  registerChosen(ctx, filter);
  ctx.last = { t: 'chosen' };
  ctx.lastWasSummon = false;
  return { t: 'chosen' };
}

// ---------------------------------------------------------------------------
// 卡池片語（隨機 / 發現）
// ---------------------------------------------------------------------------

export function parsePool(phrase: string): Pool | null {
  let s = phrase.trim();
  s = s.replace(/^(?:an?|one|two|three|four|five|\d+) /, '').replace(/^random /, '');
  const pool: Pool = {};
  let m: RegExpExecArray | null;
  if ((m = /^(\d+)-Cost /.exec(s))) {
    pool.cost = Number(m[1]);
    s = s.slice(m[0].length);
  }
  if ((m = /^Legendary /.exec(s))) {
    pool.rarity = 'LEGENDARY';
    s = s.slice(m[0].length);
  }
  if ((m = new RegExp(`^(${CLASS_RE}) `).exec(s))) {
    pool.cls = CLASS_WORDS[m[1].toLowerCase()];
    s = s.slice(m[0].length);
  }
  if ((m = /^(Blood|Frost|Unholy) Rune /.exec(s))) {
    pool.rune = m[1].toLowerCase() as 'blood' | 'frost' | 'unholy';
    s = s.slice(m[0].length);
  } else if ((m = new RegExp(`^(${SCHOOL_RE}) `).exec(s))) {
    pool.spellSchool = m[1].toUpperCase();
    s = s.slice(m[0].length);
  }
  if ((m = /^(Taunt|Deathrattle|Battlecry|Rush|Divine Shield|Lifesteal|Charge|Windfury|Stealth|Poisonous) /.exec(s))) {
    const k = m[1];
    if (k === 'Deathrattle') pool.hasDeathrattle = true;
    else if (k === 'Battlecry') pool.hasBattlecry = true;
    else pool.keyword = KEYWORD_WORDS[k.toLowerCase()];
    s = s.slice(m[0].length);
  }
  if ((m = new RegExp(`^(${RACE_RE})(?![a-z])`).exec(s))) {
    pool.race = race(m[1]);
    pool.type = 'MINION';
    s = s.slice(m[0].length).trim();
  } else if ((m = /^(minions?|spells?|weapons?|cards?|Secrets?)(?![a-z])/.exec(s))) {
    const w = m[1].toLowerCase();
    if (w.startsWith('minion')) pool.type = 'MINION';
    else if (w.startsWith('spell')) pool.type = 'SPELL';
    else if (w.startsWith('weapon')) pool.type = 'WEAPON';
    else if (w.startsWith('secret')) {
      pool.type = 'SPELL';
      pool.isSecret = true;
    }
    s = s.slice(m[0].length).trim();
  } else return null;
  if ((m = /^from your opponent's class/.exec(s))) {
    pool.cls = 'opponent';
    s = s.slice(m[0].length).trim();
  } else if ((m = /^from your class/.exec(s))) {
    pool.cls = 'own';
    s = s.slice(m[0].length).trim();
  } else if ((m = /^from another class/.exec(s))) {
    return null;
  }
  if ((m = /^with (Taunt|Deathrattle|Rush|Divine Shield|Lifesteal|Battlecry)/.exec(s))) {
    if (m[1] === 'Deathrattle') pool.hasDeathrattle = true;
    else if (m[1] === 'Battlecry') pool.hasBattlecry = true;
    else pool.keyword = KEYWORD_WORDS[m[1].toLowerCase()];
    s = s.slice(m[0].length).trim();
  }
  if ((m = /^that costs \((\d+)\)$/.exec(s))) {
    pool.cost = Number(m[1]);
    s = '';
  } else if ((m = /^that costs \((\d+)\) or less$/.exec(s))) {
    pool.maxCost = Number(m[1]);
    s = '';
  } else if ((m = /^that costs \((\d+)\) or more$/.exec(s))) {
    pool.minCost = Number(m[1]);
    s = '';
  }
  if (s) return null;
  return pool;
}

// ---------------------------------------------------------------------------
// 增益片語：+2/+2、+3 Attack、Taunt and Divine Shield、this turn…
// ---------------------------------------------------------------------------

interface BuffParse {
  atk?: Amount;
  hp?: Amount;
  keywords?: Keyword[];
  temp?: boolean;
  untilNextTurn?: boolean;
  rest: string;
}

function parseKeywordList(s: string): { kws: Keyword[]; rest: string } | null {
  const re = new RegExp(`^(${KEYWORD_RE})((?:(?:, | and |, and )${KEYWORD_RE})*)`);
  const m = re.exec(s);
  if (!m) return null;
  const words = m[0].split(/, and |, | and /).map((w) => KEYWORD_WORDS[w.trim().toLowerCase()]);
  return { kws: words, rest: s.slice(m[0].length) };
}

const DYN_PHRASES: [RegExp, DynAmount][] = [
  [/^ for each (?:other )?card in your hand/, 'handSize'],
  [/^ for each other minion on the battlefield/, 'allOtherMinions'],
  [/^ for each other minion/, 'allOtherMinions'],
  [/^ for each enemy minion/, 'enemyMinions'],
  [/^ for each other friendly minion/, 'otherFriendlyMinions'],
  [/^ for each friendly minion/, 'friendlyMinions'],
  [/^ for each minion you control/, 'friendlyMinions'],
  [/^ for each Armor you have/, 'armor'],
];

function parseDyn(rest: string): { dyn: DynAmount; rest: string } | null {
  for (const [re, dyn] of DYN_PHRASES) {
    const m = re.exec(rest);
    if (m) return { dyn, rest: rest.slice(m[0].length) };
  }
  return null;
}

function parseBuff(s: string): BuffParse | null {
  let m: RegExpExecArray | null;
  const out: BuffParse = { rest: s };
  let consumed = false;
  if ((m = /^\+(\d+)\/\+(\d+)/.exec(s))) {
    out.atk = Number(m[1]);
    out.hp = Number(m[2]);
    s = s.slice(m[0].length);
    consumed = true;
  } else if ((m = /^\+(\d+) Attack and \+(\d+) Health/.exec(s))) {
    out.atk = Number(m[1]);
    out.hp = Number(m[2]);
    s = s.slice(m[0].length);
    consumed = true;
  } else if ((m = /^([+-])(\d+) Attack/.exec(s))) {
    out.atk = Number(m[2]) * (m[1] === '-' ? -1 : 1);
    s = s.slice(m[0].length);
    consumed = true;
  } else if ((m = /^\+(\d+) Health/.exec(s))) {
    out.hp = Number(m[1]);
    s = s.slice(m[0].length);
    consumed = true;
  }
  if (consumed) {
    const d = parseDyn(s);
    if (d) {
      if (typeof out.atk === 'number') out.atk = { dyn: d.dyn, mult: out.atk };
      if (typeof out.hp === 'number') out.hp = { dyn: d.dyn, mult: out.hp };
      s = d.rest;
    }
    if ((m = /^(?:,| and|, and) /.exec(s))) {
      const kl = parseKeywordList(s.slice(m[0].length));
      if (kl) {
        out.keywords = kl.kws;
        s = kl.rest;
      }
    }
  } else {
    const kl = parseKeywordList(s);
    if (!kl) return null;
    out.keywords = kl.kws;
    s = kl.rest;
    if ((m = /^ and \+(\d+)\/\+(\d+)/.exec(s))) {
      out.atk = Number(m[1]);
      out.hp = Number(m[2]);
      s = s.slice(m[0].length);
    }
  }
  if ((m = /^ this turn/.exec(s))) {
    out.temp = true;
    s = s.slice(m[0].length);
  } else if ((m = /^ until your next turn/.exec(s))) {
    out.untilNextTurn = true;
    s = s.slice(m[0].length);
  }
  out.rest = s;
  return out;
}

function buffEffect(target: TargetExpr, b: BuffParse): Effect {
  const eff: Effect = { e: 'buff', target };
  if (b.atk !== undefined) eff.atk = b.atk;
  if (b.hp !== undefined) eff.hp = b.hp;
  if (b.keywords) eff.keywords = b.keywords;
  if (b.temp) eff.temp = true;
  if (b.untilNextTurn) eff.untilNextTurn = true;
  return eff;
}

// ---------------------------------------------------------------------------
// 衍生卡（召喚 / 裝備 / 加入手牌 / 洗入牌堆）
// ---------------------------------------------------------------------------

function singular(name: string): string[] {
  const out = [name];
  if (/ves$/.test(name)) out.push(name.replace(/ves$/, 'f'), name.replace(/ves$/, 'fe'));
  if (/ies$/.test(name)) out.push(name.replace(/ies$/, 'y'));
  if (/es$/.test(name)) out.push(name.replace(/es$/, ''));
  if (/s$/.test(name)) out.push(name.replace(/s$/, ''));
  if (/men$/.test(name)) out.push(name.replace(/men$/, 'man'));
  if (/ Ambushes$/.test(name)) out.push(name.replace(/es$/, ''));
  return out;
}

function findToken(ctx: Ctx, q: TokenQuery, plural: boolean): string {
  const names = plural ? singular(q.name) : [q.name, ...singular(q.name).slice(1)];
  if (/^Coins?$/.test(q.name)) names.unshift('The Coin');
  for (const name of names) {
    const id = ctx.env.findToken({ ...q, name });
    if (id) {
      ctx.out.tokens.push(id);
      return id;
    }
  }
  fail(`找不到衍生卡：${q.name}`);
}

/** 解析「a 2/3 Spirit Wolf with Taunt」「two 1/1 Whelps」 */
function parseStatToken(
  s: string,
  ctx: Ctx,
  type: CardType,
): { card: string; count: number; rest: string } | null {
  const re = new RegExp(`^(${COUNT_RE}) (\\d+)/(\\d+) ([A-Z][\\w'’:-]*(?: (?:of|the|[A-Z][\\w'’:-]*))*)((?: with ${KEYWORD_RE}(?:(?:, | and )${KEYWORD_RE})*)?)`);
  const m = re.exec(s);
  if (!m) return null;
  const count = num(m[1]);
  const kws = m[5] ? parseKeywordList(m[5].replace(/^ with /, ''))?.kws : undefined;
  const card = findToken(
    ctx,
    { name: m[4], type, atk: Number(m[2]), hp: Number(m[3]), keywords: kws },
    count > 1,
  );
  return { card, count, rest: s.slice(m[0].length) };
}

/** 解析「a Coin」「two Ambushes」這種沒有數值的名稱 */
function parseNamedToken(s: string, ctx: Ctx, type?: CardType): { card: string; count: number; rest: string } | null {
  const q = /^(?:a |an )?'([^']+)'/.exec(s);
  if (q) return { card: findToken(ctx, { name: q[1], type }, false), count: 1, rest: s.slice(q[0].length) };
  const re = new RegExp(`^(${COUNT_RE}) ([A-Z][\\w'’:!-]*(?: (?:of|the|[A-Z][\\w'’:!-]*))*)`);
  const m = re.exec(s);
  if (!m) return null;
  const count = num(m[1]);
  const card = findToken(ctx, { name: m[2], type }, count > 1);
  return { card, count, rest: s.slice(m[0].length) };
}

// ---------------------------------------------------------------------------
// 動作解析
// ---------------------------------------------------------------------------

type ActionResult = { effects: Effect[]; rest: string };
type ActionRule = (s: string, ctx: Ctx) => ActionResult | null;

function amountOf(s: string): { amount: number; spell: boolean } {
  return { amount: Number(s.replace('$', '')), spell: s.startsWith('$') };
}

const ACTIONS: ActionRule[] = [
  // ----- 死亡騎士的屍體 -----
  (s) => {
    const m = /^(?:[Gg]ain|and gain) (a|an|\d+) Corpses?/.exec(s);
    if (!m) return null;
    return { effects: [{ e: 'gainCorpses', amount: num(m[1]) }], rest: s.slice(m[0].length) };
  },
  (s, ctx) => {
    const m = new RegExp(`^(?:[Rr]aise|and raise) (?:up to (\\d+) Corpses|a Corpse) as (?:an? )?(\\d+/\\d+ Risen [A-Z][a-z]+(?: [A-Z][a-z]+)?(?: with ${KEYWORD_RE}(?:(?:, | and )${KEYWORD_RE})*)?)`).exec(s);
    if (!m) return null;
    const tok = parseStatToken(`two ${m[2]}`, ctx, 'MINION');
    if (!tok || tok.rest) fail(`raise token: ${m[2]}`);
    return { effects: [{ e: 'raiseCorpses', max: m[1] ? Number(m[1]) : 1, card: tok.card }], rest: s.slice(m[0].length) };
  },
  // ----- 號召：從牌堆召喚手下 -----
  (s) => {
    const m = /^(?:[Rr]ecruit|and recruit) (a|an|two|three|\d+) (?:(\d+)-Cost )?(minions?|Beasts?|Demons?|Dragons?|Murlocs?|Mechs?|Pirates?|Elementals?)(?: that costs? \((\d+)\) or less)?/.exec(s);
    if (!m) return null;
    const eff: Effect = { e: 'recruit', count: num(m[1]) };
    if (m[2]) eff.cost = Number(m[2]);
    if (m[4]) eff.maxCost = Number(m[4]);
    if (!/^minion/.test(m[3])) eff.race = race(m[3]);
    return { effects: [eff], rest: s.slice(m[0].length) };
  },
  // ----- 星艦 -----
  (s) => {
    const m = /^(?:[Yy]our|and your) next Starship launch costs \((\d+)\) less/.exec(s);
    if (!m) return null;
    return { effects: [{ e: 'launchDiscount', amount: Number(m[1]) }], rest: s.slice(m[0].length) };
  },
  // ----- 克蘇恩 -----
  (s) => {
    const m = /^(?:[Gg]ive|and give) your C'Thun \+(\d+)\/\+(\d+)( and Taunt)? \(wherever it is\)/.exec(s);
    if (!m) return null;
    const eff: Effect = { e: 'cthunBuff', atk: Number(m[1]), hp: Number(m[2]) };
    if (m[3]) eff.taunt = true;
    return { effects: [eff], rest: s.slice(m[0].length) };
  },
  // ----- 傷害 -----
  (s, ctx) => {
    const m = /^[Dd]eal (\$?\d+) damage randomly split (?:among|between) /.exec(s);
    if (!m) return null;
    const tp = parseTarget(s.slice(m[0].length), ctx);
    if (!tp || tp.exprs.length !== 1 || tp.exprs[0].t !== 'all') fail('split target');
    const { amount, spell } = amountOf(m[1]);
    return { effects: [{ e: 'splitDamage', filter: (tp.exprs[0] as { filter: Filter }).filter, amount, spell }], rest: tp.rest };
  },
  (s, ctx) => {
    const m = /^(?:[Dd]eal |and |(?=\$?\d+ damage to ))(\$?\d+) damage( to )?/.exec(s);
    if (!m) return null;
    const { amount, spell } = amountOf(m[1]);
    let rest = s.slice(m[0].length);
    let targets: TargetExpr[];
    if (m[2]) {
      const tp = parseTarget(rest, ctx);
      if (!tp) fail(`damage target: ${rest}`);
      targets = useTarget(ctx, tp);
      rest = tp.rest;
    } else {
      targets = [defaultChosen(ctx)];
    }
    const d = parseDyn(rest);
    let amt: Amount = amount;
    if (d) {
      amt = { dyn: d.dyn, mult: amount };
      rest = d.rest;
    }
    return { effects: targets.map((target) => ({ e: 'damage', target, amount: amt, spell }) as Effect), rest };
  },
  (s, ctx) => {
    const m = /^[Dd]eal damage equal to (this minion's Attack|your Armor|your hero's Attack|its Attack) to /.exec(s);
    if (!m) return null;
    const dyn: DynAmount = m[1] === 'your Armor' ? 'armor' : m[1] === "your hero's Attack" ? 'heroAttack' : 'selfAttack';
    const tp = parseTarget(s.slice(m[0].length), ctx);
    if (!tp) fail('damage-equal target');
    return { effects: useTarget(ctx, tp).map((target) => ({ e: 'damage', target, amount: { dyn } }) as Effect), rest: tp.rest };
  },
  (s) => {
    const m = /^(?:[Tt]ake|takes) (\$?\d+) damage/.exec(s);
    if (!m) return null;
    return { effects: [{ e: 'damage', target: { t: 'hero', side: 'friendly' }, amount: Number(m[1].replace('$', '')) }], rest: s.slice(m[0].length) };
  },
  // ----- 選擇目標（例如「選擇一個手下，召喚一個它的複製」） -----
  (s, ctx) => {
    const m = /^[Cc]hoose /.exec(s);
    if (!m) return null;
    const tp = parseTarget(s.slice(m[0].length), ctx);
    if (!tp || !tp.chosen) return null;
    useTarget(ctx, tp);
    return { effects: [], rest: tp.rest };
  },
  // ----- 治療 -----
  (s, ctx) => {
    const m = /^[Rr]estore (\d+) Health( to )?/.exec(s);
    if (!m) return null;
    let rest = s.slice(m[0].length);
    let targets: TargetExpr[];
    if (m[2]) {
      const tp = parseTarget(rest, ctx);
      if (!tp) fail(`heal target: ${rest}`);
      targets = useTarget(ctx, tp);
      rest = tp.rest;
    } else targets = [defaultChosen(ctx)];
    return { effects: targets.map((target) => ({ e: 'heal', target, amount: Number(m[1]) }) as Effect), rest };
  },
  (s, ctx) => {
    const m = /^[Rr]estore (.+?) to full Health/.exec(s);
    if (!m) return null;
    const tp = parseTarget(m[1], ctx);
    if (!tp || tp.rest) fail('full heal target');
    return { effects: useTarget(ctx, tp).map((target) => ({ e: 'fullHeal', target }) as Effect), rest: s.slice(m[0].length) };
  },
  // ----- 護甲 -----
  (s) => {
    const m = /^(?:[Gg]ain|and gain) (\d+) Armor/.exec(s);
    if (!m) return null;
    let rest = s.slice(m[0].length);
    const d = parseDyn(rest);
    let amount: Amount = Number(m[1]);
    if (d) {
      amount = { dyn: d.dyn, mult: Number(m[1]) };
      rest = d.rest;
    }
    return { effects: [{ e: 'armor', amount }], rest };
  },
  (s) => {
    const m = /^[Yy]our opponent gains (\d+) Armor/.exec(s);
    if (!m) return null;
    return { effects: [{ e: 'armor', amount: Number(m[1]), who: 'opponent' }], rest: s.slice(m[0].length) };
  },
  // ----- 抽牌 -----
  (s) => {
    const m = /^(?:[Dd]raw|and draw) (a|an|one|two|three|four|\d+) cards?/.exec(s);
    if (!m) return null;
    return { effects: [{ e: 'draw', count: num(m[1]), who: 'self' }], rest: s.slice(m[0].length) };
  },
  (s) => {
    const m = /^(?:[Dd]raw|and draw) a card for each (damaged friendly character|enemy minion|friendly minion|other friendly minion)/.exec(s);
    if (!m) return null;
    const map: Record<string, DynAmount> = {
      'damaged friendly character': 'damagedFriendlyChars',
      'enemy minion': 'enemyMinions',
      'friendly minion': 'friendlyMinions',
      'other friendly minion': 'otherFriendlyMinions',
    };
    return { effects: [{ e: 'draw', count: { dyn: map[m[1]] }, who: 'self' }], rest: s.slice(m[0].length) };
  },
  (s) => {
    const m = /^(?:[Dd]raw|and draw) (a|an|two|three|\d+) ((?:\d+-Cost )?(?:(?:Fire|Frost|Arcane|Nature|Holy|Shadow|Fel) spells?|minions?|spells?|weapons?|Beasts?|Demons?|Dragons?|Elementals?|Mechs?|Murlocs?|Pirates?|Nagas?|Undead|Taunt minions?|Deathrattle minions?|Secrets?|Rush minions?))(?![a-z])(?! from)/.exec(s);
    if (!m) return null;
    const pool = parsePool(`a ${m[2]}`);
    if (!pool) fail(`draw pool ${m[2]}`);
    return { effects: [{ e: 'draw', count: num(m[1]), who: 'self', pool }], rest: s.slice(m[0].length) };
  },
  (s) => {
    const m = /^[Dd]raw (a|an|two|three|\d+) (.+?) from your deck/.exec(s);
    if (!m) return null;
    const pool = parsePool(`a ${m[2]}`);
    if (!pool) fail(`draw pool ${m[2]}`);
    return { effects: [{ e: 'draw', count: num(m[1]), who: 'self', pool }], rest: s.slice(m[0].length) };
  },
  (s) => {
    const m = /^(?:[Ee]ach player|[Bb]oth players) draws? (a|two|three|\d+) cards?/.exec(s);
    if (!m) return null;
    return { effects: [{ e: 'draw', count: num(m[1]), who: 'both' }], rest: s.slice(m[0].length) };
  },
  (s) => {
    const m = /^[Yy]our opponent draws (a|two|three|\d+) cards?/.exec(s);
    if (!m) return null;
    return { effects: [{ e: 'draw', count: num(m[1]), who: 'opponent' }], rest: s.slice(m[0].length) };
  },
  // ----- 英雄攻擊力 -----
  (s) => {
    const m = /^(?:[Gg]ive your hero|[Yy]our hero gains) \+(\d+) Attack this turn/.exec(s);
    if (!m) return null;
    return { effects: [{ e: 'heroAttack', amount: Number(m[1]) }], rest: s.slice(m[0].length) };
  },
  (s) => {
    const m = /^\+\$?(\d+) Attack this turn/.exec(s);
    if (!m) return null;
    return { effects: [{ e: 'heroAttack', amount: Number(m[1]) }], rest: s.slice(m[0].length) };
  },
  (s) => {
    const m = /^\+\$?(\d+) Armor/.exec(s);
    if (!m) return null;
    return { effects: [{ e: 'armor', amount: Number(m[1]) }], rest: s.slice(m[0].length) };
  },
  // ----- 武器 -----
  (s) => {
    const m = /^[Gg]ive your weapon \+(\d+)\/\+(\d+)/.exec(s);
    if (m) return { effects: [{ e: 'weaponBuff', atk: Number(m[1]), dur: Number(m[2]) }], rest: s.slice(m[0].length) };
    const m2 = /^[Gg]ive your weapon \+(\d+) Attack/.exec(s);
    if (m2) return { effects: [{ e: 'weaponBuff', atk: Number(m2[1]) }], rest: s.slice(m2[0].length) };
    const m3 = /^[Gg]ive your weapon \+(\d+) Durability/.exec(s);
    if (m3) return { effects: [{ e: 'weaponBuff', dur: Number(m3[1]) }], rest: s.slice(m3[0].length) };
    return null;
  },
  (s) => {
    const m = /^[Dd]estroy (your opponent's|the enemy|your) weapon/.exec(s);
    if (!m) return null;
    return { effects: [{ e: 'destroyWeapon', who: m[1] === 'your' ? 'self' : 'opponent' }], rest: s.slice(m[0].length) };
  },
  (s, ctx) => {
    const m = /^[Ee]quip /.exec(s);
    if (!m) return null;
    const tok = parseStatToken(s.slice(m[0].length), ctx, 'WEAPON');
    if (!tok) fail('equip token');
    return { effects: [{ e: 'equip', card: tok.card }], rest: tok.rest };
  },
  // ----- 手牌增益 -----
  (s) => {
    const m = new RegExp(`^[Gg]ive (all|a random) (minions?|${RACE_RE}) in your hand \\+(\\d+)\\/\\+(\\d+)`).exec(s) ??
      /^[Gg]ive ()(minions) in your hand \+(\d+)\/\+(\d+)/.exec(s);
    if (!m) return null;
    const eff: Effect = { e: 'handBuff', atk: Number(m[3]), hp: Number(m[4]), scope: m[1] === 'a random' ? 'random' : 'all' };
    if (!/^minions?$/.test(m[2])) eff.race = race(m[2]);
    return { effects: [eff], rest: s.slice(m[0].length) };
  },
  // ----- 增益 -----
  (s, ctx) => {
    const m = /^[Gg]ive /.exec(s);
    if (!m) return null;
    const tp = parseTarget(s.slice(m[0].length), ctx);
    if (!tp) fail(`give target: ${s}`);
    if (!tp.rest.startsWith(' ')) fail('give syntax');
    const b = parseBuff(tp.rest.slice(1));
    if (!b) fail(`give buff: ${tp.rest}`);
    const targets = useTarget(ctx, tp);
    return { effects: targets.map((t) => buffEffect(t, b)), rest: b.rest };
  },
  (s) => {
    const m = /^(?:[Gg]ain|and gain|gains|[Hh]ave|has) /.exec(s);
    if (!m) return null;
    const b = parseBuff(s.slice(m[0].length));
    if (!b) return null;
    return { effects: [buffEffect({ t: 'self' }, b)], rest: b.rest };
  },
  (s, ctx) => {
    const m = /^(.+?) gains? /.exec(s);
    if (!m) return null;
    const tp = parseTarget(m[1], ctx);
    if (!tp || tp.rest) return null;
    const b = parseBuff(s.slice(m[0].length));
    if (!b) return null;
    return { effects: useTarget(ctx, tp).map((t) => buffEffect(t, b)), rest: b.rest };
  },
  // ----- 設定數值 -----
  (s, ctx) => {
    const m = /^(?:[Ss]et|[Cc]hange) (.+?)'s? (Attack|Health|Attack and Health) to (\d+)/.exec(s);
    if (!m) return null;
    const tp = parseTarget(m[1], ctx);
    if (!tp || tp.rest) fail('set target');
    const n = Number(m[3]);
    const eff = (target: TargetExpr): Effect => ({
      e: 'setStats',
      target,
      atk: m[2].includes('Attack') ? n : undefined,
      hp: m[2].includes('Health') ? n : undefined,
    });
    return { effects: useTarget(ctx, tp).map(eff), rest: s.slice(m[0].length) };
  },
  (s, ctx) => {
    const m = /^(?:[Ss]et|[Cc]hange) the (Attack|Health) of (.+?) to (\d+)/.exec(s);
    if (!m) return null;
    const tp = parseTarget(m[2], ctx);
    if (!tp || tp.rest) fail('set target');
    const n = Number(m[3]);
    return {
      effects: useTarget(ctx, tp).map((target) => ({ e: 'setStats', target, atk: m[1] === 'Attack' ? n : undefined, hp: m[1] === 'Health' ? n : undefined }) as Effect),
      rest: s.slice(m[0].length),
    };
  },
  (s, ctx) => {
    const m = /^[Dd]ouble (.+?)'s? (Attack|Health|Attack and Health)/.exec(s);
    if (!m) return null;
    const tp = parseTarget(m[1], ctx);
    if (!tp || tp.rest) fail('double target');
    const stat = m[2] === 'Attack' ? 'atk' : m[2] === 'Health' ? 'hp' : 'both';
    return { effects: useTarget(ctx, tp).map((target) => ({ e: 'doubleStat', target, stat }) as Effect), rest: s.slice(m[0].length) };
  },
  (s, ctx) => {
    const m = /^[Ss]wap the Attack and Health of (.+?)(?=$|[,.]| and )/.exec(s);
    if (!m) return null;
    const tp = parseTarget(m[1], ctx);
    if (!tp || tp.rest) fail('swap target');
    return { effects: useTarget(ctx, tp).map((target) => ({ e: 'swapStats', target }) as Effect), rest: s.slice(m[0].length) };
  },
  // ----- 召喚 -----
  (s, ctx) => {
    const m = /^(?:[Ss]ummon|and summon) /.exec(s);
    if (!m) return null;
    let rest = s.slice(m[0].length);
    let mm: RegExpExecArray | null;
    let effects: Effect[];
    if ((mm = /^(a|two|three|\d+) cop(?:y|ies) of (this minion|this|it|itself|that minion)/.exec(rest))) {
      const target: TargetExpr = /this|itself/.test(mm[2]) ? { t: 'self' } : itRef(ctx);
      effects = [{ e: 'summonCopy', target, count: num(mm[1]) }];
      rest = rest.slice(mm[0].length);
    } else if ((mm = /^a random basic Totem/.exec(rest))) {
      effects = [{ e: 'custom', fn: 'totemicCall' }];
      rest = rest.slice(mm[0].length);
    } else if ((mm = /^a Jade Golem/.exec(rest))) {
      effects = [{ e: 'summonJade' }];
      ctx.out.tokens.push('CFM_712_t01');
      rest = rest.slice(mm[0].length);
    } else if ((mm = new RegExp(`^(${COUNT_RE}) random (.+?)(?= for your opponent|$|[,.]| and )`).exec(rest))) {
      const pool = parsePool(`a ${mm[2]}`);
      if (!pool) fail(`summon pool ${mm[2]}`);
      pool.type = 'MINION';
      effects = [{ e: 'summonRandom', pool, count: num(mm[1]), who: 'self' }];
      rest = rest.slice(mm[0].length);
    } else {
      // 「Summon an 8-Cost minion」「Summon a 2-Cost Taunt minion」等沒有指定卡名的隨機卡池召喚。
      const pm = new RegExp(`^(${COUNT_RE}) (.+?)(?=$|[,.]| and )`).exec(rest);
      const pool = pm ? parsePool(`${pm[1]} ${pm[2]}`) : null;
      if (pm && pool) {
        pool.type = 'MINION';
        effects = [{ e: 'summonRandom', pool, count: num(pm[1]), who: 'self' }];
        rest = rest.slice(pm[0].length);
      } else {
        const tok = parseStatToken(rest, ctx, 'MINION') ?? parseNamedToken(rest, ctx, 'MINION');
        if (!tok) fail(`summon: ${rest}`);
        effects = [{ e: 'summon', card: tok.card, count: tok.count, who: 'self' }];
        rest = tok.rest;
      }
    }
    if ((mm = /^ for your opponent/.exec(rest))) {
      for (const e of effects) if ('who' in e) (e as { who: string }).who = 'opponent';
      rest = rest.slice(mm[0].length);
    }
    ctx.lastWasSummon = true;
    ctx.last = undefined;
    return { effects, rest };
  },
  // ----- 消滅 -----
  (s) => {
    const m = /^(?:this minion|it) dies/.exec(s);
    if (!m) return null;
    return { effects: [{ e: 'destroy', target: { t: 'self' } }], rest: s.slice(m[0].length) };
  },
  (s, ctx) => {
    const m = /^(?:[Dd]estroy|and destroy) /.exec(s);
    if (!m) return null;
    const tp = parseTarget(s.slice(m[0].length), ctx);
    if (!tp) fail(`destroy target: ${s}`);
    return { effects: useTarget(ctx, tp).map((target) => ({ e: 'destroy', target }) as Effect), rest: tp.rest };
  },
  // ----- 冰凍 / 沉默 -----
  (s, ctx) => {
    const m = /^(?:[Ff]reeze|and [Ff]reeze) /.exec(s);
    if (!m) return null;
    const tp = parseTarget(s.slice(m[0].length), ctx);
    if (!tp) fail(`freeze target: ${s}`);
    return { effects: useTarget(ctx, tp).map((target) => ({ e: 'freeze', target }) as Effect), rest: tp.rest };
  },
  (s, ctx) => {
    const m = /^(?:[Ss]ilence|and [Ss]ilence) /.exec(s);
    if (!m) return null;
    const tp = parseTarget(s.slice(m[0].length), ctx);
    if (!tp) fail(`silence target: ${s}`);
    return { effects: useTarget(ctx, tp).map((target) => ({ e: 'silence', target }) as Effect), rest: tp.rest };
  },
  // ----- 回到手牌 -----
  (s, ctx) => {
    const m = /^[Rr]eturn (.+?) to (?:its owner's|your|your opponent's|their owner's|their owners') hands?/.exec(s);
    if (!m) return null;
    const tp = parseTarget(m[1], ctx);
    if (!tp || tp.rest) fail('return target');
    return { effects: useTarget(ctx, tp).map((target) => ({ e: 'returnToHand', target }) as Effect), rest: s.slice(m[0].length) };
  },
  // ----- 變形 -----
  (s, ctx) => {
    const m = /^[Tt]ransform (.+?) into /.exec(s);
    if (!m) return null;
    const tp = parseTarget(m[1], ctx);
    if (!tp || tp.rest) fail('transform target');
    const rest = s.slice(m[0].length);
    const rm = /^a random (\d+)-Cost minion/.exec(rest);
    if (rm) {
      return {
        effects: useTarget(ctx, tp).map((target) => ({ e: 'transformRandom', target, pool: { type: 'MINION', cost: Number(rm[1]) } }) as Effect),
        rest: rest.slice(rm[0].length),
      };
    }
    const tok = parseStatToken(/^\d+\//.test(rest) ? `a ${rest}` : rest, ctx, 'MINION');
    if (!tok || tok.count !== 1) fail('transform token');
    return { effects: useTarget(ctx, tp).map((target) => ({ e: 'transform', target, card: tok.card }) as Effect), rest: tok.rest };
  },
  // ----- 控制 -----
  (s, ctx) => {
    const m = /^[Tt]ake control of /.exec(s);
    if (!m) return null;
    const tp = parseTarget(s.slice(m[0].length), ctx);
    if (!tp) fail('steal target');
    return { effects: useTarget(ctx, tp).map((target) => ({ e: 'steal', target }) as Effect), rest: tp.rest };
  },
  // ----- 加入手牌 -----
  (s, ctx) => {
    const m = /^(?:[Aa]dd|[Gg]et|and add|and get) (a|an|one|two|three|\d+) cop(?:y|ies) of (it|this|that card|that minion|them)(?: to your hand)?/.exec(s);
    if (!m) return null;
    const target: TargetExpr = m[2] === 'this' ? { t: 'self' } : itRef(ctx);
    return { effects: [{ e: 'addCopy', target, count: num(m[1]) }], rest: s.slice(m[0].length) };
  },
  (s) => {
    const m = new RegExp(`^(?:[Aa]dd|[Gg]et|and add|and get) (${COUNT_RE}) random (.+?)(?: to your hand|(?=$|[,.]| and ))`).exec(s);
    if (!m) return null;
    const pool = parsePool(`a ${m[2]}`);
    if (!pool) fail(`add pool: ${m[2]}`);
    return { effects: [{ e: 'addRandom', pool, count: num(m[1]), who: 'self' }], rest: s.slice(m[0].length) };
  },
  (s, ctx) => {
    const m = /^(?:[Aa]dd|[Gg]et|and add|and get) /.exec(s);
    if (!m) return null;
    const rest = s.slice(m[0].length);
    const tok = parseStatToken(rest, ctx, 'MINION') ?? parseNamedToken(rest.replace(/ to your hand/, ''), ctx);
    if (!tok) fail(`add card: ${rest}`);
    const r = tok.rest.replace(/^ to your hand/, '');
    return { effects: [{ e: 'addCard', card: tok.card, count: tok.count, who: 'self' }], rest: r };
  },
  // ----- 洗入牌堆 -----
  (s, ctx) => {
    const m = /^[Ss]huffle (a|two|three|\d+) cop(?:y|ies) of (.+?) into your deck/.exec(s);
    if (!m) return null;
    const tp = parseTarget(m[2], ctx);
    if (!tp || tp.rest) fail('shuffle copy target');
    return { effects: useTarget(ctx, tp).map((target) => ({ e: 'shuffleCopy', target, count: num(m[1]) }) as Effect), rest: s.slice(m[0].length) };
  },
  (s, ctx) => {
    const m = /^[Ss]huffle (.+?) into your deck/.exec(s);
    if (!m) return null;
    const tok = parseNamedToken(m[1], ctx) ?? parseStatToken(m[1], ctx, 'MINION');
    if (!tok || tok.rest) fail('shuffle token');
    return { effects: [{ e: 'shuffle', card: tok.card, count: tok.count }], rest: s.slice(m[0].length) };
  },
  // ----- 發現 -----
  (s) => {
    const m = /^(?:[Dd]iscover|and discover) (.+?)(?=$|[.,]| and )/.exec(s);
    if (!m) return null;
    const pool = parsePool(m[1]);
    if (!pool) fail(`discover pool: ${m[1]}`);
    return { effects: [{ e: 'discover', pool }], rest: s.slice(m[0].length) };
  },
  (s) => {
    const m = /^(?:[Ii]t costs|[Rr]educe its Cost by) \((\d+)\)( less)?/.exec(s);
    if (!m) return null;
    return { effects: [{ e: 'costMod', amount: -Number(m[1]), scope: 'it' }], rest: s.slice(m[0].length) };
  },
  // ----- 法力水晶 -----
  (s) => {
    const m = /^[Gg]ain (an?|one|two|\d+) (empty )?Mana Crystals?( this turn only)?/.exec(s);
    if (!m) return null;
    const kind = m[3] ? 'temp' : m[2] ? 'empty' : 'full';
    return { effects: [{ e: 'mana', kind, amount: num(m[1]) }], rest: s.slice(m[0].length) };
  },
  (s) => {
    const m = /^[Rr]efresh (an?|one|two|three|\d+|your) Mana Crystals?/.exec(s);
    if (!m) return null;
    return { effects: [{ e: 'mana', kind: 'refresh', amount: m[1] === 'your' ? 10 : num(m[1]) }], rest: s.slice(m[0].length) };
  },
  (s) => {
    const m = /^[Dd]estroy (one|a|an|two|\d+) of your Mana Crystals/.exec(s);
    if (!m) return null;
    return { effects: [{ e: 'mana', kind: 'destroy', amount: num(m[1]) }], rest: s.slice(m[0].length) };
  },
  // ----- 棄牌 -----
  (s) => {
    const m = /^[Dd]iscard (a|two|three|\d+) random cards?/.exec(s);
    if (!m) return null;
    return { effects: [{ e: 'discard', count: num(m[1]) }], rest: s.slice(m[0].length) };
  },
  (s) => {
    const m = /^[Dd]iscard your hand/.exec(s);
    if (!m) return null;
    return { effects: [{ e: 'discard', count: 10 }], rest: s.slice(m[0].length) };
  },
];

const INSTEAD = new WeakSet<Effect>();

function parseActions(body: string, ctx: Ctx): Effect[] {
  const effects: Effect[] = [];
  let s = body.trim();
  const fe = /^For each (enemy minion|friendly minion|other friendly minion|card in your hand), (.+)$/.exec(s);
  if (fe) {
    const map: Record<string, DynAmount> = {
      'enemy minion': 'enemyMinions',
      'friendly minion': 'friendlyMinions',
      'other friendly minion': 'otherFriendlyMinions',
      'card in your hand': 'handSize',
    };
    return [{ e: 'repeat', times: { dyn: map[fe[1]] }, effects: parseActions(fe[2], ctx) }];
  }
  let first = true;
  while (s) {
    if (!first) {
      const sep = /^(?:, then |, and then |, and |\. | and then | and |, |; )/.exec(s);
      if (!sep) fail(`無法解析：「${s}」`);
      s = s.slice(sep[0].length);
      if (/^(?:and|then) /.test(s) && !/^and (?:\$?\d|gain|draw|add|get|destroy|freeze|silence|discover|summon)/.test(s)) s = s.replace(/^(?:and|then) /, '');
    }
    first = false;
    // 死亡騎士：消耗屍體來執行後面的效果（Spend 3 Corpses to ...）
    const sp = /^(?:[Ss]pend|and spend) (a|an|\d+) Corpses? to (.+)$/.exec(s);
    if (sp) {
      let body = sp[2];
      const instead = / instead$/.test(body);
      if (instead) body = body.replace(/ instead$/, '');
      const eff: Effect = { e: 'spendCorpses', amount: num(sp[1]), then: parseActions(body, ctx) };
      if (instead) {
        if (effects.length) eff.else = effects.splice(0);
        else INSTEAD.add(eff);
      }
      effects.push(eff);
      return effects;
    }
    // 條件句：If ..., ...
    const cond = parseConditionPrefix(s, ctx);
    if (cond) {
      let body = cond.body;
      const instead = / instead$/.test(body);
      if (instead) body = body.replace(/ instead$/, '');
      const inner = parseActions(body, ctx);
      const eff: Effect = { e: 'cond', cond: cond.cond, then: inner };
      if (instead) {
        if (effects.length) {
          eff.else = effects.splice(0);
        } else INSTEAD.add(eff);
      }
      effects.push(eff);
      return effects;
    }
    let res: ActionResult | null = null;
    for (const rule of ACTIONS) {
      res = rule(s, ctx);
      if (res) break;
    }
    if (!res) fail(`無法解析動作：「${s}」`);
    effects.push(...res.effects);
    s = res.rest.trim() ? res.rest : '';
    if (res.rest.startsWith(' ') && !/^ (?:and|then)/.test(res.rest)) fail(`多餘文字：「${res.rest}」`);
  }
  return effects;
}

// ---------------------------------------------------------------------------
// 條件
// ---------------------------------------------------------------------------

const CONDITIONS: [RegExp, (m: RegExpExecArray) => Condition][] = [
  [new RegExp(`^you're holding an? (${RACE_RE})`), (m) => ({ c: 'holding', race: race(m[1]) })],
  [/^you're holding a spell/, () => ({ c: 'holding', type: 'SPELL' })],
  [new RegExp(`^you control (?:an?|another) (${RACE_RE})`), (m) => ({ c: 'control', race: race(m[1]) })],
  [/^you control a Secret/, () => ({ c: 'secret' })],
  [new RegExp(`^you control a (${KEYWORD_RE}) minion`), (m) => ({ c: 'control', keyword: KEYWORD_WORDS[m[1].toLowerCase()] })],
  [/^you have a weapon equipped/, () => ({ c: 'weapon' })],
  [/^your hero attacked this turn/, () => ({ c: 'heroAttacked' })],
  [/^you have (\d+) Mana Crystals/, (m) => ({ c: 'maxMana', n: Number(m[1]) })],
  [/^you have (\d+) or more Mana(?: Crystals?)?/, (m) => ({ c: 'maxMana', n: Number(m[1]) })],
  [/^your deck has (\d+) or more cards/, (m) => ({ c: 'deckSize', op: '>=', n: Number(m[1]) })],
  [/^your deck has (\d+) or (?:fewer|less) cards/, (m) => ({ c: 'deckSize', op: '<=', n: Number(m[1]) })],
  [/^your deck has no Neutral cards/, () => ({ c: 'deckNoNeutral' })],
  [/^your deck (?:has|contains) no duplicates/, () => ({ c: 'noDuplicates' })],
  [/^you played an Elemental last turn/, () => ({ c: 'playedElementalLastTurn' })],
  [/^it's your opponent's turn/, () => ({ c: 'opponentTurn' })],
  [/^your hand is empty/, () => ({ c: 'handSize', op: '<=', n: 0 })],
  [/^you have (\d+) or (more|fewer|less) cards in (?:your )?hand/, (m) => ({ c: 'handSize', op: m[2] === 'more' ? '>=' : '<=', n: Number(m[1]) })],
  [/^your deck is empty/, () => ({ c: 'deckEmpty' })],
  [/^your C'Thun has at least (\d+) Attack/, (m) => ({ c: 'cthunAttack', n: Number(m[1]) })],
  [/^you're building a Starship/, () => ({ c: 'buildingStarship' })],
  [/^you launched a Starship this game/, () => ({ c: 'launchedStarship' })],
  [/^your hero has (\d+) or (less|more) Health/, (m) => ({ c: 'heroHealth', op: m[2] === 'less' ? '<=' : '>=', n: Number(m[1]) })],
  [/^(?:it|that minion) (?:dies|is destroyed)/, () => ({ c: 'itDied' })],
  [/^(?:it|that minion) survives/, () => ({ c: 'itAlive' })],
  [new RegExp(`^(?:it's|it is) an? (${RACE_RE})`), (m) => ({ c: 'itRace', race: race(m[1]) })],
  [/^(?:it's|it is) a minion/, () => ({ c: 'itIsMinion' })],
];

function parseConditionPrefix(s: string, ctx: Ctx): { cond: Condition; body: string } | null {
  const m = /^[Ii]f /.exec(s);
  if (!m) return null;
  const rest = s.slice(m[0].length);
  for (const [re, build] of CONDITIONS) {
    const cm = re.exec(rest);
    if (!cm) continue;
    const after = rest.slice(cm[0].length);
    const b = /^,? (.+)$/.exec(after);
    if (!b) fail(`條件後缺少效果：${s}`);
    const cond = build(cm);
    if (ctx.isPlay && ctx.chosen === undefined) {
      // 條件式戰吼中的選擇目標只在條件成立時需要
      ctx.abilityCond = ctx.abilityCond ?? cond;
    }
    return { cond, body: b[1] };
  }
  fail(`未知條件：${rest}`);
}

// ---------------------------------------------------------------------------
// 觸發句型
// ---------------------------------------------------------------------------

interface TriggerRule {
  re: RegExp;
  build: (m: RegExpExecArray) => { on: Trig; cond?: Condition; once?: boolean; play?: boolean; also?: Trig };
}

const TRIGGERS: TriggerRule[] = [
  { re: /^Battlecry and Deathrattle: /, build: () => ({ on: { k: 'play' }, also: { k: 'deathrattle' } }) },
  { re: /^Battlecry: /, build: () => ({ on: { k: 'play' }, play: true }) },
  { re: /^Combo: /, build: () => ({ on: { k: 'play' }, cond: { c: 'combo' }, play: true }) },
  { re: /^Outcast: /, build: () => ({ on: { k: 'play' }, cond: { c: 'outcast' }, play: true }) },
  { re: /^Deathrattle: /, build: () => ({ on: { k: 'deathrattle' } }) },
  { re: /^Spellburst: /, build: () => ({ on: { k: 'spellCast', side: 'friendly' }, once: true }) },
  { re: /^Inspire: /, build: () => ({ on: { k: 'heroPower', side: 'friendly' } }) },
  { re: /^When this is launched, /, build: () => ({ on: { k: 'launch' } }) },
  { re: /^Overkill: /, build: () => ({ on: { k: 'overkill' } }) },
  { re: /^Honorable Kill: /, build: () => ({ on: { k: 'honorableKill' } }) },
  { re: /^Frenzy: /, build: () => ({ on: { k: 'frenzy' }, once: true }) },
  { re: /^At the end of your turn, /, build: () => ({ on: { k: 'turnEnd', whose: 'mine' } }) },
  { re: /^At the end of your opponent's turn, /, build: () => ({ on: { k: 'turnEnd', whose: 'opp' } }) },
  { re: /^At the end of each turn, /, build: () => ({ on: { k: 'turnEnd', whose: 'each' } }) },
  { re: /^At the start of your turn, /, build: () => ({ on: { k: 'turnStart', whose: 'mine' } }) },
  { re: /^At the start of your opponent's turn, /, build: () => ({ on: { k: 'turnStart', whose: 'opp' } }) },
  { re: /^At the start of each turn, /, build: () => ({ on: { k: 'turnStart', whose: 'each' } }) },
  { re: /^(?:Whenever|After) you cast a spell, /, build: () => ({ on: { k: 'spellCast', side: 'friendly' } }) },
  { re: /^(?:Whenever|After) your opponent casts a spell, /, build: () => ({ on: { k: 'spellCast', side: 'enemy' } }) },
  { re: /^(?:Whenever|After) a player casts a spell, /, build: () => ({ on: { k: 'spellCast', side: 'any' } }) },
  { re: /^Whenever this (?:minion|character) takes damage, /, build: () => ({ on: { k: 'damaged', subject: 'self' } }) },
  { re: /^(?:After|Whenever) this minion survives damage, /, build: () => ({ on: { k: 'damaged', subject: 'self' }, cond: { c: 'itAlive' } }) },
  { re: /^Whenever your hero takes damage(?: on your turn)?, /, build: () => ({ on: { k: 'damaged', subject: 'friendlyHero' } }) },
  { re: /^Whenever a friendly minion takes damage, /, build: () => ({ on: { k: 'damaged', subject: 'friendlyMinion' } }) },
  { re: /^Whenever a minion takes damage, /, build: () => ({ on: { k: 'damaged', subject: 'anyMinion' } }) },
  { re: /^(?:Whenever|After) (?:a|another) friendly minion dies, /, build: () => ({ on: { k: 'minionDied', side: 'friendly' } }) },
  { re: /^(?:Whenever|After) an enemy minion dies, /, build: () => ({ on: { k: 'minionDied', side: 'enemy' } }) },
  { re: /^(?:Whenever|After) (?:a|another) minion dies, /, build: () => ({ on: { k: 'minionDied', side: 'any' } }) },
  {
    re: new RegExp(`^(?:Whenever|After) (?:a|another) (friendly )?(${RACE_RE}) dies, `),
    build: (m) => ({ on: { k: 'minionDied', side: m[1] ? 'friendly' : 'any', race: race(m[2]) } }),
  },
  { re: /^(?:Whenever|After) you summon a minion, /, build: () => ({ on: { k: 'summon', side: 'friendly' } }) },
  { re: /^(?:Whenever|After) your opponent summons a minion, /, build: () => ({ on: { k: 'summon', side: 'enemy' } }) },
  {
    re: new RegExp(`^(?:Whenever|After) you summon an? (${RACE_RE}), `),
    build: (m) => ({ on: { k: 'summon', side: 'friendly', race: race(m[1]) } }),
  },
  {
    re: new RegExp(`^(?:Whenever|After) you play an? (${RACE_RE}), `),
    build: (m) => ({ on: { k: 'cardPlayed', side: 'friendly', race: race(m[1]) } }),
  },
  { re: /^(?:Whenever|After) you play a card, /, build: () => ({ on: { k: 'cardPlayed', side: 'friendly' } }) },
  { re: /^(?:Whenever|After) you play an Echo card, /, build: () => ({ on: { k: 'cardPlayed', side: 'friendly', keyword: 'ECHO' } }) },
  { re: /^(?:Whenever|After) you play a minion, /, build: () => ({ on: { k: 'cardPlayed', side: 'friendly', cardType: 'MINION' } }) },
  { re: /^(?:Whenever|After) your opponent plays a card, /, build: () => ({ on: { k: 'cardPlayed', side: 'enemy' } }) },
  { re: /^(?:Whenever|After) your opponent plays a minion, /, build: () => ({ on: { k: 'cardPlayed', side: 'enemy', cardType: 'MINION' } }) },
  { re: /^(?:Whenever|After) a character is healed, /, build: () => ({ on: { k: 'healed', subject: 'any' } }) },
  { re: /^(?:Whenever|After) a minion is healed, /, build: () => ({ on: { k: 'healed', subject: 'minion' } }) },
  { re: /^(?:Whenever|After) a friendly character is healed, /, build: () => ({ on: { k: 'healed', subject: 'friendly' } }) },
  { re: /^After your hero attacks, /, build: () => ({ on: { k: 'attack', subject: 'friendlyHero', after: true } }) },
  { re: /^Whenever your hero attacks, /, build: () => ({ on: { k: 'attack', subject: 'friendlyHero' } }) },
  { re: /^After this (?:minion )?attacks, /, build: () => ({ on: { k: 'attack', subject: 'self', after: true } }) },
  { re: /^Whenever this (?:minion )?attacks, /, build: () => ({ on: { k: 'attack', subject: 'self' } }) },
  { re: /^(?:Whenever|After) a friendly minion attacks, /, build: () => ({ on: { k: 'attack', subject: 'friendlyMinion', after: true } }) },
  { re: /^(?:Whenever|After) you draw a card, /, build: () => ({ on: { k: 'draw', side: 'friendly' } }) },
  { re: /^(?:Whenever|After) you use your Hero Power, /, build: () => ({ on: { k: 'heroPower', side: 'friendly' } }) },
];

const SECRET_EVENTS: [RegExp, SecretEvent][] = [
  [/^When your hero is attacked, /, 'heroAttacked'],
  [/^When one of your minions is attacked, /, 'minionAttacked'],
  [/^When a friendly minion is attacked, /, 'minionAttacked'],
  [/^When an enemy attacks, /, 'enemyAttacks'],
  [/^When an enemy minion attacks, /, 'enemyMinionAttacks'],
  [/^When a minion attacks your hero, /, 'minionAttacksHero'],
  [/^(?:When|After) your opponent plays a minion, /, 'enemyPlaysMinion'],
  [/^(?:When|After) your opponent casts a spell, /, 'enemyCastsSpell'],
  [/^When an enemy casts a spell, /, 'enemyCastsSpell'],
  [/^(?:When|After) (?:a friendly minion|one of your minions) dies, /, 'friendlyMinionDies'],
  [/^When your hero takes damage, /, 'heroDamaged'],
  [/^When your hero takes fatal damage, /, 'heroFatal'],
  [/^When your turn starts, /, 'turnStart'],
  [/^At the end of your opponent's turn, /, 'enemyTurnEnd'],
];

const SECRET_SPECIAL: [RegExp, (m: RegExpExecArray, ctx: Ctx) => Effect[]][] = [
  [/^[Cc]ounter it$/, () => [{ e: 'custom', fn: 'counter' }]],
  [/^prevent it and become Immune this turn$/, () => [{ e: 'custom', fn: 'preventFatal' }]],
  [/^return it to life with 1 Health$/, () => [{ e: 'custom', fn: 'resurrect' }]],
  [
    /^summon an? (\d+)\/(\d+) ([A-Z][\w' ]*?) as the new target$/,
    (m, ctx) => {
      const card = findToken(ctx, { name: m[3], type: 'MINION', atk: Number(m[1]), hp: Number(m[2]) }, false);
      return [{ e: 'custom', fn: 'redirectSummon', args: { card } }];
    },
  ],
  [/^reduce its Health to 1$/, () => [{ e: 'setStats', target: { t: 'it' }, hp: 1 }]],
  [
    /^return it to its owner's hand\. It costs \((\d+)\) more$/,
    (m) => [{ e: 'returnToHand', target: { t: 'it' }, costChange: Number(m[1]) }],
  ],
];

// ---------------------------------------------------------------------------
// 靜態能力（光環 / 被動）
// ---------------------------------------------------------------------------

type CostPer = NonNullable<ParsedCard['costRule']>['per'];

const COST_RULES: [RegExp, CostPer][] = [
  [/^(?:other )?card in your hand$/, 'otherCardsInHand'],
  [/^(?:other )?minion on the battlefield$/, 'minionsOnBoard'],
  [/^(?:enemy minion|minion your opponent controls)$/, 'enemyMinions'],
  [/^(?:friendly minion|minion you control)$/, 'friendlyMinions'],
  [/^minion that died this turn$/, 'deathsThisTurn'],
  [/^friendly minion that died this game$/, 'friendlyDeathsThisGame'],
  [/^spell you've cast this game$/, 'spellsCastThisGame'],
  [/^card you've played this turn$/, 'cardsPlayedThisTurn'],
  [/^card you've drawn this turn$/, 'drawnThisTurn'],
  [/^time you used your Hero Power this game$/, 'heroPowersUsed'],
  [/^card in your opponent's hand$/, 'oppHandSize'],
  [/^Secret you control$/, 'secrets'],
  [/^Health your hero is missing$/, 'heroMissingHealth'],
  [/^Armor you have$/, 'armor'],
  [/^Corpse you've spent this game$/, 'corpsesSpent'],
  [/^minion that died this game$/, 'deathsThisGame'],
  [/^Plague shuffled into the enemy deck this game$/, 'plaguesShuffled'],
  [/^Attack of your weapon$/, 'weaponAttack'],
  [/^spell in your hand$/, 'spellsInHand'],
  [/^damaged minion$/, 'damagedMinions'],
  [/^damaged friendly character$/, 'damagedFriendlyChars'],
  [new RegExp(`^friendly (${RACE_RE})$`), 'friendlyRace'],
  [new RegExp(`^(${RACE_RE}) you've summoned this game$`), 'summonedRace'],
];

function parseStatic(sentence: string, ctx: Ctx): boolean {
  const out = ctx.out;
  let m: RegExpExecArray | null;
  if ((m = /^Spell Damage \+(\d+)$/.exec(sentence))) {
    out.spellDamage = (out.spellDamage ?? 0) + Number(m[1]);
    return true;
  }
  if ((m = /^Overload: \((\d+)\)$/.exec(sentence))) {
    out.overload = Number(m[1]);
    return true;
  }
  if (/^Costs Health instead of Mana$/.test(sentence)) {
    out.costsHealth = true;
    return true;
  }
  if (/^Costs Corpses instead of Mana$/.test(sentence)) {
    out.costsCorpses = true;
    return true;
  }
  if (/^Can't attack$/.test(sentence)) {
    out.keywords.push('CANT_ATTACK');
    return true;
  }
  if (/^Can't attack heroes$/.test(sentence)) {
    out.keywords.push('CANT_ATTACK_HEROES');
    return true;
  }
  if (/^Can't be targeted by spells or Hero Powers$/.test(sentence)) {
    out.keywords.push('ELUSIVE');
    return true;
  }
  if (/^Freeze any character damaged by this (?:minion|weapon)$/.test(sentence)) {
    out.keywords.push('FREEZE_ON_DAMAGE');
    return true;
  }
  if (/^Also damages the minions next to whomever (?:this|your hero) attacks$/.test(sentence)) {
    out.keywords.push('CLEAVE');
    return true;
  }
  if ((m = /^(?:Has|Enrage:) \+(\d+) Attack(?: while damaged)?$/.exec(sentence))) {
    out.enrage = { atk: Number(m[1]) };
    return true;
  }
  if ((m = /^Costs \((\d+)\) less (?:for each|per) (.+)$/.exec(sentence))) {
    const rule = COST_RULES.find(([re]) => re.test(m![2]));
    if (!rule) fail(`費用規則：${m[2]}`);
    const [re, per] = rule;
    const rm = re.exec(m[2])!;
    out.costRule = { per, amount: Number(m[1]) };
    if (rm[1]) out.costRule.race = race(rm[1]);
    return true;
  }
  // 光環
  const auraRe = new RegExp(
    `^(Your other minions|Adjacent minions|Other friendly minions|Your other (${RACE_RE})|Other friendly (${RACE_RE})|All other (${RACE_RE})|Your (${RACE_RE})|Enemy minions) have (.+)$`,
  );
  if ((m = auraRe.exec(sentence))) {
    const who = m[1];
    const b = parseBuff(m[6]);
    if (!b || b.rest || b.temp) fail(`aura buff: ${m[6]}`);
    const aura: Aura = { scope: 'otherFriendly' };
    if (who === 'Adjacent minions') aura.scope = 'adjacent';
    else if (who === 'Enemy minions') aura.scope = 'enemyMinions';
    else if (m[4]) {
      aura.scope = 'otherAll';
      aura.race = race(m[4]);
    } else if (m[2] || m[3] || m[5]) aura.race = race(m[2] || m[3] || m[5]);
    if (typeof b.atk === 'object' || typeof b.hp === 'object') fail('dyn aura');
    if (b.atk) aura.atk = b.atk as number;
    if (b.hp) aura.hp = b.hp as number;
    if (b.keywords) aura.keywords = b.keywords;
    out.auras.push(aura);
    return true;
  }
  if ((m = /^All friendly minions are (.+)$/.exec(sentence))) {
    const b = parseBuff(m[1]);
    if (!b || b.rest || b.temp) fail(`aura buff: ${m[1]}`);
    out.auras.push({
      scope: 'friendlyMinions',
      atk: typeof b.atk === 'number' ? b.atk : undefined,
      hp: typeof b.hp === 'number' ? b.hp : undefined,
      keywords: b.keywords,
    });
    return true;
  }
  if ((m = /^Your hero has \+(\d+) Attack$/.exec(sentence))) {
    out.auras.push({ scope: 'friendlyHero', atk: Number(m[1]) });
    return true;
  }
  return false;
}

// ---------------------------------------------------------------------------
// 主要進入點
// ---------------------------------------------------------------------------

export interface ParseInput {
  textEn: string;
  cardType: CardType;
}

export function parseCardText(input: ParseInput, env: ParseEnv): ParsedCard {
  const out: ParsedCard = { keywords: [], abilities: [], auras: [], tokens: [] };
  const text = normalizeText(input.textEn);
  if (!text) return out;
  if (/[{}]/.test(text)) fail('含動態文字');

  const sentences = splitSentences(text);
  let current: { ability: Ability; ctx: Ctx } | null = null;
  const playCtxs: Ctx[] = [];

  const newCtx = (isPlay: boolean, inTrigger: boolean): Ctx => ({
    env,
    cardType: input.cardType,
    out,
    isPlay,
    inTrigger,
  });

  for (let raw of sentences) {
    // 星艦組件（可能在句首或句尾）
    const piece = /^Starship Piece(?: |$)|(?:^| )Starship Piece$/.exec(raw);
    if (piece) {
      out.starshipPiece = true;
      raw = (raw.slice(0, piece.index) + ' ' + raw.slice(piece.index + piece[0].length)).trim();
      if (!raw) continue;
    }
    // 抽到時施放
    const cwd = /^Casts When Drawn(?: |$)/.exec(raw);
    if (cwd) {
      out.castsWhenDrawn = true;
      raw = raw.slice(cwd[0].length).trim();
      if (!raw) continue;
    }
    // 喚起的手下：「不會留下屍體」（可能接在關鍵字後面）
    const nc = /(?:^| )Doesn't leave a Corpse\.?$/.exec(raw);
    if (nc) {
      out.noCorpse = true;
      raw = raw.slice(0, nc.index).trim();
      if (!raw) continue;
    }
    // 「也會在發射時觸發」：戰吼在星艦發射時再觸發一次
    if (/^Also triggers on launch\.?$/.test(raw)) {
      const plays = out.abilities.filter((a) => a.on.k === 'play');
      if (!plays.length) fail('發射觸發無對應戰吼');
      for (const a of plays) out.abilities.push({ ...a, on: { k: 'launch' } });
      current = null;
      continue;
    }
    // 已腐化衍生卡常寫成「Corrupted Rush, Divine Shield」，
    // 必須先移除純顯示標記，才能讓後面的關鍵字迴圈解析。
    const leadingCorrupted = /^Corrupted(?:[:.]? |$)/.exec(raw);
    if (leadingCorrupted) {
      raw = raw.slice(leadingCorrupted[0].length).trim();
      if (!raw) {
        current = null;
        continue;
      }
    }

    // 句首的關鍵字（如「嘲諷 戰吼：…」）
    for (;;) {
      const kl = new RegExp(`^(${KEYWORD_RE}|Tradeable|Echo|Twinspell)(?:,? |$)`).exec(raw);
      if (!kl) break;
      const kw = KEYWORD_WORDS[kl[1].toLowerCase()];
      // 「Stealth until your next turn」之類的句子不是單純關鍵字
      const after = raw.slice(kl[0].length);
      if (after && !/^(?:[A-Z]|$)/.test(after)) break;
      out.keywords.push(kw);
      raw = after;
      current = null;
    }
    const sp = /^(Spell Damage \+\d+|Overload: \(\d+\))(?: |$)/.exec(raw);
    if (sp && raw.length > sp[0].length) {
      if (!parseStatic(sp[1], newCtx(false, false))) fail('static');
      raw = raw.slice(sp[0].length);
    }
    if (!raw) continue;

    // 官方的已腐化衍生卡會以「Corrupted」作為純顯示標記，不是實際效果。
    // 可能單獨成句，也可能直接接在 Battlecry / 關鍵字前。
    const corrupted = /^Corrupted(?:[:.]? |$)/.exec(raw);
    if (corrupted) {
      raw = raw.slice(corrupted[0].length).trim();
      if (!raw) {
        current = null;
        continue;
      }
    }

    if (/^Choose One/.test(raw)) fail('Choose One 由子卡處理');

    const st = /^Stealth (?:for 1 turn|until your next turn)$/.exec(raw);
    if (st && input.cardType === 'MINION') {
      out.abilities.push({ on: { k: 'play' }, effects: [{ e: 'buff', target: { t: 'self' }, keywords: ['STEALTH'], untilNextTurn: true }] });
      current = null;
      continue;
    }

    // 奧秘
    const sm = /^Secret: (.+)$/.exec(raw);
    if (sm) {
      out.secret = true;
      let body = sm[1];
      let ev: SecretEvent | null = null;
      for (const [re, e] of SECRET_EVENTS) {
        const mm = re.exec(body);
        if (mm) {
          ev = e;
          body = body.slice(mm[0].length);
          break;
        }
      }
      if (!ev) fail(`未知奧秘條件：${body}`);
      const ctx = newCtx(false, true);
      const ability: Ability = { on: { k: 'secret', ev }, effects: [] };
      let special: Effect[] | null = null;
      for (const [re, build] of SECRET_SPECIAL) {
        const mm = re.exec(body);
        if (mm) special = build(mm, ctx);
      }
      ability.effects = special ?? parseActions(body, ctx);
      out.abilities.push(ability);
      current = { ability, ctx };
      continue;
    }

    // 觸發型句子
    let matched = false;
    for (const tr of TRIGGERS) {
      const mm = tr.re.exec(raw);
      if (!mm) continue;
      const info = tr.build(mm);
      const isPlay = !!info.play;
      const ctx = newCtx(isPlay, !info.play);
      if (info.cond) ctx.abilityCond = info.cond;
      const ability: Ability = { on: info.on, effects: [] };
      if (info.cond) ability.cond = info.cond;
      if (info.once) ability.once = true;
      let body = raw.slice(mm[0].length);
      if (/ instead$/.test(body)) {
        // 「連擊：改為造成 4 點傷害」→ 原本的出牌效果只在條件不成立時觸發
        body = body.replace(/ instead$/, '');
        const prev = out.abilities.filter((a) => a.on.k === 'play' && !a.cond).pop();
        if (!prev || !info.cond) fail('instead 無對應效果');
        prev.cond = { c: 'not', cond: info.cond };
        ctx.chosen = playCtxs.find((c) => c.chosen)?.chosen;
      }
      ability.effects = parseActions(body, ctx);
      out.abilities.push(ability);
      // 「戰吼和亡語：…」：同樣的效果在死亡時再觸發一次（共用同一份效果）
      if (info.also) {
        if (ctx.chosen) fail('戰吼和亡語不能指定目標');
        out.abilities.push({ ...ability, on: info.also });
      }
      if (isPlay) playCtxs.push(ctx);
      current = { ability, ctx };
      matched = true;
      break;
    }
    if (matched) continue;

    // 靜態能力
    if (input.cardType !== 'SPELL' && parseStatic(raw, newCtx(false, false))) {
      current = null;
      continue;
    }
    if (input.cardType === 'SPELL' && /^(?:Spell Damage|Overload|Costs \()/.test(raw) && parseStatic(raw, newCtx(false, false))) {
      continue;
    }

    // 延續上一個能力（例如「戰吼：發現一張法術。其消耗減少(2)」）
    if (current) {
      const effs = parseActions(raw, current.ctx);
      const last = effs[effs.length - 1];
      if (effs.length === 1 && (last.e === 'cond' || last.e === 'spendCorpses') && INSTEAD.has(last)) {
        // 「造成 3 點傷害。若你手上有龍，改為造成 5 點傷害」
        last.else = current.ability.effects;
        current.ability.effects = [last];
      } else current.ability.effects.push(...effs);
      continue;
    }

    // 法術本體
    if (input.cardType === 'SPELL') {
      const ctx = newCtx(true, false);
      const ability: Ability = { on: { k: 'play' }, effects: parseActions(raw, ctx) };
      out.abilities.push(ability);
      playCtxs.push(ctx);
      current = { ability, ctx };
      continue;
    }
    fail(`無法解析：「${raw}」`);
  }

  // 合併同類的出牌能力的選擇目標
  let target: TargetReq | undefined;
  let unconditional = false;
  for (const ctx of playCtxs) {
    if (!ctx.chosen) continue;
    if (target && JSON.stringify(target.filter) !== JSON.stringify(ctx.chosen)) fail('多個出牌目標');
    target = { filter: ctx.chosen };
    if (input.cardType !== 'SPELL') target.optional = true;
    if (ctx.abilityCond && !unconditional) target.when = ctx.abilityCond;
    else unconditional = true;
  }
  if (target && unconditional) delete target.when;
  // 法術：若所有需要目標的效果都在條件內，仍視為必選（簡化）
  if (target) {
    if (input.cardType === 'SPELL' && target.when) delete target.when;
    out.target = target;
  }
  out.keywords = [...new Set(out.keywords)];
  return out;
}
