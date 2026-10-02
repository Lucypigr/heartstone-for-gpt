// ============================================================================
// 卡牌定義與效果 DSL（Domain-Specific Language）
// 卡牌資料由 scripts/build-cards.ts 從 HearthSim CardDefs.xml 產生，
// 英文卡牌敘述會被解析成下面的 Ability / Effect 結構，引擎再依此執行。
// ============================================================================

export type CardClass =
  | 'NEUTRAL'
  | 'DEATHKNIGHT'
  | 'DEMONHUNTER'
  | 'DRUID'
  | 'HUNTER'
  | 'MAGE'
  | 'PALADIN'
  | 'PRIEST'
  | 'ROGUE'
  | 'SHAMAN'
  | 'WARLOCK'
  | 'WARRIOR';

export type Rarity = 'FREE' | 'COMMON' | 'RARE' | 'EPIC' | 'LEGENDARY';

export type CardType = 'MINION' | 'SPELL' | 'WEAPON' | 'HERO';

export type Race =
  | 'BEAST'
  | 'DEMON'
  | 'DRAGON'
  | 'ELEMENTAL'
  | 'MECHANICAL'
  | 'MURLOC'
  | 'PIRATE'
  | 'TOTEM'
  | 'NAGA'
  | 'UNDEAD'
  | 'QUILBOAR'
  | 'DRAENEI'
  | 'ALL';

export type Keyword =
  | 'TAUNT'
  | 'DIVINE_SHIELD'
  | 'CHARGE'
  | 'RUSH'
  | 'WINDFURY'
  | 'MEGA_WINDFURY'
  | 'STEALTH'
  | 'POISONOUS'
  | 'LIFESTEAL'
  | 'REBORN'
  | 'ELUSIVE'
  | 'CANT_ATTACK'
  | 'CANT_ATTACK_HEROES'
  | 'FREEZE_ON_DAMAGE'
  | 'CLEAVE'
  | 'IMMUNE'
  | 'TRADEABLE'
  /** 雙生法術：施放後把一張沒有雙生法術的複製加入手牌 */
  | 'TWINSPELL'
  /** 回音：本回合可以重複使用 */
  | 'ECHO';

/** 相對於效果擁有者（controller）的陣營 */
export type Side = 'friendly' | 'enemy' | 'any';

/** 篩選角色（英雄 / 手下）的條件 */
export interface Filter {
  side?: Side;
  /** 預設為 character（英雄 + 手下） */
  type?: 'minion' | 'hero' | 'character';
  race?: Race;
  /** 指定卡牌職業（例如「你的聖騎士手下」） */
  cardClass?: CardClass;
  /** 排除效果來源本身 */
  excludeSelf?: boolean;
  damaged?: boolean;
  undamaged?: boolean;
  maxAttack?: number;
  minAttack?: number;
  keyword?: Keyword;
  /** 排除玩家選擇的目標（例如「對其他敵人造成 1 點傷害」） */
  excludeChosen?: boolean;
  /** 星艦或星艦組件 */
  starship?: boolean;
  terran?: boolean;
}

export type TargetExpr =
  /** 玩家在出牌時選擇的目標 */
  | { t: 'chosen' }
  /** 效果來源（手下 / 武器 / 英雄） */
  | { t: 'self' }
  | { t: 'hero'; side: 'friendly' | 'enemy' | 'both' }
  | { t: 'all'; filter: Filter }
  | { t: 'random'; filter: Filter; count: number }
  /** 相鄰手下（of: self = 來源兩側；chosen = 所選目標兩側） */
  | { t: 'adjacent'; of: 'self' | 'chosen' }
  /** 情境中的「它」：觸發事件的對象 / 剛召喚的手下 / 剛發現的卡牌 */
  | { t: 'it' };

export type DynAmount =
  | 'handSize'
  | 'friendlyMinions'
  | 'otherFriendlyMinions'
  | 'enemyMinions'
  | 'allOtherMinions'
  | 'armor'
  | 'damagedFriendlyChars'
  | 'eventAmount'
  | 'cardsPlayedThisTurn'
  | 'spellsCastThisGame'
  | 'weaponAttack'
  | 'selfAttack'
  | 'heroAttack'
  | 'secrets'
  | 'heroMissingHealth'
  | 'oppHandSize'
  | 'deathsThisTurn'
  | 'friendlyDeathsThisGame'
  | 'heroPowersUsed'
  | 'drawnThisTurn'
  | 'spellsInHand'
  | 'damagedMinions'
  | 'friendlyRace'
  | 'summonedRace'
  /** 本場對戰中發射過的星艦數量 */
  | 'starshipsLaunched'
  /** 死亡騎士目前的屍體數 / 本場對戰中花費的屍體數 */
  | 'corpses'
  | 'corpsesSpent'
  /** 本場對戰中死亡的手下總數（雙方） */
  | 'deathsThisGame'
  /** 目前被冰凍的角色數 */
  | 'frozenChars'
  /** 本場對戰中洗進對手牌堆的瘟疫數 */
  | 'plaguesShuffled';

export type Amount = number | { dyn: DynAmount; mult?: number; base?: number; race?: Race };

export interface Pool {
  type?: CardType;
  race?: Race;
  cost?: number;
  minCost?: number;
  maxCost?: number;
  rarity?: Rarity;
  /** 'own' = 你的職業；'opponent' = 對手職業；或指定職業 */
  cls?: CardClass | 'own' | 'opponent';
  keyword?: Keyword;
  hasDeathrattle?: boolean;
  hasBattlecry?: boolean;
  starshipPiece?: boolean;
  /** 需要某種死亡騎士符文 */
  rune?: 'blood' | 'frost' | 'unholy';
  /** 來自另一個職業（不是你的職業，也不是中立） */
  otherClass?: boolean;
  terran?: boolean;
  isSecret?: boolean;
  spellSchool?: string;
  /** 會花費屍體的卡 */
  spendsCorpses?: boolean;
}

export type Condition =
  | { c: 'holding'; race?: Race; type?: CardType }
  | { c: 'control'; race?: Race; keyword?: Keyword; min?: number }
  | { c: 'combo' }
  | { c: 'outcast' }
  | { c: 'heroAttacked' }
  | { c: 'handSize'; op: '>=' | '<='; n: number }
  | { c: 'deckSize'; op: '>=' | '<='; n: number }
  | { c: 'deckNoNeutral' }
  | { c: 'noMinions' }
  | { c: 'itCostMax'; n: number }
  | { c: 'spellsThisTurnAtLeast'; n: number }
  | { c: 'maxMana'; n: number }
  | { c: 'opponentTurn' }
  | { c: 'secret' }
  | { c: 'weapon' }
  | { c: 'damaged' }
  | { c: 'heroHealth'; op: '>=' | '<='; n: number }
  | { c: 'itRace'; race: Race }
  | { c: 'itAlive' }
  | { c: 'itDied' }
  | { c: 'itIsMinion' }
  | { c: 'playedElementalLastTurn' }
  | { c: 'noDuplicates' }
  | { c: 'deckEmpty' }
  /** 你的克蘇恩至少有 n 點攻擊力 */
  | { c: 'cthunAttack'; n: number }
  /** 你正在建造星艦（已組裝組件、尚未發射） */
  | { c: 'buildingStarship' }
  | { c: 'launchedStarship' }
  /** 場上有被冰凍的角色 */
  | { c: 'anyFrozen' }
  /** 本回合有友方手下死亡 */
  | { c: 'friendlyDiedThisTurn' }
  /** 你上個回合結束後有友方不死族死亡 */
  | { c: 'undeadDiedSinceLastTurn' }
  /** 你的英雄本回合生命值有變化 / 被治療過 */
  | { c: 'heroHealthChanged' }
  | { c: 'heroHealed' }
  /** 「它」有亡語 */
  | { c: 'itHasDeathrattle' }
  | { c: 'not'; cond: Condition };

export type Effect =
  | { e: 'damage'; target: TargetExpr; amount: Amount; spell?: boolean }
  | { e: 'splitDamage'; filter: Filter; amount: Amount; spell?: boolean }
  | { e: 'heal'; target: TargetExpr; amount: Amount }
  | { e: 'fullHeal'; target: TargetExpr }
  | {
      e: 'buff';
      target: TargetExpr;
      atk?: Amount;
      hp?: Amount;
      keywords?: Keyword[];
      /** 僅限本回合 */
      temp?: boolean;
      /** 持續到你的下個回合開始（例如「潛行直到你的下個回合」） */
      untilNextTurn?: boolean;
      /** 額外賦予的能力（例如「賦予一個手下『死聲：…』」） */
      abilities?: Ability[];
    }
  | { e: 'setStats'; target: TargetExpr; atk?: number; hp?: number }
  | { e: 'doubleStat'; target: TargetExpr; stat: 'atk' | 'hp' | 'both' }
  | { e: 'swapStats'; target: TargetExpr }
  | { e: 'draw'; count: Amount; who: 'self' | 'opponent' | 'both'; pool?: Pool }
  | { e: 'summon'; card: string; count: number; who: 'self' | 'opponent' }
  | { e: 'summonRandom'; pool: Pool; count: number; who: 'self' | 'opponent' }
  | { e: 'summonCopy'; target: TargetExpr; count: number }
  | { e: 'destroy'; target: TargetExpr }
  | { e: 'silence'; target: TargetExpr }
  | { e: 'freeze'; target: TargetExpr }
  | { e: 'armor'; amount: Amount; who?: 'self' | 'opponent' }
  | { e: 'heroAttack'; amount: number }
  | { e: 'equip'; card: string }
  | { e: 'addCard'; card: string; count: number; who: 'self' | 'opponent' }
  | { e: 'addRandom'; pool: Pool; count: number; who: 'self' | 'opponent' }
  | { e: 'addCopy'; target: TargetExpr; count: number }
  | { e: 'discover'; pool: Pool; then?: Effect[] }
  | { e: 'returnToHand'; target: TargetExpr; costChange?: number }
  | { e: 'transform'; target: TargetExpr; card: string }
  | { e: 'transformRandom'; target: TargetExpr; pool: Pool }
  | { e: 'steal'; target: TargetExpr }
  | { e: 'mana'; kind: 'empty' | 'full' | 'temp' | 'refresh' | 'destroy'; amount: number; who?: 'self' | 'opponent' }
  | { e: 'discard'; count: number }
  | { e: 'destroyWeapon'; who: 'self' | 'opponent' }
  | { e: 'weaponBuff'; atk?: number; dur?: number }
  | { e: 'shuffle'; card: string; count: number; who?: 'self' | 'opponent' }
  | { e: 'handBuff'; atk: number; hp: number; scope: 'all' | 'random'; race?: Race }
  | { e: 'shuffleCopy'; target: TargetExpr; count: number }
  /** 變成隨機一個費用多 amount 的手下 */
  | { e: 'evolve'; target: TargetExpr; amount: number }
  /** 本場對戰中，你的（某種族）手下具有某關鍵字 */
  | { e: 'grant'; keyword: Keyword; race?: Race }
  /** 你本回合打出的下一張牌消耗減少 */
  | { e: 'nextCardDiscount'; amount: number }
  /** 賦予你的克蘇恩 +atk/+hp（無論它在哪裡） */
  | { e: 'cthunBuff'; atk: number; hp: number; taunt?: boolean }
  /** 你的下一次星艦發射消耗減少 */
  | { e: 'launchDiscount'; amount: number }
  /** 發射你正在建造的星艦（不消耗法力） */
  | { e: 'launchStarship' }
  /** 在 turns 個你的回合後（回合開始時）執行 */
  | { e: 'delayed'; turns: number; effects: Effect[] }
  /** 消耗 amount 具屍體來執行 then（屍體不足則執行 else） */
  | { e: 'spendCorpses'; amount: number; then: Effect[]; else?: Effect[] }
  | { e: 'gainCorpses'; amount: number }
  /** 消耗最多 max 具屍體：每具執行一次 each，或把數量交給自訂效果 custom（args.n） */
  | { e: 'spendCorpsesUpTo'; max: number; each?: Effect[]; custom?: string }
  /** 喚起最多 max 具屍體成為手下（每具屍體一個） */
  | { e: 'raiseCorpses'; max: number; card: string }
  /** 比武：雙方各揭露牌堆中一張手下，你的消耗較高則執行 then */
  | { e: 'joust'; then: Effect[]; else?: Effect[] }
  /** 召喚一個翠玉魔像（每召喚一個，下一個就 +1/+1） */
  | { e: 'summonJade' }
  /** 號召：從你的牌堆召喚符合條件的手下 */
  | { e: 'recruit'; count: number; race?: Race; cost?: number; maxCost?: number; keywords?: Keyword[] }
  | { e: 'costMod'; amount: number; scope: 'discovered' | 'it' }
  /** 對手的手下在他的下個回合消耗增加 */
  | { e: 'minionTax'; amount: number }
  /** 你本回合的下一張法術消耗減少 */
  | { e: 'nextSpellDiscount'; amount: number }
  /** 本場對戰剩下的時間都有效的能力（掛在玩家身上，不會被沉默） */
  | { e: 'eternal'; ability: Ability }
  /** 英雄獲得生命值上限（並回復等量生命） */
  | { e: 'heroMaxHealth'; amount: number }
  /** 英雄能力可以再使用一次 */
  | { e: 'refreshHeroPower' }
  /** 本場對戰中你的手下 +atk 攻擊力 */
  | { e: 'minionAtkBonus'; amount: number }
  /** 你打出的下一張牌改為消耗屍體 */
  | { e: 'nextCardCostsCorpses' }
  | { e: 'cond'; cond: Condition; then: Effect[]; else?: Effect[] }
  | { e: 'repeat'; times: Amount; effects: Effect[] }
  | { e: 'custom'; fn: string; args?: Record<string, unknown> };

export type Trig =
  | { k: 'play' }
  | { k: 'deathrattle' }
  | { k: 'turnEnd'; whose: 'mine' | 'opp' | 'each' }
  | { k: 'turnStart'; whose: 'mine' | 'opp' | 'each' }
  | { k: 'spellCast'; side: Side; school?: string }
  | { k: 'cardPlayed'; side: Side; cardType?: CardType; race?: Race; keyword?: Keyword; hasBattlecry?: boolean; hasDeathrattle?: boolean }
  | { k: 'summon'; side: Side; race?: Race; cardId?: string }
  | { k: 'minionDied'; side: Side; race?: Race }
  | { k: 'damaged'; subject: 'self' | 'friendlyHero' | 'friendlyMinion' | 'anyMinion' }
  | { k: 'healed'; subject: 'any' | 'friendly' | 'minion' }
  | { k: 'attack'; subject: 'self' | 'friendlyHero' | 'friendlyMinion'; after?: boolean; keyword?: Keyword }
  | { k: 'heroPower'; side: Side }
  | { k: 'draw'; side: Side }
  | { k: 'frenzy' }
  /** 星艦發射時（星艦組件的能力） */
  | { k: 'launch' }
  /** 滅殺：在你的回合，造成的傷害超過消滅一個手下所需 */
  | { k: 'overkill' }
  /** 榮譽擊殺：在你的回合，造成恰好致死的傷害 */
  | { k: 'honorableKill' }
  | { k: 'secret'; ev: SecretEvent };

export type SecretEvent =
  | 'heroAttacked'
  | 'minionAttacked'
  | 'enemyAttacks'
  | 'enemyMinionAttacks'
  | 'minionAttacksHero'
  | 'enemyPlaysMinion'
  | 'enemyCastsSpell'
  | 'friendlyMinionDies'
  | 'heroDamaged'
  | 'heroFatal'
  | 'turnStart'
  | 'enemyTurnEnd';

export interface Ability {
  on: Trig;
  effects: Effect[];
  cond?: Condition;
  /** 只觸發一次（例如法術迸發） */
  once?: boolean;
}

export interface Aura {
  /**
   * friendlyHand：你手牌中的手下（例如「你手牌中的手下具有回音」）
   * firstSpellDiscount：你每回合的第一張法術消耗減少 cost
   */
  scope: 'otherFriendly' | 'friendlyMinions' | 'adjacent' | 'otherAll' | 'friendlyHero' | 'enemyMinions' | 'friendlyHand' | 'firstSpellDiscount';
  cost?: number;
  race?: Race;
  atk?: number;
  hp?: number;
  keywords?: Keyword[];
}

/** 出牌時需要選擇的目標 */
export interface TargetReq {
  filter: Filter;
  /** true = 沒有合法目標時仍可打出（手下戰吼的標準行為） */
  optional?: boolean;
  /** 只有條件成立時才需要選目標（例如連擊） */
  when?: Condition;
}

export interface ChooseOneOption {
  id: string;
  name: string;
  text: string;
  abilities: Ability[];
  target?: TargetReq;
  /** 變形成另一個手下（例如德魯伊的二選一變身） */
  transformInto?: string;
}

/** 英雄能力（基本職業能力與英雄卡附帶的能力共用） */
export interface HeroPowerSpec {
  effects: Effect[];
  target?: TargetReq;
  /** 需要場上空位（召喚類） */
  needsBoardSpace?: boolean;
  lifesteal?: boolean;
  /** 打出一張牌後可以再次使用 */
  refresh?: 'cardPlayed';
  chooseOne?: { id: string; name?: string; text?: string; effects: Effect[]; target?: TargetReq }[];
}

export interface HeroPowerDef extends HeroPowerSpec {
  id: string;
  name: string;
  text: string;
  cost: number;
  /** 預設使用法力；部分特殊英雄能力改用屍體 */
  costKind?: 'mana' | 'corpses';
}

/** 死亡騎士符文：一副套牌中三種符文各取最高需求，加總最多 3 個 */
export interface Runes {
  blood?: number;
  frost?: number;
  unholy?: number;
}

export interface CardDef {
  id: string;
  dbfId: number;
  name: string;
  nameEn: string;
  /** 繁體中文卡牌敘述（含 <b> 等標籤，顯示前需清理） */
  text: string;
  flavor?: string;
  type: CardType;
  cardClass: CardClass;
  classes?: CardClass[];
  rarity: Rarity;
  set: number;
  cost: number;
  attack?: number;
  /** 手下的生命值；武器的耐久度 */
  health?: number;
  races?: Race[];
  spellSchool?: string;
  collectible: boolean;
  keywords?: Keyword[];
  spellDamage?: number;
  overload?: number;
  abilities?: Ability[];
  auras?: Aura[];
  /** 受傷時攻擊力加成（激怒） */
  enrage?: { atk: number };
  /** 條件成立時的持續攻擊力加成（例如牌庫 25 張以上 +5 攻擊力） */
  atkIf?: { cond: Condition; amount: number };
  /** 特殊重生：以完整生命與死亡前附魔重生（Sinful Steed） */
  fullRebornEnchantments?: boolean;
  /** 紫羅蘭堡薩滿法術：在手牌中看見你施放指定數量法術後變形成對應元素手下 */
  handTransformAfterSpells?: { count: number; into: string };
  target?: TargetReq;
  chooseOne?: ChooseOneOption[];
  secret?: boolean;
  /** 條件成立時的消耗（例如「若你正在建造星艦，消耗為 (1)」） */
  costIf?: { cond: Condition; cost: number };
  /** 動態費用 */
  costRule?: { per: DynAmount | 'otherCardsInHand' | 'minionsOnBoard' | 'coinsInHand'; amount: number; race?: Race };
  /** 英雄卡：獲得的護甲與新的英雄能力 */
  armor?: number;
  heroPower?: HeroPowerDef;
  /** 戰吼等效果額外解鎖的第二英雄能力 */
  secondaryHeroPower?: HeroPowerDef;
  /** 由 overrides / custom 加入的卡 */
  custom?: boolean;
  /** 星艦組件：打出或召喚時組裝進你的星艦 */
  starshipPiece?: boolean;
  /** 星艦本體（發射後的手下） */
  starship?: boolean;
  /** 星海爭霸：人類（Terran） */
  terran?: boolean;
  /** 發射過星艦後，手牌與牌堆中的這張卡會變形成另一張卡 */
  launchTransform?: string;
  /** 預備：可把剩餘法力投資成永久減費，且預備當回合不能打出 */
  prepare?: boolean;
  /** 開局效果：在起手抽牌前、洗牌前執行 */
  startOfGame?: Effect[];
  /** 某些開局效果（例如破鏈者霍格）規定必須在其他開局效果後執行 */
  startOfGameLast?: boolean;
  /** 偽裝／自由放置：這張手下可打到自己或對手的場上 */
  disguised?: boolean;
  /** 抽到時改為替抽牌者的對手召喚，並補抽一張（Imp-formant） */
  summonedWhenDrawnForOpponent?: boolean;
  /** 碎裂：進入手牌時分裂成左右兩個官方半片 */
  shatter?: { left: string; right: string };
  /** 碎裂半片：記錄可與哪一張另一半重組回原卡 */
  shatteredFrom?: { root: string; side: 'left' | 'right' };
  /** 腐化：在手牌中打出更高目前費用的卡後，變形成官方已腐化版本 */
  corruptInto?: string;
  /** 可無限再次腐化：每次腐化保留卡牌並增加手牌數值 */
  corruptRepeatBuff?: { atk: number; hp: number };
  /** 雙生法術：施放後加入手牌的複製（沒有雙生法術） */
  twinspellCopy?: string;
  /** 死亡騎士的符文需求（血魄 / 冰霜 / 穢邪） */
  runes?: Runes;
  /** 死亡時不會留下屍體（屍體喚起的手下） */
  noCorpse?: boolean;
  /** 消耗生命值而不是法力 */
  costsHealth?: boolean;
  /** 條件成立時消耗生命值而不是法力 */
  costsHealthIf?: Condition;
  /** 消耗屍體而不是法力 */
  costsCorpses?: boolean;
  /** 抽到時施放（施放後再抽一張牌） */
  castsWhenDrawn?: boolean;
  /** 場上時的特殊規則 */
  flags?: MinionFlag[];
}

/**
 * noTurnDraw：你的回合開始時不再抽牌
 * enemyNoHeal：敵方角色無法被治療
 * doubleCorpses：你獲得的屍體加倍
 */
export type MinionFlag = 'noTurnDraw' | 'enemyNoHeal' | 'doubleCorpses';
