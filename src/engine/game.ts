// ============================================================================
// 對戰引擎
// - 所有規則在這裡執行；UI 與 AI 只透過 Game.apply(action) 互動。
// - 效果以 generator 執行，遇到「發現」這類需要玩家選擇的情況會暫停（yield），
//   等 UI 呼叫 choose() 後再繼續。
// ============================================================================
import { cardClasses, getCard, hasCard, HEROES, poolCards } from '../cards/registry';
import { LAUNCH_COST, starshipDef, starshipIdFor } from '../cards/starship';
import { ZOMBEAST_ID, ZOMBEAST_PARTS, zombeastDef } from '../cards/zombeast';
import { BASIC_TOTEMS, HERO_POWERS } from './heroes';
import { nextRandom, pick, randomInt, shuffle } from './rng';
import {
  MAX_BOARD,
  MAX_HAND,
  MAX_MANA,
  MAX_SECRETS,
  MAX_TURNS,
  type Action,
  type ChoiceRequest,
  type Fx,
  type GameState,
  type HandCard,
  type Hero,
  type Minion,
  type Location,
  type PlayerId,
  type PlayerState,
  type StarshipPiece,
  type Weapon,
} from './state';
import type {
  Ability,
  Amount,
  CardClass,
  CardDef,
  CardType,
  Condition,
  DynAmount,
  Effect,
  Filter,
  HeroPowerSpec,
  Keyword,
  Pool,
  Race,
  SecretEvent,
  Side,
  TargetExpr,
  TargetReq,
  Trig,
} from './types';

type Gen<T = void> = Generator<ChoiceRequest, T, number>;
type Char = Minion | Hero;

export function isHero(c: Char): c is Hero {
  return (c as Hero).heroClass !== undefined;
}

export const opp = (p: PlayerId): PlayerId => (p === 0 ? 1 : 0);

/** 克蘇恩（以英文名判斷，重印版本也算） */
export const CTHUN_ID = 'OG_280';
const isCthun = (id: string) => getCard(id).nameEn === "C'Thun";
const isEyestalk = (id: string) => getCard(id).nameEn === "Eyestalk of C'Thun";
/** 泰坦的三種瘟疫（抽到時施放） */
const PLAGUES = ['TTN_450t', 'TTN_450t2', 'TTN_450t3'];
/** 翠玉魔像（官方只有一張 1/1 衍生卡，大小由召喚次數決定） */
const JADE_GOLEM = 'CFM_712_t01';

interface ItRef {
  kind: 'char' | 'hand';
  uid: number;
}

interface Ctx {
  controller: PlayerId;
  sourceUid: number | null;
  sourceCardId: string;
  /** 已死亡來源的快照（亡語用） */
  sourceSnapshot?: Minion;
  /** 本次從手牌打出的原始實體（手牌條件用） */
  sourceHandCard?: HandCard;
  isSpell: boolean;
  isHeroPower?: boolean;
  chosen: number | null;
  it: ItRef | null;
  itCardId?: string;
  eventAmount: number;
  combo: boolean;
  outcast: boolean;
  position?: number;
  lifesteal: boolean;
  /** 比武揭露的我方牌堆卡牌（uid） */
  revealed?: number;
  /** 被摧毀的武器（武器亡語用） */
  weapon?: Weapon;
}

interface Ev {
  k: Trig['k'];
  player: PlayerId;
  subject?: number;
  subjectKind?: 'char' | 'hand';
  amount?: number;
  cardType?: CardType;
  races?: Race[];
  after?: boolean;
  isHero?: boolean;
  cardId?: string;
  /** 打出的卡具有回音 */
  echo?: boolean;
}

interface DmgSource {
  owner: PlayerId;
  uid: number | null;
  poisonous?: boolean;
  lifesteal?: boolean;
  freeze?: boolean;
  /** 造成傷害的法術（滅殺用） */
  cardId?: string;
}

interface AttackState {
  attacker: number;
  defender: number;
}

export interface NewGameOptions {
  decks: [string[], string[]];
  sideboards?: [Record<string, string[]> | undefined, Record<string, string[]> | undefined];
  classes: [Exclude<CardClass, 'NEUTRAL'>, Exclude<CardClass, 'NEUTRAL'>];
  names: [string, string];
  ai: [boolean, boolean];
  seed?: number;
  first?: PlayerId;
}

export type Chooser = (state: GameState, req: ChoiceRequest) => number;

/** 預設的自動選擇：挑費用最高的選項 */
export const defaultChooser: Chooser = (_s, req) => {
  let best = 0;
  let bestScore = -1;
  req.options.forEach((id, i) => {
    const c = getCard(id);
    const score = c.cost + (c.rarity === 'LEGENDARY' ? 2 : c.rarity === 'EPIC' ? 1 : 0);
    if (score > bestScore) {
      best = i;
      bestScore = score;
    }
  });
  return best;
};

export class Game {
  s: GameState;
  private pending: Gen | null = null;
  private chooser: Chooser;
  /** 模擬模式：所有選擇自動決定 */
  private autoAll: boolean;
  private spellCountered = false;
  private currentAttack: AttackState | null = null;
  /** 最近一次攻擊的結果（攻擊後觸發的效果使用） */
  private lastAttack: { attacker: number; defender: number; defenderIsHero: boolean; killed: boolean } | null = null;
  private emitDepth = 0;
  private steps = 0;

  constructor(state: GameState, opts: { chooser?: Chooser; autoAll?: boolean } = {}) {
    this.s = state;
    this.chooser = opts.chooser ?? defaultChooser;
    this.autoAll = opts.autoAll ?? false;
  }

  // ==========================================================================
  // 建立對戰
  // ==========================================================================

  static create(o: NewGameOptions): Game {
    const seed = o.seed ?? Math.floor(Math.random() * 2 ** 31);
    const s: GameState = {
      players: [null, null] as unknown as [PlayerState, PlayerState],
      current: 0,
      first: 0,
      turn: 0,
      phase: 'mulligan',
      winner: null,
      nextUid: 1,
      playCounter: 0,
      rng: seed,
      log: [],
      fx: [],
      fxSeq: 0,
      pendingChoice: null,
      deathsThisTurn: 0,
    };
    const game = new Game(s);
    for (const id of [0, 1] as PlayerId[]) {
      const cls = o.classes[id];
      const heroInfo = HEROES[cls];
      const hero: Hero = {
        uid: game.uid(),
        owner: id,
        cardId: heroInfo.hero,
        heroClass: cls,
        hp: 30,
        maxHp: 30,
        armor: 0,
        tempAtk: 0,
        frozen: false,
        frozenTurn: 0,
        attacks: 0,
        immune: false,
      };
      s.players[id] = {
        id,
        name: o.names[id],
        heroClass: cls,
        hero,
        weapon: null,
        heroPower: { id: heroInfo.power.id, used: false, cost: heroInfo.power.cost },
        mana: 0,
        maxMana: 0,
        overloadOwed: 0,
        overloadLocked: 0,
        deck: o.decks[id].map((cardId) => ({ ...game.newHandCard(cardId), startedInDeck: true })),
        sideboards: structuredClone(o.sideboards?.[id] ?? {}),
        deckStartedNoSpells: o.decks[id].every((cardId) => getCard(cardId).type !== 'SPELL'),
        deckStartedNoMinions: o.decks[id].every((cardId) => getCard(cardId).type !== 'MINION'),
        deckStartedNoOtherMinions: o.decks[id].every((cardId) => getCard(cardId).type !== 'MINION' || cardId === 'JAIL_800'),
        deckStartedAllCostMax3: o.decks[id].every((cardId) => getCard(cardId).cost <= 3),
        cardsPlayedForTwoMana: 0,
        hand: [],
        board: [],
        secrets: [],
        graveyard: [],
        fatigue: 0,
        cardsPlayedThisTurn: 0,
        playedCardsThisTurn: [],
        spellsCastThisGame: 0,
        heroAttackedThisTurn: false,
        elementalLastTurn: false,
        elementalThisTurn: false,
        mulliganDone: false,
        grants: [],
        nextCardDiscount: 0,
        heroPowersUsed: 0,
        drawnThisTurn: 0,
        summonedRaces: {},
        ai: o.ai[id],
      };
    }
    const aya0 = o.decks[0].includes('JAIL_504');
    const aya1 = o.decks[1].includes('JAIL_504');
    s.first = aya0 !== aya1 ? (aya0 ? 1 : 0) : (o.first ?? (nextRandom(s) < 0.5 ? 0 : 1));
    s.current = s.first;
    // 開局效果必須在起手抽牌前執行；霍格等效果可修改牌庫內容。
    game.runStartOfGame();
    for (const id of [0, 1] as PlayerId[]) shuffle(s, s.players[id].deck);
    const second = opp(s.first);
    for (let i = 0; i < 3; i++) game.drawRaw(s.players[s.first]);
    for (let i = 0; i < 4; i++) game.drawRaw(s.players[second]);
    game.log(null, `${s.players[s.first].name}先攻`);
    return game;
  }

  // ==========================================================================
  // 公開 API
  // ==========================================================================

  apply(action: Action): boolean {
    if (this.s.phase === 'over') return false;
    if (action.type === 'concede') {
      this.endGame(opp(action.player));
      this.log(action.player, `${this.s.players[action.player].name}投降了`);
      return true;
    }
    if (action.type === 'choose') {
      if (!this.pending || !this.s.pendingChoice) return false;
      if (action.index < 0 || action.index >= this.s.pendingChoice.options.length) return false;
      const gen = this.pending;
      this.pending = null;
      this.s.pendingChoice = null;
      this.drive(gen, action.index);
      return true;
    }
    if (this.s.pendingChoice) return false;
    if (action.type === 'mulligan') return this.mulligan(action.player, action.replace);
    if (this.s.phase !== 'play') return false;
    const check = this.check(action);
    if (!check.ok) return false;
    this.steps = 0;
    switch (action.type) {
      case 'play':
        this.drive(this.wrap(this.playCard(action.handUid, action.target, action.position, action.option, action.side)));
        return true;
      case 'useLocation':
        this.drive(this.wrap(this.useLocation(action.uid)));
        return true;
      case 'attack':
        this.drive(this.wrap(this.doAttack(action.attacker, action.target)));
        return true;
      case 'heroPower':
        this.drive(this.wrap(this.useHeroPower(action.target, action.option)));
        return true;
      case 'secondaryHeroPower':
        this.drive(this.wrap(this.useSecondaryHeroPower(action.target)));
        return true;
      case 'trade':
        this.drive(this.wrap(this.trade(action.handUid)));
        return true;
      case 'prepare':
        this.prepare(action.handUid);
        this.trimFx();
        return true;
      case 'launch':
        this.drive(this.wrap(this.doLaunch()));
        return true;
      case 'endTurn':
        this.drive(this.wrap(this.endTurn()));
        return true;
    }
    return false;
  }

  /** 地標佔用場地格，但不屬於手下或可攻擊的角色。 */
  boardSpaceUsed(pid: PlayerId): number {
    const p = this.s.players[pid];
    return p.board.length + (p.locations?.length ?? 0);
  }

  private addLocation(pid: PlayerId, cardId: string): Location | null {
    if (this.boardSpaceUsed(pid) >= MAX_BOARD) return null;
    const location: Location = { uid: this.uid(), owner: pid, cardId, durability: getCard(cardId).health ?? 1, cooldown: 0, playOrder: ++this.s.playCounter, discarded: [] };
    (this.s.players[pid].locations ??= []).push(location);
    return location;
  }

  canUseLocation(uid: number): { ok: boolean; reason?: string } {
    if (this.s.phase !== 'play' || this.s.pendingChoice) return { ok: false, reason: '現在無法啟動地標' };
    const p = this.me;
    const location = p.locations?.find((l) => l.uid === uid);
    if (!location || location.durability <= 0) return { ok: false, reason: '找不到自己的地標' };
    if (location.cooldown > 0) return { ok: false, reason: '地標冷卻中' };
    if (location.cardId === 'JAIL_887' && !p.hand.length) return { ok: false, reason: '需要一張手牌才能捨棄' };
    return { ok: true };
  }

  private *useLocation(uid: number): Gen {
    const p = this.me;
    const location = p.locations!.find((l) => l.uid === uid)!;
    location.cooldown = 2;
    this.log(p.id, `啟動${this.name(location.cardId)}`);
    const ctx = { ...this.baseCtx(p.id), sourceUid: location.uid, sourceCardId: location.cardId };
    yield* this.runEffects(getCard(location.cardId).locationEffects ?? [], ctx);
    location.durability--;
    if (location.durability <= 0) {
      p.locations = p.locations!.filter((l) => l.uid !== uid);
      if (location.cardId === 'JAIL_887' && !this.over) {
        const released = yield* this.summon(p.id, 'JAIL_887t2');
        if (released) released.prisonCards = structuredClone(location.discarded);
      }
    }
  }

  private *replayPrisonCard(pid: PlayerId, original: HandCard): Gen {
    const p = this.s.players[pid];
    const card = { ...structuredClone(original), uid: this.uid(), locationLocked: false };
    const def = this.handDef(card);
    if ((def.type === 'MINION' || def.type === 'LOCATION') && this.boardSpaceUsed(pid) >= MAX_BOARD) return;
    const option = def.chooseOne?.length ? randomInt(this.s, def.chooseOne.length) : undefined;
    const req = option === undefined ? def.target : def.chooseOne![option].target;
    const targets = req ? this.validTargets(req, pid, def.type === 'SPELL') : [];
    if (req && !req.optional && !targets.length && def.type === 'SPELL') return;
    // 不經 enterHandCard：免費重播不應因玩家手牌已滿而燒毀卡牌。
    p.hand.push(card);
    const auto = this.autoAll;
    this.autoAll = true;
    try { yield* this.playCard(card.uid, pick(this.s, targets), undefined, option, undefined, true); }
    finally { this.autoAll = auto; }
  }

  /** 檢查動作是否合法 */
  check(action: Action): { ok: boolean; reason?: string } {
    const s = this.s;
    if (s.phase !== 'play') return { ok: false, reason: '對戰尚未開始' };
    if (s.pendingChoice) return { ok: false, reason: '請先做出選擇' };
    const p = s.players[s.current];
    switch (action.type) {
      case 'useLocation':
        return this.canUseLocation(action.uid);
      case 'endTurn':
        return { ok: true };
      case 'play': {
        const r = this.canPlay(action.handUid, action.option, action.side);
        if (!r.ok) return r;
        const req = this.playTargetReq(action.handUid, action.option);
        if (req) {
          const valid = this.validTargets(req, s.current, this.cardIsSpell(action.handUid));
          if (valid.length) {
            if (action.target === undefined || !valid.includes(action.target)) return { ok: false, reason: '請選擇目標' };
          } else if (!req.optional) return { ok: false, reason: '沒有可選擇的目標' };
        }
        return { ok: true };
      }
      case 'attack': {
        if (!this.canAttack(action.attacker)) return { ok: false, reason: '無法攻擊' };
        if (!this.attackTargets(action.attacker).includes(action.target)) return { ok: false, reason: '無效的攻擊目標' };
        return { ok: true };
      }
      case 'heroPower': {
        if (!this.canHeroPower(action.option)) return { ok: false, reason: '無法使用英雄能力' };
        const def = this.powerDef(p);
        if (def.chooseOne && (action.option === undefined || !def.chooseOne[action.option])) return { ok: false, reason: '請選擇一個選項' };
        const req = this.powerTarget(p, action.option);
        if (req) {
          const valid = this.validTargets(req, s.current, true);
          if (action.target === undefined || !valid.includes(action.target)) return { ok: false, reason: '請選擇目標' };
        }
        return { ok: true };
      }
      case 'secondaryHeroPower': {
        if (!this.canSecondaryHeroPower()) return { ok: false, reason: '無法使用第二英雄能力' };
        const req = this.secondaryPowerDef(p)?.target;
        if (req) {
          const valid = this.validTargets(req, s.current, true);
          if (action.target === undefined || !valid.includes(action.target)) return { ok: false, reason: '請選擇目標' };
        }
        return { ok: true };
      }
      case 'trade': {
        const hc = p.hand.find((h) => h.uid === action.handUid);
        if (!hc) return { ok: false };
        if (!this.handDef(hc).keywords?.includes('TRADEABLE')) return { ok: false, reason: '不可交易' };
        if (p.mana < 1 || !p.deck.length) return { ok: false, reason: '法力不足' };
        return { ok: true };
      }
      case 'prepare':
        return this.canPrepare(action.handUid);
      case 'launch':
        return this.canLaunch();
    }
    return { ok: false };
  }

  // ==========================================================================
  // 查詢（UI / AI 使用）
  // ==========================================================================

  player(id: PlayerId): PlayerState {
    return this.s.players[id];
  }

  get me(): PlayerState {
    return this.s.players[this.s.current];
  }

  chars(): Char[] {
    const out: Char[] = [];
    for (const p of this.s.players) {
      out.push(p.hero, ...p.board);
    }
    return out;
  }

  char(uid: number): Char | null {
    for (const p of this.s.players) {
      if (p.hero.uid === uid) return p.hero;
      for (const m of p.board) if (m.uid === uid) return m;
    }
    return null;
  }

  minion(uid: number): Minion | null {
    for (const p of this.s.players) for (const m of p.board) if (m.uid === uid) return m;
    return null;
  }

  handCard(uid: number): { card: HandCard; owner: PlayerState } | null {
    for (const p of this.s.players) {
      const card = p.hand.find((h) => h.uid === uid);
      if (card) return { card, owner: p };
    }
    return null;
  }

  hasKw(m: Minion, k: Keyword): boolean {
    if (m.keywords.includes(k) || m.tempKeywords.includes(k) || m.nextTurnKeywords.includes(k) || m.auraKeywords.includes(k)) return true;
    const grants = this.s.players[m.owner].grants;
    if (!grants.length) return false;
    return grants.some((g) => {
      if (g.keyword !== k) return false;
      if (!g.race) return true;
      const races = getCard(m.cardId).races ?? [];
      return races.includes(g.race) || races.includes('ALL');
    });
  }

  atkOf(c: Char): number {
    if (isHero(c)) {
      const p = this.s.players[c.owner];
      const weapon = p.weapon && this.s.current === c.owner ? p.weapon.atk : 0;
      const aura = p.board.reduce(
        (sum, m) => sum + (m.silenced || (m.dormantTurns ?? 0) > 0 ? 0 : m.auras.filter((a) => a.scope === 'friendlyHero').reduce((x, a) => x + (a.atk ?? 0), 0)),
        0,
      );
      return Math.max(0, c.tempAtk + weapon + (this.s.current === c.owner ? aura : 0));
    }
    const enrage = c.enrageAtk && c.hp < c.maxHp ? c.enrageAtk : 0;
    const linger = c.lingerAtk?.reduce((x, l) => x + l.amount, 0) ?? 0;
    const bonus = this.s.players[c.owner].minionAtkBonus ?? 0;
    const def = getCard(c.cardId);
    const conditional = def.atkIf && this.evalCond(def.atkIf.cond, { ...this.baseCtx(c.owner), sourceUid: c.uid, sourceCardId: c.cardId }) ? def.atkIf.amount : 0;
    return Math.max(0, c.baseAtk + c.atkBuff + c.tempAtk + c.auraAtk + enrage + linger + bonus + conditional);
  }

  spellDamage(p: PlayerId): number {
    return this.s.players[p].board.reduce((sum, m) => sum + (m.silenced || (m.dormantTurns ?? 0) > 0 ? 0 : m.spellDamage), 0);
  }

  /** 手牌的卡牌定義（殭屍獸、賄賂強化的二選一會在這裡動態合成） */
  handDef(hc: HandCard): CardDef {
    if (hc.starship) return starshipDef(hc.cardId, hc.starship);
    if (hc.parts) return zombeastDef(hc.parts);
    const base = getCard(hc.cardId);
    if (hc.cardId === 'VH_SHAM_TRIAL' && hc.trialCost !== undefined) return { ...base, cost: hc.trialCost };
    if (hc.cardId === 'JAIL_504t3p' && hc.trialEffects?.includes('potion_damage')) return { ...base, target: { filter: { type: 'character', side: 'any' } } };
    if (!hc.chooseOneCombined || !base.chooseOne?.length) return base;

    // Noxious Bribe：把二選一的兩個選項合併成一張卡。
    // 若選項是變身型手下，合併兩個變體的較高數值、關鍵字與能力。
    const variants = base.chooseOne
      .map((o) => (o.transformInto ? getCard(o.transformInto) : null))
      .filter((x): x is CardDef => !!x);
    const abilities = [...(base.abilities ?? []), ...base.chooseOne.flatMap((o) => o.abilities), ...variants.flatMap((v) => v.abilities ?? [])];
    const auras = [...(base.auras ?? []), ...variants.flatMap((v) => v.auras ?? [])];
    const keywords = [...new Set([...(base.keywords ?? []), ...variants.flatMap((v) => v.keywords ?? [])])];
    return {
      ...base,
      chooseOne: undefined,
      target: base.chooseOne.find((o) => o.target)?.target ?? base.target,
      attack: Math.max(base.attack ?? 0, ...variants.map((v) => v.attack ?? 0)),
      health: Math.max(base.health ?? 0, ...variants.map((v) => v.health ?? 0)),
      abilities: abilities.length ? abilities : undefined,
      auras: auras.length ? auras : undefined,
      keywords: keywords.length ? keywords : undefined,
    };
  }

  /** 場上手下的卡牌定義 */
  minionDef(m: Minion): CardDef {
    if (m.starship) return starshipDef(m.cardId, m.starship);
    return m.parts ? zombeastDef(m.parts) : getCard(m.cardId);
  }

  // ==========================================================================
  // 克蘇恩
  // ==========================================================================

  /** 你的克蘇恩目前的攻擊力（在場上就看場上的，否則是 6 + 累積加成） */
  cthunAttack(pid: PlayerId): number {
    const p = this.s.players[pid];
    let best = (getCard(CTHUN_ID).attack ?? 6) + (p.cthun?.atk ?? 0);
    for (const m of p.board) if (isCthun(m.cardId) && !m.dead) best = Math.max(best, this.atkOf(m));
    return best;
  }

  /** 手牌中卡牌目前的攻擊力 / 生命值（含手牌增益與克蘇恩的累積加成） */
  handStats(pid: PlayerId, hc: HandCard): { atk: number; hp: number } {
    const def = this.handDef(hc);
    const bonus = isCthun(hc.cardId) ? this.s.players[pid].cthun : undefined;
    const extra = def.type === 'MINION' ? this.s.players[pid].minionAtkBonus ?? 0 : 0;
    const mirrored = def.manaMirrorInHand ? (hc.lockedManaValue ?? Math.max(0, this.s.players[pid].mana)) : undefined;
    return {
      atk: (mirrored ?? def.attack ?? 0) + hc.atkBuff + (bonus?.atk ?? 0) + extra,
      hp: (mirrored ?? def.health ?? 0) + hc.hpBuff + (bonus?.hp ?? 0),
    };
  }

  /**
   * 賦予你的克蘇恩加成。加成記在玩家身上：手牌、牌堆裡（包括之後才拿到）的克蘇恩都會有，
   * 場上的克蘇恩直接獲得；克蘇恩眼柄無論在哪裡都會跟著成長。
   */
  cthunBuff(pid: PlayerId, atk: number, hp: number, taunt: boolean) {
    const p = this.s.players[pid];
    const c = (p.cthun ??= { atk: 0, hp: 0, taunt: false });
    c.atk += atk;
    c.hp += hp;
    if (taunt) c.taunt = true;
    const grow = (match: (id: string) => boolean, a: number, h: number, t: boolean, inHand: boolean) => {
      if (inHand) {
        for (const hc of [...p.hand, ...p.deck]) {
          if (!match(hc.cardId)) continue;
          hc.atkBuff += a;
          hc.hpBuff += h;
        }
      }
      for (const m of p.board) {
        if (!match(m.cardId) || m.dead) continue;
        m.atkBuff += a;
        m.maxHp += h;
        m.hp += h;
        if (t && !m.keywords.includes('TAUNT')) m.keywords.push('TAUNT');
      }
    };
    grow(isCthun, atk, hp, taunt, false);
    if (atk > 0 || hp > 0) grow(isEyestalk, Math.max(0, atk), Math.max(0, hp), false, true);
    this.log(pid, `克蘇恩獲得 +${atk}/+${hp}${taunt ? ' 與嘲諷' : ''}（目前 ${this.cthunAttack(pid)} 攻擊力）`);
  }

  /** 手牌是否具有回音（卡牌本身，或場上有「你手牌中的手下具有回音」） */
  hasEcho(pid: PlayerId, hc: HandCard): boolean {
    const def = this.handDef(hc);
    if (def.keywords?.includes('ECHO')) return true;
    if (def.type !== 'MINION') return false;
    return this.s.players[pid].board.some(
      (m) => !m.silenced && m.auras.some((a) => a.scope === 'friendlyHand' && a.keywords?.includes('ECHO')),
    );
  }

  costOf(p: PlayerState, hc: HandCard): number {
    const def = this.handDef(hc);
    const base = def.manaMirrorInHand
      ? (hc.lockedManaValue ?? Math.max(0, p.mana))
      : hc.cardId === 'JAIL_433' && hc.opponentCopyPlayedSeen
        ? 1
        : (def.costIf && this.evalCond(def.costIf.cond, this.baseCtx(p.id)) ? def.costIf.cost : def.cost);
    let cost = base + hc.costMod - (hc.prepareDiscount ?? 0);
    // Mug's Magic：第 3 個自己的回合起，每回合第一個手下 -2 費。
    const hasMug = p.heroPower.id === 'JAIL_800hp1' || p.secondaryHeroPower?.id === 'JAIL_800hp1';
    if (hasMug && (p.turnsStarted ?? 0) >= 3 && (p.minionsPlayedThisTurn ?? 0) === 0 && def.type === 'MINION') cost -= 2;
    // 每回合的第一張法術（例如薩塔隱蔽力場）
    if (def.type === 'SPELL' && !p.spellsThisTurn && p.id === this.s.current) {
      for (const m of p.board) {
        if (m.silenced) continue;
        for (const a of m.auras) if (a.scope === 'firstSpellDiscount') cost -= a.cost ?? 0;
      }
    }
    if (def.costRule) {
      let n = 0;
      switch (def.costRule.per) {
        case 'otherCardsInHand':
          n = p.hand.filter((h) => h.uid !== hc.uid).length;
          break;
        case 'minionsOnBoard':
          n = this.s.players[0].board.length + this.s.players[1].board.length;
          break;
        case 'coinsInHand':
          n = p.hand.filter((h) => this.isCoin(h.cardId)).length;
          break;
        default:
          n = this.dyn(def.costRule.per, this.baseCtx(p.id), def.costRule.race);
      }
      cost -= def.costRule.amount * n;
    }
    if (p.nextCardDiscount && p.id === this.s.current) cost -= p.nextCardDiscount;
    if (def.type === 'SPELL' && p.nextSpellDiscount?.turn === this.s.turn && p.id === this.s.current) cost -= p.nextSpellDiscount.amount;
    if (def.type === 'MINION' && p.minionTax?.turn === this.s.turn) cost += p.minionTax.amount;
    if (def.type === 'MINION') {
      const jailers = [...this.s.players[0].board, ...this.s.players[1].board]
        .filter((m) => m.cardId === 'JAIL_890' && !m.silenced && !m.dead && (m.dormantTurns ?? 0) <= 0).length;
      cost += jailers * 2;
    }
    // 回音卡的消耗不會低於 1
    return Math.max(this.hasEcho(p.id, hc) ? Math.min(1, def.cost) : 0, cost);
  }

  /** 這張卡用什麼支付：法力、生命值或屍體 */
  costKind(p: PlayerState, hc: HandCard): 'mana' | 'health' | 'corpses' {
    const def = this.handDef(hc);
    if (def.costsCorpses || (p.nextCardCorpsesTurn === this.s.turn && p.id === this.s.current)) return 'corpses';
    if (def.costsHealth || (hc.healthCostUntil ?? -1) >= this.s.turn) return 'health';
    if (def.costsHealthIf && this.evalCond(def.costsHealthIf, this.baseCtx(p.id))) return 'health';
    return 'mana';
  }

  /** 付得起這張卡嗎（生命值不能付到自己死掉） */
  private canAfford(p: PlayerState, hc: HandCard): boolean {
    const cost = this.costOf(p, hc);
    switch (this.costKind(p, hc)) {
      case 'health':
        return cost < p.hero.hp;
      case 'corpses':
        return cost <= (p.corpses ?? 0);
      default:
        return cost <= p.mana;
    }
  }

  cardIsSpell(handUid: number): boolean {
    const hc = this.handCard(handUid);
    return !!hc && this.handDef(hc.card).type === 'SPELL';
  }

  canPlay(handUid: number, option?: number, side?: 'self' | 'opponent'): { ok: boolean; reason?: string } {
    const s = this.s;
    const p = s.players[s.current];
    const hc = p.hand.find((h) => h.uid === handUid);
    if (!hc) return { ok: false, reason: '找不到卡牌' };
    const def = this.handDef(hc);
    if (hc.locationLocked) return { ok: false, reason: '此牌被鎖定，請先打出另一張牌' };
    if (hc.preparedTurn === s.turn) return { ok: false, reason: '這張牌本回合剛完成預備，下回合才能打出' };
    if (!this.canAfford(p, hc)) {
      const kind = this.costKind(p, hc);
      return { ok: false, reason: kind === 'health' ? '生命值不足' : kind === 'corpses' ? '屍體不足' : '法力不足' };
    }
    if (def.type === 'MINION' || def.type === 'LOCATION') {
      if (side === 'opponent' && !def.disguised) return { ok: false, reason: '這張手下不能打到對手場上' };
      if (def.disguised && side === undefined) {
        if (this.boardSpaceUsed(p.id) >= MAX_BOARD && this.boardSpaceUsed(s.players[opp(p.id)].id) >= MAX_BOARD) return { ok: false, reason: '雙方場上都已滿' };
      } else {
        const boardOwner = side === 'opponent' ? opp(p.id) : p.id;
        if (this.boardSpaceUsed(s.players[boardOwner].id) >= MAX_BOARD) return { ok: false, reason: side === 'opponent' ? '對手場上已滿' : '場上已滿' };
      }
    }
    if (def.secret) {
      if (p.secrets.some((x) => x.cardId === def.id)) return { ok: false, reason: '已有相同的奧秘' };
      if (p.secrets.length >= MAX_SECRETS) return { ok: false, reason: '奧秘已滿' };
    }
    if (def.chooseOne) {
      if (option === undefined) {
        const any = def.chooseOne.some((_o, i) => this.optionPlayable(hc, def, i));
        return any ? { ok: true } : { ok: false, reason: '沒有可選擇的目標' };
      }
      if (!def.chooseOne[option]) return { ok: false, reason: '無效選項' };
      if (!this.optionPlayable(hc, def, option)) return { ok: false, reason: '沒有可選擇的目標' };
      return { ok: true };
    }
    if (def.type === 'SPELL') {
      const req = this.playTargetReq(handUid);
      if (req && !req.optional && !this.validTargets(req, s.current, true).length) return { ok: false, reason: '沒有可選擇的目標' };
    }
    return { ok: true };
  }

  private optionPlayable(hc: HandCard, def: CardDef, i: number): boolean {
    const opt = def.chooseOne![i];
    if (!opt.target || def.type === 'MINION') return true;
    const req = this.playTargetReq(hc.uid, i);
    return !req || !!this.validTargets(req, this.s.current, true).length;
  }

  /** 出牌時的目標需求（已考慮連擊等條件） */
  playTargetReq(handUid: number, option?: number): TargetReq | null {
    const p = this.s.players[this.s.current];
    const idx = p.hand.findIndex((h) => h.uid === handUid);
    if (idx < 0) return null;
    const def = this.handDef(p.hand[idx]);
    const req = def.chooseOne ? (option === undefined ? undefined : def.chooseOne[option]?.target) : def.target;
    if (!req) return null;
    if (req.when) {
      const ctx = this.baseCtx(p.id);
      ctx.combo = p.cardsPlayedThisTurn > 0;
      ctx.outcast = idx === 0 || idx === p.hand.length - 1;
      if (!this.evalCond(req.when, ctx, p.hand[idx].uid)) return null;
    }
    return req;
  }

  /** 可被選為目標的角色 */
  validTargets(req: TargetReq, player: PlayerId, bySpell: boolean, sourceUid: number | null = null): number[] {
    const ctx = this.baseCtx(player);
    ctx.sourceUid = sourceUid;
    return this.chars()
      .filter((c) => this.alive(c) && this.pass(c, req.filter, ctx))
      .filter((c) => {
        if (isHero(c)) return true;
        if (c.owner !== player && this.hasKw(c, 'STEALTH')) return false;
        if (bySpell && this.hasKw(c, 'ELUSIVE')) return false;
        return true;
      })
      .map((c) => c.uid);
  }

  /** 玩家目前的英雄能力（打出英雄卡後會被換掉） */
  powerDef(p: PlayerState): HeroPowerSpec {
    if (p.heroPower.heroCard) {
      const card = getCard(p.heroPower.heroCard);
      if (card.secondaryHeroPower?.id === p.heroPower.id) return card.secondaryHeroPower;
      const hp = card.heroPower;
      if (hp) return hp;
    }
    return HERO_POWERS[p.heroClass];
  }

  /** 顯示用的英雄能力名稱與敘述 */
  powerInfo(p: PlayerState): { name: string; text: string; cost: number } {
    if (p.heroPower.heroCard) {
      const card = getCard(p.heroPower.heroCard);
      const hp = card.secondaryHeroPower?.id === p.heroPower.id ? card.secondaryHeroPower : card.heroPower;
      if (hp) return { name: hp.name, text: hp.text, cost: p.heroPower.cost };
    }
    const info = HEROES[p.heroClass].power;
    return { name: info.name, text: info.text, cost: p.heroPower.cost };
  }

  private powerTarget(p: PlayerState, option?: number): TargetReq | undefined {
    const def = this.powerDef(p);
    if (def.chooseOne) return option === undefined ? undefined : def.chooseOne[option]?.target;
    return def.target;
  }

  heroPowerOptions(): { id: string; name?: string; text?: string }[] | null {
    return this.powerDef(this.me).chooseOne ?? null;
  }

  heroPowerTargets(option?: number): number[] {
    const req = this.powerTarget(this.me, option);
    return req ? this.validTargets(req, this.s.current, true) : [];
  }

  heroPowerNeedsTarget(option?: number): boolean {
    return !!this.powerTarget(this.me, option);
  }

  canHeroPower(option?: number): boolean {
    const p = this.me;
    if (p.heroPower.used || p.mana < p.heroPower.cost) return false;
    const def = this.powerDef(p);
    if (def.passive) return false;
    if (def.needsBoardSpace && this.boardSpaceUsed(p.id) >= MAX_BOARD) return false;
    if (!p.heroPower.heroCard && p.heroClass === 'SHAMAN' && BASIC_TOTEMS.every((t) => p.board.some((m) => m.cardId === t))) return false;
    if (def.chooseOne) {
      const opts = option === undefined ? def.chooseOne.map((_o, i) => i) : [option];
      return opts.some((i) => {
        const req = def.chooseOne![i]?.target;
        return !!def.chooseOne![i] && (!req || this.validTargets(req, this.s.current, true).length > 0);
      });
    }
    if (def.target && !this.validTargets(def.target, this.s.current, true).length) return false;
    return true;
  }

  /** 額外解鎖的第二英雄能力定義。 */
  secondaryPowerDef(p: PlayerState) {
    if (!p.secondaryHeroPower) return null;
    return getCard(p.secondaryHeroPower.sourceCardId).secondaryHeroPower ?? null;
  }

  secondaryPowerInfo(p: PlayerState): { name: string; text: string; cost: number; costKind: 'mana' | 'corpses' } | null {
    const def = this.secondaryPowerDef(p);
    if (!def || !p.secondaryHeroPower) return null;
    return { name: def.name, text: def.text, cost: p.secondaryHeroPower.cost, costKind: def.costKind ?? 'mana' };
  }

  secondaryHeroPowerTargets(): number[] {
    const def = this.secondaryPowerDef(this.me);
    return def?.target ? this.validTargets(def.target, this.s.current, true) : [];
  }

  secondaryHeroPowerNeedsTarget(): boolean {
    return !!this.secondaryPowerDef(this.me)?.target;
  }

  canSecondaryHeroPower(): boolean {
    const p = this.me;
    const inst = p.secondaryHeroPower;
    const def = this.secondaryPowerDef(p);
    if (!inst || !def || inst.used) return false;
    if (def.passive) return false;
    const costKind = def.costKind ?? 'mana';
    if (costKind === 'corpses') {
      if ((p.corpses ?? 0) < inst.cost) return false;
    } else if (p.mana < inst.cost) return false;
    if (def.needsBoardSpace && this.boardSpaceUsed(p.id) >= MAX_BOARD) return false;
    if (def.target && !this.validTargets(def.target, this.s.current, true).length) return false;
    return true;
  }

  maxAttacks(c: Char): number {
    if (isHero(c)) {
      const w = this.s.players[c.owner].weapon;
      return w?.keywords.includes('WINDFURY') ? 2 : 1;
    }
    if (this.hasKw(c, 'MEGA_WINDFURY')) return 4;
    return this.hasKw(c, 'WINDFURY') ? 2 : 1;
  }

  canAttack(uid: number): boolean {
    const s = this.s;
    if (s.phase !== 'play' || s.pendingChoice) return false;
    const c = this.char(uid);
    if (!c || c.owner !== s.current || !this.alive(c)) return false;
    if (!isHero(c) && (c.dormantTurns ?? 0) > 0) return false;
    if (c.frozen) return false;
    if (this.atkOf(c) <= 0) return false;
    if (c.attacks >= this.maxAttacks(c)) return false;
    if (!isHero(c)) {
      if (this.hasKw(c, 'CANT_ATTACK')) return false;
      if (c.sleeping && !this.hasKw(c, 'CHARGE') && !this.hasKw(c, 'RUSH')) return false;
    }
    return this.attackTargets(uid).length > 0;
  }

  attackTargets(uid: number): number[] {
    const c = this.char(uid);
    if (!c) return [];
    const enemy = this.s.players[opp(c.owner)];
    const minions = enemy.board.filter((m) => this.alive(m) && (m.dormantTurns ?? 0) <= 0 && !this.hasKw(m, 'STEALTH'));
    const taunts = minions.filter((m) => this.hasKw(m, 'TAUNT'));
    let targets: Char[] = taunts.length ? taunts : minions;
    let heroAllowed = !taunts.length;
    if (!isHero(c)) {
      if (this.hasKw(c, 'CANT_ATTACK_HEROES')) heroAllowed = false;
      if (c.sleeping && !this.hasKw(c, 'CHARGE')) heroAllowed = false; // 突襲
    }
    if (heroAllowed) targets = [...targets, enemy.hero];
    return targets.map((t) => t.uid);
  }

  alive(c: Char): boolean {
    if (isHero(c)) return c.hp > 0;
    return c.hp > 0 && !c.dead;
  }

  // ==========================================================================
  // 執行
  // ==========================================================================

  private drive(gen: Gen, first?: number) {
    let input = first;
    for (;;) {
      const r = gen.next(input as number);
      if (r.done) return;
      const req = r.value;
      if (this.autoAll || this.s.players[req.player].ai) {
        input = this.chooser(this.s, req);
        continue;
      }
      this.pending = gen;
      this.s.pendingChoice = req;
      return;
    }
  }

  private *wrap(inner: Gen): Gen {
    yield* inner;
    yield* this.processDeaths();
    this.recalcAuras();
    this.trimFx();
  }

  uid(): number {
    return this.s.nextUid++;
  }

  newHandCard(cardId: string): HandCard {
    return { uid: this.uid(), cardId, costMod: 0, atkBuff: 0, hpBuff: 0 };
  }

  log(player: PlayerId | null, text: string) {
    this.s.log.push({ turn: this.s.turn, player, text });
    if (this.s.log.length > 200) this.s.log.splice(0, this.s.log.length - 200);
  }

  private fx(f: Omit<Fx, 'id'>) {
    this.s.fx.push({ id: ++this.s.fxSeq, ...f });
  }

  private trimFx() {
    if (this.s.fx.length > 60) this.s.fx.splice(0, this.s.fx.length - 60);
  }

  private name(cardId: string): string {
    return `【${getCard(cardId).name}】`;
  }

  private endGame(winner: PlayerId | 'draw') {
    if (this.s.phase === 'over') return;
    this.s.phase = 'over';
    this.s.winner = winner;
  }

  private get over(): boolean {
    return this.s.phase === 'over';
  }

  // ==========================================================================
  // 起手換牌與回合
  // ==========================================================================

  /** 執行雙方牌庫中的開局效果。普通效果先執行；startOfGameLast 最後執行。 */
  private runStartOfGame() {
    const pending: { player: PlayerId; cardId: string; effects: Effect[]; last: boolean }[] = [];
    for (const pid of [0, 1] as PlayerId[]) {
      // 固定快照，避免開局效果新增的卡又在同一輪重複觸發。
      for (const hc of [...this.s.players[pid].deck]) {
        const def = getCard(hc.cardId);
        if (!def.startOfGame?.length) continue;
        pending.push({ player: pid, cardId: def.id, effects: def.startOfGame, last: !!def.startOfGameLast });
      }
    }
    pending.sort((a, b) => Number(a.last) - Number(b.last));
    for (const item of pending) {
      this.steps = 0;
      const ctx: Ctx = { ...this.baseCtx(item.player), sourceCardId: item.cardId };
      this.log(item.player, `${this.name(item.cardId)}觸發了開局效果`);
      this.drive(this.wrap(this.runEffects(item.effects, ctx)));
    }
  }

  private mulligan(player: PlayerId, replace: number[]): boolean {
    const s = this.s;
    if (s.phase !== 'mulligan') return false;
    const p = s.players[player];
    if (p.mulliganDone) return false;
    // 先移除要換的牌，再把新牌加入手牌；碎裂牌也必須在起手換牌時正常分裂。
    const back = p.hand.filter((h) => replace.includes(h.uid));
    p.hand = p.hand.filter((h) => !replace.includes(h.uid));
    for (const old of back) {
      const next = p.deck.pop();
      if (next) this.enterHandCard(p, next, false);
      else p.hand.push(old);
    }
    for (const card of back) p.deck.splice(randomInt(s, p.deck.length + 1), 0, card);
    this.recombineShatter(p);
    p.mulliganDone = true;
    if (s.players[0].mulliganDone && s.players[1].mulliganDone) {
      const second = s.players[opp(s.first)];
      second.hand.push(this.newHandCard('GAME_005'));
      s.phase = 'play';
      this.drive(this.wrap(this.startTurn(s.first)));
    }
    return true;
  }

  private *startTurn(pid: PlayerId): Gen {
    const s = this.s;
    s.current = pid;
    s.turn++;
    if (s.turn > MAX_TURNS) {
      this.log(null, '回合數達到上限，平手！');
      this.endGame('draw');
      return;
    }
    const p = s.players[pid];
    p.maxMana = Math.min(MAX_MANA, p.maxMana + 1);
    p.overloadLocked = p.overloadOwed;
    p.mana = Math.max(0, p.maxMana - p.overloadOwed);
    if (p.mana10AfterTurns !== undefined) {
      p.mana10AfterTurns--;
      if (p.mana10AfterTurns <= 0) {
        p.maxMana = MAX_MANA;
        p.mana = MAX_MANA;
        p.mana10AfterTurns = undefined;
        this.log(p.id, `${p.name}的法力水晶被設為 10！`);
      }
    }
    p.overloadOwed = 0;
    for (const location of p.locations ?? []) location.cooldown = Math.max(0, location.cooldown - 1);
    p.heroPower.used = false;
    if (p.secondaryHeroPower) p.secondaryHeroPower.used = false;
    p.cardsPlayedThisTurn = 0;
    p.spellsThisTurn = 0;
    p.minionsPlayedThisTurn = 0;
    p.turnsStarted = (p.turnsStarted ?? 0) + 1;
    p.drawnThisTurn = 0;
    s.deathsThisTurn = 0;
    p.heroAttackedThisTurn = false;
    p.damagedFriendlyUidsThisTurn = [];
    for (const pl of s.players) pl.nextCardDiscount = 0;
    p.elementalLastTurn = p.elementalThisTurn;
    p.elementalThisTurn = false;
    p.hero.attacks = 0;
    for (const pl of s.players) pl.hero.immune = false;
    for (const m of p.board) {
      if ((m.dormantTurns ?? 0) > 0) {
        m.dormantTurns!--;
        if ((m.dormantTurns ?? 0) <= 0) {
          m.dormantTurns = undefined;
          m.sleeping = false;
          this.log(p.id, `${this.name(m.cardId)}從休眠中甦醒`);
        }
      } else m.sleeping = false;
      m.attacks = 0;
      m.nextTurnKeywords = [];
    }
    for (const pl of s.players) for (const m of pl.board) if (m.lingerAtk) m.lingerAtk = m.lingerAtk.filter((l) => l.until !== pid);
    this.log(pid, `—— 第 ${Math.ceil(s.turn / 2)} 回合：${p.name} ——`);
    yield* this.emit({ k: 'turnStart', player: pid });
    yield* this.checkSecrets(pid, 'turnStart', {});
    yield* this.processDeaths();
    if (this.over) return;
    // 延遲的效果（例如不祥之兆「2 回合後召喚…」）
    if (p.delayed?.length) {
      const due = p.delayed.filter((d) => --d.turns <= 0);
      p.delayed = p.delayed.filter((d) => d.turns > 0);
      for (const d of due) {
        yield* this.runEffects(d.effects, { ...this.baseCtx(pid), sourceCardId: d.sourceCardId });
        yield* this.processDeaths();
        if (this.over) return;
      }
    }
    // 伊莉妲‧逐罪者：這是額外「取得」卡牌，不算正常抽牌，也不會阻止疲勞。
    if (p.voidDeck?.length) this.getFromVoid(p, 2);
    // 時光凍結者：回合開始時不再抽牌
    if (p.board.some((m) => !m.silenced && getCard(m.cardId).flags?.includes('noTurnDraw'))) return;
    yield* this.draw(p, 1);
  }

  private *endTurn(): Gen {
    const s = this.s;
    const pid = s.current;
    const p = s.players[pid];
    // 回音的複製與暫時的卡只能在本回合使用
    p.hand = p.hand.filter((h) => !h.echo && !h.temporary);
    for (const h of p.hand) {
      if (h.grantedPlayEffectsTurn === s.turn) {
        h.grantedPlayEffects = undefined;
        h.grantedPlayEffectsTurn = undefined;
      }
    }
    this.recombineShatter(p);
    yield* this.emit({ k: 'turnEnd', player: pid });
    // 目標/光環型法術：每個自己的回合結束觸發一次，持續指定回合數。
    if (p.objectives?.length) {
      for (const o of [...p.objectives]) {
        yield* this.runEffects(o.effects, { ...this.baseCtx(pid), sourceCardId: o.sourceCardId });
        o.remaining--;
        yield* this.processDeaths();
        if (this.over) return;
      }
      p.objectives = p.objectives.filter((o) => o.remaining > 0);
    }
    // 回合結束時回到手牌的卡（例如屍淇淋）
    if (p.endOfTurnCards?.length) {
      for (const id of p.endOfTurnCards) this.addToHand(p, id);
      p.endOfTurnCards = [];
    }
    yield* this.checkSecrets(opp(pid), 'enemyTurnEnd', {});
    yield* this.processDeaths();
    if (this.over) return;
    for (const pl of s.players) {
      pl.hero.tempAtk = 0;
      for (const m of pl.board) {
        m.tempAtk = 0;
        m.tempKeywords = [];
      }
    }
    // Holmes 的調查只持續到指定的「對手下一回合」結束。
    for (const pl of s.players) if (pl.holmesWatches) pl.holmesWatches = pl.holmesWatches.filter((w) => w.turn > s.turn);
    // 解凍：沒有錯過攻擊機會的角色才會在回合結束解凍
    const thaw = (c: Char) => {
      if (!c.frozen) return;
      const couldAttack = isHero(c) ? true : !c.sleeping || this.hasKw(c, 'CHARGE') || this.hasKw(c, 'RUSH');
      if (c.frozenTurn < s.turn || (c.attacks === 0 && couldAttack)) c.frozen = false;
    };
    thaw(p.hero);
    p.board.forEach(thaw);
    this.recalcAuras();
    yield* this.startTurn(opp(pid));
  }

  // ==========================================================================
  // 出牌
  // ==========================================================================

  private *playCard(
    handUid: number,
    target: number | undefined,
    position: number | undefined,
    option: number | undefined,
    side: 'self' | 'opponent' | undefined,
    free = false,
  ): Gen {
    const s = this.s;
    const p = s.players[s.current];
    const idx = p.hand.findIndex((h) => h.uid === handUid);
    const hc = p.hand[idx];
    const def = this.handDef(hc);
    const cost = this.costOf(p, hc);
    // 只有「打出這張卡之前就已經在手牌」的腐化卡能被本次出牌腐化。
    // 先記 UID，真正比較費用時會在本次一次性折扣被消耗後重新計算它們的目前費用。
    const corruptibleUids = p.hand
      .filter((h) => h.uid !== handUid)
      .filter((h) => {
        const d = this.handDef(h);
        return !!d.corruptInto || !!d.corruptRepeatBuff;
      })
      .map((h) => h.uid);
    for (const held of p.hand) if (held.uid !== hc.uid) held.locationLocked = false;
    const outcast = idx === 0 || idx === p.hand.length - 1;
    const combo = p.cardsPlayedThisTurn > 0;
    const echo = this.hasEcho(p.id, hc);
    if (def.manaMirrorInHand) hc.lockedManaValue = Math.max(0, p.mana);
    const kind = this.costKind(p, hc);
    if (free) { /* 由效果免費打出，不支付任何資源。 */ }
    else if (kind === 'health') this.payHealth(p, cost);
    else if (kind === 'corpses') this.spendCorpses(p, cost);
    else {
      p.mana -= cost;
      if (cost === 2) {
        p.cardsPlayedForTwoMana = (p.cardsPlayedForTwoMana ?? 0) + 1;
        for (const card of [...p.hand, ...p.deck]) {
          if (card.uid !== hc.uid && card.cardId === 'JAIL_470') card.twoManaCardsSeen = (card.twoManaCardsSeen ?? 0) + 1;
        }
      }
    }
    if (p.nextCardCorpsesTurn === s.turn) p.nextCardCorpsesTurn = undefined;
    if (def.type === 'SPELL' && p.nextSpellDiscount?.turn === s.turn) p.nextSpellDiscount = undefined;
    if (hc.copiedFromOpponent) {
      for (const held of p.hand) {
        if (held.uid !== hc.uid && (held.cardId === 'JAIL_432' || held.cardId === 'JAIL_433')) held.opponentCopyPlayedSeen = true;
      }
    }
    p.hand.splice(idx, 1);
    this.recombineShatter(p);
    // 回音：把一張複製加入手牌，回合結束時消失
    if (echo && p.hand.length < MAX_HAND) p.hand.push({ ...structuredClone(hc), uid: this.uid(), echo: true });
    // 雙生法術：把一張沒有雙生法術的複製加入手牌
    if (def.twinspellCopy && p.hand.length < MAX_HAND) p.hand.push(this.newHandCard(def.twinspellCopy));
    p.cardsPlayedThisTurn++;
    // Inspector Murloc Holmes：只在被調查對手的下一個回合檢查「同名卡」。
    const watcher = s.players[opp(p.id)];
    if (watcher.holmesWatches?.length) {
      const matches = watcher.holmesWatches.filter((w) => w.turn === s.turn && w.cardName === def.nameEn);
      for (let hit = 0; hit < matches.length; hit++) {
        for (let i = 0; i < 3; i++) this.addToHand(watcher, 'GAME_005');
        this.log(watcher.id, `${watcher.name}的調查命中：${def.name}`);
      }
      if (matches.length) watcher.holmesWatches = watcher.holmesWatches.filter((w) => !matches.includes(w));
    }
    p.nextCardDiscount = 0;
    if (def.overload) p.overloadOwed += def.overload;
    this.corruptHand(p, corruptibleUids, cost);

    let abilities: Ability[] = [...(def.abilities ?? [])];
    if (hc.grantedPlayEffects?.length) abilities.push({ on: { k: 'play' }, effects: hc.grantedPlayEffects });
    let transformInto: string | undefined;
    if (def.chooseOne) {
      const opt = def.chooseOne[option ?? 0];
      abilities = opt.abilities;
      transformInto = opt.transformInto;
      this.log(p.id, `${p.name}打出了${this.name(def.id)}（${opt.name}）`);
    } else this.log(p.id, `${p.name}打出了${this.name(def.id)}`);
    this.fx({ kind: 'play', cardId: def.id, player: p.id, target });

    const ctx: Ctx = {
      controller: p.id,
      sourceUid: null,
      sourceCardId: def.id,
      sourceHandCard: hc,
      isSpell: def.type === 'SPELL',
      chosen: target ?? null,
      it: null,
      eventAmount: 0,
      combo,
      outcast,
      lifesteal: !!def.keywords?.includes('LIFESTEAL'),
    };
    const playAbilities = abilities.filter((a) => a.on.k === 'play');

    if (def.type === 'MINION') {
      const boardOwner = def.disguised && side === 'opponent' ? opp(p.id) : p.id;
      const boardPlayer = s.players[boardOwner];
      const m = this.makeMinion(boardOwner, transformInto ?? def.id, hc);
      const pos = Math.max(0, Math.min(position ?? boardPlayer.board.length, boardPlayer.board.length));
      boardPlayer.board.splice(pos, 0, m);
      ctx.sourceUid = m.uid;
      // 偽裝手下進場後，其卡面中的「友方／敵方」依目前控制者判定。
      // 但 cardPlayed 仍由真正出牌的玩家 p.id 發出，符合官方自由放置規則。
      ctx.controller = boardOwner;
      this.recalcAuras();
      this.countSummon(boardPlayer, m.cardId);
      this.assemble(boardPlayer, m);
      this.fx({ kind: 'summon', uid: m.uid, cardId: m.cardId, player: boardOwner, played: true });
      if (def.races?.includes('ELEMENTAL')) boardPlayer.elementalThisTurn = true;
      p.minionsPlayedThisTurn = (p.minionsPlayedThisTurn ?? 0) + 1;
      p.minionsPlayedThisGame = (p.minionsPlayedThisGame ?? 0) + 1;
      const hasZee = p.heroPower.id === 'JAIL_800hp2' || p.secondaryHeroPower?.id === 'JAIL_800hp2';
      const battlecryCasts = hasZee && p.minionsPlayedThisGame % 5 === 0 ? 2 : 1;
      for (let repeat = 0; repeat < battlecryCasts; repeat++) {
        for (const ab of playAbilities) {
          if (ab.cond && !this.evalCond(ab.cond, ctx)) continue;
          yield* this.runEffects(ab.effects, ctx);
          if (this.over) return;
        }
      }
      yield* this.emit({ k: 'summon', player: boardOwner, subject: m.uid, races: def.races });
      yield* this.emit({ k: 'cardPlayed', player: p.id, subject: m.uid, cardType: 'MINION', races: def.races, cardId: def.id, echo });
      if (this.minion(m.uid)) yield* this.checkSecrets(opp(p.id), 'enemyPlaysMinion', { it: { kind: 'char', uid: m.uid } });
    } else if (def.type === 'LOCATION') {
      this.addLocation(p.id, def.id);
      yield* this.emit({ k: 'cardPlayed', player: p.id, cardType: 'LOCATION', cardId: def.id });
    } else if (def.type === 'SPELL') {
      this.spellCountered = false;
      yield* this.checkSecrets(opp(p.id), 'enemyCastsSpell', {});
      if (!this.spellCountered) {
        if (def.secret) {
          p.secrets.push({ uid: this.uid(), cardId: def.id });
        } else {
          const casts = hc.castTwice ? 2 : 1;
          for (let cast = 0; cast < casts; cast++) {
            for (const ab of playAbilities) {
              if (ab.cond && !this.evalCond(ab.cond, ctx)) continue;
              yield* this.runEffects(ab.effects, ctx);
              if (this.over) return;
            }
          }
        }
      } else this.log(p.id, `${this.name(def.id)}被反制了！`);
      p.spellsCastThisGame++;
      p.spellsThisTurn = (p.spellsThisTurn ?? 0) + 1;
      // 紫羅蘭堡薩滿：這三張法術只計算「它們待在手牌時」看到的施法。
      for (const held of p.hand) {
        const trans = this.handDef(held).handTransformAfterSpells;
        if (!trans) continue;
        held.spellTransformProgress = (held.spellTransformProgress ?? 0) + 1;
        if (held.spellTransformProgress >= trans.count) {
          const before = held.cardId;
          held.cardId = trans.into;
          held.spellTransformProgress = undefined;
          this.log(p.id, `${this.name(before)}變形成${this.name(trans.into)}`);
        }
      }
      yield* this.emit({ k: 'spellCast', player: p.id, cardId: def.id, subject: target, subjectKind: 'char' });
      yield* this.emit({ k: 'cardPlayed', player: p.id, cardType: 'SPELL', cardId: def.id, echo });
    } else if (def.type === 'HERO') {
      // 英雄卡：換上新英雄、獲得護甲、換成新的英雄能力（本回合就能使用）
      p.hero.cardId = def.id;
      p.hero.armor += def.armor ?? 0;
      if (def.armor) this.fx({ kind: 'armor', uid: p.hero.uid, amount: def.armor });
      if (def.heroPower) p.heroPower = { id: def.heroPower.id, used: false, cost: def.heroPower.cost, heroCard: def.id };
      ctx.sourceUid = p.hero.uid;
      for (const ab of playAbilities) {
        if (ab.cond && !this.evalCond(ab.cond, ctx)) continue;
        yield* this.runEffects(ab.effects, ctx);
        if (this.over) return;
      }
      yield* this.emit({ k: 'cardPlayed', player: p.id, cardType: 'HERO', cardId: def.id, echo });
    } else {
      yield* this.equip(p.id, def.id);
      ctx.sourceUid = p.weapon?.uid ?? null;
      for (const ab of playAbilities) {
        if (ab.cond && !this.evalCond(ab.cond, ctx)) continue;
        yield* this.runEffects(ab.effects, ctx);
        if (this.over) return;
      }
      yield* this.emit({ k: 'cardPlayed', player: p.id, cardType: 'WEAPON', cardId: def.id, echo });
    }
    if (def.id !== 'JAIL_500') (p.playedCardsThisTurn ??= []).push({ cardId: def.id, option, side });
    if (this.powerDef(p).refresh === 'cardPlayed') p.heroPower.used = false;
    this.returnGodfreyOverdraw(p);
  }

  /** 腐化手牌：比較雙方「目前費用」，並保留原手牌卡的費用/數值增益。 */
  private corruptHand(p: PlayerState, candidates: number[], playedCost: number) {
    for (const uid of candidates) {
      const hc = p.hand.find((h) => h.uid === uid);
      if (!hc) continue;
      const def = this.handDef(hc);
      if (!def.corruptInto && !def.corruptRepeatBuff) continue;
      const currentCost = this.costOf(p, hc);
      if (playedCost <= currentCost) continue;

      if (def.corruptInto) {
        const oldName = def.name;
        hc.cardId = def.corruptInto;
        this.log(p.id, `${oldName}已腐化`);
      } else if (def.corruptRepeatBuff) {
        hc.atkBuff += def.corruptRepeatBuff.atk;
        hc.hpBuff += def.corruptRepeatBuff.hp;
        this.log(p.id, `${def.name}再次腐化，獲得 +${def.corruptRepeatBuff.atk}/+${def.corruptRepeatBuff.hp}`);
      }
    }
  }

  /** 是否可以對這張手牌進行「預備」。 */
  canPrepare(handUid: number): { ok: boolean; reason?: string } {
    const p = this.me;
    const hc = p.hand.find((h) => h.uid === handUid);
    if (!hc) return { ok: false, reason: '找不到卡牌' };
    const def = this.handDef(hc);
    if (!def.prepare && !hc.grantedPrepare) return { ok: false, reason: '這張牌沒有預備' };
    if (hc.prepared) return { ok: false, reason: '這張牌已經預備過' };
    if (p.mana < 1) return { ok: false, reason: '至少需要 1 點剩餘法力才能預備' };
    if (this.costOf(p, hc) <= 0) return { ok: false, reason: '這張牌已經是 0 費' };
    return { ok: true };
  }

  /**
   * 預備：消耗所有剩餘法力，永久減少「消耗量 + 1」。
   * 降費可以超過卡牌目前費用，但實際費用最低仍為 0；不算出牌，並鎖到下回合。
   */
  private prepare(handUid: number) {
    const p = this.me;
    const hc = p.hand.find((h) => h.uid === handUid)!;
    const spend = p.mana;
    p.mana = 0;
    const discount = spend + 1;
    hc.prepareDiscount = (hc.prepareDiscount ?? 0) + discount;
    for (const h of p.hand) {
      if (h.uid !== hc.uid && h.cardId === 'JAIL_453') h.costMod -= discount;
    }
    hc.prepared = true;
    hc.preparedTurn = this.s.turn;
    this.log(p.id, `${p.name}預備了${this.name(hc.cardId)}，消耗 ${spend} 點法力並降低 ${spend + 1} 點消耗`);
  }

  private *trade(handUid: number): Gen {
    const p = this.me;
    const i = p.hand.findIndex((h) => h.uid === handUid);
    const [card] = p.hand.splice(i, 1);
    this.recombineShatter(p);
    p.mana -= 1;
    // 洗回牌庫會清除「預備」附魔；其他永久 costMod / 手牌 buff 維持原有引擎規則。
    card.prepareDiscount = 0;
    card.prepared = false;
    card.preparedTurn = undefined;
    p.deck.splice(randomInt(this.s, p.deck.length + 1), 0, card);
    this.log(p.id, `${p.name}交易了一張牌`);
    yield* this.draw(p, 1);
  }

  private *useHeroPower(target: number | undefined, option: number | undefined): Gen {
    const p = this.me;
    const def = this.powerDef(p);
    const effects = def.chooseOne ? def.chooseOne[option ?? 0].effects : def.effects;
    p.mana -= p.heroPower.cost;
    p.heroPower.used = true;
    p.heroPowersUsed++;
    this.log(p.id, `${p.name}使用了英雄能力【${this.powerInfo(p).name}】`);
    this.fx({ kind: 'play', cardId: p.heroPower.id, player: p.id, target });
    const ctx = this.baseCtx(p.id);
    ctx.sourceUid = p.hero.uid;
    ctx.sourceCardId = p.heroPower.id;
    ctx.chosen = target ?? null;
    ctx.isHeroPower = true;
    ctx.lifesteal = !!def.lifesteal;
    yield* this.runEffects(effects, ctx);
    yield* this.emit({ k: 'heroPower', player: p.id });
  }

  private *useSecondaryHeroPower(target: number | undefined): Gen {
    const p = this.me;
    const inst = p.secondaryHeroPower!;
    const def = this.secondaryPowerDef(p)!;
    if ((def.costKind ?? 'mana') === 'corpses') {
      p.corpses = Math.max(0, (p.corpses ?? 0) - inst.cost);
      p.corpsesSpent = (p.corpsesSpent ?? 0) + inst.cost;
    } else p.mana -= inst.cost;
    inst.used = true;
    p.heroPowersUsed++;
    this.log(p.id, `${p.name}使用了第二英雄能力【${def.name}】`);
    this.fx({ kind: 'play', cardId: inst.id, player: p.id, target });
    const ctx = this.baseCtx(p.id);
    ctx.sourceUid = p.hero.uid;
    ctx.sourceCardId = inst.id;
    ctx.chosen = target ?? null;
    ctx.isHeroPower = true;
    ctx.lifesteal = !!def.lifesteal;
    yield* this.runEffects(def.effects, ctx);
    yield* this.emit({ k: 'heroPower', player: p.id });
  }

  // ==========================================================================
  // 攻擊
  // ==========================================================================

  private *doAttack(attackerUid: number, targetUid: number): Gen {
    const s = this.s;
    const attacker = this.char(attackerUid)!;
    const pid = attacker.owner;
    const defender = this.char(targetUid)!;
    const dp = opp(pid);
    const atkName = isHero(attacker) ? s.players[pid].name : this.name(attacker.cardId);
    const defName = isHero(defender) ? `${s.players[dp].name}的英雄` : this.name(defender.cardId);
    this.log(pid, `${atkName}攻擊了${defName}`);
    this.fx({ kind: 'attack', uid: attackerUid, target: targetUid, player: pid });

    attacker.attacks++;
    if (isHero(attacker)) {
      s.players[pid].heroAttackedThisTurn = true;
      s.players[pid].heroAttacksThisGame = (s.players[pid].heroAttacksThisGame ?? 0) + 1;
    }

    this.currentAttack = { attacker: attackerUid, defender: targetUid };
    if (!isHero(attacker) && this.hasKw(attacker, 'STEALTH')) {
      for (const h of s.players[pid].hand) if (h.cardId === 'CAP_006') h.stealthAttackSeen = true;
    }
    const it: ItRef = { kind: 'char', uid: attackerUid };
    if (isHero(defender)) {
      yield* this.checkSecrets(dp, 'heroAttacked', { it });
      if (!isHero(attacker)) yield* this.checkSecrets(dp, 'minionAttacksHero', { it });
    } else yield* this.checkSecrets(dp, 'minionAttacked', { it: { kind: 'char', uid: targetUid } });
    yield* this.checkSecrets(dp, 'enemyAttacks', { it });
    if (!isHero(attacker)) yield* this.checkSecrets(dp, 'enemyMinionAttacks', { it });
    const defUid = this.currentAttack.defender;
    this.currentAttack = null;
    yield* this.processDeaths();
    if (this.over) return;

    yield* this.emit({ k: 'attack', player: pid, subject: attackerUid, isHero: isHero(attacker), after: false });
    yield* this.processDeaths();
    if (this.over) return;

    const a = this.char(attackerUid);
    const d = this.char(defUid);
    if (!a || !d || !this.alive(a) || !this.alive(d)) return;

    if (!isHero(a)) {
      a.keywords = a.keywords.filter((k) => k !== 'STEALTH');
      a.tempKeywords = a.tempKeywords.filter((k) => k !== 'STEALTH');
      a.nextTurnKeywords = a.nextTurnKeywords.filter((k) => k !== 'STEALTH');
    }
    const aAtk = this.atkOf(a);
    const dAtk = isHero(d) ? 0 : this.atkOf(d);
    const aSrc = this.charSource(a);
    const dSrc = this.charSource(d);
    const cleave = isHero(a) ? !!s.players[pid].weapon?.keywords.includes('CLEAVE') : this.hasKw(a, 'CLEAVE');
    const neighbors = cleave && !isHero(d) ? this.adjacent(d) : [];
    yield* this.damage(aSrc, d.uid, aAtk);
    if (dAtk > 0) yield* this.damage(dSrc, a.uid, dAtk);
    for (const n of neighbors) yield* this.damage(aSrc, n.uid, aAtk);
    const killed = !isHero(d) && (d.hp <= 0 || d.dead);

    if (isHero(a)) {
      const w = s.players[pid].weapon;
      if (w) {
        w.durability--;
        // 霜之哀傷：記住被這把武器消滅的手下
        if (killed) (w.killed ??= []).push(d.cardId);
      }
    }
    this.lastAttack = { attacker: a.uid, defender: d.uid, defenderIsHero: isHero(d), killed };
    yield* this.emit({ k: 'attack', player: pid, subject: attackerUid, isHero: isHero(a), after: true });
  }

  private charSource(c: Char): DmgSource {
    if (isHero(c)) {
      const w = this.s.players[c.owner].weapon;
      return {
        owner: c.owner,
        uid: c.uid,
        cardId: w?.cardId,
        poisonous: !!w?.keywords.includes('POISONOUS'),
        lifesteal: !!w?.keywords.includes('LIFESTEAL'),
        freeze: !!w?.keywords.includes('FREEZE_ON_DAMAGE'),
      };
    }
    return {
      owner: c.owner,
      uid: c.uid,
      cardId: c.cardId,
      poisonous: this.hasKw(c, 'POISONOUS'),
      lifesteal: this.hasKw(c, 'LIFESTEAL'),
      freeze: this.hasKw(c, 'FREEZE_ON_DAMAGE'),
    };
  }

  // ==========================================================================
  // 基本操作：傷害 / 治療 / 抽牌 / 召喚
  // ==========================================================================

  private *summonWarptooths(p: PlayerState): Gen {
    while (this.boardSpaceUsed(p.id) < MAX_BOARD) {
      const fromHand = p.hand.find((h) => h.cardId === 'JAIL_421');
      const fromDeck = p.deck.find((h) => h.cardId === 'JAIL_421');
      const card = fromHand ?? fromDeck;
      if (!card) break;
      if (fromHand) p.hand.splice(p.hand.indexOf(fromHand), 1);
      else p.deck.splice(p.deck.indexOf(fromDeck!), 1);
      yield* this.summon(p.id, 'JAIL_421', undefined, card);
      this.log(p.id, `${this.name('JAIL_421')}因四個不同友方角色受傷而登場`);
    }
  }

  private *damage(src: DmgSource, targetUid: number, amount: number): Gen<number> {
    const sourceMinion = src.uid !== null ? this.minion(src.uid) : null;
    if (sourceMinion && this.s.current === src.owner) {
      const races = getCard(sourceMinion.cardId).races ?? [];
      if (races.includes('PIRATE') || races.includes('ALL')) {
        amount += this.s.players[src.owner].board.filter((m) => !m.silenced && !m.dead && m.hp > 0 && m.cardId === 'CAP_104').length;
      }
    }
    const t = this.char(targetUid);
    if (!t || amount <= 0 || this.over) return 0;
    if (src.cardId === 'JAIL_443' && isHero(t)) {
      const deck = this.s.players[t.owner].deck;
      for (let i = 0; i < amount; i++) deck.splice(randomInt(this.s, deck.length + 1), 0, this.newHandCard('JAIL_443t'));
      this.log(src.owner, `${this.name('JAIL_443')}把 ${amount} 張 Blight 洗入${this.s.players[t.owner].name}的牌庫`);
      return 0;
    }
    let overkill = false;
    let honorableKill = false;
    if (isHero(t)) {
      if (t.immune) return 0;
      if (amount >= t.hp + t.armor && this.s.current !== t.owner) {
        const sec = this.s.players[t.owner].secrets.find((x) => this.secretEvent(x.cardId) === 'heroFatal');
        if (sec) {
          this.revealSecret(t.owner, sec.uid);
          t.immune = true;
          return 0;
        }
      }
      // 榮譽擊殺：自己的回合造成恰好致死的傷害（護甲也算有效生命）
      if (amount === t.hp + t.armor && this.s.current === src.owner) honorableKill = true;
      const absorbed = Math.min(t.armor, amount);
      t.armor -= absorbed;
      t.hp -= amount - absorbed;
      if (amount > absorbed) this.s.players[t.owner].heroHealthChangedTurn = this.s.turn;
    } else {
      if (this.hasKw(t, 'IMMUNE')) return 0;
      if (this.hasKw(t, 'DIVINE_SHIELD')) {
        t.keywords = t.keywords.filter((k) => k !== 'DIVINE_SHIELD');
        t.tempKeywords = t.tempKeywords.filter((k) => k !== 'DIVINE_SHIELD');
        t.nextTurnKeywords = t.nextTurnKeywords.filter((k) => k !== 'DIVINE_SHIELD');
        t.auraKeywords = t.auraKeywords.filter((k) => k !== 'DIVINE_SHIELD');
        this.fx({ kind: 'shield', uid: t.uid });
        return 0;
      }
      // 滅殺 / 榮譽擊殺都只在傷害來源擁有者的回合判定
      if (this.s.current === src.owner) {
        if (amount > t.hp) overkill = true;
        if (amount === t.hp) honorableKill = true;
      }
      t.hp -= amount;
      if (src.poisonous) t.dead = true;
    }
    this.fx({ kind: 'damage', uid: t.uid, amount, from: src.uid ?? undefined, cardId: src.cardId, player: src.owner });
    if (t.owner === this.s.current) {
      const owner = this.s.players[t.owner];
      const seen = (owner.damagedFriendlyUidsThisTurn ??= []);
      if (!seen.includes(t.uid)) seen.push(t.uid);
      if (seen.length >= 4) yield* this.summonWarptooths(owner);
    }
    if (src.freeze) this.freeze(t);
    if (src.lifesteal) yield* this.heal(this.s.players[src.owner].hero.uid, amount);
    yield* this.emit({ k: 'damaged', player: t.owner, subject: t.uid, amount, isHero: isHero(t) });
    if (isHero(t)) yield* this.checkSecrets(t.owner, 'heroDamaged', { amount, it: { kind: 'char', uid: t.uid } });
    else if (t.hp > 0 && !t.dead) {
      const frenzy = t.abilities.filter((a) => a.on.k === 'frenzy');
      for (const ab of frenzy) {
        t.abilities = t.abilities.filter((x) => x !== ab);
        const ctx = this.baseCtx(t.owner);
        ctx.sourceUid = t.uid;
        ctx.sourceCardId = t.cardId;
        yield* this.runEffects(ab.effects, ctx);
      }
    }
    if (overkill) yield* this.overkill(src);
    if (honorableKill) yield* this.honorableKill(src);
    return amount;
  }

  /** 觸發滅殺：造成傷害的手下 / 武器 / 法術 */
  private *overkill(src: DmgSource): Gen {
    const p = this.s.players[src.owner];
    const ctx = this.baseCtx(src.owner);
    let abilities: Ability[] = [];
    const m = src.uid !== null ? this.minion(src.uid) : null;
    if (m) {
      if (!m.silenced) abilities = m.abilities;
      ctx.sourceUid = m.uid;
      ctx.sourceCardId = m.cardId;
    } else if (src.uid === p.hero.uid && p.weapon) {
      abilities = p.weapon.abilities;
      ctx.sourceUid = p.weapon.uid;
      ctx.sourceCardId = p.weapon.cardId;
    } else if (src.cardId && getCard(src.cardId).type === 'SPELL') {
      abilities = getCard(src.cardId).abilities ?? [];
      ctx.sourceCardId = src.cardId;
      ctx.isSpell = true;
    }
    const list = abilities.filter((a) => a.on.k === 'overkill');
    if (list.length) this.log(src.owner, `${this.name(ctx.sourceCardId)}觸發了滅殺`);
    for (const ab of list) {
      if (ab.cond && !this.evalCond(ab.cond, ctx)) continue;
      yield* this.runEffects(ab.effects, ctx);
      if (this.over) return;
    }
  }

  /** 觸發榮譽擊殺：自己的回合造成恰好致死的傷害 */
  private *honorableKill(src: DmgSource): Gen {
    const p = this.s.players[src.owner];
    const ctx = this.baseCtx(src.owner);
    let abilities: Ability[] = [];
    const m = src.uid !== null ? this.minion(src.uid) : null;
    if (m) {
      if (!m.silenced) abilities = m.abilities;
      ctx.sourceUid = m.uid;
      ctx.sourceCardId = m.cardId;
    } else if (src.uid === p.hero.uid && p.weapon) {
      abilities = p.weapon.abilities;
      ctx.sourceUid = p.weapon.uid;
      ctx.sourceCardId = p.weapon.cardId;
    } else if (src.cardId && getCard(src.cardId).type === 'SPELL') {
      abilities = getCard(src.cardId).abilities ?? [];
      ctx.sourceCardId = src.cardId;
      ctx.isSpell = true;
    }
    const list = abilities.filter((a) => a.on.k === 'honorableKill');
    if (list.length) this.log(src.owner, `${this.name(ctx.sourceCardId)}觸發了榮譽擊殺`);
    for (const ab of list) {
      if (ab.cond && !this.evalCond(ab.cond, ctx)) continue;
      yield* this.runEffects(ab.effects, ctx);
      if (this.over) return;
    }
  }

  private *heal(targetUid: number, amount: number): Gen<number> {
    const t = this.char(targetUid);
    if (!t || amount <= 0) return 0;
    // 噁心巨怪：敵方角色無法被治療
    if (this.s.players[opp(t.owner)].board.some((m) => !m.silenced && !m.dead && m.hp > 0 && getCard(m.cardId).flags?.includes('enemyNoHeal'))) return 0;
    const healed = Math.min(t.maxHp - t.hp, amount);
    if (healed <= 0) return 0;
    t.hp += healed;
    if (isHero(t)) {
      const p = this.s.players[t.owner];
      p.heroHealedTurn = this.s.turn;
      p.heroHealthChangedTurn = this.s.turn;
    }
    this.fx({ kind: 'heal', uid: t.uid, amount: healed });
    yield* this.emit({ k: 'healed', player: t.owner, subject: t.uid, amount: healed, isHero: isHero(t) });
    return healed;
  }

  private freeze(c: Char) {
    if (!c.frozen) this.fx({ kind: 'freeze', uid: c.uid });
    c.frozen = true;
    c.frozenTurn = this.s.turn;
  }

  /**
   * 碎裂牌進入手牌：若加入後仍有空位，左半片放最左、右半片放最右。
   * 官方規則：若這張牌進手後會讓手牌滿到 10 張，則不碎裂，保留完整原卡。
   */
  private enterHandCard(p: PlayerState, card: HandCard, showBurn = true): HandCard | null {
    if (p.hand.length >= MAX_HAND) {
      if (showBurn) {
        this.log(p.id, `${p.name}的手牌已滿，${this.name(card.cardId)}被燒掉了`);
        this.fx({ kind: 'burn', cardId: card.cardId, player: p.id });
      }
      if (p.godfreyOverdraw) {
        card.costMod -= 1;
        (p.overdrawReturn ??= []).push(card);
      }
      return null;
    }
    card.enteredTurn = this.s.turn;
    const def = this.handDef(card);
    if (def.shatter && !card.shatterCombined && p.hand.length <= MAX_HAND - 2) {
      const left: HandCard = { ...structuredClone(card), cardId: def.shatter.left, shatterCombined: undefined };
      const right: HandCard = { ...structuredClone(card), uid: this.uid(), cardId: def.shatter.right, shatterCombined: undefined };
      p.hand.unshift(left);
      p.hand.push(right);
      this.log(p.id, `${this.name(def.id)}碎裂成左右兩半`);
      this.recombineShatter(p);
      return p.hand.find((h) => h.uid === card.uid) ?? null;
    }
    p.hand.push(card);
    this.recombineShatter(p);
    return card;
  }

  /** Godfrey：在其他等待進手牌的效果處理完後，把爆掉的牌隨機返還。 */
  private returnGodfreyOverdraw(p: PlayerState) {
    while (p.hand.length < MAX_HAND && p.overdrawReturn?.length) {
      const card = pick(this.s, p.overdrawReturn);
      if (!card) break;
      p.overdrawReturn.splice(p.overdrawReturn.indexOf(card), 1);
      this.enterHandCard(p, card, false);
      this.log(p.id, `${this.name(card.cardId)}從爆牌區返回手牌（-1 費）`);
    }
  }

  /** 從伊莉妲的虛無區隨機取回卡牌；這是「取得」而非抽牌。 */
  private getFromVoid(p: PlayerState, count: number) {
    if (!p.voidDeck?.length) return;
    for (let i = 0; i < count && p.voidDeck.length; i++) {
      const card = pick(this.s, p.voidDeck);
      if (!card) break;
      p.voidDeck.splice(p.voidDeck.indexOf(card), 1);
      this.enterHandCard(p, card);
      this.log(p.id, `${p.name}從虛無取得了${this.name(card.cardId)}`);
    }
  }

  /** 左、右碎裂半片相鄰時，立即重組成原卡；重組後不會再次碎裂。 */
  private recombineShatter(p: PlayerState) {
    let changed = true;
    while (changed) {
      changed = false;
      for (let i = 0; i + 1 < p.hand.length; i++) {
        const a = p.hand[i];
        const b = p.hand[i + 1];
        const ad = this.handDef(a).shatteredFrom;
        const bd = this.handDef(b).shatteredFrom;
        if (!ad || !bd || ad.root !== bd.root || ad.side !== 'left' || bd.side !== 'right') continue;
        const merged: HandCard = {
          ...structuredClone(a),
          cardId: ad.root,
          shatterCombined: true,
          // 兩個半片在手牌期間各自獲得的附魔於重組時合併。
          costMod: a.costMod + b.costMod,
          atkBuff: a.atkBuff + b.atkBuff,
          hpBuff: a.hpBuff + b.hpBuff,
          prepareDiscount: (a.prepareDiscount ?? 0) + (b.prepareDiscount ?? 0),
          prepared: !!a.prepared || !!b.prepared,
          preparedTurn: Math.max(a.preparedTurn ?? 0, b.preparedTurn ?? 0) || undefined,
        };
        p.hand.splice(i, 2, merged);
        this.log(p.id, `${this.name(ad.root)}的兩個碎裂半片重新組合`);
        changed = true;
        break;
      }
    }
  }

  /** 開局發牌（不觸發事件） */
  drawRaw(p: PlayerState): HandCard | null {
    const card = p.deck.pop();
    if (!card) return null;
    return this.enterHandCard(p, card, false);
  }

  private *draw(p: PlayerState, count: number, pool?: Pool): Gen<HandCard[]> {
    const drawn: HandCard[] = [];
    for (let i = 0; i < count; i++) {
      if (this.over) break;
      let card: HandCard | undefined;
      if (pool) {
        const matches = p.deck.filter((h) => this.cardMatches(getCard(h.cardId), pool, p.id));
        const chosen = pick(this.s, matches);
        if (!chosen) break;
        p.deck.splice(p.deck.indexOf(chosen), 1);
        card = chosen;
      } else {
        card = p.deck.pop();
        if (!card) {
          p.fatigue++;
          this.log(p.id, `${p.name}的牌庫已空，受到 ${p.fatigue} 點疲勞傷害`);
          this.fx({ kind: 'fatigue', player: p.id, amount: p.fatigue });
          yield* this.damage({ owner: p.id, uid: null }, p.hero.uid, p.fatigue);
          continue;
        }
      }
      const drawnDef = getCard(card.cardId);
      if (drawnDef.summonedWhenDrawnForOpponent) {
        yield* this.summon(opp(p.id), card.cardId, undefined, card);
        if (!pool) i--;
        continue;
      }
      // 抽到時施放：施放後再抽一張
      if (drawnDef.castsWhenDrawn) {
        yield* this.castOnDraw(p, card);
        if (!pool) i--;
        continue;
      }
      const entered = this.enterHandCard(p, card);
      if (!entered) {
        if (card.cardId === 'JAIL_398') yield* this.impfernalOffboard(p.id);
        continue;
      }
      drawn.push(entered);
      p.drawnThisTurn++;
      this.fx({ kind: 'draw', uid: entered.uid, player: p.id });
      yield* this.emit({ k: 'draw', player: p.id, subject: entered.uid, subjectKind: 'hand' });
    }
    return drawn;
  }

  /** 觸發手下的亡語（或指定的亡語能力） */
  private *runDeathrattles(m: Minion, list?: Ability[]): Gen {
    this.log(m.owner, `觸發了${this.name(m.cardId)}的亡語`);
    const dctx: Ctx = { ...this.baseCtx(m.owner), sourceUid: m.uid, sourceCardId: m.cardId, sourceSnapshot: m };
    for (const ab of list ?? m.abilities) {
      if (ab.on.k !== 'deathrattle' || (ab.cond && !this.evalCond(ab.cond, dctx))) continue;
      yield* this.runEffects(ab.effects, dctx);
      if (this.over) return;
    }
  }

  /** 讓玩家從幾張卡中選一張（電腦 / 模擬時自動選） */
  private *choose(ctx: Ctx, options: string[], title: string): Gen<string> {
    const idx = yield { player: ctx.controller, kind: 'discover', options, title };
    return options[Math.max(0, Math.min(options.length - 1, idx ?? 0))];
  }

  /** 發現的三個選項（名稱不重複） */
  private discoverOptions(pool: Pool | undefined, pid: PlayerId, cards?: CardDef[]): string[] {
    const list = shuffle(this.s, [...(cards ?? this.randomPool(pool ?? {}, pid, true))]);
    const opts: string[] = [];
    for (const c of list) {
      if (opts.length >= 3) break;
      if (!opts.some((o) => getCard(o).name === c.name)) opts.push(c.id);
    }
    return opts;
  }

  private isRace(cardId: string, race: Race): boolean {
    const races = getCard(cardId).races ?? [];
    return races.includes(race) || races.includes('ALL');
  }

  /** 抽到時施放的卡：由抽到的玩家施放 */
  private *castOnDraw(p: PlayerState, card: HandCard): Gen {
    const def = getCard(card.cardId);
    this.log(p.id, `${p.name}抽到了${this.name(def.id)}，立即施放`);
    this.fx({ kind: 'play', cardId: def.id, player: p.id });
    const ctx = this.baseCtx(p.id);
    ctx.sourceCardId = def.id;
    for (const ab of def.abilities ?? []) {
      if (ab.on.k !== 'play') continue;
      if (ab.cond && !this.evalCond(ab.cond, ctx)) continue;
      yield* this.runEffects(ab.effects, ctx);
      if (this.over) return;
    }
    yield* this.processDeaths();
  }

  private cardMatches(c: CardDef, pool: Pool, pid: PlayerId): boolean {
    const own = this.s.players[pid].heroClass;
    return poolCards(pool, own, this.s.players[opp(pid)].heroClass).some((x) => x.id === c.id);
  }

  private isCoin(cardId: string): boolean {
    // 官方有多種不同 ID 的幸運幣造型；不能只識別 GAME_005。
    return getCard(cardId).nameEn === 'The Coin';
  }

  private addToHand(p: PlayerState, cardId: string): HandCard | null {
    const actual = this.isCoin(cardId) && p.coinReplacement ? p.coinReplacement : cardId;
    return this.enterHandCard(p, this.newHandCard(actual));
  }

  makeMinion(owner: PlayerId, cardId: string, hand?: HandCard): Minion {
    const parts = hand?.parts && cardId === ZOMBEAST_ID ? hand.parts : undefined;
    const ship = hand?.starship;
    const def = ship ? starshipDef(cardId, ship) : parts ? zombeastDef(parts) : getCard(cardId);
    const mirrored = def.manaMirrorInHand ? (hand?.lockedManaValue ?? 1) : undefined;
    const baseHp = mirrored ?? def.health ?? 1;
    const keywords = [...(def.keywords ?? [])];
    // 克蘇恩上場時帶著累積的加成
    const bonus = isCthun(cardId) ? this.s.players[owner].cthun : undefined;
    if (bonus?.taunt && !keywords.includes('TAUNT')) keywords.push('TAUNT');
    const hpBuff = (hand?.hpBuff ?? 0) + (bonus?.hp ?? 0);
    return {
      uid: this.uid(),
      cardId,
      owner,
      baseAtk: mirrored ?? def.attack ?? 0,
      baseHp,
      atkBuff: (hand?.atkBuff ?? 0) + (bonus?.atk ?? 0),
      tempAtk: 0,
      auraAtk: 0,
      auraHp: 0,
      maxHp: baseHp + hpBuff,
      hp: baseHp + hpBuff,
      keywords,
      tempKeywords: [],
      nextTurnKeywords: [],
      auraKeywords: [],
      abilities: [...(def.abilities ?? [])],
      auras: def.auras ?? [],
      spellDamage: def.spellDamage ?? 0,
      enrageAtk: def.enrage?.atk ?? 0,
      silenced: false,
      frozen: false,
      frozenTurn: 0,
      sleeping: true,
      summonedTurn: this.s.turn,
      attacks: 0,
      playOrder: ++this.s.playCounter,
      dead: false,
      parts,
      starship: ship,
    };
  }

  /** 召喚手下（非從手牌打出） */
  private *summon(owner: PlayerId, cardId: string, position?: number, sourceCard?: HandCard): Gen<Minion | null> {
    const p = this.s.players[owner];
    if (this.boardSpaceUsed(p.id) >= MAX_BOARD) return null;
    const m = this.makeMinion(owner, cardId, sourceCard);
    const pos = position === undefined ? p.board.length : Math.max(0, Math.min(position, p.board.length));
    p.board.splice(pos, 0, m);
    this.recalcAuras();
    this.countSummon(p, cardId);
    this.assemble(p, m);
    this.fx({ kind: 'summon', uid: m.uid, cardId, player: owner });
    yield* this.emit({ k: 'summon', player: owner, subject: m.uid, races: getCard(cardId).races, cardId });
    return m;
  }

  // ==========================================================================
  // 星艦
  // ==========================================================================

  // ==========================================================================
  // 死亡騎士的屍體
  // ==========================================================================

  gainCorpses(p: PlayerState, n: number) {
    if (n <= 0) return;
    // 法勒瑞克：獲得的屍體加倍
    if (p.board.some((m) => !m.silenced && !m.dead && getCard(m.cardId).flags?.includes('doubleCorpses'))) n *= 2;
    p.corpses = (p.corpses ?? 0) + n;
  }

  /** 用生命值支付消耗（不是傷害，護甲不會吸收） */
  private payHealth(p: PlayerState, n: number) {
    if (n <= 0) return;
    p.hero.hp -= n;
    p.heroHealthChangedTurn = this.s.turn;
    this.fx({ kind: 'damage', uid: p.hero.uid, amount: n, player: p.id });
    this.log(p.id, `${p.name}支付了 ${n} 點生命值`);
  }

  /** 屍體足夠就花費並回傳 true */
  spendCorpses(p: PlayerState, n: number): boolean {
    if ((p.corpses ?? 0) < n) return false;
    p.corpses = (p.corpses ?? 0) - n;
    p.corpsesSpent = (p.corpsesSpent ?? 0) + n;
    this.log(p.id, `花費了 ${n} 具屍體`);
    return true;
  }

  /** 星艦組件上場時組裝進星艦（記錄當下的攻擊力與生命值） */
  private assemble(p: PlayerState, m: Minion) {
    if (!getCard(m.cardId).starshipPiece) return;
    (p.starship ??= []).push({ id: m.cardId, atk: m.baseAtk + m.atkBuff, hp: m.maxHp - m.auraHp });
    this.log(p.id, `${this.name(m.cardId)}組裝進了星艦（${p.starship.length} 個組件）`);
  }

  launchCost(p: PlayerState): number {
    return Math.max(0, LAUNCH_COST - (p.launchDiscount ?? 0));
  }

  /** 目前玩家正在建造的星艦的定義（沒有則為 null） */
  starshipPreview(pid: PlayerId): CardDef | null {
    const p = this.s.players[pid];
    return p.starship?.length ? starshipDef(starshipIdFor(p.heroClass), p.starship) : null;
  }

  canLaunch(): { ok: boolean; reason?: string } {
    const p = this.me;
    if (!p.starship?.length) return { ok: false, reason: '還沒有組裝星艦組件' };
    if (this.boardSpaceUsed(p.id) >= MAX_BOARD) return { ok: false, reason: '場上已滿' };
    if (p.mana < this.launchCost(p)) return { ok: false, reason: '法力不足' };
    return { ok: true };
  }

  private *doLaunch(): Gen {
    yield* this.launch(this.s.current, false);
  }

  /** 再施放一次法術（目標隨機；例如星光反應爐） */
  private *castRandomly(pid: PlayerId, cardId: string): Gen {
    const def = getCard(cardId);
    if (def.type !== 'SPELL') return;
    const p = this.s.players[pid];
    if (def.secret) {
      if (p.secrets.length < MAX_SECRETS && !p.secrets.some((x) => x.cardId === cardId)) p.secrets.push({ uid: this.uid(), cardId });
      return;
    }
    let abilities = def.abilities ?? [];
    let req = def.target;
    if (def.chooseOne?.length) {
      const opt = pick(this.s, def.chooseOne)!;
      abilities = opt.abilities;
      req = opt.target;
    }
    let chosen: number | null = null;
    if (req) {
      const valid = this.validTargets(req, pid, true);
      if (valid.length) chosen = pick(this.s, valid)!;
      else if (!req.optional) return;
    }
    this.log(pid, `再次施放了${this.name(cardId)}`);
    const ctx: Ctx = { ...this.baseCtx(pid), sourceCardId: cardId, isSpell: true, chosen };
    for (const ab of abilities) {
      if (ab.on.k !== 'play' || (ab.cond && !this.evalCond(ab.cond, ctx))) continue;
      yield* this.runEffects(ab.effects, ctx);
      if (this.over) return;
    }
  }

  /** 發射星艦：以手下的形式登場，觸發所有組件的發射效果 */
  private *launch(pid: PlayerId, free: boolean): Gen<Minion | null> {
    const p = this.s.players[pid];
    const pieces = p.starship;
    if (!pieces?.length || this.boardSpaceUsed(p.id) >= MAX_BOARD) return null;
    if (!free) {
      p.mana -= this.launchCost(p);
      p.launchDiscount = 0;
    }
    p.starship = undefined;
    (p.launched ??= []).push(pieces);
    const m = yield* this.summonStarship(pid, pieces, true);
    // 發射過星艦後，手牌與牌堆中的卡會變形（例如雷神號）
    for (const hc of [...p.hand, ...p.deck]) {
      const into = getCard(hc.cardId).launchTransform;
      if (into) hc.cardId = into;
    }
    return m;
  }

  /** 讓星艦登場（launched = 觸發組件的發射效果） */
  private *summonStarship(pid: PlayerId, pieces: StarshipPiece[], launched: boolean): Gen<Minion | null> {
    const p = this.s.players[pid];
    if (this.boardSpaceUsed(p.id) >= MAX_BOARD) return null;
    const shipId = starshipIdFor(p.heroClass);
    const m = this.makeMinion(pid, shipId, { uid: 0, cardId: shipId, costMod: 0, atkBuff: 0, hpBuff: 0, starship: pieces });
    p.board.push(m);
    this.recalcAuras();
    this.countSummon(p, shipId);
    this.log(pid, `${p.name}${launched ? '發射' : '召喚'}了星艦${this.name(shipId)}（${this.atkOf(m)}/${m.hp}）`);
    this.fx({ kind: 'play', cardId: shipId, player: pid });
    if (launched) {
      const ctx: Ctx = { ...this.baseCtx(pid), sourceUid: m.uid, sourceCardId: shipId };
      for (const piece of pieces) {
        for (const ab of getCard(piece.id).abilities ?? []) {
          if (ab.on.k !== 'launch' || (ab.cond && !this.evalCond(ab.cond, ctx))) continue;
          yield* this.runEffects(ab.effects, ctx);
          if (this.over) return m;
        }
      }
    }
    yield* this.emit({ k: 'summon', player: pid, subject: m.uid, races: getCard(shipId).races });
    return m;
  }

  private countSummon(p: PlayerState, cardId: string) {
    for (const r of getCard(cardId).races ?? []) p.summonedRaces[r] = (p.summonedRaces[r] ?? 0) + 1;
  }

  private *equip(owner: PlayerId, cardId: string): Gen {
    const p = this.s.players[owner];
    const old = p.weapon;
    const def = getCard(cardId);
    p.weapon = {
      uid: this.uid(),
      cardId,
      owner,
      atk: def.attack ?? 0,
      durability: def.health ?? 1,
      abilities: [...(def.abilities ?? [])],
      keywords: [...(def.keywords ?? [])],
    };
    if (old) yield* this.weaponDestroyed(old);
  }

  private *weaponDestroyed(w: Weapon): Gen {
    this.log(w.owner, `${this.name(w.cardId)}被摧毀了`);
    const ctx = this.baseCtx(w.owner);
    ctx.sourceUid = w.uid;
    ctx.sourceCardId = w.cardId;
    ctx.weapon = w;
    for (const ab of w.abilities) {
      if (ab.on.k === 'deathrattle') yield* this.runEffects(ab.effects, ctx);
    }
  }

  private adjacent(m: Minion): Minion[] {
    const board = this.s.players[m.owner].board;
    const i = board.indexOf(m);
    if (i < 0) return [];
    return [board[i - 1], board[i + 1]].filter((x): x is Minion => !!x);
  }

  // ==========================================================================
  // 光環
  // ==========================================================================

  recalcAuras() {
    const all = [...this.s.players[0].board, ...this.s.players[1].board];
    for (const m of all) {
      let atk = 0;
      let hp = 0;
      const kws: Keyword[] = [];
      for (const src of all) {
        if (src.silenced || (src.dormantTurns ?? 0) > 0 || !src.auras.length) continue;
        for (const aura of src.auras) {
          let applies = false;
          const races = getCard(m.cardId).races ?? [];
          const raceOk = !aura.race || races.includes(aura.race) || races.includes('ALL');
          switch (aura.scope) {
            case 'otherFriendly':
              applies = src !== m && src.owner === m.owner && raceOk;
              break;
            case 'friendlyMinions':
              applies = src.owner === m.owner && raceOk;
              break;
            case 'adjacent': {
              if (src.owner !== m.owner) break;
              const board = this.s.players[m.owner].board;
              applies = Math.abs(board.indexOf(src) - board.indexOf(m)) === 1;
              break;
            }
            case 'otherAll':
              applies = src !== m && raceOk;
              break;
            case 'enemyMinions':
              applies = src.owner !== m.owner;
              break;
          }
          if (!applies) continue;
          atk += aura.atk ?? 0;
          hp += aura.hp ?? 0;
          if (aura.keywords) kws.push(...aura.keywords);
        }
      }
      if ((m.dormantTurns ?? 0) > 0) {
        atk = 0;
        hp = 0;
        kws.length = 0;
      }
      m.auraAtk = atk;
      if (hp !== m.auraHp) {
        const diff = hp - m.auraHp;
        m.maxHp += diff;
        if (diff > 0) m.hp += diff;
        else m.hp = Math.min(m.hp, m.maxHp);
        m.auraHp = hp;
      }
      m.auraKeywords = kws;
    }
  }

  // ==========================================================================
  // 死亡處理
  // ==========================================================================

  private *processDeaths(): Gen {
    for (let loop = 0; loop < 60 && !this.over; loop++) {
      this.recalcAuras();
      const dead: { m: Minion; left: Set<number> }[] = [];
      for (const p of this.s.players) {
        p.board.forEach((m, i) => {
          if (m.hp <= 0 || m.dead) dead.push({ m, left: new Set(p.board.slice(0, i).map((x) => x.uid)) });
        });
      }
      const deadWeapons = this.s.players.filter((p) => p.weapon && p.weapon.durability <= 0).map((p) => p.weapon!);
      if (!dead.length && !deadWeapons.length) break;
      dead.sort((a, b) => a.m.playOrder - b.m.playOrder);
      for (const { m } of dead) {
        const p = this.s.players[m.owner];
        p.board = p.board.filter((x) => x !== m);
        p.graveyard.push(m.cardId);
        this.s.deathsThisTurn++;
        p.friendlyDiedTurn = this.s.turn;
        const races = getCard(m.cardId).races;
        if (races?.includes('UNDEAD') || races?.includes('ALL')) p.undeadDiedTurn = this.s.turn;
        // 死亡騎士：友方手下死亡時獲得 1 具屍體（屍體喚起的手下不會留下屍體）
        if (p.heroClass === 'DEATHKNIGHT' && !getCard(m.cardId).noCorpse) this.gainCorpses(p, 1);
        this.fx({ kind: 'death', uid: m.uid, cardId: m.cardId, player: m.owner });
      }
      for (const w of deadWeapons) this.s.players[w.owner].weapon = null;
      this.recalcAuras();
      for (const w of deadWeapons) yield* this.weaponDestroyed(w);
      for (const { m, left } of dead) {
        const p = this.s.players[m.owner];
        const pos = p.board.filter((x) => left.has(x.uid)).length;
        const ctx = this.baseCtx(m.owner);
        ctx.sourceUid = m.uid;
        ctx.sourceCardId = m.cardId;
        ctx.sourceSnapshot = m;
        ctx.position = pos;
        if (!m.silenced) {
          for (const ab of m.abilities) {
            if (ab.on.k !== 'deathrattle') continue;
            if (ab.cond && !this.evalCond(ab.cond, ctx)) continue;
            yield* this.runEffects(ab.effects, ctx);
          }
          if (m.keywords.includes('REBORN')) {
            const r = yield* this.summon(m.owner, m.cardId, ctx.position);
            if (r) {
              (p.rebornThisGame ??= []).push(m.cardId);
              if (getCard(m.cardId).fullRebornEnchantments) {
                this.copyStats(m, r);
                r.keywords = r.keywords.filter((k) => k !== 'REBORN');
                r.tempKeywords = r.tempKeywords.filter((k) => k !== 'REBORN');
                r.nextTurnKeywords = r.nextTurnKeywords.filter((k) => k !== 'REBORN');
                r.hp = r.maxHp;
              } else {
                r.keywords = r.keywords.filter((k) => k !== 'REBORN');
                r.baseHp = 1;
                r.maxHp = 1 + r.auraHp;
                r.hp = r.maxHp;
              }
            }
          }
        }
        yield* this.emit({ k: 'minionDied', player: m.owner, subject: m.uid, races: getCard(m.cardId).races, cardId: m.cardId });
        yield* this.checkSecrets(m.owner, 'friendlyMinionDies', { it: { kind: 'char', uid: m.uid }, itCardId: m.cardId });
      }
    }
    const [h0, h1] = [this.s.players[0].hero.hp <= 0, this.s.players[1].hero.hp <= 0];
    if (h0 && h1) this.endGame('draw');
    else if (h0) this.endGame(1);
    else if (h1) this.endGame(0);
  }

  // ==========================================================================
  // 觸發
  // ==========================================================================

  private *emit(ev: Ev): Gen {
    if (this.over || this.emitDepth > 40 || ++this.steps > 4000) return;
    this.emitDepth++;
    try {
      const order: PlayerId[] = [this.s.current, opp(this.s.current)];
      const holders: { kind: 'minion' | 'weapon'; uid: number; owner: PlayerId }[] = [];
      for (const pid of order) {
        for (const m of this.s.players[pid].board) holders.push({ kind: 'minion', uid: m.uid, owner: pid });
      }
      for (const pid of order) {
        const w = this.s.players[pid].weapon;
        if (w) holders.push({ kind: 'weapon', uid: w.uid, owner: pid });
      }
      for (const h of holders) {
        if (this.over) return;
        let abilities: Ability[];
        let ent: Minion | Weapon | null;
        if (h.kind === 'minion') {
          const m = this.minion(h.uid);
          if (!m || m.hp <= 0 || m.dead || (m.dormantTurns ?? 0) > 0) continue;
          ent = m;
          abilities = m.abilities;
        } else {
          const w = this.s.players[h.owner].weapon;
          if (!w || w.uid !== h.uid) continue;
          ent = w;
          abilities = w.abilities;
        }
        for (const ab of [...abilities]) {
          if (!this.matches(ab.on, ev, h.uid, h.owner)) continue;
          const ctx = this.baseCtx(h.owner);
          ctx.sourceUid = h.uid;
          ctx.sourceCardId = ent.cardId;
          if (ev.subject !== undefined) ctx.it = { kind: ev.subjectKind ?? 'char', uid: ev.subject };
          ctx.itCardId = ev.cardId;
          ctx.eventAmount = ev.amount ?? 0;
          if (ab.cond && !this.evalCond(ab.cond, ctx)) continue;
          if (ab.once) ent.abilities = ent.abilities.filter((x) => x !== ab);
          yield* this.runEffects(ab.effects, ctx);
        }
      }
      // 掛在玩家身上、本場對戰都有效的能力
      for (const pid of order) {
        for (const e of [...(this.s.players[pid].eternal ?? [])]) {
          if (this.over) return;
          if (!this.matches(e.ability.on, ev, -1, pid)) continue;
          const ctx = this.baseCtx(pid);
          ctx.sourceCardId = e.sourceCardId;
          if (ev.subject !== undefined) ctx.it = { kind: ev.subjectKind ?? 'char', uid: ev.subject };
          ctx.itCardId = ev.cardId;
          ctx.eventAmount = ev.amount ?? 0;
          if (e.ability.cond && !this.evalCond(e.ability.cond, ctx)) continue;
          yield* this.runEffects(e.ability.effects, ctx);
        }
      }
    } finally {
      this.emitDepth--;
    }
  }

  private matches(trig: Trig, ev: Ev, holderUid: number, owner: PlayerId): boolean {
    if (trig.k !== ev.k) return false;
    const rel = (side: Side) => side === 'any' || (side === 'friendly') === (ev.player === owner);
    const raceOk = (r?: Race) => !r || !!ev.races?.includes(r) || !!ev.races?.includes('ALL');
    switch (trig.k) {
      case 'turnEnd':
      case 'turnStart':
        return trig.whose === 'each' || (trig.whose === 'mine') === (ev.player === owner);
      case 'spellCast':
        return rel(trig.side) && (!trig.school || (!!ev.cardId && getCard(ev.cardId).spellSchool === trig.school));
      case 'heroPower':
      case 'draw':
        return rel(trig.side);
      case 'cardPlayed':
        return (
          rel(trig.side) &&
          (!trig.cardType || trig.cardType === ev.cardType) &&
          raceOk(trig.race) &&
          (trig.keyword !== 'ECHO' || !!ev.echo) &&
          (!trig.hasBattlecry || (!!ev.cardId && !!getCard(ev.cardId).abilities?.some((a) => a.on.k === 'play'))) &&
          (!trig.hasDeathrattle || (!!ev.cardId && !!getCard(ev.cardId).abilities?.some((a) => a.on.k === 'deathrattle'))) &&
          ev.subject !== holderUid
        );
      case 'summon':
        return rel(trig.side) && raceOk(trig.race) && (!trig.cardId || trig.cardId === ev.cardId) && ev.subject !== holderUid;
      case 'minionDied':
        return rel(trig.side) && raceOk(trig.race) && ev.subject !== holderUid;
      case 'damaged':
        switch (trig.subject) {
          case 'self':
            return ev.subject === holderUid;
          case 'friendlyHero':
            return !!ev.isHero && ev.player === owner;
          case 'friendlyMinion':
            return !ev.isHero && ev.player === owner;
          case 'anyMinion':
            return !ev.isHero;
        }
        return false;
      case 'healed':
        if (trig.subject === 'friendly') return ev.player === owner;
        if (trig.subject === 'minion') return !ev.isHero;
        return true;
      case 'attack': {
        if (!!trig.after !== !!ev.after) return false;
        if (trig.keyword) {
          const ch = ev.subject !== undefined ? this.char(ev.subject) : null;
          if (!ch || isHero(ch) || !this.hasKw(ch, trig.keyword)) return false;
        }
        if (trig.subject === 'self') return ev.subject === holderUid;
        if (trig.subject === 'friendlyHero') return !!ev.isHero && ev.player === owner;
        return !ev.isHero && ev.player === owner;
      }
    }
    return false;
  }

  // ==========================================================================
  // 奧秘
  // ==========================================================================

  private secretEvent(cardId: string): SecretEvent | null {
    const ab = getCard(cardId).abilities?.find((a) => a.on.k === 'secret');
    return ab && ab.on.k === 'secret' ? ab.on.ev : null;
  }

  private revealSecret(owner: PlayerId, uid: number) {
    const p = this.s.players[owner];
    const sec = p.secrets.find((x) => x.uid === uid);
    if (!sec) return;
    p.secrets = p.secrets.filter((x) => x.uid !== uid);
    this.log(owner, `奧秘揭露：${this.name(sec.cardId)}`);
    this.fx({ kind: 'secret', cardId: sec.cardId, player: owner });
  }

  private *checkSecrets(owner: PlayerId, ev: SecretEvent, info: { it?: ItRef; itCardId?: string; amount?: number }): Gen {
    if (this.s.current === owner || this.over) return;
    const p = this.s.players[owner];
    for (const sec of [...p.secrets]) {
      if (this.secretEvent(sec.cardId) !== ev) continue;
      if (!p.secrets.includes(sec)) continue;
      // 目標已不存在時不觸發
      if (info.it?.kind === 'char' && ev !== 'friendlyMinionDies' && !this.char(info.it.uid)) continue;
      if (ev === 'friendlyMinionDies' && this.boardSpaceUsed(p.id) >= MAX_BOARD) continue;
      this.revealSecret(owner, sec.uid);
      const ab = getCard(sec.cardId).abilities!.find((a) => a.on.k === 'secret')!;
      const ctx = this.baseCtx(owner);
      ctx.sourceCardId = sec.cardId;
      ctx.isSpell = true;
      ctx.it = info.it ?? null;
      ctx.itCardId = info.itCardId;
      ctx.eventAmount = info.amount ?? 0;
      yield* this.runEffects(ab.effects, ctx);
    }
  }

  // ==========================================================================
  // 效果執行
  // ==========================================================================

  private baseCtx(controller: PlayerId): Ctx {
    return {
      controller,
      sourceUid: null,
      sourceCardId: '',
      isSpell: false,
      chosen: null,
      it: null,
      eventAmount: 0,
      combo: false,
      outcast: false,
      lifesteal: false,
    };
  }

  private *runEffects(effects: Effect[], ctx: Ctx): Gen {
    for (const e of effects) {
      if (this.over || ++this.steps > 4000) return;
      yield* this.runEffect(e, ctx);
    }
  }

  private dmgSource(ctx: Ctx): DmgSource {
    const m = ctx.sourceUid !== null ? this.minion(ctx.sourceUid) : null;
    if (m && !ctx.isSpell) return { ...this.charSource(m), freeze: false };
    return { owner: ctx.controller, uid: ctx.sourceUid, lifesteal: ctx.lifesteal, cardId: ctx.isSpell ? ctx.sourceCardId : undefined };
  }

  private amount(a: Amount, ctx: Ctx): number {
    if (typeof a === 'number') return a;
    return (a.base ?? 0) + this.dyn(a.dyn, ctx, a.race) * (a.mult ?? 1);
  }

  private dyn(d: DynAmount, ctx: Ctx, race?: Race): number {
    const p = this.s.players[ctx.controller];
    const e = this.s.players[opp(ctx.controller)];
    switch (d) {
      case 'handSize':
        return p.hand.length;
      case 'friendlyMinions':
        return p.board.filter((m) => this.alive(m)).length;
      case 'otherFriendlyMinions':
        return p.board.filter((m) => this.alive(m) && m.uid !== ctx.sourceUid).length;
      case 'enemyMinions':
        return e.board.filter((m) => this.alive(m)).length;
      case 'allOtherMinions':
        return [...p.board, ...e.board].filter((m) => this.alive(m) && m.uid !== ctx.sourceUid).length;
      case 'armor':
        return p.hero.armor;
      case 'damagedFriendlyChars':
        return [p.hero, ...p.board].filter((c) => c.hp < c.maxHp && this.alive(c)).length;
      case 'eventAmount':
        return ctx.eventAmount;
      case 'cardsPlayedThisTurn':
        return p.cardsPlayedThisTurn;
      case 'spellsCastThisGame':
        return p.spellsCastThisGame;
      case 'weaponAttack':
        return p.weapon?.atk ?? 0;
      case 'selfAttack': {
        const src = ctx.sourceUid !== null ? this.char(ctx.sourceUid) : null;
        if (src) return this.atkOf(src);
        return ctx.sourceSnapshot ? this.atkOf(ctx.sourceSnapshot) : 0;
      }
      case 'heroAttack':
        return this.atkOf(p.hero);
      case 'secrets':
        return p.secrets.length;
      case 'heroMissingHealth':
        return p.hero.maxHp - p.hero.hp;
      case 'oppHandSize':
        return e.hand.length;
      case 'deathsThisTurn':
        return this.s.deathsThisTurn;
      case 'friendlyDeathsThisGame':
        return p.graveyard.length;
      case 'heroPowersUsed':
        return p.heroPowersUsed;
      case 'drawnThisTurn':
        return p.drawnThisTurn;
      case 'spellsInHand':
        return p.hand.filter((h) => getCard(h.cardId).type === 'SPELL').length;
      case 'damagedMinions':
        return [...p.board, ...e.board].filter((m) => this.alive(m) && m.hp < m.maxHp).length;
      case 'friendlyRace':
        return p.board.filter((m) => this.alive(m) && m.uid !== ctx.sourceUid && (!race || (getCard(m.cardId).races ?? []).includes(race))).length;
      case 'summonedRace':
        return race ? (p.summonedRaces[race] ?? 0) : 0;
      case 'starshipsLaunched':
        return p.launched?.length ?? 0;
      case 'corpses':
        return p.corpses ?? 0;
      case 'corpsesSpent':
        return p.corpsesSpent ?? 0;
      case 'deathsThisGame':
        return this.s.players[0].graveyard.length + this.s.players[1].graveyard.length;
      case 'frozenChars':
        return this.chars().filter((ch) => ch.frozen && this.alive(ch)).length;
      case 'plaguesShuffled':
        return p.plaguesShuffled ?? 0;
    }
    return 0;
  }

  private pass(c: Char, f: Filter, ctx: Ctx): boolean {
    const hero = isHero(c);
    const type = f.type ?? 'character';
    if (type === 'minion' && hero) return false;
    if (type === 'hero' && !hero) return false;
    if (!hero && ((c as Minion).dormantTurns ?? 0) > 0) return false;
    if (f.side === 'friendly' && c.owner !== ctx.controller) return false;
    if (f.side === 'enemy' && c.owner === ctx.controller) return false;
    if (f.excludeSelf && c.uid === ctx.sourceUid) return false;
    if (f.excludeChosen && c.uid === ctx.chosen) return false;
    if (f.race) {
      if (hero) return false;
      const races = getCard(c.cardId).races ?? [];
      if (!races.includes(f.race) && !races.includes('ALL')) return false;
    }
    if (f.cardClass) {
      if (hero || !cardClasses(getCard(c.cardId)).includes(f.cardClass)) return false;
    }
    if (f.damaged && c.hp >= c.maxHp) return false;
    if (f.undamaged && c.hp < c.maxHp) return false;
    if (f.maxAttack !== undefined && this.atkOf(c) > f.maxAttack) return false;
    if (f.minAttack !== undefined && this.atkOf(c) < f.minAttack) return false;
    if (f.keyword && (hero || !this.hasKw(c, f.keyword))) return false;
    if (f.starship && (hero || !(c.starship || getCard(c.cardId).starshipPiece))) return false;
    if (f.terran && (hero || !getCard(c.cardId).terran)) return false;
    return true;
  }

  private resolve(expr: TargetExpr, ctx: Ctx): number[] {
    const p = this.s.players[ctx.controller];
    const e = this.s.players[opp(ctx.controller)];
    switch (expr.t) {
      case 'chosen':
        return ctx.chosen !== null && this.char(ctx.chosen) ? [ctx.chosen] : [];
      case 'self':
        return ctx.sourceUid !== null && this.char(ctx.sourceUid) ? [ctx.sourceUid] : [];
      case 'hero':
        if (expr.side === 'friendly') return [p.hero.uid];
        if (expr.side === 'enemy') return [e.hero.uid];
        return [p.hero.uid, e.hero.uid];
      case 'all': {
        const list = this.chars().filter((c) => this.alive(c) && this.pass(c, expr.filter, ctx));
        return list.map((c) => c.uid);
      }
      case 'random': {
        const list = shuffle(
          this.s,
          this.chars().filter((c) => this.alive(c) && this.pass(c, expr.filter, ctx)),
        );
        return list.slice(0, expr.count).map((c) => c.uid);
      }
      case 'adjacent': {
        const center = expr.of === 'self' ? ctx.sourceUid : ctx.chosen;
        const m = center !== null ? this.minion(center) : null;
        if (m) return this.adjacent(m).map((x) => x.uid);
        if (expr.of === 'self' && ctx.sourceSnapshot && ctx.position !== undefined) {
          const board = this.s.players[ctx.sourceSnapshot.owner].board;
          return [board[ctx.position - 1], board[ctx.position]].filter(Boolean).map((x) => x.uid);
        }
        return [];
      }
      case 'it':
        if (ctx.it?.kind === 'char' && this.char(ctx.it.uid)) return [ctx.it.uid];
        return [];
    }
  }

  private evalCond(c: Condition, ctx: Ctx, excludeHandUid?: number): boolean {
    const p = this.s.players[ctx.controller];
    const races = (id: string) => getCard(id).races ?? [];
    switch (c.c) {
      case 'holding':
        return p.hand.some((h) => {
          if (h.uid === excludeHandUid) return false;
          const def = getCard(h.cardId);
          if (c.type && def.type !== c.type) return false;
          if (c.race && !races(h.cardId).includes(c.race) && !races(h.cardId).includes('ALL')) return false;
          return true;
        });
      case 'control': {
        const list = p.board.filter((m) => {
          if (m.uid === ctx.sourceUid || !this.alive(m)) return false;
          if (c.race && !races(m.cardId).includes(c.race) && !races(m.cardId).includes('ALL')) return false;
          if (c.keyword && !this.hasKw(m, c.keyword)) return false;
          return true;
        });
        return list.length >= (c.min ?? 1);
      }
      case 'combo':
        return ctx.combo;
      case 'outcast':
        return ctx.outcast;
      case 'heroAttacked':
        return p.heroAttackedThisTurn;
      case 'handSize':
        return c.op === '>=' ? p.hand.length >= c.n : p.hand.length <= c.n;
      case 'deckSize':
        return c.op === '>=' ? p.deck.length >= c.n : p.deck.length <= c.n;
      case 'deckNoNeutral':
        return p.deck.every((h) => !cardClasses(getCard(h.cardId)).includes('NEUTRAL'));
      case 'noMinions':
        return this.s.players[0].board.every((m) => !this.alive(m)) && this.s.players[1].board.every((m) => !this.alive(m));
      case 'itCostMax': {
        if (ctx.it?.kind !== 'hand') return false;
        const found = this.handCard(ctx.it.uid);
        return !!found && this.costOf(found.owner, found.card) <= c.n;
      }
      case 'spellsThisTurnAtLeast':
        return (p.spellsThisTurn ?? 0) >= c.n;
      case 'maxMana':
        return p.maxMana >= c.n;
      case 'opponentTurn':
        return this.s.current !== ctx.controller;
      case 'secret':
        return p.secrets.length > 0;
      case 'weapon':
        return !!p.weapon;
      case 'damaged': {
        const src = ctx.sourceUid !== null ? this.char(ctx.sourceUid) : null;
        return !!src && src.hp < src.maxHp;
      }
      case 'heroHealth':
        return c.op === '<=' ? p.hero.hp <= c.n : p.hero.hp >= c.n;
      case 'itRace': {
        if (!ctx.it) return false;
        const id = ctx.it.kind === 'char' ? this.char(ctx.it.uid) && !isHero(this.char(ctx.it.uid)!) ? (this.char(ctx.it.uid) as Minion).cardId : null : this.handCard(ctx.it.uid)?.card.cardId;
        return !!id && (races(id).includes(c.race) || races(id).includes('ALL'));
      }
      case 'itIsMinion': {
        if (!ctx.it) return false;
        if (ctx.it.kind === 'hand') {
          const hc = this.handCard(ctx.it.uid);
          return !!hc && getCard(hc.card.cardId).type === 'MINION';
        }
        const ch = this.char(ctx.it.uid);
        return !!ch && !isHero(ch);
      }
      case 'itAlive': {
        const target = ctx.it?.kind === 'char' ? ctx.it.uid : ctx.chosen;
        const ch = target !== null && target !== undefined ? this.char(target) : null;
        return !!ch && this.alive(ch);
      }
      case 'itDied': {
        const target = ctx.it?.kind === 'char' ? ctx.it.uid : ctx.chosen;
        const ch = target !== null && target !== undefined ? this.char(target) : null;
        return !ch || !this.alive(ch);
      }
      case 'playedElementalLastTurn':
        return p.elementalLastTurn;
      case 'noDuplicates': {
        const ids = p.deck.map((h) => h.cardId);
        return new Set(ids).size === ids.length;
      }
      case 'deckEmpty':
        return p.deck.length === 0;
      case 'cthunAttack':
        return this.cthunAttack(p.id) >= c.n;
      case 'buildingStarship':
        return !!p.starship?.length;
      case 'launchedStarship':
        return !!p.launched?.length;
      case 'anyFrozen':
        return this.chars().some((ch) => ch.frozen && this.alive(ch));
      case 'friendlyDiedThisTurn':
        return p.friendlyDiedTurn === this.s.turn;
      case 'undeadDiedSinceLastTurn':
        // 你上個回合結束之後 = 對手的回合或這個回合
        return (p.undeadDiedTurn ?? -9) >= this.s.turn - (this.s.current === p.id ? 1 : 0);
      case 'heroHealthChanged':
        return p.heroHealthChangedTurn === this.s.turn;
      case 'heroHealed':
        return p.heroHealedTurn === this.s.turn;
      case 'itHasDeathrattle': {
        const m = ctx.it?.kind === 'char' ? this.minion(ctx.it.uid) : null;
        return !!m && !m.silenced && m.abilities.some((a) => a.on.k === 'deathrattle');
      }
      case 'not':
        return !this.evalCond(c.cond, ctx, excludeHandUid);
    }
    return false;
  }

  private randomPool(pool: Pool, pid: PlayerId, classRestrict: boolean): CardDef[] {
    const own = this.s.players[pid].heroClass;
    let cards = poolCards(pool, own, this.s.players[opp(pid)].heroClass);
    if (classRestrict && !pool.cls) {
      const restricted = cards.filter((c) => c.cardClass === 'NEUTRAL' || cardClasses(c).includes(own));
      if (restricted.length) cards = restricted;
    }
    return cards;
  }

  private summonPos(ctx: Ctx, who: PlayerId): number | undefined {
    if (who !== ctx.controller) return undefined;
    if (ctx.position !== undefined) return ctx.position;
    if (ctx.sourceUid !== null) {
      const board = this.s.players[who].board;
      const i = board.findIndex((m) => m.uid === ctx.sourceUid);
      if (i >= 0) return i + 1;
    }
    return undefined;
  }

  private *doSummon(ctx: Ctx, who: PlayerId, cardId: string): Gen<Minion | null> {
    const pos = this.summonPos(ctx, who);
    const m = yield* this.summon(who, cardId, pos);
    if (m) {
      if (ctx.position !== undefined && who === ctx.controller) ctx.position++;
      ctx.it = { kind: 'char', uid: m.uid };
    }
    return m;
  }

  private *runEffect(e: Effect, ctx: Ctx): Gen {
    const s = this.s;
    const me = s.players[ctx.controller];
    const foe = s.players[opp(ctx.controller)];
    const who = (w: 'self' | 'opponent') => (w === 'self' ? me : foe);
    switch (e.e) {
      case 'damage': {
        let amt = this.amount(e.amount, ctx);
        if (e.spell && ctx.isSpell) amt += this.spellDamage(ctx.controller);
        const targets = this.resolve(e.target, ctx);
        const src = this.dmgSource(ctx);
        for (const t of targets) yield* this.damage(src, t, amt);
        if (targets.length === 1 && e.target.t !== 'it') ctx.it = { kind: 'char', uid: targets[0] };
        break;
      }
      case 'splitDamage': {
        let n = this.amount(e.amount, ctx);
        if (e.spell && ctx.isSpell) n += this.spellDamage(ctx.controller);
        const src = this.dmgSource(ctx);
        for (let i = 0; i < n; i++) {
          const list = this.chars().filter((c) => this.alive(c) && this.pass(c, e.filter, ctx));
          const t = pick(s, list);
          if (!t) break;
          yield* this.damage(src, t.uid, 1);
        }
        break;
      }
      case 'heal': {
        const amt = this.amount(e.amount, ctx);
        for (const t of this.resolve(e.target, ctx)) yield* this.heal(t, amt);
        break;
      }
      case 'fullHeal':
        for (const t of this.resolve(e.target, ctx)) {
          const c = this.char(t);
          if (c) yield* this.heal(t, c.maxHp - c.hp);
        }
        break;
      case 'buff': {
        const atk = e.atk !== undefined ? this.amount(e.atk, ctx) : 0;
        const hp = e.hp !== undefined ? this.amount(e.hp, ctx) : 0;
        if (e.target.t === 'it' && ctx.it?.kind === 'hand') {
          const hc = this.handCard(ctx.it.uid);
          if (hc) {
            hc.card.atkBuff += atk;
            hc.card.hpBuff += hp;
            const extra = getCard(hc.card.cardId).extraStatsOnBuff ?? 0;
            if (extra && (atk > 0 || hp > 0)) {
              hc.card.atkBuff += extra;
              hc.card.hpBuff += extra;
            }
          }
          break;
        }
        for (const uid of this.resolve(e.target, ctx)) {
          const c = this.char(uid);
          if (!c) continue;
          if (atk > 0 || hp > 0 || e.keywords?.length) this.fx({ kind: 'buff', uid: c.uid, from: ctx.sourceUid ?? undefined, cardId: ctx.sourceCardId, player: ctx.controller });
          if (isHero(c)) {
            c.tempAtk += atk;
            continue;
          }
          if (e.temp) c.tempAtk += atk;
          else if (e.untilNextTurn && atk) (c.lingerAtk ??= []).push({ amount: atk, until: ctx.controller });
          else c.atkBuff += atk;
          c.maxHp += hp;
          c.hp += hp;
          const extra = getCard(c.cardId).extraStatsOnBuff ?? 0;
          if (extra && (atk > 0 || hp > 0)) {
            c.atkBuff += extra;
            c.maxHp += extra;
            c.hp += extra;
          }
          if (e.keywords) {
            for (const k of e.keywords) {
              if (e.temp) c.tempKeywords.push(k);
              else if (e.untilNextTurn) c.nextTurnKeywords.push(k);
              else if (!c.keywords.includes(k)) c.keywords.push(k);
            }
          }
          if (e.abilities) c.abilities.push(...e.abilities);
        }
        break;
      }
      case 'setStats':
        for (const uid of this.resolve(e.target, ctx)) {
          const m = this.minion(uid);
          if (!m) {
            const h = this.char(uid);
            if (h && isHero(h) && e.hp !== undefined) {
              h.hp = e.hp;
              h.maxHp = Math.max(h.maxHp, e.hp);
            }
            continue;
          }
          if (e.atk !== undefined) {
            m.baseAtk = e.atk;
            m.atkBuff = 0;
            m.tempAtk = 0;
          }
          if (e.hp !== undefined) {
            m.baseHp = e.hp;
            m.maxHp = e.hp + m.auraHp;
            m.hp = m.maxHp;
          }
        }
        break;
      case 'doubleStat':
        for (const uid of this.resolve(e.target, ctx)) {
          const m = this.minion(uid);
          if (!m) continue;
          if (e.stat !== 'hp') m.atkBuff += this.atkOf(m);
          if (e.stat !== 'atk') {
            const add = m.hp;
            m.maxHp += add;
            m.hp += add;
          }
        }
        break;
      case 'swapStats':
        for (const uid of this.resolve(e.target, ctx)) {
          const m = this.minion(uid);
          if (!m) continue;
          const a = this.atkOf(m);
          const h = m.hp;
          m.baseAtk = h;
          m.atkBuff = 0;
          m.tempAtk = -m.auraAtk;
          m.baseHp = a;
          m.maxHp = a;
          m.hp = a;
          m.auraHp = 0;
        }
        break;
      case 'draw': {
        const n = this.amount(e.count, ctx);
        const targets = e.who === 'both' ? [me, foe] : [who(e.who)];
        for (const p of targets) {
          const drawn = yield* this.draw(p, n, e.pool);
          if (p === me && drawn.length) ctx.it = { kind: 'hand', uid: drawn[drawn.length - 1].uid };
        }
        break;
      }
      case 'summon':
        for (let i = 0; i < e.count; i++) yield* this.doSummon(ctx, who(e.who).id, e.card);
        break;
      case 'summonRandom': {
        const cards = this.randomPool(e.pool, ctx.controller, false);
        for (let i = 0; i < e.count; i++) {
          const c = pick(s, cards);
          if (c) yield* this.doSummon(ctx, who(e.who).id, c.id);
        }
        break;
      }
      case 'summonCopy': {
        const sources: Minion[] = this.resolve(e.target, ctx)
          .map((uid) => this.minion(uid))
          .filter((m): m is Minion => !!m);
        if (!sources.length && e.target.t === 'self' && ctx.sourceSnapshot) sources.push(ctx.sourceSnapshot);
        for (const src of sources) {
          for (let i = 0; i < e.count; i++) {
            const m = yield* this.doSummon(ctx, ctx.controller, src.cardId);
            if (m) this.copyStats(src, m);
          }
        }
        break;
      }
      case 'destroy':
        for (const uid of this.resolve(e.target, ctx)) {
          const m = this.minion(uid);
          if (m) m.dead = true;
          else {
            const h = this.char(uid);
            if (h && isHero(h)) h.hp = 0;
          }
        }
        break;
      case 'silence':
        for (const uid of this.resolve(e.target, ctx)) {
          const m = this.minion(uid);
          if (m) this.silence(m);
        }
        break;
      case 'freeze':
        for (const uid of this.resolve(e.target, ctx)) {
          const c = this.char(uid);
          if (c) this.freeze(c);
        }
        break;
      case 'armor': {
        const p = e.who === 'opponent' ? foe : me;
        const amt = this.amount(e.amount, ctx);
        p.hero.armor += amt;
        this.fx({ kind: 'armor', uid: p.hero.uid, amount: amt });
        break;
      }
      case 'heroAttack':
        me.hero.tempAtk += e.amount;
        break;
      case 'equip':
        yield* this.equip(ctx.controller, e.card);
        break;
      case 'addCard':
        for (let i = 0; i < e.count; i++) {
          const hc = this.addToHand(who(e.who), e.card);
          if (hc && e.who === 'self') ctx.it = { kind: 'hand', uid: hc.uid };
        }
        break;
      case 'addRandom': {
        const cards = this.randomPool(e.pool, ctx.controller, true);
        for (let i = 0; i < e.count; i++) {
          const c = pick(s, cards);
          if (!c) break;
          const hc = this.addToHand(who(e.who), c.id);
          if (hc && e.who === 'self') ctx.it = { kind: 'hand', uid: hc.uid };
        }
        break;
      }
      case 'addCopy': {
        let cardId: string | null = null;
        const t = this.resolve(e.target, ctx)[0];
        const c = t !== undefined ? this.char(t) : null;
        if (c && !isHero(c)) cardId = c.cardId;
        else if (e.target.t === 'self') cardId = ctx.sourceCardId;
        else if (ctx.it?.kind === 'hand') cardId = this.handCard(ctx.it.uid)?.card.cardId ?? null;
        else if (ctx.itCardId) cardId = ctx.itCardId;
        if (cardId) {
          const enemySource = !!c && !isHero(c) && c.owner !== ctx.controller;
          for (let i = 0; i < e.count; i++) {
            const h = this.addToHand(me, cardId);
            if (h && enemySource) h.copiedFromOpponent = true;
          }
        }
        break;
      }
      case 'discover': {
        const cards = shuffle(s, [...this.randomPool(e.pool, ctx.controller, true)]);
        const opts: string[] = [];
        for (const c of cards) {
          if (opts.length >= 3) break;
          if (!opts.some((o) => getCard(o).name === c.name)) opts.push(c.id);
        }
        if (!opts.length) break;
        const idx = yield { player: ctx.controller, kind: 'discover', options: opts, title: '發現一張卡牌' };
        const chosen = opts[Math.max(0, Math.min(opts.length - 1, idx ?? 0))];
        const hc = this.addToHand(me, chosen);
        if (hc) ctx.it = { kind: 'hand', uid: hc.uid };
        if (e.then) yield* this.runEffects(e.then, ctx);
        break;
      }
      case 'returnToHand':
        for (const uid of this.resolve(e.target, ctx)) {
          const m = this.minion(uid);
          if (!m) continue;
          const owner = s.players[m.owner];
          owner.board = owner.board.filter((x) => x !== m);
          const hc = this.addToHand(owner, m.cardId);
          if (hc && m.parts) hc.parts = m.parts;
          if (hc && m.starship) hc.starship = m.starship;
          if (hc && e.costChange) hc.costMod += e.costChange;
          if (hc && owner.id === ctx.controller) ctx.it = { kind: 'hand', uid: hc.uid };
          this.recalcAuras();
        }
        break;
      case 'transform':
        for (const uid of this.resolve(e.target, ctx)) this.transform(uid, e.card);
        break;
      case 'transformRandom': {
        const cards = this.randomPool(e.pool, ctx.controller, false);
        for (const uid of this.resolve(e.target, ctx)) {
          const c = pick(s, cards);
          if (c) this.transform(uid, c.id);
        }
        break;
      }
      case 'steal':
        for (const uid of this.resolve(e.target, ctx)) {
          const m = this.minion(uid);
          if (!m || m.owner === ctx.controller) continue;
          const from = s.players[m.owner];
          from.board = from.board.filter((x) => x !== m);
          if (this.boardSpaceUsed(me.id) >= MAX_BOARD) {
            m.dead = true;
            from.board.push(m);
            continue;
          }
          m.owner = ctx.controller;
          m.sleeping = true;
          m.summonedTurn = s.turn;
          m.attacks = 0;
          me.board.push(m);
          this.recalcAuras();
        }
        break;
      case 'mana': {
        const p = e.who === 'opponent' ? foe : me;
        switch (e.kind) {
          case 'empty':
            p.maxMana = Math.min(MAX_MANA, p.maxMana + e.amount);
            break;
          case 'full':
            p.maxMana = Math.min(MAX_MANA, p.maxMana + e.amount);
            p.mana = Math.min(MAX_MANA, p.mana + e.amount);
            break;
          case 'temp':
            p.mana = Math.min(MAX_MANA, p.mana + e.amount);
            break;
          case 'refresh':
            p.mana = Math.min(p.maxMana, p.mana + e.amount);
            break;
          case 'destroy':
            p.maxMana = Math.max(0, p.maxMana - e.amount);
            p.mana = Math.min(p.mana, p.maxMana);
            break;
        }
        break;
      }
      case 'discard':
        for (let i = 0; i < e.count && me.hand.length; i++) {
          const idx = randomInt(s, me.hand.length);
          const [c] = me.hand.splice(idx, 1);
          this.recombineShatter(me);
          this.log(me.id, `${me.name}棄掉了${this.name(c.cardId)}`);
          if (c.cardId === 'JAIL_398') yield* this.impfernalOffboard(me.id);
        }
        this.returnGodfreyOverdraw(me);
        break;
      case 'destroyWeapon': {
        const p = who(e.who);
        const w = p.weapon;
        if (w) {
          p.weapon = null;
          yield* this.weaponDestroyed(w);
        }
        break;
      }
      case 'weaponBuff':
        if (me.weapon) {
          me.weapon.atk += e.atk ?? 0;
          me.weapon.durability += e.dur ?? 0;
        }
        break;
      case 'cthunBuff':
        this.cthunBuff(ctx.controller, e.atk, e.hp, !!e.taunt);
        break;
      case 'joust': {
        // 比武：雙方各揭露牌堆中一張隨機手下，你的消耗較高就贏
        const mine = pick(s, me.deck.filter((h) => getCard(h.cardId).type === 'MINION'));
        const theirs = pick(s, foe.deck.filter((h) => getCard(h.cardId).type === 'MINION'));
        const won = !!mine && (!theirs || getCard(mine.cardId).cost > getCard(theirs.cardId).cost);
        const desc = (h: HandCard | undefined) => (h ? `${this.name(h.cardId)}（${getCard(h.cardId).cost} 費）` : '（沒有手下）');
        this.log(me.id, `比武：${desc(mine)} 對上 ${desc(theirs)}，${won ? '獲勝！' : '落敗'}`);
        ctx.revealed = mine?.uid;
        if (won) yield* this.runEffects(e.then, ctx);
        else if (e.else) yield* this.runEffects(e.else, ctx);
        break;
      }
      case 'summonJade': {
        // 翠玉魔像：第 n 個是 n/n（最多 30/30）
        me.jade = (me.jade ?? 0) + 1;
        const n = Math.min(30, me.jade);
        const m = yield* this.doSummon(ctx, ctx.controller, JADE_GOLEM);
        if (m) {
          m.baseAtk = n;
          m.baseHp = n;
          m.maxHp = n + m.auraHp;
          m.hp = m.maxHp;
        }
        break;
      }
      case 'recruit':
        for (let i = 0; i < e.count; i++) {
          if (this.boardSpaceUsed(me.id) >= MAX_BOARD) break;
          const list = me.deck.filter((h) => {
            const d = getCard(h.cardId);
            if (d.type !== 'MINION') return false;
            if (e.race && !(d.races?.includes(e.race) || d.races?.includes('ALL'))) return false;
            if (e.cost !== undefined && d.cost !== e.cost) return false;
            if (e.maxCost !== undefined && d.cost > e.maxCost) return false;
            return true;
          });
          const hc = pick(s, list);
          if (!hc) break;
          me.deck.splice(me.deck.indexOf(hc), 1);
          this.log(me.id, `號召了${this.name(hc.cardId)}`);
          const recruited = yield* this.doSummon(ctx, ctx.controller, hc.cardId);
          if (recruited && e.keywords?.length) for (const k of e.keywords) if (!recruited.keywords.includes(k)) recruited.keywords.push(k);
        }
        break;
      case 'spendCorpses':
        if (this.spendCorpses(me, e.amount)) yield* this.runEffects(e.then, ctx);
        else if (e.else) yield* this.runEffects(e.else, ctx);
        break;
      case 'gainCorpses':
        this.gainCorpses(me, e.amount);
        break;
      case 'spendCorpsesUpTo': {
        const n = Math.min(e.max, me.corpses ?? 0);
        if (n > 0) this.spendCorpses(me, n);
        if (e.each) for (let i = 0; i < n; i++) yield* this.runEffects(e.each, ctx);
        if (e.custom) yield* this.custom(e.custom, { n }, ctx);
        break;
      }
      case 'raiseCorpses': {
        const n = Math.min(e.max, me.corpses ?? 0, MAX_BOARD - this.boardSpaceUsed(me.id));
        if (n <= 0) break;
        this.spendCorpses(me, n);
        this.log(me.id, `喚起了 ${n} 具屍體`);
        for (let i = 0; i < n; i++) yield* this.doSummon(ctx, ctx.controller, e.card);
        break;
      }
      case 'launchDiscount':
        me.launchDiscount = (me.launchDiscount ?? 0) + e.amount;
        break;
      case 'launchStarship':
        yield* this.launch(ctx.controller, true);
        break;
      case 'delayed':
        (me.delayed ??= []).push({ turns: e.turns, effects: e.effects, sourceCardId: ctx.sourceCardId });
        break;
      case 'shuffle': {
        const target = who(e.who ?? 'self');
        for (let i = 0; i < e.count; i++) target.deck.splice(randomInt(s, target.deck.length + 1), 0, this.newHandCard(e.card));
        if (target !== me && /Plague$/.test(getCard(e.card).nameEn)) me.plaguesShuffled = (me.plaguesShuffled ?? 0) + e.count;
        break;
      }
      case 'shuffleCopy':
        for (const uid of this.resolve(e.target, ctx)) {
          const m = this.minion(uid);
          if (!m) continue;
          for (let i = 0; i < e.count; i++) me.deck.splice(randomInt(s, me.deck.length + 1), 0, this.newHandCard(m.cardId));
        }
        break;
      case 'handBuff': {
        const minions = me.hand.filter((h) => {
          const def = getCard(h.cardId);
          if (def.type !== 'MINION') return false;
          return !e.race || !!def.races?.includes(e.race) || !!def.races?.includes('ALL');
        });
        const targets = e.scope === 'all' ? minions : ([pick(s, minions)].filter(Boolean) as HandCard[]);
        for (const h of targets) {
          h.atkBuff += e.atk;
          h.hpBuff += e.hp;
          const extra = getCard(h.cardId).extraStatsOnBuff ?? 0;
          if (extra && (e.atk > 0 || e.hp > 0)) {
            h.atkBuff += extra;
            h.hpBuff += extra;
          }
        }
        break;
      }
      case 'evolve':
        for (const uid of this.resolve(e.target, ctx)) {
          const m = this.minion(uid);
          if (!m) continue;
          const want = getCard(m.cardId).cost + e.amount;
          const pool = this.randomPool({ type: 'MINION', cost: want }, ctx.controller, false);
          const c = pick(s, pool);
          if (c) this.transform(uid, c.id);
        }
        break;
      case 'grant':
        me.grants.push({ keyword: e.keyword, race: e.race });
        break;
      case 'nextCardDiscount':
        me.nextCardDiscount += e.amount;
        break;
      case 'minionTax': {
        // 對手的下個回合（回合數 +1）
        const tax = foe.minionTax;
        foe.minionTax = { amount: (tax?.turn === s.turn + 1 ? tax.amount : 0) + e.amount, turn: s.turn + 1 };
        break;
      }
      case 'nextSpellDiscount':
        me.nextSpellDiscount = { amount: (me.nextSpellDiscount?.turn === s.turn ? me.nextSpellDiscount.amount : 0) + e.amount, turn: s.turn };
        break;
      case 'eternal':
        (me.eternal ??= []).push({ ability: e.ability, sourceCardId: ctx.sourceCardId });
        break;
      case 'heroMaxHealth':
        me.hero.maxHp += e.amount;
        me.hero.hp += e.amount;
        me.heroHealthChangedTurn = s.turn;
        this.fx({ kind: 'heal', uid: me.hero.uid, amount: e.amount });
        yield* this.emit({ k: 'healed', player: me.id, subject: me.hero.uid, amount: e.amount, isHero: true });
        break;
      case 'refreshHeroPower':
        me.heroPower.used = false;
        if (me.secondaryHeroPower) me.secondaryHeroPower.used = false;
        break;
      case 'minionAtkBonus':
        me.minionAtkBonus = (me.minionAtkBonus ?? 0) + e.amount;
        break;
      case 'nextCardCostsCorpses':
        me.nextCardCorpsesTurn = s.turn;
        break;
      case 'costMod':
        if (ctx.it?.kind === 'hand') {
          const hc = this.handCard(ctx.it.uid);
          if (hc) hc.card.costMod += e.amount;
        }
        break;
      case 'cond':
        if (this.evalCond(e.cond, ctx)) yield* this.runEffects(e.then, ctx);
        else if (e.else) yield* this.runEffects(e.else, ctx);
        break;
      case 'repeat': {
        const n = this.amount(e.times, ctx);
        for (let i = 0; i < n; i++) yield* this.runEffects(e.effects, ctx);
        break;
      }
      case 'custom':
        yield* this.custom(e.fn, e.args ?? {}, ctx);
        break;
    }
  }

  private copyStats(src: Minion, m: Minion) {
    m.prisonCards = src.prisonCards ? structuredClone(src.prisonCards) : undefined;
    m.parts = src.parts;
    m.starship = src.starship;
    m.baseAtk = src.baseAtk;
    m.atkBuff = src.atkBuff;
    m.baseHp = src.baseHp;
    m.maxHp = src.maxHp - src.auraHp + m.auraHp;
    m.hp = Math.min(m.maxHp, src.hp - src.auraHp + m.auraHp);
    if (m.hp <= 0) m.hp = 1;
    m.keywords = [...src.keywords];
    m.abilities = [...src.abilities];
    m.silenced = src.silenced;
    if (src.silenced) {
      m.auras = [];
      m.spellDamage = 0;
      m.enrageAtk = 0;
    }
  }

  private silence(m: Minion) {
    m.silenced = true;
    m.keywords = [];
    m.tempKeywords = [];
    m.nextTurnKeywords = [];
    m.abilities = [];
    m.auras = [];
    m.spellDamage = 0;
    m.enrageAtk = 0;
    m.frozen = false;
    m.atkBuff = 0;
    m.tempAtk = 0;
    m.lingerAtk = undefined;
    const def = this.minionDef(m);
    m.baseAtk = def.attack ?? 0;
    m.baseHp = def.health ?? 1;
    m.maxHp = m.baseHp + m.auraHp;
    m.hp = Math.min(m.hp, m.maxHp);
    this.recalcAuras();
  }

  private transform(uid: number, cardId: string) {
    const old = this.minion(uid);
    if (!old) return;
    const p = this.s.players[old.owner];
    const idx = p.board.indexOf(old);
    const m = this.makeMinion(old.owner, cardId);
    m.sleeping = old.sleeping;
    m.summonedTurn = old.summonedTurn;
    m.attacks = old.attacks;
    p.board[idx] = m;
    this.recalcAuras();
  }

  /** IMPFERNAL! 在手牌/牌庫被摧毀時也會觸發同一個亡語。 */
  private *impfernalOffboard(owner: PlayerId): Gen {
    const ctx: Ctx = { ...this.baseCtx(owner), sourceCardId: 'JAIL_398' };
    yield* this.runEffects([
      { e: 'damage', target: { t: 'all', filter: { type: 'character', side: 'any' } }, amount: 3 },
    ], ctx);
    yield* this.processDeaths();
  }

  // ==========================================================================
  // 特殊效果（手動定義的卡牌使用）
  // ==========================================================================

  private putImpInformants(owner: PlayerId, count: number) {
    const enemy = this.s.players[opp(owner)];
    for (let i = 0; i < count; i++) {
      const h = this.newHandCard('CAP_400t2t');
      enemy.deck.splice(randomInt(this.s, enemy.deck.length + 1), 0, h);
    }
  }

  private *custom(fn: string, args: Record<string, unknown>, ctx: Ctx): Gen {
    const s = this.s;
    const me = s.players[ctx.controller];
    const foe = s.players[opp(ctx.controller)];
    switch (fn) {
      case 'duplicateOtherLegendariesInDeck': {
        const originals = [...me.deck].filter((h) => h.cardId !== ctx.sourceCardId && getCard(h.cardId).rarity === 'LEGENDARY');
        for (const hc of originals) me.deck.push({ ...structuredClone(hc), uid: this.uid() });
        this.log(me.id, `${this.name(ctx.sourceCardId)}複製了 ${originals.length} 張其他傳說卡`);
        break;
      }
      case 'grantSecondaryHeroPower': {
        const def = getCard(ctx.sourceCardId).secondaryHeroPower;
        if (def) {
          me.secondaryHeroPower = { id: def.id, used: false, cost: def.cost, sourceCardId: ctx.sourceCardId };
          this.log(me.id, `${me.name}獲得了第二英雄能力【${def.name}】`);
        }
        break;
      }
      case 'sendDeckToVoidExceptOne': {
        // 36.2.2 後保留 1 張在牌庫。牌庫本身已隨機洗牌，因此保留目前最上方那張。
        if (me.deck.length > 1) {
          const keep = me.deck[me.deck.length - 1];
          me.voidDeck = me.deck.filter((h) => h !== keep);
          me.deck = [keep];
        } else {
          me.voidDeck = [];
        }
        this.log(me.id, `${me.name}把 ${me.voidDeck.length} 張牌送入了虛無`);
        break;
      }
      case 'darkBribe': {
        const drawn = yield* this.draw(me, 3);
        if (!drawn.length) break;
        const chosenId = yield* this.choose(ctx, drawn.map((h) => h.cardId), '選一張牌交給對手');
        const card = drawn.find((h) => h.cardId === chosenId);
        if (!card) break;
        const i = me.hand.findIndex((h) => h.uid === card.uid);
        if (i >= 0) {
          me.hand.splice(i, 1);
          this.enterHandCard(foe, card);
          this.log(me.id, `${me.name}把${this.name(card.cardId)}交給了對手`);
        }
        break;
      }
      case 'noxiousBribe': {
        const chooseCards = poolCards({}, me.heroClass, foe.heroClass).filter((c) => !!c.chooseOne?.length);
        const options = this.discoverOptions({}, me.id, chooseCards);
        if (!options.length) break;
        const cardId = yield* this.choose(ctx, options, '發現一張二選一卡牌');
        const mine = this.addToHand(me, cardId);
        if (mine) mine.chooseOneCombined = true;
        this.addToHand(foe, cardId); // 對手拿到的是沒有強化的普通版本
        break;
      }
      case 'desperateBribe': {
        const mine: number[] = [];
        for (const pid of [me.id, foe.id] as PlayerId[]) {
          for (let i = 0; i < 2; i++) {
            const card = pick(s, this.randomPool({ type: 'MINION', cost: 2 }, pid, false));
            if (!card) continue;
            const m = yield* this.summon(pid, card.id);
            if (m && pid === me.id) mine.push(m.uid);
          }
        }
        for (const uid of mine) {
          const card = pick(s, this.randomPool({ type: 'MINION', cost: 3 }, me.id, false));
          if (card && this.minion(uid)) this.transform(uid, card.id);
        }
        break;
      }
      case 'destroyNonClassMinions': {
        const cls = args.class as CardClass;
        for (const m of [...s.players[0].board, ...s.players[1].board]) {
          if (!cardClasses(getCard(m.cardId)).includes(cls)) m.dead = true;
        }
        break;
      }
      case 'markItCastTwice': {
        if (ctx.it?.kind === 'hand') {
          const found = this.handCard(ctx.it.uid);
          if (found) found.card.castTwice = true;
        }
        break;
      }
      case 'releaseTheBeasts': {
        for (const h of me.hand) {
          if (getCard(h.cardId).type !== 'MINION') continue;
          h.atkBuff += 1;
          h.hpBuff += 1;
          if (getCard(h.cardId).rarity === 'LEGENDARY') {
            h.atkBuff += 2;
            h.hpBuff += 1;
          }
        }
        break;
      }
      case 'triggerChosenDeathrattle': {
        if (ctx.chosen === null) break;
        const m = this.minion(ctx.chosen);
        if (m) yield* this.runDeathrattles(m);
        break;
      }
      case 'destroyRandomAdjacent': {
        const src = ctx.sourceUid !== null ? this.minion(ctx.sourceUid) : null;
        if (!src) break;
        const target = pick(s, this.adjacent(src));
        if (target) target.dead = true;
        break;
      }
      case 'spitefulChef': {
        const cost = me.maxMana >= 10 ? 6 : 2;
        const card = pick(s, this.randomPool({ type: 'MINION', cost, keyword: 'TAUNT' }, ctx.controller, false));
        if (card) yield* this.doSummon(ctx, ctx.controller, card.id);
        break;
      }
      case 'franticForger': {
        const spells = this.randomPool({ type: 'SPELL' }, ctx.controller, true).filter((c) => c.cost <= me.mana);
        const card = pick(s, spells);
        if (card) {
          const hc = this.addToHand(me, card.id);
          if (hc) hc.temporary = true;
        }
        break;
      }
      case 'thievesTools': {
        const pool = this.randomPool({ type: 'SPELL', cost: 4 }, ctx.controller, true);
        for (let i = 0; i < 2; i++) {
          const c = pick(s, pool);
          if (!c) break;
          const hc = this.addToHand(me, c.id);
          if (hc) hc.costMod -= 2;
        }
        break;
      }
      case 'si7RandomHandDiscount': {
        const h = pick(s, me.hand);
        if (h) h.costMod -= Number(args.amount ?? 3);
        break;
      }
      case 'silentStrike': {
        const target = ctx.chosen !== null ? this.minion(ctx.chosen) : null;
        if (!target) break;
        target.atkBuff += 3;
        if (this.hasKw(target, 'STEALTH')) {
          const enemies = this.s.players[opp(ctx.controller)].board.filter((m) => this.alive(m));
          const victim = pick(s, enemies);
          if (victim) yield* this.damage(this.dmgSource(ctx), victim.uid, this.atkOf(target) + (ctx.isSpell ? this.spellDamage(ctx.controller) : 0));
        }
        break;
      }
      case 'tricksOfTrade': {
        if (ctx.chosen === null) break;
        const amount = ctx.sourceHandCard?.stealthAttackSeen ? 3 : 1;
        yield* this.damage(this.dmgSource(ctx), ctx.chosen, amount + (ctx.isSpell ? this.spellDamage(ctx.controller) : 0));
        break;
      }
      case 'follow': {
        const kind = String(args.kind ?? '');
        const grant = (h: HandCard | null) => {
          if (!h) return;
          h.grantedPlayEffects = [{ e: 'custom', fn: 'follow', args: { kind } }];
          h.grantedPlayEffectsTurn = s.turn;
        };
        const self = this;
        const choosePlayable = function* (cards: HandCard[], title: string): Gen<HandCard | null> {
          if (!cards.length) return null;
          const id = yield* self.choose(ctx, cards.map((h) => h.cardId), title);
          return cards.find((h) => h.cardId === id) ?? null;
        };
        if (kind === 'footsteps') {
          const opts = this.discoverOptions({ type: 'MINION', keyword: 'STEALTH' }, ctx.controller);
          if (!opts.length) break;
          const id = yield* this.choose(ctx, opts, '發現一個潛行手下');
          grant(this.addToHand(me, id));
        } else if (kind === 'fuse') {
          const enemies = this.chars().filter((c) => this.alive(c) && c.owner !== ctx.controller);
          const victim = pick(s, enemies);
          if (victim) yield* this.damage(this.dmgSource(ctx), victim.uid, 2 + (ctx.isSpell ? this.spellDamage(ctx.controller) : 0));
          const cards = me.hand.filter((h) => (getCard(h.cardId).races ?? []).includes('PIRATE') && this.canPlay(h.uid).ok);
          grant(yield* choosePlayable(cards, '選一張可打出的海盜'));
        } else if (kind === 'evidence') {
          this.putImpInformants(ctx.controller, 1);
          const cards = me.hand.filter((h) => this.canPlay(h.uid).ok);
          grant(yield* choosePlayable(cards, '選一張可打出的牌'));
        } else if (kind === 'ghosts') {
          yield* this.summon(ctx.controller, 'CAP_802t');
          const cards = me.hand.filter((h) => this.canPlay(h.uid).ok);
          grant(yield* choosePlayable(cards, '選一張可打出的牌'));
        }
        break;
      }
      case 'fireThisCannoneer': {
        const cannon = ctx.sourceUid !== null ? this.minion(ctx.sourceUid) : null;
        if (!cannon || cannon.cardId !== 'CAP_107t') break;
        const extra = me.board.filter((m) => !m.silenced && !m.dead && m.hp > 0 && m.cardId === 'CAP_106').length;
        for (let shot = 0; shot < 1 + extra; shot++) {
          const enemies = this.chars().filter((c) => this.alive(c) && c.owner !== ctx.controller);
          const victim = pick(s, enemies);
          if (!victim) break;
          yield* this.damage(this.charSource(cannon), victim.uid, 1);
        }
        break;
      }
      case 'fireCannoneers': {
        for (const cannon of [...me.board].filter((m) => this.alive(m) && m.cardId === 'CAP_107t')) {
          const cctx: Ctx = { ...this.baseCtx(ctx.controller), sourceUid: cannon.uid, sourceCardId: cannon.cardId };
          yield* this.custom('fireThisCannoneer', {}, cctx);
        }
        break;
      }
      case 'putImpInformants':
        this.putImpInformants(ctx.controller, Number(args.count ?? 1));
        break;
      case 'corruptConstable': {
        const list = foe.deck.filter((h) => h.cardId === 'CAP_400t2t');
        const h = pick(s, list);
        if (h) {
          foe.deck.splice(foe.deck.indexOf(h), 1);
          h.atkBuff += 2;
          h.hpBuff += 2;
          foe.deck.push(h);
        }
        break;
      }
      case 'frameJob': {
        for (let i = 0; i < 2; i++) {
          const victim = pick(s, foe.board.filter((m) => this.alive(m)));
          if (victim) victim.dead = true;
        }
        const minions = foe.deck.filter((h) => getCard(h.cardId).type === 'MINION');
        const sample = shuffle(s, [...minions]).slice(0, 3);
        if (sample.length) {
          const id = yield* this.choose(ctx, sample.map((h) => h.cardId), '選一個敵方牌庫中的手下置頂');
          const h = minions.find((x) => x.cardId === id);
          if (h) {
            foe.deck.splice(foe.deck.indexOf(h), 1);
            foe.deck.push(h);
          }
        }
        break;
      }
      case 'lingeringSpirit': {
        const hero = me.hero;
        const missing = Math.max(0, hero.maxHp - hero.hp);
        const healed = Math.min(3, missing);
        if (healed > 0) yield* this.heal(hero.uid, healed);
        const excess = 3 - healed;
        if (excess > 0) {
          const victim = pick(s, this.chars().filter((x) => this.alive(x) && x.owner !== ctx.controller));
          if (victim) yield* this.damage(this.dmgSource(ctx), victim.uid, excess);
        }
        break;
      }
      case 'specterSpecialist': {
        if (ctx.chosen === null) break;
        const target = this.minion(ctx.chosen);
        if (!target) break;
        if (this.hasKw(target, 'REBORN')) {
          const copy = yield* this.summon(ctx.controller, target.cardId);
          if (copy) this.copyStats(target, copy);
        } else target.keywords.push('REBORN');
        break;
      }
      case 'escapeSelf': {
        const m = ctx.sourceUid !== null ? this.minion(ctx.sourceUid) : null;
        if (m) {
          const owner = s.players[m.owner];
          owner.board = owner.board.filter((x) => x.uid !== m.uid);
          this.recalcAuras();
          this.log(m.owner, `${this.name(m.cardId)}逃離了對戰`);
        }
        break;
      }
      case 'grantSpellEchoSummon': {
        (me.eternal ??= []).push({
          sourceCardId: ctx.sourceCardId,
          ability: { on: { k: 'spellCast', side: 'friendly' }, effects: [{ e: 'custom', fn: 'summonMinionAtSpellCost' }] } as Ability,
        });
        break;
      }
      case 'summonMinionAtSpellCost': {
        if (!ctx.itCardId || getCard(ctx.itCardId).type !== 'SPELL') break;
        const cost = getCard(ctx.itCardId).cost;
        const card = pick(s, this.randomPool({ type: 'MINION', cost }, ctx.controller, false));
        if (card) yield* this.summon(ctx.controller, card.id);
        break;
      }
      case 'nab': {
        if (ctx.chosen === null) break;
        const target = this.minion(ctx.chosen);
        if (!target) break;
        const cardId = target.cardId;
        yield* this.damage(this.dmgSource(ctx), target.uid, 3 + (ctx.isSpell ? this.spellDamage(ctx.controller) : 0));
        if (target.hp <= 0 || target.dead) {
          const copy = this.newHandCard(cardId);
          copy.costMod = 2 - getCard(cardId).cost;
          me.deck.splice(randomInt(s, me.deck.length + 1), 0, copy);
        }
        break;
      }
      case 'castTwoMageSecrets': {
        const pool = this.randomPool({ type: 'SPELL', isSecret: true, cls: 'MAGE' }, ctx.controller, false)
          .filter((x) => !me.secrets.some((sec) => sec.cardId === x.id));
        for (let i = 0; i < 2 && me.secrets.length < MAX_SECRETS; i++) {
          const card = pick(s, pool.filter((x) => !me.secrets.some((sec) => sec.cardId === x.id)));
          if (!card) break;
          me.secrets.push({ uid: this.uid(), cardId: card.id });
          this.log(me.id, `${me.name}施放了一個隨機法師奧秘`);
        }
        break;
      }
      case 'judgment': {
        if (ctx.chosen === null) break;
        const chosen = this.minion(ctx.chosen);
        if (!chosen) break;
        const atk = this.atkOf(chosen);
        const hp = chosen.maxHp;
        for (const m of [...s.players[0].board, ...s.players[1].board]) {
          m.baseAtk = atk;
          m.atkBuff = 0;
          m.tempAtk = -m.auraAtk;
          m.baseHp = Math.max(1, hp - m.auraHp);
          m.maxHp = Math.max(1, hp);
          m.hp = m.maxHp;
        }
        break;
      }
      case 'spireSecurity': {
        const spells = me.deck.filter((h) => getCard(h.cardId).type === 'SPELL');
        const revealed = pick(s, spells);
        if (!revealed) break;
        this.log(me.id, `${me.name}揭露了${this.name(revealed.cardId)}`);
        if (getCard(revealed.cardId).cost >= 5) {
          yield* this.runEffects([{ e: 'splitDamage', filter: { type: 'minion', side: 'enemy' }, amount: 5, spell: false }], ctx);
        }
        break;
      }
      case 'sawbones': {
        const victims = me.board.filter((m) => m.uid !== ctx.sourceUid && this.alive(m));
        for (const m of victims) m.dead = true;
        const n = victims.length;
        if (n) {
          yield* this.draw(me, n);
          me.mana = Math.min(me.maxMana, me.mana + n);
        }
        break;
      }
      case 'karov': {
        const legendaries = this.randomPool({ type: 'MINION', rarity: 'LEGENDARY' }, ctx.controller, false);
        for (let i = 0; i < 3; i++) {
          const card = pick(s, legendaries);
          if (!card) break;
          const h = this.addToHand(me, card.id);
          if (!h) continue;
          h.atkBuff = 1 - (card.attack ?? 0);
          h.hpBuff = 1 - (card.health ?? 1);
          h.costMod = 1 - card.cost;
        }
        break;
      }
      case 'overloadController':
        me.overloadOwed += Number(args.amount ?? 2);
        break;
      case 'hogdriver': {
        const drawn = yield* this.draw(me, 2);
        if (drawn.length === 2 && drawn.every((h) => getCard(h.cardId).type === 'MINION')) {
          const src = ctx.sourceUid !== null ? this.minion(ctx.sourceUid) : null;
          if (src && !src.keywords.includes('CHARGE')) src.keywords.push('CHARGE');
        }
        break;
      }
      case 'jadeGuardians': {
        const discount = me.cardsPlayedForTwoMana ?? 0;
        const pool = this.randomPool({ type: 'MINION', cost: 8 }, ctx.controller, false);
        for (let i = 0; i < 2; i++) {
          const card = pick(s, pool);
          if (!card) break;
          const h = this.addToHand(me, card.id);
          if (h) h.costMod -= discount;
        }
        break;
      }
      case 'alarmOMaticEnemy': {
        const self = ctx.sourceUid !== null ? this.minion(ctx.sourceUid) : null;
        const candidates = foe.hand.filter((h) => getCard(h.cardId).type === 'MINION');
        const chosen = pick(s, candidates);
        if (!self || !chosen || this.boardSpaceUsed(me.id) > MAX_BOARD) break;
        const pos = me.board.indexOf(self);
        if (pos < 0) break;
        foe.hand.splice(foe.hand.indexOf(chosen), 1);
        me.board.splice(pos, 1);
        this.addToHand(foe, self.cardId);
        const summoned = this.makeMinion(me.id, chosen.cardId, chosen);
        summoned.sleeping = true;
        summoned.summonedTurn = s.turn;
        me.board.splice(Math.min(pos, me.board.length), 0, summoned);
        this.recalcAuras();
        yield* this.emit({ k: 'summon', player: me.id, subject: summoned.uid, races: getCard(summoned.cardId).races });
        break;
      }
      case 'annihilation': {
        for (const m of [...s.players[0].board, ...s.players[1].board]) m.dead = true;
        yield* this.processDeaths();
        const bottom = me.deck.slice(0, 3);
        const demons = bottom.filter((h) => (getCard(h.cardId).races ?? []).some((r) => r === 'DEMON' || r === 'ALL'));
        for (const h of demons) {
          const i = me.deck.indexOf(h);
          if (i >= 0) me.deck.splice(i, 1);
          yield* this.summon(me.id, h.cardId);
        }
        break;
      }
      case 'shadowRounds': {
        if (ctx.chosen === null) break;
        let target = this.minion(ctx.chosen);
        const amount = 2 + (ctx.isSpell ? this.spellDamage(ctx.controller) : 0);
        for (let guard = 0; target && guard < 14; guard++) {
          yield* this.damage(this.dmgSource(ctx), target.uid, amount);
          const died = target.hp <= 0 || target.dead;
          if (!died) break;
          yield* this.processDeaths();
          target = pick(s, foe.board.filter((m) => this.alive(m))) ?? null;
        }
        break;
      }
      case 'soulParasiteGainStats': {
        const src = ctx.sourceUid !== null ? this.minion(ctx.sourceUid) : null;
        const it = ctx.it?.kind === 'char' ? this.minion(ctx.it.uid) : null;
        if (src && it) {
          src.atkBuff += this.atkOf(it);
          const hp = it.maxHp;
          src.maxHp += hp;
          src.hp += hp;
        }
        break;
      }
      case 'shuffleHandsTogether': {
        const mineCount = me.hand.length;
        const theirsCount = foe.hand.length;
        const mixed = shuffle(s, [...me.hand, ...foe.hand]);
        me.hand = mixed.slice(0, mineCount);
        foe.hand = mixed.slice(mineCount, mineCount + theirsCount);
        this.recombineShatter(me);
        this.recombineShatter(foe);
        break;
      }
      case 'hellraiser': {
        if (!me.deck.length) {
          const src = ctx.sourceUid !== null ? this.minion(ctx.sourceUid) : null;
          if (src) {
            src.atkBuff += 4;
            src.maxHp += 4;
            src.hp += 4;
          }
          break;
        }
        const opts = shuffle(s, [...me.deck]).slice(0, 3);
        const id = yield* this.choose(ctx, opts.map((h) => h.cardId), '發現牌庫中的一張牌');
        const h = opts.find((x) => x.cardId === id);
        if (h) {
          me.deck.splice(me.deck.indexOf(h), 1);
          this.enterHandCard(me, h);
        }
        break;
      }
      case 'hexmarshal': {
        const pool = this.randomPool({ type: 'SPELL', minCost: 5 }, ctx.controller, true);
        const card = pick(s, pool);
        if (!card) break;
        const h = this.addToHand(me, card.id);
        if (h && me.deckStartedNoSpells) h.costMod -= 5;
        break;
      }
      case 'staffOfTrickery': {
        const opts = this.discoverOptions({ cls: 'DRUID' }, ctx.controller);
        if (!opts.length) break;
        const id = yield* this.choose(ctx, opts, '發現一張德魯伊卡牌');
        const h = this.addToHand(me, id);
        if (h) h.costMod -= this.atkOf(me.hero);
        break;
      }
      case 'spireOfSolitude': {
        const size = me.hand.length;
        const token = this.newHandCard('JAIL_511t');
        token.atkBuff = size - 1; token.hpBuff = size - 1;
        const demon = yield* this.summon(me.id, token.cardId, undefined, token);
        if (demon && this.alive(demon)) {
          const enemy = pick(s, foe.board.filter((m) => this.alive(m) && !(m.dormantTurns ?? 0)));
          if (enemy) yield* this.doAttack(demon.uid, enemy.uid);
        }
        break;
      }
      case 'lowSecurityWing': {
        const card = pick(s, this.randomPool({ type: 'MINION', cls: 'SHAMAN' }, me.id, false));
        if (card) {
          const held = this.addToHand(me, card.id);
          if (held) held.locationLocked = true;
        }
        break;
      }
      case 'zuramatPrison': {
        const location = me.locations?.find((l) => l.uid === ctx.sourceUid);
        if (!location || !me.hand.length) break;
        const choices = [...me.hand];
        const id = yield* this.choose(ctx, choices.map((h) => h.cardId), '選擇要捨棄的牌');
        const selected = choices.find((h) => h.cardId === id);
        if (!selected || !me.hand.includes(selected)) break;
        me.hand.splice(me.hand.indexOf(selected), 1);
        location.discarded.push(structuredClone(selected));
        this.recombineShatter(me);
        this.log(me.id, `舒拉邁特的牢獄捨棄了${this.name(selected.cardId)}`);
        if (selected.cardId === 'JAIL_398') yield* this.impfernalOffboard(me.id);
        if (!this.over) yield* this.summon(me.id, 'JAIL_887t3');
        break;
      }
      case 'zuramatReplay': {
        const source = ctx.sourceUid === null ? null : this.minion(ctx.sourceUid);
        const card = pick(s, source?.prisonCards ?? []);
        if (card) yield* this.replayPrisonCard(me.id, card);
        break;
      }
      case 'lethalRecipe': {
        const drawn = yield* this.draw(me, 2, { type: 'MINION' });
        if (me.maxMana >= 10) for (const h of drawn) { h.atkBuff += 3; h.hpBuff += 3; }
        break;
      }
      case 'copyDeckSpells': {
        const source = ctx.sourceUid !== null ? this.minion(ctx.sourceUid) : null;
        if (source) source.copiedDeckSpellIds = [...new Set([...(source.copiedDeckSpellIds ?? []), ...me.deck.filter((h) => getCard(h.cardId).type === 'SPELL').map((h) => h.cardId)])];
        const copies = me.deck.filter((h) => getCard(h.cardId).type === 'SPELL').map((h) => ({ ...structuredClone(h), uid: this.uid() }));
        for (const h of copies) me.deck.splice(randomInt(s, me.deck.length + 1), 0, h);
        break;
      }
      case 'drawCopiedDeckSpell': {
        const source = ctx.sourceSnapshot ?? (ctx.sourceUid !== null ? this.minion(ctx.sourceUid) : null);
        const ids = source?.copiedDeckSpellIds ?? [];
        const eligible = me.deck.filter((h) => ids.includes(h.cardId));
        const card = pick(s, eligible);
        if (card) {
          me.deck.splice(me.deck.indexOf(card), 1);
          me.deck.push(card);
          yield* this.draw(me, 1);
        }
        break;
      }
      case 'shuffleRandomDHSpell': {
        const pool = this.randomPool({ type: 'SPELL', cls: 'DEMONHUNTER' }, ctx.controller, false);
        const card = pick(s, pool);
        if (card) me.deck.splice(randomInt(s, me.deck.length + 1), 0, this.newHandCard(card.id));
        break;
      }
      case 'moragg': {
        const demons = me.deck.filter((h) => {
          const races = getCard(h.cardId).races ?? [];
          return getCard(h.cardId).type === 'MINION' && (races.includes('DEMON') || races.includes('ALL'));
        });
        const h = pick(s, demons);
        if (!h) break;
        me.deck.splice(me.deck.indexOf(h), 1);
        const summoned = yield* this.summon(me.id, h.cardId);
        if (summoned) summoned.abilities.push({ on: { k: 'deathrattle' }, effects: [{ e: 'summon', card: 'JAIL_906', count: 1, who: 'self' }] });
        break;
      }
      case 'undeathSentence': {
        const options = me.graveyard.filter((id) => getCard(id).type === 'MINION' && (getCard(id).abilities ?? []).some((a) => a.on.k === 'deathrattle'));
        const id = pick(s, options);
        if (id) {
          const dummy = this.makeMinion(me.id, id);
          yield* this.runDeathrattles(dummy);
        }
        break;
      }
      case 'capturedArchmage': {
        if (me.graveyard.filter((id) => id === ctx.sourceCardId).length < 5) break;
        const target = pick(s, this.chars().filter((x) => this.alive(x) && x.owner !== ctx.controller));
        if (target) yield* this.damage({ owner: ctx.controller, uid: null, cardId: 'CS2_029' }, target.uid, 6 + this.spellDamage(ctx.controller));
        break;
      }
      case 'skeletonKey': {
        // 三張法術 +「刷新」。刷新可以無限重複；每次有 20% 機率受到 5 點外部傷害。
        for (let guard = 0; guard < 50 && !this.over; guard++) {
          const spells = this.discoverOptions({ type: 'SPELL' }, ctx.controller);
          if (!spells.length) break;
          const options = [...spells, 'VH_SKELETON_REFRESH'];
          const id = yield* this.choose(ctx, options, '發現一張法術，或刷新選項');
          if (id !== 'VH_SKELETON_REFRESH') {
            this.addToHand(me, id);
            break;
          }
          if (nextRandom(s) < 0.2) {
            yield* this.damage({ owner: me.id, uid: null, cardId: ctx.sourceCardId }, me.hero.uid, 5);
            if (this.over) return;
          }
        }
        break;
      }
      case 'slimeEm': {
        const mine = me.board.filter((m) => this.alive(m)).map((m) => m.cardId);
        const theirs = foe.board.filter((m) => this.alive(m)).map((m) => m.cardId);
        for (const m of [...me.board, ...foe.board]) if (this.alive(m)) m.dead = true;
        yield* this.processDeaths();
        if (this.over) return;
        const mySpell = this.newHandCard('VH_ECTOPLASM');
        mySpell.ectoplasmMinions = mine;
        this.enterHandCard(me, mySpell);
        const theirSpell = this.newHandCard('VH_ECTOPLASM');
        theirSpell.ectoplasmMinions = theirs;
        this.enterHandCard(foe, theirSpell);
        break;
      }
      case 'ectoplasm': {
        const list = ctx.sourceHandCard?.ectoplasmMinions ?? [];
        for (const id of list) {
          if (this.boardSpaceUsed(me.id) >= MAX_BOARD) break;
          yield* this.doSummon(ctx, me.id, id);
        }
        break;
      }
      case 'raithVanGeist': {
        for (const id of me.rebornThisGame ?? []) {
          if (this.boardSpaceUsed(me.id) >= MAX_BOARD) break;
          const summoned = yield* this.doSummon(ctx, me.id, id);
          if (!summoned) continue;
          const target = pick(s, foe.board.filter((m) => this.alive(m) && (m.dormantTurns ?? 0) <= 0));
          if (target && this.alive(summoned)) {
            summoned.sleeping = false;
            yield* this.doAttack(summoned.uid, target.uid);
            yield* this.processDeaths();
            if (this.over) return;
          }
        }
        break;
      }
      case 'ancientAugur': {
        const self = ctx.sourceUid !== null ? this.minion(ctx.sourceUid) : null;
        const sample = shuffle(s, [...foe.hand]).slice(0, 3);
        if (!self || !sample.length) break;
        const id = yield* this.choose(ctx, sample.map((h) => h.cardId), '從對手手牌中暗中選擇一張');
        const picked = sample.find((h) => h.cardId === id);
        if (picked) self.markedHandUid = picked.uid;
        break;
      }
      case 'ancientAugurDiscard': {
        const self = ctx.sourceSnapshot ?? (ctx.sourceUid !== null ? this.minion(ctx.sourceUid) : null);
        const uid = self?.markedHandUid;
        if (uid === undefined) break;
        const i = foe.hand.findIndex((h) => h.uid === uid);
        if (i >= 0) {
          const [discarded] = foe.hand.splice(i, 1);
          this.log(me.id, `${this.name('JAIL_303')}使對手棄掉了${this.name(discarded.cardId)}`);
        }
        break;
      }
      case 'bootlegAlchemist': {
        if (!me.hand.length) break;
        const options = [...me.hand];
        const id = yield* this.choose(ctx, options.map((h) => h.cardId), '選擇你手牌中的一張牌');
        const h = options.find((x) => x.cardId === id);
        if (!h || !me.hand.includes(h)) break;
        const originalCost = this.costOf(me, h);
        const targetPrintedCost = getCard(h.cardId).cost + 5;
        const pool = this.randomPool({ type: 'SPELL', cost: targetPrintedCost }, ctx.controller, false);
        const spell = pick(s, pool);
        if (!spell) break;
        h.cardId = spell.id;
        h.costMod = originalCost - spell.cost;
        h.atkBuff = 0;
        h.hpBuff = 0;
        h.parts = undefined;
        h.starship = undefined;
        h.prepareDiscount = undefined;
        h.prepared = undefined;
        h.preparedTurn = undefined;
        this.log(me.id, `手牌變形成${this.name(spell.id)}，費用維持 ${originalCost}`);
        break;
      }
      case 'inspectEnemyHand': {
        const sample = shuffle(s, [...foe.hand]).slice(0, 4);
        if (!sample.length) break;
        const id = yield* this.choose(ctx, sample.map((h) => h.cardId), '調查對手手牌中的一張牌');
        const h = sample.find((x) => x.cardId === id);
        if (h) (me.holmesWatches ??= []).push({ cardName: getCard(h.cardId).nameEn, turn: s.turn + 1 });
        break;
      }
      case 'violetPunisher': {
        if (ctx.chosen === null) break;
        const target = this.minion(ctx.chosen);
        const self = ctx.sourceUid !== null ? this.minion(ctx.sourceUid) : null;
        if (!target || !self) break;
        const stealable: Keyword[] = ['TAUNT','WINDFURY','DIVINE_SHIELD','POISONOUS','ELUSIVE','RUSH','LIFESTEAL','REBORN'];
        const stolen = stealable.filter((k) => this.hasKw(target, k));
        for (const k of stolen) {
          target.keywords = target.keywords.filter((x) => x !== k);
          target.tempKeywords = target.tempKeywords.filter((x) => x !== k);
          target.nextTurnKeywords = target.nextTurnKeywords.filter((x) => x !== k);
          target.auraKeywords = target.auraKeywords.filter((x) => x !== k);
          if (!self.keywords.includes(k)) self.keywords.push(k);
        }
        if (stolen.length) {
          self.atkBuff += stolen.length;
          self.maxHp += stolen.length;
          self.hp += stolen.length;
        }
        this.recalcAuras();
        break;
      }
      case 'reinforcementAura':
        (me.objectives ??= []).push({
          remaining: 3,
          sourceCardId: ctx.sourceCardId,
          effects: [{ e: 'recruit', count: 1, maxCost: 2 }],
        });
        break;
      case 'picklockDamage': {
        const self = ctx.sourceUid !== null ? this.minion(ctx.sourceUid) : null;
        if (self && ctx.chosen !== null) yield* this.damage(this.dmgSource(ctx), ctx.chosen, Math.max(0, self.baseAtk));
        break;
      }
      case 'beatrixStart': {
        const configured = me.sideboards?.JAIL_397?.[0];
        const legal = poolCards({ type: 'MINION', cost: 2 }, 'PALADIN', foe.heroClass)
          .filter((d) => cardClasses(d).includes('PALADIN') || cardClasses(d).includes('NEUTRAL'));
        const pickId = configured && legal.some((d) => d.id === configured) ? configured : pick(s, legal)?.id;
        if (pickId) {
          for (let i = 0; i < 10; i++) {
            const h = this.newHandCard(pickId);
            h.startedInDeck = false;
            me.deck.push(h);
          }
          this.log(me.id, `Commander Beatrix 將10張${this.name(pickId)}加入牌庫`);
        }
        break;
      }
      case 'kingUnderbelly': {
        const valid = (me.sideboards?.JAIL_831 ?? []).filter((id) => {
          if (!hasCard(id)) return false;
          const d = getCard(id);
          const cls = cardClasses(d);
          return d.type === 'MINION' && !!(d.races?.includes('BEAST') || d.races?.includes('ALL')) && !cls.includes('HUNTER') && !cls.includes('NEUTRAL');
        });
        const fallback = shuffle(
          s,
          poolCards({ type: 'MINION', race: 'BEAST', otherClass: true }, me.heroClass, foe.heroClass),
        ).slice(0, 3).map((d) => d.id);
        const options = [...new Set(valid.length ? valid : fallback)].slice(0, 3);
        if (!options.length) break;
        const chosen = yield* this.choose(ctx, options, '選擇一張違禁野獸');
        const h = this.addToHand(me, chosen);
        if (h) h.costMod -= 3;
        break;
      }
      case 'ayaCounterfeit': {
        const options = ['JAIL_504t', 'JAIL_504t2', 'JAIL_504t3'];
        const chosen = yield* this.choose(ctx, options, '選擇強化假幣');
        me.coinReplacement = chosen;
        for (const zone of [me.hand, me.deck]) {
          for (const h of zone) if (this.isCoin(h.cardId)) h.cardId = chosen;
        }
        for (let i = 0; i < 3; i++) this.addToHand(me, chosen);
        break;
      }
      case 'grimyCoin': {
        const enemies = foe.board.filter((m) => this.alive(m));
        const victim = pick(s, enemies);
        if (victim) yield* this.damage(this.dmgSource(ctx), victim.uid, 2 + this.spellDamage(ctx.controller));
        break;
      }
      case 'kabalCoinPotion': {
        const h = this.addToHand(me, 'JAIL_504t3p');
        if (h) {
          const pool = ['potion_aoe','potion_health','potion_damage','potion_armor','potion_freeze','potion_resurrect','potion_draw','potion_demon22','potion_addDemon'];
          h.trialEffects = shuffle(s, pool).slice(0, 2);
        }
        break;
      }
      case 'randomKazakusPotion1': {
        for (const effect of ctx.sourceHandCard?.trialEffects ?? []) {
          if (effect === 'potion_aoe') {
            for (const m of [...me.board, ...foe.board]) if (this.alive(m)) yield* this.damage(this.dmgSource(ctx), m.uid, 2 + this.spellDamage(ctx.controller));
          } else if (effect === 'potion_health') {
            for (const m of me.board) { m.maxHp += 2; m.hp += 2; }
          } else if (effect === 'potion_damage') {
            if (ctx.chosen !== null) yield* this.damage(this.dmgSource(ctx), ctx.chosen, 3 + this.spellDamage(ctx.controller));
          } else if (effect === 'potion_armor') me.hero.armor += 4;
          else if (effect === 'potion_freeze') {
            const target = pick(s, foe.board.filter((x) => this.alive(x) && (x.dormantTurns ?? 0) <= 0));
            if (target) this.freeze(target);
          } else if (effect === 'potion_resurrect') {
            const id = pick(s, me.graveyard);
            if (id) yield* this.summon(ctx.controller, id);
          } else if (effect === 'potion_draw') yield* this.draw(me, 1);
          else if (effect === 'potion_demon22') {
            yield* this.summon(ctx.controller, 'CFM_621_m4');
          } else if (effect === 'potion_addDemon') {
            const demon = pick(s, this.randomPool({ type: 'MINION', race: 'DEMON' }, ctx.controller, false));
            if (demon) this.addToHand(me, demon.id);
          }
        }
        break;
      }
      case 'godfatherKazakus': {
        const effects = [
          ['VH_TRIAL_TYRANNY','tyranny'], ['VH_TRIAL_SUGGEST','suggest'], ['VH_TRIAL_CRATE','crate'],
          ['VH_TRIAL_PERJURY','perjury'], ['VH_TRIAL_CONTRACT','contract'], ['VH_TRIAL_SHIV','shiv'],
          ['VH_TRIAL_CONSPIRACY','conspiracy'], ['VH_TRIAL_SMUGGLING','smuggling'], ['VH_TRIAL_DESTRUCTION','destruction'],
        ] as const;
        const firstOpts = shuffle(s, [...effects]).slice(0, 3);
        const firstId = yield* this.choose(ctx, firstOpts.map(([id]) => id), '選擇第一個審判效果');
        const first = effects.find(([id]) => id === firstId)![1];
        const secondOpts = shuffle(s, effects.filter(([, key]) => key !== first)).slice(0, 3);
        const secondId = yield* this.choose(ctx, secondOpts.map(([id]) => id), '選擇第二個審判效果');
        const second = effects.find(([id]) => id === secondId)![1];
        const durationId = yield* this.choose(ctx, ['VH_TRIAL_RUSHED','VH_TRIAL_GRUELING','VH_TRIAL_UNENDING'], '選擇審判長度');
        const h = this.addToHand(me, 'VH_SHAM_TRIAL');
        if (h) {
          h.trialEffects = [first, second];
          if (durationId === 'VH_TRIAL_RUSHED') { h.trialCost = 7; h.trialDelay = 0; }
          else if (durationId === 'VH_TRIAL_GRUELING') { h.trialCost = 4; h.trialDelay = 1; }
          else { h.trialCost = 0; h.trialDelay = 4; }
        }
        break;
      }
      case 'resolveShamTrial': {
        const effects = ctx.sourceHandCard?.trialEffects ?? [];
        const delay = ctx.sourceHandCard?.trialDelay ?? 0;
        if (delay > 0) (me.delayed ??= []).push({ turns: delay, effects: [{ e: 'custom', fn: 'executeShamTrial', args: { effects } }], sourceCardId: 'VH_SHAM_TRIAL' });
        else yield* this.custom('executeShamTrial', { effects }, ctx);
        break;
      }
      case 'executeShamTrial': {
        const effects = Array.isArray(args.effects) ? args.effects.map(String) : [];
        for (const effect of effects) {
          if (effect === 'tyranny') {
            if (hasCard('LOOT_368')) yield* this.summon(ctx.controller, 'LOOT_368');
          } else if (effect === 'suggest') yield* this.heal(me.hero.uid, 12);
          else if (effect === 'crate') yield* this.draw(me, 3);
          else if (effect === 'perjury') {
            for (const h of me.hand) if (getCard(h.cardId).type === 'MINION') h.costMod -= 2;
          } else if (effect === 'contract') {
            for (let i = 0; i < 3; i++) {
              const d = pick(s, this.randomPool({ type: 'MINION', cost: 3 }, ctx.controller, false));
              if (d) yield* this.summon(ctx.controller, d.id);
            }
          } else if (effect === 'shiv') {
            for (const h of me.hand) if (getCard(h.cardId).type === 'MINION') { h.atkBuff += 3; h.hpBuff += 3; }
            for (const m of me.board) { m.atkBuff += 3; m.maxHp += 3; m.hp += 3; }
          } else if (effect === 'conspiracy') {
            const target = pick(s, foe.board.filter((m) => this.alive(m)));
            if (target && this.boardSpaceUsed(me.id) < MAX_BOARD) {
              foe.board = foe.board.filter((m) => m !== target);
              target.owner = me.id; target.sleeping = true; target.attacks = 0; me.board.push(target); this.recalcAuras();
            }
          } else if (effect === 'smuggling') {
            for (let i = 0; i < 2 && foe.hand.length; i++) {
              const target = pick(s, foe.hand);
              if (!target) break;
              foe.hand.splice(foe.hand.indexOf(target), 1);
              target.copiedFromOpponent = true;
              this.enterHandCard(me, target);
            }
          } else if (effect === 'destruction') {
            const snapshot = shuffle(s, [...me.board, ...foe.board]);
            for (const m of snapshot) {
              if (!this.minion(m.uid) || !this.alive(m)) continue;
              const targets = [...me.board, ...foe.board].filter((x) => x.uid !== m.uid && this.alive(x));
              const target = pick(s, targets);
              if (target) yield* this.doAttack(m.uid, target.uid);
              if (this.over) return;
            }
          }
        }
        break;
      }
      case 'azalinaStart': {
        me.hero.maxHp = 40;
        me.hero.hp = 40;
        // 組牌階段已驗證 20 張自組牌；保留全部自組牌，不隨機刪牌。
        const copies = shuffle(s, [...foe.deck]).slice(0, 20);
        for (const h of copies) {
          const c = { ...structuredClone(h), uid: this.uid(), startedInDeck: false, copiedFromOpponent: true };
          me.deck.push(c);
        }
        break;
      }
      case 'drawUntilHandFull':
        if (me.hand.length < MAX_HAND) yield* this.draw(me, MAX_HAND - me.hand.length);
        break;
      case 'tinyPalChooseAmmo': {
        const options = ['JAIL_458t1', 'JAIL_458t2', 'JAIL_458t3', 'JAIL_458t4'].filter((id) => id !== me.weapon?.cardId);
        if (!options.length || !me.weapon) break;
        const chosen = yield* this.choose(ctx, options, '選擇元素彈藥');
        const def = getCard(chosen);
        me.weapon.cardId = chosen;
        me.weapon.abilities = [...(def.abilities ?? [])];
        me.weapon.keywords = [...(def.keywords ?? [])];
        break;
      }
      case 'tinyPalAmmo': {
        const kind = String(args.kind ?? '');
        if (kind === 'frost') {
          const skip = this.lastAttack?.defender;
          const enemies = shuffle(s, this.chars().filter((c) => this.alive(c) && c.owner !== ctx.controller && c.uid !== skip));
          for (const c of enemies.slice(0, 2)) this.freeze(c);
        } else if (kind === 'fire') {
          for (const c of this.chars().filter((x) => this.alive(x) && x.owner !== ctx.controller)) {
            yield* this.damage(this.dmgSource(ctx), c.uid, 1);
            if (this.over) return;
          }
        } else if (kind === 'earth') {
          const card = pick(s, this.randomPool({ type: 'MINION', cost: 3 }, ctx.controller, false));
          if (card) {
            const m = yield* this.summon(ctx.controller, card.id);
            if (m && !m.keywords.includes('TAUNT')) m.keywords.push('TAUNT');
          }
        } else if (kind === 'air') {
          const card = pick(s, poolCards({ type: 'MINION', hasBattlecry: true }, me.heroClass, foe.heroClass));
          if (card) {
            const h = this.addToHand(me, card.id);
            if (h) h.costMod -= 2;
          }
        }
        yield* this.custom('tinyPalChooseAmmo', {}, ctx);
        break;
      }
      case 'lotusTroublemaker': {
        const shots = 1 + (ctx.sourceHandCard?.twoManaCardsSeen ?? 0);
        for (let i = 0; i < shots; i++) {
          const enemies = this.chars().filter((c) => this.alive(c) && c.owner !== ctx.controller);
          const victim = pick(s, enemies);
          if (!victim) break;
          yield* this.damage(this.dmgSource(ctx), victim.uid, 1);
          if (this.over) return;
        }
        break;
      }
      case 'sliceAndDice': {
        const history = shuffle(s, [...(me.playedCardsThisTurn ?? [])]);
        for (const item of history) {
          const def = getCard(item.cardId);
          const abilities = def.chooseOne ? (def.chooseOne[item.option ?? 0]?.abilities ?? []) : (def.abilities ?? []);
          const playAbilities = abilities.filter((a) => a.on.k === 'play');
          const rctx: Ctx = { ...this.baseCtx(ctx.controller), sourceCardId: def.id, isSpell: def.type === 'SPELL' };
          const req = def.chooseOne ? def.chooseOne[item.option ?? 0]?.target : def.target;
          if (req) {
            const legal = this.validTargets(req, ctx.controller, def.type === 'SPELL');
            const enemies = legal.filter((uid) => this.char(uid)?.owner !== ctx.controller);
            rctx.chosen = pick(s, enemies.length ? enemies : legal) ?? null;
          }
          if (def.type === 'MINION') {
            if (this.boardSpaceUsed(me.id) >= MAX_BOARD) continue;
            const m = yield* this.doSummon(rctx, ctx.controller, def.id);
            if (!m) continue;
            rctx.sourceUid = m.uid;
          } else if (def.type === 'WEAPON') {
            yield* this.equip(ctx.controller, def.id);
            rctx.sourceUid = me.weapon?.uid ?? null;
          } else if (def.type === 'HERO') {
            me.hero.cardId = def.id;
            me.hero.armor += def.armor ?? 0;
            if (def.heroPower) me.heroPower = { id: def.heroPower.id, used: false, cost: def.heroPower.cost, heroCard: def.id };
            rctx.sourceUid = me.hero.uid;
          }
          for (const ab of playAbilities) {
            if (ab.cond && !this.evalCond(ab.cond, rctx)) continue;
            yield* this.runEffects(ab.effects, rctx);
            if (this.over) return;
          }
        }
        if (!this.over && this.s.current === ctx.controller) yield* this.endTurn();
        break;
      }
      case 'godfreyStart':
        me.godfreyOverdraw = true;
        break;
      case 'mugZeeStart': {
        const mug = !!me.deckStartedNoOtherMinions;
        const zee = !!me.deckStartedNoSpells;
        if (mug) me.heroPower = { id: 'JAIL_800hp1', used: false, cost: 0, heroCard: 'JAIL_800' };
        if (zee) {
          if (mug) me.secondaryHeroPower = { id: 'JAIL_800hp2', used: true, cost: 0, sourceCardId: 'JAIL_800' };
          else me.heroPower = { id: 'JAIL_800hp2', used: false, cost: 0, heroCard: 'JAIL_800' };
        }
        break;
      }
      case 'chefNethrekStart':
        if (me.deckStartedAllCostMax3) me.mana10AfterTurns = 5;
        break;
      case 'voidSoul': {
        const tier = Math.max(1, Math.min(10, me.voidSoulLevel ?? 1));
        const pool = this.randomPool({ type: 'MINION', race: 'DEMON', cost: tier }, ctx.controller, false);
        const card = pick(s, pool);
        if (card) yield* this.summon(ctx.controller, card.id);
        me.voidSoulLevel = Math.min(10, tier + 1);
        break;
      }
      case 'voidBlast': {
        if (ctx.chosen === null) break;
        const target = this.minion(ctx.chosen);
        if (!target) break;
        yield* this.damage(this.dmgSource(ctx), target.uid, 3 + (ctx.isSpell ? this.spellDamage(ctx.controller) : 0));
        if (target.hp <= 0 || target.dead) this.addToHand(me, 'JAIL_732');
        break;
      }
      case 'wardenMaiev': {
        const target = ctx.it?.kind === 'char' ? this.minion(ctx.it.uid) : null;
        if (!target || (target.dormantTurns ?? 0) > 0) break;
        target.atkBuff += 3;
        target.maxHp += 3;
        target.hp += 3;
        target.dormantTurns = 1;
        target.sleeping = true;
        target.attacks = 0;
        this.recalcAuras();
        break;
      }
      case 'demonicConfinement': {
        if (ctx.chosen === null) break;
        const target = this.minion(ctx.chosen);
        if (!target) break;
        const races = getCard(target.cardId).races ?? [];
        if (target.owner === ctx.controller && (races.includes('DEMON') || races.includes('ALL'))) {
          target.atkBuff += 3;
          target.maxHp += 3;
          target.hp += 3;
        } else {
          target.dormantTurns = 2;
          target.sleeping = true;
          target.attacks = 0;
        }
        this.recalcAuras();
        break;
      }
      case 'wantedPoster': {
        const opts = this.discoverOptions({ type: 'MINION', minCost: 5 }, ctx.controller);
        if (!opts.length) break;
        const id = yield* this.choose(ctx, opts, '發現一個 5 費以上的手下');
        const h = this.addToHand(me, id);
        if (h) h.grantedPrepare = true;
        break;
      }
      case 'infestScullery': {
        const tier = Math.max(1, Math.min(10, 2 + (me.heroAttacksThisGame ?? 0)));
        const pool = this.randomPool({ type: 'MINION', cost: tier }, ctx.controller, false);
        for (let i = 0; i < 2; i++) {
          const card = pick(s, pool);
          if (card) yield* this.summon(me.id, card.id);
        }
        break;
      }
      case 'ratBurglar': {
        const stolen = foe.hand.filter((h) => h.enteredTurn === s.turn);
        for (const h of stolen) {
          foe.hand.splice(foe.hand.indexOf(h), 1);
          this.enterHandCard(me, h);
        }
        if (stolen.length) this.log(me.id, `${this.name('JAIL_205')}偷走了 ${stolen.length} 張牌`);
        break;
      }
      case 'drawGeneratedSpell': {
        const candidates = me.deck.filter((h) => getCard(h.cardId).type === 'SPELL' && !h.startedInDeck);
        const h = pick(s, candidates);
        if (h) {
          me.deck.splice(me.deck.indexOf(h), 1);
          this.enterHandCard(me, h);
        }
        break;
      }
      case 'mindSweeper': {
        if (ctx.sourceHandCard?.opponentCopyPlayedSeen) {
          yield* this.runEffects([{ e: 'damage', target: { t: 'all', filter: { type: 'minion', side: 'enemy' } }, amount: 2 }], ctx);
        }
        break;
      }
      case 'discountCopiedOpponent': {
        for (const h of me.hand) if (h.copiedFromOpponent) h.costMod -= 1;
        break;
      }
      case 'rampagingHound': {
        const self = ctx.sourceUid !== null ? this.minion(ctx.sourceUid) : null;
        if (!self) break;
        for (const enemy of [...foe.board]) {
          if (!this.alive(enemy) || (enemy.dormantTurns ?? 0) > 0 || !this.alive(self)) continue;
          const enemyAtk = this.atkOf(enemy);
          const selfAtk = this.atkOf(self);
          yield* this.damage(this.charSource(enemy), self.uid, enemyAtk);
          if (selfAtk > 0 && this.alive(enemy)) yield* this.damage(this.charSource(self), enemy.uid, selfAtk);
          yield* this.processDeaths();
        }
        break;
      }
      case 'impGangStooge': {
        // 「put on bottom」不是 shuffle；陣列 index 0 是牌庫底部。
        me.deck.unshift(this.newHandCard('JAIL_399t1'), this.newHandCard('JAIL_399t1'));
        break;
      }
      case 'enableSorry':
        me.canSaySorry = true;
        break;
      case 'counter':
        this.spellCountered = true;
        break;
      case 'preventFatal':
        break;
      case 'resurrect':
        if (ctx.itCardId) {
          const m = yield* this.summon(ctx.controller, ctx.itCardId);
          if (m) m.hp = 1;
        }
        break;
      case 'redirectSummon': {
        const m = yield* this.summon(ctx.controller, args.card as string);
        if (m && this.currentAttack) this.currentAttack.defender = m.uid;
        break;
      }
      case 'summonOneOf': {
        const id = pick(s, args.cards as string[]);
        if (id) yield* this.doSummon(ctx, ctx.controller, id);
        break;
      }
      case 'addOneOf': {
        const id = pick(s, args.cards as string[]);
        if (id) this.addToHand(me, id);
        break;
      }
      // ------------------------------------------------------------ 死亡騎士
      case 'corpseExplosion': {
        // 屍爆術：引爆一具屍體對所有手下造成傷害；若還有手下存活就重複
        const n = 1 + (ctx.isSpell ? this.spellDamage(ctx.controller) : 0);
        const src = this.dmgSource(ctx);
        for (let loop = 0; loop < 30 && this.spendCorpses(me, 1); loop++) {
          for (const m of this.chars().filter((c) => !isHero(c) && this.alive(c))) yield* this.damage(src, m.uid, n);
          yield* this.processDeaths();
          if (this.over || !this.chars().some((c) => !isHero(c) && this.alive(c))) break;
        }
        break;
      }
      case 'corpseFarm': {
        // 屍體農場：召喚一個消耗等同花費屍體數的隨機手下
        const n = args.n as number;
        const id = n > 0 ? pick(s, this.randomPool({ type: 'MINION', cost: n }, ctx.controller, false))?.id : undefined;
        if (id) yield* this.doSummon(ctx, ctx.controller, id);
        break;
      }
      case 'marrowgar': {
        // 骨煞領主馬洛加：每具屍體一個 1/1 魔像，放不下的每具給其中一個 +2/+2
        const n = args.n as number;
        const golems: Minion[] = [];
        let extra = 0;
        for (let i = 0; i < n; i++) {
          const m = this.boardSpaceUsed(me.id) < MAX_BOARD ? yield* this.doSummon(ctx, ctx.controller, 'RLK_085t') : null;
          if (m) golems.push(m);
          else extra++;
        }
        for (let i = 0; i < extra && golems.length; i++) {
          const g = pick(s, golems)!;
          g.atkBuff += 2;
          g.maxHp += 2;
          g.hp += 2;
        }
        break;
      }
      case 'corpseBride': {
        // 屍體新娘：召喚一個攻擊力與生命值等同花費屍體數的嘲諷新郎
        const n = args.n as number;
        if (n <= 0) break;
        const m = yield* this.doSummon(ctx, ctx.controller, 'RLK_506t');
        if (m) {
          m.baseAtk = n;
          m.baseHp = n;
          m.maxHp = n + m.auraHp;
          m.hp = m.maxHp;
        }
        break;
      }
      // ------------------------------------------------------------ 死亡騎士（第二批）
      case 'chowDown': {
        // 狼吞虎嚥：召喚五個 5/4 飛龍；消耗 8 具屍體讓它們獲得突襲
        const drakes: Minion[] = [];
        for (let i = 0; i < 5; i++) {
          const m = yield* this.doSummon(ctx, me.id, 'CATA_465t');
          if (m) drakes.push(m);
        }
        if (drakes.length && this.spendCorpses(me, 8)) for (const m of drakes) m.keywords.push('RUSH');
        break;
      }
      case 'consumption': {
        // 吞噬：對兩個隨機敵方手下造成 3 點傷害，每死一個抽一張牌
        const n = 3 + this.spellDamage(me.id);
        const src = this.dmgSource(ctx);
        const targets = shuffle(s, foe.board.filter((m) => this.alive(m))).slice(0, 2);
        for (const t of targets) yield* this.damage(src, t.uid, n);
        const died = targets.filter((t) => t.hp <= 0 || t.dead).length;
        yield* this.processDeaths();
        if (died) yield* this.draw(me, died);
        break;
      }
      case 'soulstealer': {
        // 竊魂者：消滅其他所有手下，每消滅一個敵方手下獲得 1 具屍體
        let enemies = 0;
        for (const m of [...me.board, ...foe.board]) {
          if (m.uid === ctx.sourceUid || !this.alive(m)) continue;
          m.dead = true;
          if (m.owner !== me.id) enemies++;
        }
        this.gainCorpses(me, enemies);
        break;
      }
      case 'destroyHighestAttack': {
        // 窒息術：消滅攻擊力最高的敵方手下
        const list = foe.board.filter((m) => this.alive(m));
        const top = Math.max(-1, ...list.map((m) => this.atkOf(m)));
        const m = pick(s, list.filter((x) => this.atkOf(x) === top));
        if (m) m.dead = true;
        break;
      }
      case 'fillBoardRandom': {
        // 天譴軍團：用隨機不死族填滿你的場面
        const pool = this.randomPool({ type: 'MINION', race: args.race as Race }, me.id, false);
        for (let i = 0; i < MAX_BOARD && this.boardSpaceUsed(me.id) < MAX_BOARD; i++) {
          const c = pick(s, pool);
          if (c) yield* this.doSummon(ctx, me.id, c.id);
        }
        break;
      }
      case 'afterHeroKill': {
        // 破魂者：英雄攻擊並消滅手下後獲得屍體
        if (this.lastAttack?.killed) this.gainCorpses(me, args.corpses as number);
        break;
      }
      case 'afterHeroHitMinion': {
        // 碎骨者：英雄攻擊手下後，對敵方英雄造成傷害
        if (this.lastAttack && !this.lastAttack.defenderIsHero) yield* this.damage(this.dmgSource(ctx), foe.hero.uid, args.amount as number);
        break;
      }
      case 'frostmourne': {
        // 霜之哀傷：召喚所有被這把武器消滅的手下
        for (const id of ctx.weapon?.killed ?? []) yield* this.doSummon(ctx, me.id, id);
        break;
      }
      case 'emergencySurgery': {
        // 緊急手術：召喚四個 3/1 生命竊取的不死族，攻擊所選的敵方手下
        const target = ctx.chosen;
        for (let i = 0; i < 4; i++) {
          const m = yield* this.doSummon(ctx, me.id, 'JAIL_454t');
          const t = target !== null ? this.char(target) : null;
          if (!m || !t || !this.alive(t)) continue;
          yield* this.doAttack(m.uid, t.uid);
          yield* this.processDeaths();
          if (this.over) return;
        }
        break;
      }
      case 'triggerDeathrattle': {
        // 嚎叫約德爾歌手：觸發一個友方手下的亡語（兩次）
        const m = ctx.chosen !== null ? this.minion(ctx.chosen) : null;
        if (!m || m.silenced) break;
        for (let i = 0; i < ((args.times as number) ?? 1); i++) yield* this.runDeathrattles(m);
        break;
      }
      case 'deadAir': {
        // 死亡斷訊：消滅你的不死族，再重新召喚它們
        const undead = me.board.filter((m) => this.alive(m) && this.isRace(m.cardId, 'UNDEAD'));
        for (const m of undead) m.dead = true;
        yield* this.processDeaths();
        if (this.over) return;
        for (const m of undead) yield* this.doSummon(ctx, me.id, m.cardId);
        break;
      }
      case 'patchwerk': {
        // 縫補者：消滅對手手牌、牌堆、戰場上各一個隨機手下
        const isMinion = (h: HandCard) => getCard(h.cardId).type === 'MINION';
        const inHand = pick(s, foe.hand.filter(isMinion));
        if (inHand) {
          foe.hand = foe.hand.filter((h) => h !== inHand);
          this.recombineShatter(foe);
        }
        const inDeck = pick(s, foe.deck.filter(isMinion));
        if (inDeck) foe.deck = foe.deck.filter((h) => h !== inDeck);
        const onBoard = pick(s, foe.board.filter((m) => this.alive(m)));
        if (onBoard) onBoard.dead = true;
        this.log(me.id, `縫補者消滅了對手${[inHand, inDeck].filter(Boolean).map((h) => this.name(h!.cardId)).join('、') || '的手下'}`);
        break;
      }
      case 'returnCostsHealth': {
        // 死亡使者薩魯法爾：回到手牌，改為消耗生命值
        const hc = this.addToHand(me, ctx.sourceCardId);
        if (hc) hc.healthCostUntil = 1e9;
        break;
      }
      case 'frigidara': {
        // 監督者弗力吉達拉：抽兩張法術，若都是冰霜法術，對全部敵人造成 2 點傷害
        const drawn = yield* this.draw(me, 2, { type: 'SPELL' });
        if (drawn.length === 2 && drawn.every((h) => getCard(h.cardId).spellSchool === 'FROST')) {
          const src = this.dmgSource(ctx);
          for (const c of [foe.hero, ...foe.board]) if (this.alive(c)) yield* this.damage(src, c.uid, 2);
        }
        break;
      }
      case 'discountRandomSpell': {
        const hc = pick(s, me.hand.filter((h) => getCard(h.cardId).type === 'SPELL'));
        if (hc) hc.costMod -= (args.amount as number) ?? 1;
        break;
      }
      case 'debuff': {
        // 屈辱之盔：-5/-5
        const m = ctx.chosen !== null ? this.minion(ctx.chosen) : null;
        if (!m) break;
        const a = args.atk as number;
        const h = args.hp as number;
        m.atkBuff -= a;
        m.maxHp = Math.max(0, m.maxHp - h);
        m.hp = Math.min(m.hp, m.maxHp);
        if (m.maxHp <= 0 || m.hp <= 0) m.dead = true;
        break;
      }
      case 'attackPerSpellSchool': {
        // 依米亞破霜者：手中每有一張冰霜法術 +1 攻擊力
        const m = ctx.sourceUid !== null ? this.minion(ctx.sourceUid) : null;
        const n = me.hand.filter((h) => getCard(h.cardId).spellSchool === args.school).length;
        if (m && n) m.atkBuff += n;
        break;
      }
      case 'meatGrinder': {
        // 絞肉機：絞碎牌堆中一個隨機手下，獲得 4 具屍體
        const hc = pick(s, me.deck.filter((h) => getCard(h.cardId).type === 'MINION'));
        if (!hc) break;
        me.deck = me.deck.filter((h) => h !== hc);
        this.gainCorpses(me, 4);
        this.log(me.id, `絞碎了牌堆中的${this.name(hc.cardId)}`);
        break;
      }
      case 'plagueTick': {
        // 沸血術的感染：受到傷害，施放者的英雄回復等量生命值
        const m = ctx.sourceUid !== null ? this.minion(ctx.sourceUid) : null;
        if (!m || !this.alive(m)) break;
        yield* this.damage({ owner: foe.id, uid: null, lifesteal: true }, m.uid, args.amount as number);
        break;
      }
      case 'giveAttackEqualSelf': {
        // 惡毒血蟲 / 恐怖夢魘：手牌（或戰場）中一個手下獲得等同此手下的攻擊力
        const self = ctx.sourceUid !== null ? this.minion(ctx.sourceUid) : null;
        const n = self ? this.atkOf(self) : 0;
        if (!n) break;
        const hand = me.hand.filter((h) => getCard(h.cardId).type === 'MINION');
        const board = args.board ? me.board.filter((m) => m !== self && this.alive(m)) : [];
        const i = randomInt(s, hand.length + board.length);
        if (i < hand.length) hand[i].atkBuff += n;
        else if (board.length) board[i - hand.length].atkBuff += n;
        break;
      }
      case 'copySpellSchoolInHand': {
        // 亡語女士：複製你手中所有的冰霜法術
        for (const h of me.hand.filter((x) => getCard(x.cardId).spellSchool === args.school)) this.addToHand(me, h.cardId);
        break;
      }
      case 'attackLowestEnemy': {
        // 地精嚼食者：攻擊生命值最低的敵人
        const m = ctx.sourceUid !== null ? this.minion(ctx.sourceUid) : null;
        if (!m || !this.alive(m)) break;
        const enemies = [foe.hero, ...foe.board].filter((c) => this.alive(c));
        const low = Math.min(...enemies.map((c) => c.hp));
        const t = pick(s, enemies.filter((c) => c.hp === low));
        if (t) {
          yield* this.doAttack(m.uid, t.uid);
          m.attacks = Math.max(0, m.attacks - 1);
        }
        break;
      }
      case 'unholyFrenzy': {
        // 穢邪狂亂：你的手下攻擊所選的敵方手下，死掉的再召喚回來
        const t = ctx.chosen;
        const died: string[] = [];
        for (const m of [...me.board]) {
          const target = t !== null ? this.char(t) : null;
          if (!target || !this.alive(target) || !this.alive(m)) continue;
          yield* this.doAttack(m.uid, target.uid);
          m.attacks = Math.max(0, m.attacks - 1);
          if (!this.alive(m)) died.push(m.cardId);
        }
        yield* this.processDeaths();
        if (this.over) return;
        for (const id of died) yield* this.doSummon(ctx, me.id, id);
        break;
      }
      case 'fillHandHealthCost': {
        // 被遺忘的千年：用隨機不死族填滿手牌，本回合消耗生命值
        const pool = this.randomPool({ type: 'MINION', race: 'UNDEAD' }, me.id, false);
        while (me.hand.length < MAX_HAND) {
          const c = pick(s, pool);
          if (!c) break;
          const hc = this.addToHand(me, c.id);
          if (hc) hc.healthCostUntil = s.turn;
        }
        break;
      }
      case 'summonBestFromGraveyard': {
        // 回憶顯化：召喚本場對戰中死亡、消耗最高的友方不死族
        const list = me.graveyard.filter((id) => this.isRace(id, 'UNDEAD'));
        const top = Math.max(-1, ...list.map((id) => getCard(id).cost));
        const id = pick(s, list.filter((x) => getCard(x).cost === top));
        if (id) yield* this.doSummon(ctx, me.id, id);
        break;
      }
      case 'paleomancy': {
        // 古生物死靈術：發現一個不死族；消耗 5 具屍體改為三張都拿
        const opts = this.discoverOptions({ type: 'MINION', race: 'UNDEAD' }, me.id);
        if (!opts.length) break;
        if (this.spendCorpses(me, 5)) {
          for (const id of opts) this.addToHand(me, id);
          break;
        }
        const id = yield* this.choose(ctx, opts, '發現一個不死族');
        this.addToHand(me, id);
        break;
      }
      case 'freezeOrShatter': {
        // 霜凍掠劫者：冰凍 3 個隨機敵人，已經被冰凍的改為受到 5 點傷害
        const src = this.dmgSource(ctx);
        const list = shuffle(s, [foe.hero, ...foe.board].filter((c) => this.alive(c))).slice(0, 3);
        for (const c of list) {
          if (c.frozen) yield* this.damage(src, c.uid, 5);
          else this.freeze(c);
        }
        break;
      }
      case 'returnAtEndOfTurn':
        (me.endOfTurnCards ??= []).push(ctx.sourceCardId);
        break;
      case 'summonAndAttackRandom': {
        // 食屍鬼之夜：召喚五個 1/1 食屍鬼，各自攻擊隨機敵人
        for (let i = 0; i < (args.count as number); i++) {
          const m = yield* this.doSummon(ctx, me.id, args.card as string);
          const t = pick(s, [foe.hero, ...foe.board].filter((c) => this.alive(c)));
          if (!m || !t) continue;
          yield* this.doAttack(m.uid, t.uid);
          yield* this.processDeaths();
          if (this.over) return;
        }
        break;
      }
      case 'discoverFromDeck': {
        // 靈魂搜尋 / 北境導覽：從你的牌堆發現一張卡
        const type = args.type as CardType | undefined;
        const cards = me.deck.filter((h) => !type || getCard(h.cardId).type === type);
        const opts: HandCard[] = [];
        for (const h of shuffle(s, [...cards])) {
          if (opts.length >= 3) break;
          if (!opts.some((o) => getCard(o.cardId).name === getCard(h.cardId).name)) opts.push(h);
        }
        if (!opts.length) break;
        const id = yield* this.choose(ctx, opts.map((h) => h.cardId), '從你的牌堆發現一張卡');
        const hc = opts.find((h) => h.cardId === id)!;
        me.deck = me.deck.filter((h) => h !== hc);
        this.enterHandCard(me, hc);
        if (args.copyCorpses && this.spendCorpses(me, args.copyCorpses as number)) this.addToHand(me, id);
        if (args.frostFreeze && getCard(id).spellSchool === 'FROST') {
          const m = pick(s, foe.board.filter((x) => this.alive(x)));
          if (m) this.freeze(m);
        }
        break;
      }
      case 'spreadDeathrattle': {
        // 死亡咆哮：把一個手下的亡語擴散到相鄰的手下
        const m = ctx.chosen !== null ? this.minion(ctx.chosen) : null;
        if (!m || m.silenced) break;
        const drs = m.abilities.filter((a) => a.on.k === 'deathrattle');
        for (const n of this.adjacent(m)) n.abilities.push(...structuredClone(drs));
        break;
      }
      case 'boneshredder': {
        // 骸骨速彈手：消耗 5 具屍體，觸發並獲得一個本場死亡的友方手下的亡語
        const self = ctx.sourceUid !== null ? this.minion(ctx.sourceUid) : null;
        const list = me.graveyard.filter((id) => getCard(id).abilities?.some((a) => a.on.k === 'deathrattle'));
        if (!self || !list.length || !this.spendCorpses(me, 5)) break;
        const id = pick(s, list)!;
        const drs = structuredClone((getCard(id).abilities ?? []).filter((a) => a.on.k === 'deathrattle'));
        self.abilities.push(...drs);
        this.log(me.id, `獲得了${this.name(id)}的亡語`);
        yield* this.runDeathrattles(self, drs);
        break;
      }
      case 'refreshManaByAttack': {
        // 炫彩育母：攻擊時回復等同攻擊力的法力水晶
        const m = ctx.sourceUid !== null ? this.minion(ctx.sourceUid) : null;
        if (m) me.mana = Math.min(me.maxMana, me.mana + this.atkOf(m));
        break;
      }
      case 'ursoc': {
        // 厄索克：攻擊其他所有手下，記住消滅的手下
        const self = ctx.sourceUid !== null ? this.minion(ctx.sourceUid) : null;
        if (!self) break;
        const src = this.charSource(self);
        for (const m of [...foe.board, ...me.board]) {
          if (m === self || !this.alive(m) || !this.alive(self)) continue;
          this.fx({ kind: 'attack', uid: self.uid, target: m.uid, player: me.id });
          yield* this.damage(src, m.uid, this.atkOf(self));
          const back = this.atkOf(m);
          if (back > 0) yield* this.damage(this.charSource(m), self.uid, back);
          if (!this.alive(m)) (self.killed ??= []).push(m.cardId);
        }
        break;
      }
      case 'resurrectKilled': {
        for (const id of ctx.sourceSnapshot?.killed ?? []) yield* this.doSummon(ctx, me.id, id);
        break;
      }
      case 'airlockBreach': {
        // 氣閘破口：召喚 5/5 嘲諷不死族，英雄 +5 生命值；消耗 5 具屍體再來一次
        for (let i = 0; i < 2; i++) {
          if (i === 1 && !this.spendCorpses(me, 5)) break;
          yield* this.doSummon(ctx, me.id, 'GDB_113t');
          yield* this.runEffect({ e: 'heroMaxHealth', amount: 5 }, ctx);
        }
        break;
      }
      case 'resurrectDeathrattle': {
        // 靈魂喚醒者：復活另一個友方亡語手下
        const selfName = getCard(ctx.sourceCardId).nameEn;
        const list = me.graveyard.filter((id) => getCard(id).nameEn !== selfName && getCard(id).abilities?.some((a) => a.on.k === 'deathrattle'));
        const id = pick(s, list);
        if (id) yield* this.doSummon(ctx, me.id, id);
        break;
      }
      case 'eightHands': {
        // 來自異界的8隻手：雙方的牌堆只留下消耗最高的 8 張
        for (const pl of s.players) {
          const sorted = shuffle(s, [...pl.deck]).sort((a, b) => getCard(b.cardId).cost - getCard(a.cardId).cost);
          const keep = new Set(sorted.slice(0, 8));
          pl.deck = pl.deck.filter((h) => keep.has(h));
        }
        break;
      }
      case 'discoverSummon': {
        // 同化疫病 / 昂布拉的故事：發現一個手下並直接召喚
        const minCost = (args.minCost as number) ?? 0;
        const pool = this.randomPool({ type: 'MINION', hasDeathrattle: true, cost: args.cost as number | undefined }, me.id, false).filter((c) => c.cost >= minCost);
        const opts = this.discoverOptions(undefined, me.id, pool);
        if (!opts.length) break;
        const id = yield* this.choose(ctx, opts, '發現一個亡語手下');
        const m = yield* this.doSummon(ctx, me.id, id);
        if (!m) break;
        if (args.reborn && !m.keywords.includes('REBORN')) m.keywords.push('REBORN');
        if (args.trigger) yield* this.runDeathrattles(m);
        break;
      }
      case 'giftOf': {
        // 阿薩斯的禮物：發現其中一張暫時的卡
        const opts = (args.cards as string[]).filter((id) => hasCard(id));
        if (!opts.length) break;
        const id = yield* this.choose(ctx, opts, '發現一張卡牌');
        const hc = this.addToHand(me, id);
        if (hc) hc.temporary = true;
        break;
      }
      case 'summonSoulFromEvent': {
        // 尖嘯女妖：召喚攻擊力與生命值等同回復量的靈魂
        const n = ctx.eventAmount;
        if (n <= 0) break;
        const m = yield* this.doSummon(ctx, me.id, args.card as string);
        if (m) {
          m.baseAtk = n;
          m.baseHp = n;
          m.maxHp = n + m.auraHp;
          m.hp = m.maxHp;
        }
        break;
      }
      case 'shufflePlagues': {
        // 將隨機瘟疫洗入對手的牌堆
        for (let i = 0; i < (args.count as number); i++) {
          const id = pick(s, PLAGUES)!;
          foe.deck.splice(randomInt(s, foe.deck.length + 1), 0, this.newHandCard(id));
          me.plaguesShuffled = (me.plaguesShuffled ?? 0) + 1;
        }
        break;
      }
      case 'destroyPlague': {
        // 叛墓者：消滅對手牌堆中的一張瘟疫，對全部敵方手下造成 3 點傷害
        const plague = pick(s, foe.deck.filter((h) => PLAGUES.includes(h.cardId)));
        if (!plague) break;
        foe.deck = foe.deck.filter((h) => h !== plague);
        const src = this.dmgSource(ctx);
        for (const m of foe.board) if (this.alive(m)) yield* this.damage(src, m.uid, 3);
        break;
      }
      case 'spendCorpsesForStats': {
        // 弗柯羅斯：花費 10 / 20 / 30 具屍體獲得等量的屬性值（自動選能付得起的最大值）
        const self = ctx.sourceUid !== null ? this.minion(ctx.sourceUid) : null;
        if (!self) break;
        const n = [30, 20, 10].find((x) => (me.corpses ?? 0) >= x);
        if (!n || !this.spendCorpses(me, n)) break;
        self.atkBuff += n;
        self.maxHp += n;
        self.hp += n;
        break;
      }
      case 'yseraAwakens': {
        // 伊瑟拉之覺醒：對伊瑟拉以外的所有角色造成傷害
        const n = (args.amount as number) + (ctx.isSpell ? this.spellDamage(ctx.controller) : 0);
        const src = this.dmgSource(ctx);
        for (const c of this.chars()) {
          if (!this.alive(c) || (!isHero(c) && getCard(c.cardId).nameEn.startsWith('Ysera'))) continue;
          yield* this.damage(src, c.uid, n);
        }
        break;
      }
      case 'nightmare': {
        // 夢魘：+5/+5，並在施放者的下個回合開始時消滅它
        const m = ctx.chosen !== null ? this.minion(ctx.chosen) : null;
        if (!m) break;
        yield* this.runEffect({ e: 'buff', target: { t: 'chosen' }, atk: 5, hp: 5 }, ctx);
        m.abilities.push({ on: { k: 'turnStart', whose: m.owner === ctx.controller ? 'mine' : 'opp' }, effects: [{ e: 'destroy', target: { t: 'self' } }] });
        break;
      }
      case 'totemicCall': {
        const options = BASIC_TOTEMS.filter((t) => !me.board.some((m) => m.cardId === t));
        const id = pick(s, options);
        if (id) yield* this.summon(ctx.controller, id);
        break;
      }
      case 'attackEqualsHealth':
        for (const uid of this.resolve({ t: 'chosen' }, ctx)) {
          const m = this.minion(uid);
          if (m) m.atkBuff += m.hp - this.atkOf(m);
        }
        break;
      case 'bladeFlurry': {
        const w = me.weapon;
        if (!w) break;
        const dmg = w.atk;
        me.weapon = null;
        yield* this.weaponDestroyed(w);
        for (const m of [...foe.board]) yield* this.damage({ owner: me.id, uid: null }, m.uid, dmg);
        break;
      }
      case 'setHeroHealth':
        for (const uid of this.resolve({ t: 'chosen' }, ctx)) {
          const h = this.char(uid);
          if (h && isHero(h)) {
            h.hp = args.hp as number;
            if (h.hp > h.maxHp) h.maxHp = h.hp;
          }
        }
        break;
      case 'fillBoard':
        while (this.boardSpaceUsed(me.id) < MAX_BOARD) {
          const m = yield* this.doSummon(ctx, ctx.controller, args.card as string);
          if (!m) break;
        }
        break;
      case 'destroyWeaponDraw': {
        const w = foe.weapon;
        if (!w) break;
        const n = w.durability;
        foe.weapon = null;
        yield* this.weaponDestroyed(w);
        yield* this.draw(me, n);
        break;
      }
      case 'stealIfFour':
        if (foe.board.filter((m) => this.alive(m)).length >= 4) {
          const m = pick(s, foe.board.filter((x) => this.alive(x)));
          if (m) yield* this.runEffect({ e: 'steal', target: { t: 'it' } }, { ...ctx, it: { kind: 'char', uid: m.uid } });
        }
        break;
      case 'transformRandomOther': {
        const others = this.chars().filter((c) => !isHero(c) && this.alive(c) && c.uid !== ctx.sourceUid);
        const t = pick(s, others);
        const into = pick(s, args.cards as string[]);
        if (t && into) this.transform(t.uid, into);
        break;
      }
      // ------------------------------------------------------------ 比武 / 滅殺 / 號召 / 翠玉
      case 'drawRevealed': {
        // 抽出比武揭露的那張牌
        const hc = me.deck.find((h) => h.uid === ctx.revealed);
        if (!hc) break;
        me.deck.splice(me.deck.indexOf(hc), 1);
        if (me.hand.length >= MAX_HAND) {
          this.fx({ kind: 'burn', cardId: hc.cardId, player: me.id });
          break;
        }
        this.enterHandCard(me, hc);
        me.drawnThisTurn++;
        break;
      }
      case 'attackAgain':
        // 蘇薩斯：你可以再攻擊一次
        me.hero.attacks = Math.max(0, me.hero.attacks - 1);
        break;
      case 'summonFromHand': {
        // 從手牌召喚一個（某種族的）手下
        const race = args.race as Race | undefined;
        const hc = pick(
          s,
          me.hand.filter((h) => {
            const d = this.handDef(h);
            return d.type === 'MINION' && (!race || !!d.races?.includes(race) || !!d.races?.includes('ALL'));
          }),
        );
        if (!hc || this.boardSpaceUsed(me.id) >= MAX_BOARD) break;
        me.hand = me.hand.filter((h) => h !== hc);
        this.recombineShatter(me);
        const m = this.makeMinion(me.id, hc.cardId, hc);
        me.board.push(m);
        this.recalcAuras();
        this.countSummon(me, hc.cardId);
        this.log(me.id, `從手牌召喚了${this.name(hc.cardId)}`);
        yield* this.emit({ k: 'summon', player: me.id, subject: m.uid, races: getCard(hc.cardId).races });
        break;
      }
      case 'oakheart':
        // 橡心大師：號召攻擊力 1、2、3 的手下各一個
        for (const atk of [1, 2, 3]) {
          if (this.boardSpaceUsed(me.id) >= MAX_BOARD) break;
          const hc = pick(s, me.deck.filter((h) => getCard(h.cardId).type === 'MINION' && getCard(h.cardId).attack === atk));
          if (!hc) continue;
          me.deck.splice(me.deck.indexOf(hc), 1);
          this.log(me.id, `號召了${this.name(hc.cardId)}`);
          yield* this.doSummon(ctx, ctx.controller, hc.cardId);
        }
        break;
      case 'jadeTelegram': {
        // 翠玉通訊：看對手手牌中的 3 張牌，把其中一張洗進他的牌堆
        const options = shuffle(s, [...foe.hand]).slice(0, 3);
        if (!options.length) break;
        const i = yield { player: ctx.controller, kind: 'discover', options: options.map((h) => h.cardId), title: '選擇一張洗回對手的牌堆' };
        const hc = options[Math.max(0, Math.min(options.length - 1, i ?? 0))];
        foe.hand = foe.hand.filter((h) => h !== hc);
        this.recombineShatter(foe);
        foe.deck.splice(randomInt(s, foe.deck.length + 1), 0, hc);
        break;
      }
      // ------------------------------------------------------------ 星艦
      case 'triggerRandomDeathrattle': {
        // 觸發一個隨機友方手下的亡語
        const list = me.board.filter((m) => this.alive(m) && !m.silenced && m.abilities.some((a) => a.on.k === 'deathrattle'));
        const m = pick(s, list);
        if (!m) break;
        this.log(me.id, `觸發了${this.name(m.cardId)}的亡語`);
        const dctx: Ctx = { ...this.baseCtx(m.owner), sourceUid: m.uid, sourceCardId: m.cardId, sourceSnapshot: m };
        for (const ab of m.abilities) {
          if (ab.on.k !== 'deathrattle' || (ab.cond && !this.evalCond(ab.cond, dctx))) continue;
          yield* this.runEffects(ab.effects, dctx);
        }
        break;
      }
      case 'attackIt': {
        // 此手下攻擊觸發事件的對象（不消耗攻擊次數）
        const src = ctx.sourceUid !== null ? this.minion(ctx.sourceUid) : null;
        const t = ctx.it?.kind === 'char' ? this.char(ctx.it.uid) : null;
        if (!src || !t || !this.alive(src) || !this.alive(t) || src.owner === t.owner) break;
        yield* this.doAttack(src.uid, t.uid);
        src.attacks = Math.max(0, src.attacks - 1);
        break;
      }
      case 'recastIt':
        if (ctx.itCardId) yield* this.castRandomly(ctx.controller, ctx.itCardId);
        break;
      case 'summonCostEqualAttack': {
        const atk = Math.min(10, this.dyn('selfAttack', ctx));
        const id = pick(s, this.randomPool({ type: 'MINION', cost: atk }, ctx.controller, false))?.id;
        if (id) yield* this.doSummon(ctx, ctx.controller, id);
        break;
      }
      case 'exodar': {
        // 艾克索達：發射星艦，然後選擇一個協定
        const ship = yield* this.launch(ctx.controller, true);
        if (!ship) break;
        const options = ['GDB_100a', 'GDB_100b', 'GDB_100c'];
        const i = yield { player: ctx.controller, kind: 'discover', options, title: '選擇一個協定' };
        const alive = this.minion(ship.uid);
        const atk = alive ? this.atkOf(alive) : this.atkOf(ship);
        const hp = alive ? alive.hp : ship.hp;
        switch (options[i ?? 0]) {
          case 'GDB_100a':
            me.hero.armor += hp * 2;
            this.fx({ kind: 'armor', uid: me.hero.uid, amount: hp * 2 });
            break;
          case 'GDB_100b':
            yield* this.runEffect({ e: 'splitDamage', filter: { type: 'character', side: 'enemy' }, amount: atk }, { ...ctx, sourceUid: ship.uid });
            break;
          case 'GDB_100c':
            for (const piece of ship.starship ?? []) {
              const hc = this.addToHand(me, piece.id);
              if (hc) hc.costMod = 1 - getCard(piece.id).cost;
            }
            break;
        }
        break;
      }
      case 'relaunchAll':
        // 吉姆‧雷諾：重新發射本場對戰中發射過的每一艘星艦
        for (const pieces of [...(me.launched ?? [])]) {
          if (this.boardSpaceUsed(me.id) >= MAX_BOARD) break;
          yield* this.summonStarship(me.id, pieces, true);
          if (this.over) return;
        }
        break;
      case 'warpDrive': {
        const drawn = yield* this.draw(me, 2);
        if (me.starship?.length) for (const hc of drawn) hc.costMod -= 2;
        break;
      }
      case 'suffocate': {
        const m = ctx.chosen !== null ? this.minion(ctx.chosen) : null;
        if (!m) break;
        if (me.starship?.length) {
          const n = pick(s, this.adjacent(m));
          if (n) n.dead = true;
        }
        m.dead = true;
        break;
      }
      case 'othaar': {
        const spells = shuffle(s, this.randomPool({ type: 'SPELL', spellSchool: 'ARCANE' }, ctx.controller, false).map((c) => c.id)).slice(0, 3);
        for (const id of spells) {
          const hc = this.addToHand(me, id);
          if (hc) hc.costMod -= 2;
        }
        break;
      }
      case 'destroyLowestInOppHand': {
        if (!foe.hand.length) break;
        const low = Math.min(...foe.hand.map((h) => this.costOf(foe, h)));
        const hc = pick(s, foe.hand.filter((h) => this.costOf(foe, h) === low));
        if (!hc) break;
        foe.hand = foe.hand.filter((h) => h !== hc);
        this.recombineShatter(foe);
        this.log(me.id, `摧毀了對手手牌中的${this.name(hc.cardId)}`);
        break;
      }
      case 'siegeTank': {
        // 作戰中的攻城坦克：對隨機敵方手下造成 10 點傷害，多餘的傷害打到敵方英雄
        const t = pick(s, foe.board.filter((m) => this.alive(m)));
        if (!t) break;
        const excess = Math.max(0, 10 - t.hp);
        const src = this.dmgSource(ctx);
        yield* this.damage(src, t.uid, 10);
        if (excess > 0) yield* this.damage(src, foe.hero.uid, excess);
        break;
      }
      case 'bladeOfCthun': {
        // 克蘇恩之刃：消滅一個手下，把它的攻擊力和生命值加到你的克蘇恩
        const m = ctx.chosen !== null ? this.minion(ctx.chosen) : null;
        if (!m) break;
        const atk = this.atkOf(m);
        const hp = Math.max(0, m.hp);
        m.dead = true;
        this.cthunBuff(me.id, atk, hp, false);
        break;
      }
      case 'cthunRevive': {
        // 厄運召喚者：克蘇恩已經死亡的話，把它洗入你的牌堆（保留所有加成）
        const alive = [...me.hand, ...me.deck, ...me.board].some((c) => isCthun(c.cardId));
        const deadId = me.graveyard.find((id) => isCthun(id));
        if (alive || !deadId) break;
        const hc = this.newHandCard(deadId);
        me.deck.splice(randomInt(s, me.deck.length + 1), 0, hc);
        this.log(me.id, '克蘇恩被洗回了牌堆');
        break;
      }
      case 'buildABeast': {
        // 製造殭屍獸：先發現一張獵人野獸，再發現一張殭屍獸專用野獸，縫合後加入手牌
        const first = shuffle(s, this.randomPool({ type: 'MINION', race: 'BEAST', cls: 'HUNTER', maxCost: 5 }, ctx.controller, false).map((c) => c.id)).slice(0, 3);
        const second = shuffle(s, [...ZOMBEAST_PARTS]).slice(0, 3);
        if (!first.length) break;
        const i1 = yield { player: ctx.controller, kind: 'discover', options: first, title: '製造殭屍獸：選擇第一隻野獸' };
        const i2 = yield { player: ctx.controller, kind: 'discover', options: second, title: '製造殭屍獸：選擇第二隻野獸' };
        const a = first[Math.max(0, Math.min(first.length - 1, i1 ?? 0))];
        const b = second[Math.max(0, Math.min(second.length - 1, i2 ?? 0))];
        const hc = this.addToHand(me, ZOMBEAST_ID);
        if (hc) {
          hc.parts = [a, b];
          ctx.it = { kind: 'hand', uid: hc.uid };
        }
        break;
      }
      case 'summonDeadRace': {
        // 召喚本場對戰中死亡的所有友方某種族手下
        const race = args.race as Race;
        for (const id of [...me.graveyard]) {
          if (this.boardSpaceUsed(me.id) >= MAX_BOARD) break;
          const races = getCard(id).races ?? [];
          if (races.includes(race) || races.includes('ALL')) yield* this.doSummon(ctx, ctx.controller, id);
        }
        break;
      }
      case 'horsemen': {
        // 天啟四騎士：召喚一個場上沒有的騎士，四個到齊就消滅敵方英雄
        const all = args.cards as string[];
        const missing = all.filter((id) => !me.board.some((m) => m.cardId === id));
        const id = pick(s, missing);
        if (id) yield* this.doSummon(ctx, ctx.controller, id);
        if (all.every((c) => me.board.some((m) => m.cardId === c && this.alive(m)))) {
          this.log(me.id, '天啟四騎士到齊了！');
          foe.hero.hp = 0;
        }
        break;
      }
    }
  }
}
