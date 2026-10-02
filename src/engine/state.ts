// 對戰狀態（純資料，可 structuredClone，供 AI 模擬使用）
import type { Ability, Aura, CardClass, Effect, Keyword, Race } from './types';

export type PlayerId = 0 | 1;

/** 組裝進星艦的組件（打出時的攻擊力 / 生命值） */
export interface StarshipPiece {
  id: string;
  atk: number;
  hp: number;
}

export interface HandCard {
  uid: number;
  cardId: string;
  /** 永久費用變化（例如「其消耗減少(2)」） */
  costMod: number;
  /** 手牌中的手下增益 */
  atkBuff: number;
  hpBuff: number;
  /** 殭屍獸：由兩張野獸縫合而成 */
  parts?: [string, string];
  /** 回音產生的複製：回合結束時從手牌消失 */
  echo?: boolean;
  /** 被移回手牌的星艦 */
  starship?: StarshipPiece[];
  /** 到這個回合為止消耗生命值而不是法力 */
  healthCostUntil?: number;
  /** 暫時的卡：回合結束時從手牌消失 */
  temporary?: boolean;
  /** 預備：永久折扣（與其他 costMod 分開，方便洗回牌庫時重置） */
  prepareDiscount?: number;
  /** 已經預備過；同一張手牌實體只能預備一次 */
  prepared?: boolean;
  /** 預備發生的遊戲回合；同回合不能打出 */
  preparedTurn?: number;
  /** 碎裂兩半重組後的原卡；避免再次進手牌時重新碎裂 */
  shatterCombined?: boolean;
  /** Noxious Bribe：這張二選一卡牌的兩個效果會同時生效 */
  chooseOneCombined?: boolean;
  /** Breakout Architect：這張法術打出時效果會施放兩次 */
  castTwice?: boolean;
}

export interface Minion {
  uid: number;
  cardId: string;
  owner: PlayerId;
  baseAtk: number;
  baseHp: number;
  atkBuff: number;
  tempAtk: number;
  auraAtk: number;
  auraHp: number;
  maxHp: number;
  hp: number;
  keywords: Keyword[];
  tempKeywords: Keyword[];
  /** 持續到擁有者下個回合開始的關鍵字 */
  nextTurnKeywords: Keyword[];
  auraKeywords: Keyword[];
  /** 持續到某位玩家下個回合開始的攻擊力變化（例如「直到你的下個回合」） */
  lingerAtk?: { amount: number; until: PlayerId }[];
  abilities: Ability[];
  auras: Aura[];
  spellDamage: number;
  enrageAtk: number;
  silenced: boolean;
  frozen: boolean;
  frozenTurn: number;
  sleeping: boolean;
  /** 本回合被召喚（突襲判定用） */
  summonedTurn: number;
  attacks: number;
  playOrder: number;
  dead: boolean;
  /** 殭屍獸的兩個部位 */
  parts?: [string, string];
  /** 星艦：由這些組件組成 */
  starship?: StarshipPiece[];
  /** 這個手下消滅的手下（厄索克） */
  killed?: string[];
}

export interface Hero {
  uid: number;
  owner: PlayerId;
  cardId: string;
  heroClass: CardClass;
  hp: number;
  maxHp: number;
  armor: number;
  tempAtk: number;
  frozen: boolean;
  frozenTurn: number;
  attacks: number;
  immune: boolean;
}

export interface Weapon {
  uid: number;
  cardId: string;
  owner: PlayerId;
  atk: number;
  durability: number;
  abilities: Ability[];
  keywords: Keyword[];
  /** 這把武器消滅的手下（霜之哀傷） */
  killed?: string[];
}

export interface SecretInst {
  uid: number;
  cardId: string;
}

export interface PlayerState {
  id: PlayerId;
  name: string;
  heroClass: Exclude<CardClass, 'NEUTRAL'>;
  hero: Hero;
  weapon: Weapon | null;
  /** heroCard：打出英雄卡後，英雄能力改用該卡附帶的能力 */
  heroPower: { id: string; used: boolean; cost: number; heroCard?: string };
  /** 額外的第二英雄能力；sourceCardId 用來取得完整能力定義 */
  secondaryHeroPower?: { id: string; used: boolean; cost: number; sourceCardId: string };
  /** 本場對戰中賦予手下的關鍵字（例如「你的元素具有生命竊取」） */
  grants: { keyword: Keyword; race?: Race }[];
  /** 本回合下一張牌的折扣 */
  nextCardDiscount: number;
  mana: number;
  maxMana: number;
  overloadOwed: number;
  overloadLocked: number;
  deck: HandCard[];
  hand: HandCard[];
  board: Minion[];
  secrets: SecretInst[];
  graveyard: string[];
  /** 本場對戰中你的克蘇恩累積獲得的加成（無論它在哪裡） */
  cthun?: { atk: number; hp: number; taunt: boolean };
  /** 正在建造的星艦（已組裝的組件） */
  starship?: StarshipPiece[];
  /** 本場對戰中發射過的星艦 */
  launched?: StarshipPiece[][];
  /** 下一次星艦發射的折扣 */
  launchDiscount?: number;
  /** 死亡騎士的屍體（友方手下死亡時獲得） */
  corpses?: number;
  corpsesSpent?: number;
  /** 已召喚的翠玉魔像數 */
  jade?: number;
  /** 本回合施放的法術數 */
  spellsThisTurn?: number;
  /** 延遲的效果（例如「2 回合後召喚…」） */
  delayed?: { turns: number; effects: Effect[]; sourceCardId: string }[];
  /** 本場對戰剩下的時間都有效的能力（例如「在你的回合結束時對對手造成 3 點傷害」） */
  eternal?: { ability: Ability; sourceCardId: string }[];
  /** 你的手下在這個回合消耗增加（對手的冰涼腳丫等） */
  minionTax?: { amount: number; turn: number };
  /** 本回合下一張法術的折扣 */
  nextSpellDiscount?: { amount: number; turn: number };
  /** 本回合下一張牌改為消耗屍體 */
  nextCardCorpsesTurn?: number;
  /** 本場對戰中你的手下額外的攻擊力 */
  minionAtkBonus?: number;
  /** 最近一次友方手下 / 友方不死族死亡的回合 */
  friendlyDiedTurn?: number;
  undeadDiedTurn?: number;
  /** 最近一次英雄生命值變化 / 被治療的回合 */
  heroHealthChangedTurn?: number;
  heroHealedTurn?: number;
  /** 回合結束時加入手牌的卡 */
  endOfTurnCards?: string[];
  /** 伊莉妲‧逐罪者：從牌庫送入虛無、之後每回合取回的牌 */
  voidDeck?: HandCard[];
  /** 洗進對手牌堆的瘟疫數 */
  plaguesShuffled?: number;
  fatigue: number;
  cardsPlayedThisTurn: number;
  spellsCastThisGame: number;
  heroAttackedThisTurn: boolean;
  elementalLastTurn: boolean;
  elementalThisTurn: boolean;
  mulliganDone: boolean;
  heroPowersUsed: number;
  drawnThisTurn: number;
  /** 本場對戰召喚過的各種族手下數量 */
  summonedRaces: Record<string, number>;
  /** 是否為電腦 */
  ai: boolean;
}

export interface LogEntry {
  turn: number;
  player: PlayerId | null;
  text: string;
}

export type FxKind =
  | 'damage'
  | 'heal'
  | 'death'
  | 'play'
  | 'secret'
  | 'armor'
  | 'burn'
  | 'attack'
  | 'shield'
  | 'fatigue'
  | 'summon'
  | 'freeze'
  | 'buff'
  | 'draw';

export interface Fx {
  id: number;
  kind: FxKind;
  uid?: number;
  amount?: number;
  cardId?: string;
  player?: PlayerId;
  target?: number;
  /** 造成效果的角色（手下 / 英雄）；法術則為 undefined，cardId 是法術 */
  from?: number;
  /** 召喚：從手牌打出（而不是效果召喚） */
  played?: boolean;
}

export interface ChoiceRequest {
  player: PlayerId;
  kind: 'discover';
  options: string[];
  title: string;
}

export interface GameState {
  players: [PlayerState, PlayerState];
  current: PlayerId;
  first: PlayerId;
  turn: number;
  phase: 'mulligan' | 'play' | 'over';
  winner: PlayerId | 'draw' | null;
  nextUid: number;
  playCounter: number;
  rng: number;
  log: LogEntry[];
  fx: Fx[];
  fxSeq: number;
  pendingChoice: ChoiceRequest | null;
  deathsThisTurn: number;
}

export type Action =
  | { type: 'play'; handUid: number; target?: number; position?: number; option?: number; side?: 'self' | 'opponent' }
  | { type: 'attack'; attacker: number; target: number }
  | { type: 'heroPower'; target?: number; option?: number }
  | { type: 'secondaryHeroPower'; target?: number }
  | { type: 'trade'; handUid: number }
  /** 預備：花掉剩餘法力，讓這張牌永久減費並鎖到下回合 */
  | { type: 'prepare'; handUid: number }
  /** 發射星艦 */
  | { type: 'launch' }
  | { type: 'endTurn' }
  | { type: 'mulligan'; player: PlayerId; replace: number[] }
  | { type: 'choose'; index: number }
  | { type: 'concede'; player: PlayerId };

export const MAX_BOARD = 7;
export const MAX_HAND = 10;
export const MAX_MANA = 10;
export const MAX_SECRETS = 5;
export const MAX_TURNS = 89;
