// ============================================================================
// 手動覆寫：解析器看不懂、但很經典的卡牌，在這裡直接用效果 DSL 描述。
// key 是卡牌 ID（可在 hsreplay 卡牌網址或 .cache/unsupported.txt 找到）。
// 修改後請執行 `npm run cards` 重新產生資料（覆寫的卡才會被收錄）。
// ============================================================================
import type { Ability, CardDef, Effect, HeroPowerSpec, TargetReq } from '../engine/types';

export type Override = Partial<Omit<CardDef, 'id' | 'dbfId' | 'name' | 'nameEn' | 'text' | 'heroPower'>> & {
  /** 英雄卡的新英雄能力（名稱、敘述、費用會自動從卡牌資料帶入） */
  heroPower?: HeroPowerSpec;
  /** 覆寫中引用的衍生卡，需一起收錄 */
  tokens?: string[];
};

const play = (...effects: Effect[]) => [{ on: { k: 'play' as const }, effects }];
const anyChar: TargetReq = { filter: { type: 'character', side: 'any' } };
const friendlyMinion: TargetReq = { filter: { type: 'minion', side: 'friendly' } };
const LACKEYS = ['DAL_613', 'DAL_614', 'DAL_739', 'DAL_741', 'ULD_616', 'DRG_052'];
const HORSEMEN = ['ICC_829t2', 'ICC_829t3', 'ICC_829t4', 'ICC_829t5'];
const DREAM_CARDS = ['DREAM_01', 'DREAM_02', 'DREAM_03', 'DREAM_04', 'DREAM_05'];

const chosenMinion = { filter: { type: 'minion' as const, side: 'any' as const } };
const enemyMinion: TargetReq = { filter: { type: 'minion', side: 'enemy' } };
const dr = (...effects: Effect[]) => [{ on: { k: 'deathrattle' as const }, effects }];
const fn = (name: string, args?: Record<string, unknown>): Effect => ({ e: 'custom', fn: name, args });
const hit = (amount: number, spell = true): Effect => ({ e: 'damage', target: { t: 'chosen' }, amount, spell });
const allFriendly = { t: 'all' as const, filter: { type: 'minion' as const, side: 'friendly' as const } };
const allEnemy = { t: 'all' as const, filter: { type: 'minion' as const, side: 'enemy' as const } };
const heroAttacked = (...effects: Effect[]): Ability[] => [{ on: { k: 'attack', subject: 'friendlyHero', after: true }, effects }];
/** 在你的回合結束時，此手下死亡 */
const dieAtEndOfTurn: Ability = { on: { k: 'turnEnd', whose: 'mine' }, effects: [{ e: 'destroy', target: { t: 'self' } }] };
const PLAGUES = ['TTN_450t', 'TTN_450t2', 'TTN_450t3'];

export const OVERRIDES: Record<string, Override> = {
  // 破鏈者霍格：開局時複製牌庫中所有「其他」傳說卡；官方規定在其他開局效果之後觸發。
  JAIL_384: {
    startOfGame: [{ e: 'custom', fn: 'duplicateOtherLegendariesInDeck' }],
    startOfGameLast: true,
  },
  // 血腥醫生薩蕾娜：戰吼解鎖第二英雄能力「吸血鬼之吻」，每回合獨立使用一次並消耗 3 屍體。
  JAIL_446: {
    abilities: play(fn('grantSecondaryHeroPower')),
    secondaryHeroPower: {
      id: 'JAIL_446hp',
      name: '吸血鬼之吻',
      text: '賦予一個手下+3攻擊力。此能力消耗屍體而非法力。',
      cost: 3,
      costKind: 'corpses',
      target: { filter: { type: 'minion', side: 'any' } },
      effects: [{ e: 'buff', target: { t: 'chosen' }, atk: 3 }],
    },
  },
  // 伊莉妲‧逐罪者：現行 36.2.2 規則。把牌庫送入虛無但保留 1 張；之後每個自己的回合開始額外從虛無取得 2 張。
  JAIL_719: {
    abilities: play(fn('sendDeckToVoidExceptOne')),
  },
  // 賄賂牌：強力效果 + 給對手補償。這些效果共用現有「對手資源」能力與少量專用流程。
  JAIL_206: { abilities: play(fn('darkBribe')) },
  JAIL_861: { abilities: play(fn('noxiousBribe')) },
  CATA_EVENT_402: {
    target: chosenMinion,
    abilities: [
      { on: { k: 'play' }, effects: [{ e: 'destroy', target: { t: 'chosen' } }, { e: 'addCard', card: 'GAME_005', count: 1, who: 'opponent' }] },
      { on: { k: 'play' }, cond: { c: 'combo' }, effects: [{ e: 'addCard', card: 'GAME_005', count: 1, who: 'self' }] },
    ],
    tokens: ['GAME_005'],
  },
  JAIL_EVENT_102: { abilities: play(fn('desperateBribe')) },

  // 紫羅蘭堡：第一批共用條件/效果復原
  JAIL_035: {
    abilities: [{ on: { k: 'play' }, cond: { c: 'deckNoNeutral' }, effects: [{ e: 'summonCopy', target: { t: 'self' }, count: 2 }] }],
  },
  JAIL_118: { abilities: play(fn('destroyNonClassMinions', { class: 'PALADIN' })) },
  JAIL_123: {
    abilities: play({ e: 'discover', pool: { type: 'SPELL', minCost: 5 }, then: [fn('markItCastTwice')] }),
  },
  JAIL_202: { auras: [{ scope: 'friendlyHero', atk: 1 }] },
  JAIL_204: { costIf: { cond: { c: 'noMinions' }, cost: 2 } },
  JAIL_307: {
    costIf: { cond: { c: 'deckSize', op: '>=', n: 25 }, cost: 3 },
    abilities: play({ e: 'repeat', times: 2, effects: [{ e: 'damage', target: { t: 'all', filter: { type: 'minion', side: 'any' } }, amount: 2, spell: true }] }),
  },
  JAIL_311: { atkIf: { cond: { c: 'deckSize', op: '>=', n: 25 }, amount: 5 } },
  JAIL_329: {
    abilities: heroAttacked({ e: 'buff', target: { t: 'all', filter: { type: 'minion', side: 'friendly', cardClass: 'PALADIN' } }, atk: 2, hp: 2 }),
  },
  JAIL_377: {
    abilities: play(
      { e: 'draw', count: 1, who: 'self' },
      { e: 'cond', cond: { c: 'itCostMax', n: 2 }, then: [{ e: 'draw', count: 1, who: 'self' }] },
    ),
  },
  JAIL_387: { abilities: play(fn('releaseTheBeasts')) },
  JAIL_395: { target: friendlyMinion, abilities: play(fn('triggerChosenDeathrattle')) },
  JAIL_455: {
    abilities: play({ e: 'repeat', times: 2, effects: [{ e: 'damage', target: { t: 'all', filter: { type: 'minion', side: 'friendly', excludeSelf: true } }, amount: 1 }] }),
  },
  JAIL_461: { abilities: play(fn('destroyRandomAdjacent')) },
  JAIL_507: { abilities: play(fn('spitefulChef')) },
  JAIL_516: { abilities: play({ e: 'recruit', count: 2, maxCost: 2, keywords: ['RUSH'] }) },
  JAIL_735: {
    abilities: play(
      { e: 'summonRandom', pool: { type: 'MINION', cost: 8 }, count: 1, who: 'self' },
      { e: 'cond', cond: { c: 'spellsThisTurnAtLeast', n: 3 }, then: [{ e: 'summonRandom', pool: { type: 'MINION', cost: 8 }, count: 1, who: 'self' }] },
    ),
  },
  JAIL_802: {
    abilities: [{ on: { k: 'cardPlayed', side: 'friendly', cardType: 'MINION', hasBattlecry: true }, effects: [{ e: 'buff', target: { t: 'it' }, atk: 1, hp: 1 }] }],
  },
  JAIL_880: {
    abilities: [{ on: { k: 'cardPlayed', side: 'friendly', cardType: 'MINION', hasDeathrattle: true }, effects: [{ e: 'buff', target: { t: 'it' }, keywords: ['RUSH'] }] }],
  },
  JAIL_909: {
    abilities: [{ on: { k: 'play' }, cond: { c: 'combo' }, effects: [{ e: 'buff', target: { t: 'self' }, atk: { dyn: 'cardsPlayedThisTurn', base: -1 }, hp: { dyn: 'cardsPlayedThisTurn', base: -1 } }] }],
  },
  JAIL_986: { abilities: play(fn('franticForger')) },
  JAIL_706: { abilities: play(fn('thievesTools')) },
  // 紫羅蘭堡：SI:7 潛行連動
  CAP_000: {
    keywords: ['STEALTH'],
    abilities: [{ on: { k: 'attack', subject: 'friendlyMinion', keyword: 'STEALTH' }, effects: [{ e: 'buff', target: { t: 'it' }, atk: 2, hp: 2 }] }],
  },
  CAP_001: { target: chosenMinion, abilities: play(fn('silentStrike')) },
  CAP_005: {
    keywords: ['STEALTH'],
    abilities: [{ on: { k: 'attack', subject: 'friendlyMinion', keyword: 'STEALTH' }, effects: [fn('si7RandomHandDiscount', { amount: 3 })] }],
  },
  CAP_006: { target: anyChar, abilities: play(fn('tricksOfTrade')) },

  // 紫羅蘭堡：Follow 效果
  CAP_002: { abilities: play(fn('follow', { kind: 'footsteps' })) },
  CAP_101: { abilities: play(fn('follow', { kind: 'fuse' })) },
  CAP_402: { abilities: play(fn('follow', { kind: 'evidence' })), tokens: ['CAP_400t2t'] },
  CAP_802: { abilities: play(fn('follow', { kind: 'ghosts' })), tokens: ['CAP_802t'] },
  CAP_802t: { keywords: ['REBORN'] },

  // 紫羅蘭堡：Cannoneer 套件
  CAP_103: { abilities: heroAttacked(fn('fireCannoneers')), tokens: ['CAP_107t'] },
  CAP_104: {},
  CAP_106: { abilities: play({ e: 'summon', card: 'CAP_107t', count: 2, who: 'self' }), tokens: ['CAP_107t'] },
  CAP_107: { abilities: play({ e: 'addCard', card: 'CAP_107t', count: 1, who: 'self' }), tokens: ['CAP_107t'] },
  CAP_107t: { abilities: [{ on: { k: 'turnEnd', whose: 'mine' }, effects: [fn('fireThisCannoneer')] }] },

  // 紫羅蘭堡：Imp-formant 套件
  CAP_400: { abilities: dr(fn('putImpInformants', { count: 2 })), tokens: ['CAP_400t2t'] },
  CAP_401: { abilities: play(fn('corruptConstable')), tokens: ['CAP_400t2t'] },
  CAP_403: { abilities: play(fn('frameJob')) },
  CAP_404: {
    abilities: play({ e: 'minionTax', amount: 2 }, fn('putImpInformants', { count: 2 })),
    tokens: ['CAP_400t2t'],
  },
  CAP_406: {
    abilities: play({
      e: 'eternal',
      ability: { on: { k: 'summon', side: 'friendly', cardId: 'CAP_400t2t' }, effects: [{ e: 'buff', target: { t: 'it' }, atk: 2, hp: 2 }] },
    }),
    tokens: ['CAP_400t2t'],
  },
  CAP_400t2t: { keywords: ['LIFESTEAL'], summonedWhenDrawnForOpponent: true },

  // 紫羅蘭堡：第二批可直接掛在既有引擎上的特殊卡
  CAP_800: { keywords: ['REBORN'], fullRebornEnchantments: true },
  CAP_803: { keywords: ['REBORN'], abilities: dr(fn('lingeringSpirit')) },
  CAP_804: { target: friendlyMinion, abilities: play(fn('specterSpecialist')) },

  JAIL_029: {
    abilities: [{ on: { k: 'damaged', subject: 'friendlyMinion' }, cond: { c: 'itAlive' }, effects: [{ e: 'buff', target: { t: 'it' }, atk: 1 }] }],
  },
  JAIL_030: {
    keywords: ['STEALTH'],
    abilities: [{ on: { k: 'attack', subject: 'self', after: true }, effects: [{ e: 'draw', count: 1, who: 'self' }, fn('escapeSelf')] }],
  },
  JAIL_122: { abilities: play(fn('grantSpellEchoSummon')) },
  JAIL_225: { target: chosenMinion, abilities: play(fn('nab')) },
  JAIL_321: {
    abilities: [{ on: { k: 'play' }, cond: { c: 'spellsThisTurnAtLeast', n: 1 }, effects: [fn('castTwoMageSecrets')] }],
  },
  JAIL_326: { target: friendlyMinion, abilities: play(fn('judgment')) },
  JAIL_379: { abilities: play(fn('spireSecurity')) },
  JAIL_444: { abilities: play(fn('sawbones')) },
  JAIL_448: { keywords: ['TAUNT'], abilities: dr(fn('karov')) },
  JAIL_452: { abilities: play(fn('overloadController', { amount: 2 })) },
  JAIL_453: { keywords: ['TAUNT'] },
  JAIL_462: { abilities: play(fn('hogdriver')) },
  JAIL_474: { abilities: play(fn('jadeGuardians')) },
  JAIL_502: { abilities: [{ on: { k: 'turnStart', whose: 'mine' }, effects: [fn('alarmOMaticEnemy')] }] },
  JAIL_503: { costRule: { per: 'coinsInHand', amount: 1 }, abilities: dr({ e: 'draw', count: 1, who: 'self' }) },
  JAIL_510: { abilities: play(fn('annihilation')) },
  JAIL_515: { target: enemyMinion, abilities: play(fn('shadowRounds')) },
  JAIL_721: {
    keywords: ['RUSH'],
    abilities: [{ on: { k: 'summon', side: 'friendly', race: 'DEMON' }, effects: [fn('soulParasiteGainStats')] }],
  },
  JAIL_734: { keywords: ['TAUNT'], abilities: play(fn('hellraiser')) },
  JAIL_806: { abilities: play(fn('hexmarshal')) },
  JAIL_852: { abilities: play(fn('shuffleHandsTogether')) },
  JAIL_860: { startOfGame: [fn('chefNethrekStart')] },
  JAIL_875: { abilities: heroAttacked(fn('staffOfTrickery')) },
  JAIL_876: {
    target: friendlyMinion,
    abilities: play({
      e: 'buff',
      target: { t: 'chosen' },
      abilities: [{ on: { k: 'deathrattle' }, effects: [{ e: 'summonRandom', pool: { type: 'MINION', cost: 4 }, count: 2, who: 'self' }] }],
    }),
  },
  JAIL_882: { abilities: [...play(fn('copyDeckSpells')), ...dr({ e: 'draw', count: 1, who: 'self' })] },
  JAIL_892: {
    target: anyChar,
    abilities: [
      ...play({ e: 'damage', target: { t: 'chosen' }, amount: 2, spell: true }, fn('shuffleRandomDHSpell')),
      { on: { k: 'play' }, cond: { c: 'outcast' }, effects: [{ e: 'damage', target: { t: 'chosen' }, amount: 2, spell: true }, fn('shuffleRandomDHSpell')] },
    ],
  },
  JAIL_906: { abilities: dr(fn('moragg')) },
  JAIL_940: { abilities: play(fn('undeathSentence')) },
  JAIL_974: { abilities: dr(fn('capturedArchmage')) },

  // 紫羅蘭堡：Void Soul / Tripwire / 衍生法術 / Dormant
  JAIL_730: { abilities: heroAttacked({ e: 'addCard', card: 'JAIL_732', count: 1, who: 'self' }), tokens: ['JAIL_732'] },
  JAIL_732: { abilities: play(fn('voidSoul')) },
  JAIL_733: { keywords: ['TAUNT'], abilities: dr({ e: 'addCard', card: 'JAIL_732', count: 1, who: 'self' }), tokens: ['JAIL_732'] },
  JAIL_891: { target: chosenMinion, abilities: play(fn('voidBlast')), tokens: ['JAIL_732'] },

  JAIL_386: {
    abilities: play({ e: 'armor', amount: 2, who: 'self' }, { e: 'shuffle', card: 'JAIL_386t', count: 5 }),
    tokens: ['JAIL_386t'],
  },
  JAIL_386t: { castsWhenDrawn: true, abilities: play({ e: 'armor', amount: 2, who: 'self' }) },

  JAIL_879: {
    abilities: play(
      { e: 'summonRandom', pool: { type: 'MINION', race: 'BEAST', cost: 5 }, count: 1, who: 'self' },
      { e: 'shuffle', card: 'JAIL_879t', count: 2 },
    ),
    tokens: ['JAIL_879t'],
  },
  JAIL_879t: {
    castsWhenDrawn: true,
    abilities: play({ e: 'summonRandom', pool: { type: 'MINION', race: 'BEAST', cost: 5 }, count: 1, who: 'self' }),
  },
  JAIL_881: {
    abilities: play(
      { e: 'splitDamage', filter: { type: 'character', side: 'enemy' }, amount: 4, spell: true },
      { e: 'shuffle', card: 'JAIL_881t', count: 2 },
    ),
    tokens: ['JAIL_881t'],
  },
  JAIL_881t: {
    castsWhenDrawn: true,
    abilities: play({ e: 'splitDamage', filter: { type: 'character', side: 'enemy' }, amount: 4, spell: true }),
  },

  JAIL_436: {
    abilities: play(
      { e: 'heroAttack', amount: 1 },
      { e: 'armor', amount: 1, who: 'self' },
      { e: 'addCard', card: 'JAIL_436t', count: 1, who: 'self' },
    ),
    tokens: ['JAIL_436t', 'JAIL_436t2'],
  },
  JAIL_436t: {
    abilities: play(
      { e: 'heroAttack', amount: 2 },
      { e: 'armor', amount: 2, who: 'self' },
      { e: 'addCard', card: 'JAIL_436t2', count: 1, who: 'self' },
    ),
    tokens: ['JAIL_436t2'],
  },
  JAIL_436t2: { abilities: play({ e: 'heroAttack', amount: 4 }, { e: 'armor', amount: 4, who: 'self' }) },

  JAIL_447: { keywords: ['RUSH'], abilities: dr({ e: 'addCard', card: 'JAIL_447t', count: 1, who: 'self' }), tokens: ['JAIL_447t'] },
  JAIL_447t: {
    target: chosenMinion,
    abilities: play({ e: 'buff', target: { t: 'chosen' }, atk: 4, hp: 4, keywords: ['RUSH'] }),
  },

  JAIL_941: {
    target: anyChar,
    abilities: play({ e: 'heal', target: { t: 'chosen' }, amount: 4 }, { e: 'addCard', card: 'JAIL_941t', count: 1, who: 'self' }),
    tokens: ['JAIL_941t'],
  },
  JAIL_941t: { target: anyChar, abilities: play({ e: 'damage', target: { t: 'chosen' }, amount: 4, spell: true }) },

  JAIL_850: {
    abilities: [{ on: { k: 'cardPlayed', side: 'friendly', cardType: 'MINION' }, effects: [fn('wardenMaiev')] }],
  },
  JAIL_997: { target: chosenMinion, abilities: play(fn('demonicConfinement')) },

  // 動物夥伴：隨機召喚米莎、雷歐克或霍弗
  NEW1_031: {
    abilities: [{ on: { k: 'play' }, effects: [{ e: 'custom', fn: 'summonOneOf', args: { cards: ['NEW1_032', 'NEW1_033', 'NEW1_034'] } }] }],
    tokens: ['NEW1_032', 'NEW1_033', 'NEW1_034'],
  },
  // 心靈之火：攻擊力變得與生命值相同
  CS1_129: {
    target: chosenMinion,
    abilities: [{ on: { k: 'play' }, effects: [{ e: 'custom', fn: 'attackEqualsHealth' }] }],
  },
  // 劍刃亂舞：摧毀武器並對全部敵方手下造成武器攻擊力的傷害
  CS2_233: {
    abilities: [{ on: { k: 'play' }, effects: [{ e: 'custom', fn: 'bladeFlurry' }] }],
  },
  // 雅立史卓莎：將一位英雄的生命值設為 15
  EX1_561: {
    target: { filter: { type: 'hero', side: 'any' }, optional: true },
    abilities: [{ on: { k: 'play' }, effects: [{ e: 'custom', fn: 'setHeroHealth', args: { hp: 15 } }] }],
  },
  // 奧妮克希亞：召喚 1/1 雛龍直到場上填滿
  EX1_562: {
    abilities: [{ on: { k: 'play' }, effects: [{ e: 'custom', fn: 'fillBoard', args: { card: 'ds1_whelptoken' } }] }],
    tokens: ['ds1_whelptoken'],
  },
  // 哈里遜‧瓊斯：摧毀對手武器並抽等同耐久度的牌
  EX1_558: {
    abilities: [{ on: { k: 'play' }, effects: [{ e: 'custom', fn: 'destroyWeaponDraw' }] }],
  },
  // 心控技師：若對手有 4 個以上的手下，隨機控制一個
  EX1_085: {
    abilities: [{ on: { k: 'play' }, effects: [{ e: 'custom', fn: 'stealIfFour' }] }],
  },
  // 修補匠超火花：隨機把另一個手下變成 5/5 魔暴龍或 1/1 松鼠
  EX1_083: {
    abilities: [{ on: { k: 'play' }, effects: [{ e: 'custom', fn: 'transformRandomOther', args: { cards: ['EX1_tk28', 'EX1_tk29'] } }] }],
    tokens: ['EX1_tk28', 'EX1_tk29'],
  },
  // 伊瑟拉：回合結束時隨機獲得兩張夢境卡（伊瑟拉之覺醒、歡笑的姊妹、翡翠飛龍、夢境、夢魘）
  EX1_572: {
    abilities: [
      {
        on: { k: 'turnEnd', whose: 'mine' },
        effects: [
          { e: 'custom', fn: 'addOneOf', args: { cards: DREAM_CARDS } },
          { e: 'custom', fn: 'addOneOf', args: { cards: DREAM_CARDS } },
        ],
      },
    ],
    tokens: DREAM_CARDS,
  },
  // 伊瑟拉之覺醒：對伊瑟拉以外的所有角色造成 5 點傷害
  DREAM_02: { abilities: play({ e: 'custom', fn: 'yseraAwakens', args: { amount: 5 } }) },
  // 夢魘：賦予一個手下 +5/+5，在你的下個回合開始時消滅它
  DREAM_05: { target: chosenMinion, abilities: play({ e: 'custom', fn: 'nightmare' }) },
  // 血帆襲擊者：獲得等同武器攻擊力的攻擊力
  NEW1_018: {
    abilities: [{ on: { k: 'play' }, effects: [{ e: 'buff', target: { t: 'self' }, atk: { dyn: 'weaponAttack' } }] }],
  },
  // 恐怖海盜：每有 1 點武器攻擊力，消耗減少(1)
  NEW1_022: {
    keywords: ['TAUNT'],
    costRule: { per: 'weaponAttack', amount: 1 },
  },

  // ==========================================================================
  // 英雄卡
  // ==========================================================================

  // 賈拉克瑟斯領主：裝備 3/8 血怒；英雄能力召喚 6/6 煉獄火
  EX1_323: {
    abilities: play({ e: 'equip', card: 'EX1_323w' }),
    heroPower: { effects: [{ e: 'summon', card: 'EX1_tk34', count: 1, who: 'self' }], needsBoardSpace: true },
    tokens: ['EX1_323w', 'EX1_tk34'],
  },
  // 『黯刃騎士』烏瑟：裝備 5/3 生命竊取武器；英雄能力召喚天啟四騎士，四個到齊就消滅敵方英雄
  ICC_829: {
    abilities: play({ e: 'equip', card: 'ICC_829t' }),
    heroPower: { effects: [{ e: 'custom', fn: 'horsemen', args: { cards: HORSEMEN } }], needsBoardSpace: true },
    tokens: ['ICC_829t', ...HORSEMEN],
  },
  // 『暗影死神』安杜因：消滅所有攻擊力 5 以上的手下；英雄能力造成 2 點傷害，打出卡牌後可再次使用
  ICC_830: {
    abilities: play({ e: 'destroy', target: { t: 'all', filter: { type: 'minion', minAttack: 5 } } }),
    heroPower: { effects: [{ e: 'damage', target: { t: 'chosen' }, amount: 2 }], target: anyChar, refresh: 'cardPlayed' },
  },
  // 『奪血者』古爾丹：召喚本場死亡的所有友方惡魔；英雄能力 生命竊取 造成 3 點傷害
  ICC_831: {
    abilities: play({ e: 'custom', fn: 'summonDeadRace', args: { race: 'DEMON' } }),
    heroPower: { effects: [{ e: 'damage', target: { t: 'chosen' }, amount: 3 }], target: anyChar, lifesteal: true },
  },
  // 『疫病蟲王』瑪法里恩：二選一 召喚兩隻劇毒蜘蛛 / 兩隻嘲諷甲蟲；英雄能力二選一 +3 攻擊 / +3 護甲
  ICC_832: {
    chooseOne: [
      {
        id: 'ICC_832a',
        name: '聖甲蟲之災',
        text: '召喚兩隻具有<b>嘲諷</b>的1/5聖甲蟲',
        abilities: play({ e: 'summon', card: 'ICC_832t4', count: 2, who: 'self' }),
      },
      {
        id: 'ICC_832b',
        name: '蜘蛛之災',
        text: '召喚兩隻具有<b>劇毒</b>的1/2冰霜寡婦',
        abilities: play({ e: 'summon', card: 'ICC_832t3', count: 2, who: 'self' }),
      },
    ],
    heroPower: {
      effects: [],
      chooseOne: [
        { id: 'ICC_832pa', name: '聖甲蟲之殼', text: '+3護甲值', effects: [{ e: 'armor', amount: 3 }] },
        { id: 'ICC_832pb', name: '蜘蛛之牙', text: '本回合+3攻擊力', effects: [{ e: 'heroAttack', amount: 3 }] },
      ],
    },
    tokens: ['ICC_832t3', 'ICC_832t4'],
  },
  // 『霜巫』珍娜：召喚 3/6 水元素，你的元素在本場對戰具有生命竊取；英雄能力造成 1 點傷害，擊殺手下時召喚水元素
  ICC_833: {
    abilities: play({ e: 'summon', card: 'ICC_833t', count: 1, who: 'self' }, { e: 'grant', keyword: 'LIFESTEAL', race: 'ELEMENTAL' }),
    heroPower: {
      effects: [
        { e: 'damage', target: { t: 'chosen' }, amount: 1 },
        { e: 'cond', cond: { c: 'itDied' }, then: [{ e: 'cond', cond: { c: 'itIsMinion' }, then: [{ e: 'summon', card: 'ICC_833t', count: 1, who: 'self' }] }] },
      ],
      target: anyChar,
    },
    tokens: ['ICC_833t'],
  },
  // 『天譴領主』卡爾洛斯：裝備會同時傷害相鄰手下的 4/3 霜之哀傷；英雄能力對所有手下造成 1 點傷害
  ICC_834: {
    abilities: play({ e: 'equip', card: 'ICC_834w' }),
    heroPower: { effects: [{ e: 'damage', target: { t: 'all', filter: { type: 'minion' } }, amount: 1 }] },
    tokens: ['ICC_834w'],
  },
  // 『死亡先知』索爾：把你的手下變成費用多 2 的隨機手下；英雄能力把一個友方手下變成費用多 1 的隨機手下
  ICC_481: {
    abilities: play({ e: 'evolve', target: { t: 'all', filter: { type: 'minion', side: 'friendly' } }, amount: 2 }),
    heroPower: { effects: [{ e: 'evolve', target: { t: 'chosen' }, amount: 1 }], target: friendlyMinion },
  },
  // 製影者史蓋伯斯：所有手下回到手牌，召喚兩個 4/2 潛行暗影；英雄能力讓下一張牌消耗減少(2)
  AV_203: {
    abilities: play(
      { e: 'returnToHand', target: { t: 'all', filter: { type: 'minion' } } },
      { e: 'summon', card: 'AV_203t', count: 2, who: 'self' },
    ),
    heroPower: { effects: [{ e: 'nextCardDiscount', amount: 2 }] },
    tokens: ['AV_203t'],
  },
  // 葛拉克朗（基本形態；不支援祈願升級）
  DRG_600: {
    abilities: play({ e: 'summonRandom', pool: { type: 'MINION', race: 'DEMON' }, count: 1, who: 'self' }),
    heroPower: { effects: [{ e: 'summon', card: 'DRG_238t12t2', count: 2, who: 'self' }], needsBoardSpace: true },
    tokens: ['DRG_238t12t2'],
  },
  DRG_610: {
    abilities: play({ e: 'draw', count: 1, who: 'self' }, { e: 'costMod', amount: -99, scope: 'it' }),
    heroPower: { effects: [{ e: 'custom', fn: 'addOneOf', args: { cards: LACKEYS } }] },
    tokens: LACKEYS,
  },
  DRG_620: {
    abilities: play({ e: 'summon', card: 'DRG_620t4', count: 2, who: 'self' }),
    heroPower: { effects: [{ e: 'summon', card: 'DRG_238t14t3', count: 1, who: 'self' }], needsBoardSpace: true },
    tokens: ['DRG_620t4', 'DRG_238t14t3'],
  },
  DRG_650: {
    abilities: play({ e: 'draw', count: 1, who: 'self', pool: { type: 'MINION' } }, { e: 'buff', target: { t: 'it' }, atk: 4, hp: 4 }),
    heroPower: { effects: [{ e: 'heroAttack', amount: 3 }] },
  },
  DRG_660: {
    abilities: play({ e: 'destroy', target: { t: 'random', filter: { type: 'minion', side: 'enemy' }, count: 1 } }),
    heroPower: { effects: [{ e: 'addRandom', pool: { type: 'MINION', cls: 'PRIEST' }, count: 1, who: 'self' }] },
  },
  // 『死屍獸王』雷克薩：對所有敵方手下造成 2 點傷害；英雄能力「製造殭屍獸」
  //（先發現一張獵人野獸，再發現一張殭屍獸專用野獸，縫合成一張卡加入手牌）
  ICC_828: {
    abilities: play({ e: 'damage', target: { t: 'all', filter: { type: 'minion', side: 'enemy' } }, amount: 2 }),
    heroPower: { effects: [{ e: 'custom', fn: 'buildABeast' }] },
    tokens: ['ICC_828t', 'ICC_828t2', 'ICC_828t3', 'ICC_828t4', 'ICC_828t5', 'ICC_828t6', 'ICC_828t7'],
  },
  // 殭屍獸本體（數值與效果由兩個部位合成，見 src/cards/zombeast.ts）
  ICC_828t: {},

  // ------------------------------------------------------------------ 死亡騎士：屍體
  // 屍爆術：引爆一具屍體對所有手下造成 1 點傷害，若還有手下存活就重複
  RLK_035: { abilities: play({ e: 'custom', fn: 'corpseExplosion' }) },
  // 滿手屍體：對一個手下造成等同你屍體數的傷害
  WW_354: { target: chosenMinion, abilities: play({ e: 'damage', target: { t: 'chosen' }, amount: { dyn: 'corpses' }, spell: true }) },
  // 骨髓操控者：戰吼：消耗最多 5 具屍體，每具對一個隨機敵人造成 2 點傷害
  RLK_505: {
    abilities: play({
      e: 'spendCorpsesUpTo',
      max: 5,
      each: [{ e: 'damage', target: { t: 'random', filter: { type: 'character', side: 'enemy' }, count: 1 }, amount: 2 }],
    }),
  },
  // 麥奈希爾之力：戰吼：消耗最多 3 具屍體，冰凍等量的敵方手下
  RLK_740: {
    abilities: play({ e: 'spendCorpsesUpTo', max: 3, each: [{ e: 'freeze', target: { t: 'random', filter: { type: 'minion', side: 'enemy' }, count: 1 } }] }),
  },
  // 屍體農場：消耗最多 8 具屍體，召喚一個消耗等同數量的隨機手下
  WW_374: { abilities: play({ e: 'spendCorpsesUpTo', max: 8, custom: 'corpseFarm' }) },
  // 屍體新娘：戰吼：消耗最多 10 具屍體，召喚一個攻擊力與生命值等同數量的嘲諷新郎
  RLK_504: { abilities: play({ e: 'spendCorpsesUpTo', max: 10, custom: 'corpseBride' }), tokens: ['RLK_506t'] },
  // 除霜：抽一張牌；消耗 2 具屍體再抽一張
  RLK_101: { abilities: play({ e: 'draw', count: 1, who: 'self' }, { e: 'spendCorpses', amount: 2, then: [{ e: 'draw', count: 1, who: 'self' }] }) },
  // 墳墓之力：你的手下 +1 攻擊力；消耗 5 具屍體改為 +3 攻擊力
  RLK_707: {
    abilities: play({
      e: 'spendCorpses',
      amount: 5,
      then: [{ e: 'buff', target: { t: 'all', filter: { type: 'minion', side: 'friendly' } }, atk: 3 }],
      else: [{ e: 'buff', target: { t: 'all', filter: { type: 'minion', side: 'friendly' } }, atk: 1 }],
    }),
  },
  // 鮮血汲取：你手牌中的所有手下 +1/+1；消耗 2 具屍體再 +1/+1
  RLK_712: {
    abilities: play(
      { e: 'handBuff', atk: 1, hp: 1, scope: 'all' },
      { e: 'spendCorpses', amount: 2, then: [{ e: 'handBuff', atk: 1, hp: 1, scope: 'all' }] },
    ),
  },
  // 墮落新兵：戰吼：消耗 2 具屍體，你手牌中的所有手下 +2 攻擊力
  RLK_731: { abilities: play({ e: 'spendCorpses', amount: 2, then: [{ e: 'handBuff', atk: 2, hp: 0, scope: 'all' }] }) },
  // 骨煞領主馬洛加：戰吼：喚起所有屍體成為 1/1 衝刺魔像；放不下的，每具給其中一個 +2/+2
  RLK_085: { abilities: play({ e: 'spendCorpsesUpTo', max: 99, custom: 'marrowgar' }), tokens: ['RLK_085t'] },

  // ------------------------------------------------------------------ 死亡騎士（第二批）
  // 狼吞虎嚥：召喚五個 5/4 飛龍；消耗 8 具屍體讓它們獲得突襲
  CATA_465: { abilities: play(fn('chowDown')), tokens: ['CATA_465t'] },
  // 病態蟲群：二選一——召喚兩隻 1/1 螞蟻；或消耗 2 具屍體對一個手下造成 4 點傷害
  EDR_813: {
    chooseOne: [
      { id: 'EDR_813a', name: '腐敗蟻群', text: '召喚兩個1/1螞蟻', abilities: play({ e: 'summon', card: 'EDR_813at', count: 2, who: 'self' }) },
      {
        id: 'EDR_813b',
        name: '蟲咬',
        text: '消耗2個<b>屍體</b>對一個手下造成$4點傷害',
        abilities: play({ e: 'spendCorpses', amount: 2, then: [hit(4)] }),
        target: chosenMinion,
      },
    ],
    tokens: ['EDR_813at'],
  },
  // 吞噬：對兩個隨機敵方手下造成 3 點傷害，每死一個抽一張牌
  CORE_CATA_007: { abilities: play(fn('consumption')) },
  // 竊魂者：消滅其他所有手下，每消滅一個敵方手下獲得 1 具屍體
  CORE_RLK_741: { abilities: play(fn('soulstealer')) },
  // 窒息術：消滅攻擊力最高的敵方手下
  CORE_RLK_087: { abilities: play(fn('destroyHighestAttack')) },
  // 天譴軍團：用隨機不死族填滿你的場面
  CORE_RLK_122: { abilities: play(fn('fillBoardRandom', { race: 'UNDEAD' })) },
  // 亞歷山卓斯‧莫格萊尼：本場對戰剩下的時間，你的回合結束時對對手造成 3 點傷害
  CORE_RLK_706: {
    abilities: play({ e: 'eternal', ability: { on: { k: 'turnEnd', whose: 'mine' }, effects: [{ e: 'damage', target: { t: 'hero', side: 'enemy' }, amount: 3 }] } }),
  },
  // 血族之裔：英雄 +5 生命值；消耗 3 具屍體再 +5 並抽一張牌
  CORE_RLK_051: {
    abilities: play({ e: 'heroMaxHealth', amount: 5 }, { e: 'spendCorpses', amount: 3, then: [{ e: 'heroMaxHealth', amount: 5 }, { e: 'draw', count: 1, who: 'self' }] }),
  },
  // 破魂者：英雄攻擊並消滅一個手下後，獲得 2 具屍體
  CORE_RLK_012: { abilities: heroAttacked(fn('afterHeroKill', { corpses: 2 })) },
  // 霜之哀傷：亡語：召喚所有被這把武器消滅的手下
  CORE_RLK_086: { abilities: dr(fn('frostmourne')) },
  // 死靈禮儀師：若友方不死族在你上回合結束後死亡，發現一張穢邪符文牌
  CORE_RLK_116: { abilities: play({ e: 'cond', cond: { c: 'undeadDiedSinceLastTurn' }, then: [{ e: 'discover', pool: { rune: 'unholy' } }] }) },
  // 魂眠儀式：你的手下 +1 攻擊力與突襲，在你的回合結束時死亡
  DINO_417: { abilities: play({ e: 'buff', target: allFriendly, atk: 1, keywords: ['RUSH'], abilities: [dieAtEndOfTurn] }) },
  // 作物輪替：召喚四個有突襲、回合結束時死亡的 1/1 不死族
  WW_368: { abilities: play({ e: 'summon', card: 'WW_368t', count: 4, who: 'self' }), tokens: ['WW_368t'] },
  // 採礦受害者：召喚兩個有「亡語：召喚一個 1/1 脆弱食屍鬼」的白銀之手新兵
  DEEP_017: {
    abilities: play({
      e: 'repeat',
      times: 2,
      effects: [
        { e: 'summon', card: 'CS2_101t', count: 1, who: 'self' },
        { e: 'buff', target: { t: 'it' }, abilities: dr({ e: 'summon', card: 'HERO_11bpt', count: 1, who: 'self' }) },
      ],
    }),
  },
  // 凝霜雕刻者：召喚兩個 2/1 霜凍元素（亡語：對一個隨機敵人造成 2 點傷害）
  LEG_RLK_752: { abilities: play({ e: 'summon', card: 'RLK_907t', count: 2, who: 'self' }), tokens: ['RLK_907t'] },
  // 飲血：生命竊取，對一個手下造成 3 點傷害，英雄能力可再使用
  JAIL_441: { keywords: ['LIFESTEAL'], target: chosenMinion, abilities: play(hit(3), { e: 'refreshHeroPower' }) },
  // 骸骨亂舞：隨機分配 3 點傷害給敵人；若本回合有友方手下死亡，再 3 點
  JAIL_445: {
    abilities: play(
      { e: 'splitDamage', filter: { side: 'enemy', type: 'character' }, amount: 3, spell: true },
      { e: 'cond', cond: { c: 'friendlyDiedThisTurn' }, then: [{ e: 'splitDamage', filter: { side: 'enemy', type: 'character' }, amount: 3, spell: true }] },
    ),
  },
  // 緊急手術：召喚四個 3/1 生命竊取的不死族，攻擊所選的敵方手下
  JAIL_454: { target: enemyMinion, abilities: play(fn('emergencySurgery')), tokens: ['JAIL_454t'] },
  // 食屍鬼疊羅漢：此手下受到傷害後，召喚兩個 1/1 脆弱食屍鬼
  JAIL_440: { abilities: [{ on: { k: 'damaged', subject: 'self' }, effects: [{ e: 'summon', card: 'HERO_11bpt', count: 2, who: 'self' }] }] },
  // 嚎叫約德爾歌手：觸發一個友方手下的亡語兩次
  JAM_005: { target: { filter: { type: 'minion', side: 'friendly' }, optional: true }, abilities: play(fn('triggerDeathrattle', { times: 2 })) },
  // 腳感冰冷：敵方手下在下回合消耗增加 (5)
  JAM_006: { abilities: play({ e: 'minionTax', amount: 5 }) },
  // 焦油浪潮：對全部敵方手下造成 2 點傷害，敵方手下在下回合消耗增加 (2)
  TLC_439: { abilities: play({ e: 'damage', target: allEnemy, amount: 2, spell: true }, { e: 'minionTax', amount: 2 }) },
  // 死亡斷訊：消滅你的不死族，再重新召喚它們
  JAM_008: { abilities: play(fn('deadAir')) },
  // 縫補者：消滅對手手牌、牌堆與戰場上各一個隨機手下
  LEG_RLK_071: { abilities: play(fn('patchwerk')) },
  // 劇毒死屍：對一個敵人與你的英雄各造成 2 點傷害
  LEG_RLK_079: {
    target: { filter: { type: 'character', side: 'enemy' }, optional: true },
    abilities: play(hit(2, false), { e: 'damage', target: { t: 'hero', side: 'friendly' }, amount: 2 }),
  },
  // 死亡使者薩魯法爾：嘲諷；亡語：回到你的手牌，改為消耗生命值
  LEG_RLK_082: { keywords: ['TAUNT'], abilities: dr(fn('returnCostsHealth')) },
  // 噁心巨怪：敵方角色無法被治療
  LEG_RLK_115: { flags: ['enemyNoHeal'] },
  // 監督者弗力吉達拉：抽兩張法術；若都是冰霜法術，對全部敵人造成 2 點傷害
  LEG_RLK_224: { abilities: play(fn('frigidara')) },
  // 霜牙之劍：英雄攻擊後，手中一張法術消耗減少 (1)
  LEG_RLK_710: { abilities: heroAttacked(fn('discountRandomSpell', { amount: 1 })) },
  // 屈辱之盔：一個手下 -5/-5，手中一個隨機手下 +5/+5
  MIS_100: { target: chosenMinion, abilities: play(fn('debuff', { atk: 5, hp: 5 }), { e: 'handBuff', atk: 5, hp: 5, scope: 'random' }) },
  // 泡棉裂斧：英雄攻擊時，消耗 3 具屍體獲得 +1 耐久度
  MIS_101: { abilities: [{ on: { k: 'attack', subject: 'friendlyHero' }, effects: [{ e: 'spendCorpses', amount: 3, then: [{ e: 'weaponBuff', dur: 1 }] }] }] },
  // 黑暗變身：把一個不死族變成 4/5 突襲的不死畸怪
  RLK_057: {
    target: { filter: { type: 'minion', side: 'any', race: 'UNDEAD' } },
    abilities: play({ e: 'transform', target: { t: 'chosen' }, card: 'RLK_057t' }),
    tokens: ['RLK_057t'],
  },
  // 依米亞破霜者：手中每有一張冰霜法術 +1 攻擊力
  RLK_110: { abilities: play(fn('attackPerSpellSchool', { school: 'FROST' })) },
  // 絞肉機：絞碎牌堆中一個隨機手下，獲得 4 具屍體
  RLK_120: { abilities: play(fn('meatGrinder')) },
  // 疫牙：感染全部敵方手下，它們死亡時你召喚一個 2/2 嘲諷殭屍
  RLK_225: {
    abilities: play({ e: 'buff', target: allEnemy, abilities: dr({ e: 'summon', card: 'RLK_118t3', count: 1, who: 'opponent' }) }),
    tokens: ['RLK_118t3'],
  },
  // 沸血術：生命竊取；感染全部敵方手下，你的回合結束時它們受到 2 點傷害
  RLK_730: {
    keywords: ['LIFESTEAL'],
    abilities: play({ e: 'buff', target: allEnemy, abilities: [{ on: { k: 'turnEnd', whose: 'opp' }, effects: [fn('plagueTick', { amount: 2 })] }] }),
  },
  // 冰川突進：造成 4 點傷害，你本回合的下一張法術消耗減少 (2)
  RLK_512: { target: anyChar, abilities: play(hit(4), { e: 'nextSpellDiscount', amount: 2 }) },
  // 碎骨者：英雄攻擊手下後，對敵方英雄造成 2 點傷害
  RLK_516: { abilities: heroAttacked(fn('afterHeroHitMinion', { amount: 2 })) },
  // 惡毒血蟲：手牌中一個手下獲得等同此手下的攻擊力
  RLK_711: { abilities: play(fn('giveAttackEqualSelf')) },
  // 恐怖夢魘：手牌或戰場上一個手下獲得等同此手下的攻擊力
  CATA_161: { abilities: play(fn('giveAttackEqualSelf', { board: true })) },
  // 亡語女士：亡語：複製你手中所有的冰霜法術
  RLK_713: { abilities: dr(fn('copySpellSchoolInHand', { school: 'FROST' })) },
  // 地精嚼食者：嘲諷、生命竊取；在你的回合結束時，攻擊生命值最低的敵人
  RLK_720: { keywords: ['TAUNT', 'LIFESTEAL'], abilities: [{ on: { k: 'turnEnd', whose: 'mine' }, effects: [fn('attackLowestEnemy')] }] },
  // 穢邪狂亂：你的手下攻擊所選的敵方手下，死掉的再召喚回來
  RLK_056: { target: enemyMinion, abilities: play(fn('unholyFrenzy')) },
  // 血液導引：消耗生命值；發現一張法術
  TIME_612: { costsHealth: true, abilities: play({ e: 'discover', pool: { type: 'SPELL' } }) },
  // 生命撕裂者：若你的英雄本回合生命值有變化，對一個敵方手下造成 6 點傷害
  TIME_614: {
    target: { filter: { type: 'minion', side: 'enemy' }, optional: true, when: { c: 'heroHealthChanged' } },
    abilities: play({ e: 'cond', cond: { c: 'heroHealthChanged' }, then: [hit(6, false)] }),
  },
  // 被遺忘的千年：用隨機不死族填滿手牌，本回合改為消耗生命值
  TIME_615: { abilities: play(fn('fillHandHealthCost')) },
  // 回憶顯化：召喚本場對戰中死亡、消耗最高的友方不死族
  TIME_616: { abilities: play(fn('summonBestFromGraveyard')) },
  // 時光凍結者：你的回合開始時不再抽牌
  TIME_617: { flags: ['noTurnDraw'] },
  // 古生物死靈術：發現一個不死族；消耗 5 具屍體改為三張都拿
  TLC_434: { abilities: play(fn('paleomancy')) },
  // 復甦翼手龍：突襲、生命竊取；消耗屍體而不是法力
  TLC_436: { keywords: ['RUSH', 'LIFESTEAL'], costsCorpses: true },
  // 瑪拉達爾主教：你本回合打出的下一張牌改為消耗屍體
  GDB_470: { abilities: play({ e: 'nextCardCostsCorpses' }) },
  // 喧鬧的填充玩偶：突襲；你施放冰霜法術後獲得復生
  TOY_821: {
    keywords: ['RUSH'],
    abilities: [{ on: { k: 'spellCast', side: 'friendly', school: 'FROST' }, effects: [{ e: 'buff', target: { t: 'self' }, keywords: ['REBORN'] }] }],
  },
  // 黑棘針縫師：在你的回合結束時，把等同此手下攻擊力的傷害隨機分配給敵人
  TOY_824: { abilities: [{ on: { k: 'turnEnd', whose: 'mine' }, effects: [{ e: 'splitDamage', filter: { side: 'enemy', type: 'character' }, amount: { dyn: 'selfAttack' } }] }] },
  // 絕望絲線：賦予全部手下「亡語：對全部手下造成 1 點傷害」
  TOY_826: {
    abilities: play({
      e: 'buff',
      target: { t: 'all', filter: { type: 'minion', side: 'any' } },
      abilities: dr({ e: 'damage', target: { t: 'all', filter: { type: 'minion', side: 'any' } }, amount: 1 }),
    }),
  },
  // 霜凍掠劫者：亡語：冰凍 3 個隨機敵人，已被冰凍的改為受到 5 點傷害
  VAC_402: { abilities: dr(fn('freezeOrShatter')) },
  // 伊莉莎‧凝血刃：亡語：本場對戰剩下的時間，你的手下 +1 攻擊力
  VAC_426: { abilities: dr({ e: 'minionAtkBonus', amount: 1 }) },
  // 屍淇淋：造成 3 點傷害；消耗 3 具屍體讓它在回合結束時回到你的手牌
  VAC_427: { target: anyChar, abilities: play(hit(3), { e: 'spendCorpses', amount: 3, then: [fn('returnAtEndOfTurn')] }) },
  // 滑雪高手：若有角色被冰凍，消耗 (1)
  VAC_429: { costIf: { cond: { c: 'anyFrozen' }, cost: 1 } },
  // 脆骨海賊：每當你打出有亡語的手下，使其獲得復生
  VAC_436: {
    abilities: [
      { on: { k: 'cardPlayed', side: 'friendly', cardType: 'MINION' }, cond: { c: 'itHasDeathrattle' }, effects: [{ e: 'buff', target: { t: 'it' }, keywords: ['REBORN'] }] },
    ],
  },
  // 食屍鬼之夜：召喚五個 1/1 食屍鬼，各自攻擊隨機敵人
  VAC_445: { abilities: play(fn('summonAndAttackRandom', { card: 'VAC_445t', count: 5 })), tokens: ['VAC_445t'] },
  // 滑溜坡道：冰凍一個角色，每有一個被冰凍的角色抽一張牌
  VAC_513: { target: anyChar, abilities: play({ e: 'freeze', target: { t: 'chosen' } }, { e: 'draw', count: { dyn: 'frozenChars' }, who: 'self' }) },
  // 靈魂搜尋：從你的牌堆發現一張卡；消耗 5 具屍體再複製一張
  WORK_070: { abilities: play(fn('discoverFromDeck', { copyCorpses: 5 })) },
  // 北境導覽：從你的牌堆發現一張法術；若是冰霜法術，冰凍一個隨機敵方手下
  TTN_735: { abilities: play(fn('discoverFromDeck', { type: 'SPELL', frostFreeze: true })) },
  // 礦坑老大雷斯卡：突襲；本場對戰每死亡一個手下消耗減少 (1)；亡語：奪取一個隨機敵方手下
  WW_373: {
    keywords: ['RUSH'],
    costRule: { per: 'deathsThisGame', amount: 1 },
    abilities: dr({ e: 'steal', target: { t: 'random', filter: { type: 'minion', side: 'enemy' }, count: 1 } }),
  },
  // 死亡咆哮：把一個手下的亡語擴散到相鄰的手下
  ETC_424: { target: chosenMinion, abilities: play(fn('spreadDeathrattle')) },
  // 骸骨速彈手：消耗 5 具屍體，觸發並獲得一個本場死亡的友方手下的亡語
  ETC_428: { abilities: play(fn('boneshredder')) },
  // 炫彩育母：突襲；此手下攻擊時，回復等同其攻擊力的法力水晶
  CATA_469: { keywords: ['RUSH'], abilities: [{ on: { k: 'attack', subject: 'self' }, effects: [fn('refreshManaByAttack')] }] },
  // 塔蘭姬的最後一搏：賦予你的手下「亡語：召喚一個隨機 4 費手下」
  CATA_471: { abilities: play({ e: 'buff', target: allFriendly, abilities: dr({ e: 'summonRandom', pool: { type: 'MINION', cost: 4 }, count: 1, who: 'self' }) }) },
  // 厄索克：戰吼：攻擊其他所有手下；亡語：復活它消滅的手下
  EDR_819: { abilities: [...play(fn('ursoc')), ...dr(fn('resurrectKilled'))] },
  // 氣閘破口：召喚 5/5 嘲諷不死族，英雄 +5 生命值；消耗 5 具屍體再來一次
  GDB_113: { abilities: play(fn('airlockBreach')), tokens: ['GDB_113t'] },
  // 靈魂喚醒者：嘲諷、復生；亡語：復活另一個友方亡語手下
  GDB_468: { keywords: ['TAUNT', 'REBORN'], abilities: dr(fn('resurrectDeathrattle')) },
  // 來自異界的8隻手：雙方的牌堆只留下消耗最高的 8 張
  GDB_477: { abilities: play(fn('eightHands')) },
  // 同化疫病：發現一個 3 費亡語手下，召喚它並賦予復生
  GDB_478: { abilities: play(fn('discoverSummon', { cost: 3, reborn: true })) },
  // 昂布拉的故事：發現一個 5 費以上的亡語手下，召喚它並觸發其亡語
  DINO_415: { abilities: play(fn('discoverSummon', { minCost: 5, trigger: true })) },
  // 法勒瑞克：你獲得的屍體加倍；戰吼：抽一張會消耗屍體的卡
  CORE_EDR_003: { flags: ['doubleCorpses'], abilities: play({ e: 'draw', count: 1, who: 'self', pool: { spendsCorpses: true } }) },
  // 死亡金屬騎士：嘲諷；若你的英雄本回合被治療過，改為消耗生命值
  CORE_ETC_523: { keywords: ['TAUNT'], costsHealthIf: { c: 'heroHealed' } },
  // 阿薩斯的禮物：發現一張暫時的黑暗變身、凜風衝擊或死亡打擊
  CORE_GIFT_04: { abilities: play(fn('giftOf', { cards: ['RLK_057', 'RLK_015', 'RLK_024'] })) },
  // 石英粉碎錘：生命竊取；冰凍被你的英雄傷害的角色
  DEEP_016: { keywords: ['LIFESTEAL', 'FREEZE_ON_DAMAGE'] },
  // 尖嘯女妖：生命竊取；你的英雄獲得生命值後，召喚一個屬性等同回復量的靈魂
  ETC_522: {
    keywords: ['LIFESTEAL'],
    abilities: [{ on: { k: 'healed', subject: 'friendly' }, cond: { c: 'not', cond: { c: 'itIsMinion' } }, effects: [fn('summonSoulFromEvent', { card: 'ETC_522t' })] }],
    tokens: ['ETC_522t'],
  },
  // 染疫的穀物：獲得 4 具屍體；把四個穀物箱洗入你的牌堆（抽到時召喚 2/2 不死的農民）
  LEG_RLK_039: { abilities: play({ e: 'gainCorpses', amount: 4 }, { e: 'shuffle', card: 'RLK_039t', count: 4 }), tokens: ['RLK_039t'] },
  RLK_039t: { abilities: play({ e: 'summon', card: 'RLK_070t', count: 1, who: 'self' }), tokens: ['RLK_070t'] },
  // 三種瘟疫（抽到時施放）
  TTN_450t: { abilities: play({ e: 'damage', target: { t: 'hero', side: 'friendly' }, amount: 2 }, { e: 'heal', target: { t: 'hero', side: 'enemy' }, amount: 2 }) },
  TTN_450t2: {
    abilities: play({ e: 'damage', target: { t: 'hero', side: 'friendly' }, amount: 2 }, { e: 'summon', card: 'RLK_070t', count: 1, who: 'opponent' }),
    tokens: ['RLK_070t'],
  },
  TTN_450t3: { abilities: play({ e: 'damage', target: { t: 'hero', side: 'friendly' }, amount: 2 }, { e: 'nextCardDiscount', amount: -1 }) },
  // 憂慮的科瓦迪爾：亡語：把兩張隨機瘟疫洗入對手的牌堆
  TTN_450: { abilities: dr(fn('shufflePlagues', { count: 2 })), tokens: PLAGUES },
  // 隨船沉沒：造成 3 點傷害，把兩張隨機瘟疫洗入對手的牌堆
  TTN_454: { target: anyChar, abilities: play(hit(3), fn('shufflePlagues', { count: 2 })), tokens: PLAGUES },
  // 叛墓者：消滅對手牌堆中的一張瘟疫，對全部敵方手下造成 3 點傷害
  TTN_455: { abilities: play(fn('destroyPlague')), tokens: PLAGUES },
  // 統御者之杖：英雄攻擊後，把一張隨機瘟疫洗入對手的牌堆
  TTN_736: { abilities: heroAttacked(fn('shufflePlagues', { count: 1 })), tokens: PLAGUES },
  // 縛練守護者：突襲、復生；本場每洗一張瘟疫到對手牌堆，消耗減少 (1)
  TTN_459: { keywords: ['RUSH', 'REBORN'], costRule: { per: 'plaguesShuffled', amount: 1 }, tokens: PLAGUES },
  // 弗柯羅斯：突襲、嘲諷；戰吼：花費 10、20 或 30 具屍體獲得等量的屬性值
  FIR_951: { keywords: ['RUSH', 'TAUNT'], abilities: play(fn('spendCorpsesForStats')) },

  // ------------------------------------------------------------------ 比武（雙方各揭露牌堆一張手下，你的消耗較高就獲勝）
  // 治療波：恢復 8 點生命值；比武獲勝則改為恢復 16 點
  AT_048: {
    target: anyChar,
    abilities: play({ e: 'joust', then: [{ e: 'heal', target: { t: 'chosen' }, amount: 16 }], else: [{ e: 'heal', target: { t: 'chosen' }, amount: 8 }] }),
  },
  // 國王的伊萊克：比武獲勝則抽出那張牌
  AT_058: { abilities: play({ e: 'joust', then: [{ e: 'custom', fn: 'drawRevealed' }] }) },
  // 銀白長槍：比武獲勝則 +1 耐久度
  AT_077: { abilities: play({ e: 'joust', then: [{ e: 'weaponBuff', dur: 1 }] }) },
  // 巨牙矛騎兵：比武獲勝則為你的英雄恢復 7 點生命值
  AT_104: { abilities: play({ e: 'joust', then: [{ e: 'heal', target: { t: 'hero', side: 'friendly' }, amount: 7 }] }) },
  // 裝甲戰馬：比武獲勝則獲得衝鋒
  AT_108: { abilities: play({ e: 'joust', then: [{ e: 'buff', target: { t: 'self' }, keywords: ['CHARGE'] }] }) },
  // 至尊矛騎兵：比武獲勝則獲得嘲諷與聖盾
  AT_112: { abilities: play({ e: 'joust', then: [{ e: 'buff', target: { t: 'self' }, keywords: ['TAUNT', 'DIVINE_SHIELD'] }] }) },
  // 骷髏騎士：亡語：比武獲勝則回到你的手牌
  AT_128: { abilities: [{ on: { k: 'deathrattle' }, effects: [{ e: 'joust', then: [{ e: 'addCard', card: 'AT_128', count: 1, who: 'self' }] }] }] },
  // 加基森矛騎兵：比武獲勝則獲得 +1/+1
  AT_133: { abilities: play({ e: 'joust', then: [{ e: 'buff', target: { t: 'self' }, atk: 1, hp: 1 }] }) },

  // ------------------------------------------------------------------ 翠玉魔像 / 號召 / 滅殺
  // 翠玉塑像：二選一：召喚一個翠玉魔像；或把 3 張翠玉塑像洗入你的牌堆
  CFM_602: {
    chooseOne: [
      { id: 'CFM_602a', name: '翠玉塑像', text: '召喚一個<b>翠玉魔像</b>', abilities: play({ e: 'summonJade' }) },
      { id: 'CFM_602b', name: '翠玉塑像', text: '將3張翠玉塑像洗入你的牌堆', abilities: play({ e: 'shuffle', card: 'CFM_602', count: 3 }) },
    ],
    tokens: ['CFM_712_t01'],
  },
  // 翠玉通訊：看對手手牌中的 3 張牌，把其中一張洗進他的牌堆；召喚一個翠玉魔像
  WON_078: { abilities: play({ e: 'custom', fn: 'jadeTelegram' }, { e: 'summonJade' }), tokens: ['CFM_712_t01'] },
  // 橡心大師：戰吼：號召攻擊力 1、2、3 的手下各一個
  LOOT_521: { abilities: play({ e: 'custom', fn: 'oakheart' }) },
  // 蘇薩斯：滅殺：你可以再攻擊一次
  TRL_325: { abilities: [{ on: { k: 'overkill' }, effects: [{ e: 'custom', fn: 'attackAgain' }] }] },
  // 烏達斯塔：突襲；滅殺：從你的手牌召喚一個野獸
  TRL_542: { keywords: ['RUSH'], abilities: [{ on: { k: 'overkill' }, effects: [{ e: 'custom', fn: 'summonFromHand', args: { race: 'BEAST' } }] }] },
  // 競技場觀眾：滅殺：召喚另一個競技場觀眾
  TRL_521: { abilities: [{ on: { k: 'overkill' }, effects: [{ e: 'summon', card: 'TRL_521', count: 1, who: 'self' }] }] },
  // 法拉奇戰斧：滅殺：賦予你手牌中的一個手下 +2/+2
  TRL_304: { abilities: [{ on: { k: 'overkill' }, effects: [{ e: 'handBuff', atk: 2, hp: 2, scope: 'random' }] }] },
  // 整裝備戰：召喚三個白銀之手新兵，裝備一把 1/4 的武器（聖光的正義）
  GVG_061: {
    abilities: play({ e: 'summon', card: 'CS2_101t', count: 3, who: 'self' }, { e: 'equip', card: 'CS2_091' }),
    tokens: ['CS2_091'],
  },
  // 戰線擊破者：滅殺：此手下的攻擊力加倍
  TRL_528: { abilities: [{ on: { k: 'overkill' }, effects: [{ e: 'doubleStat', target: { t: 'self' }, stat: 'atk' }] }] },

  // ------------------------------------------------------------------ 星艦
  // 星艦本體：數值與效果由組件組成（見 src/cards/starship.ts）
  GDB_100t2: {},
  GDB_100t4: {},
  GDB_100t5: {},
  GDB_100t6: {},
  GDB_100t7: {},
  GDB_100t8: {},
  GDB_100t9: {},
  SC_999t: {},
  // 星艦結構圖：發現一張其他職業的星艦組件，其消耗減少 (1)
  GDB_102: {
    abilities: play({ e: 'discover', pool: { type: 'MINION', starshipPiece: true, otherClass: true } }, { e: 'costMod', amount: -1, scope: 'it' }),
  },
  // 薩塔隱蔽力場：法術免疫；你每回合的第一張法術消耗減少 (1)
  GDB_103: { keywords: ['ELUSIVE'], auras: [{ scope: 'firstSpellDiscount', cost: 1 }] },
  // 魔焰推進器：法術迸發：對 2 個隨機敵方手下造成等同此手下攻擊力的傷害
  GDB_104: {
    abilities: [
      {
        on: { k: 'spellCast', side: 'friendly' },
        once: true,
        effects: [{ e: 'damage', target: { t: 'random', filter: { type: 'minion', side: 'enemy' }, count: 2 }, amount: { dyn: 'selfAttack' } }],
      },
    ],
  },
  // 船首刻像：法術迸發：觸發一個隨機友方手下的亡語
  GDB_106: { abilities: [{ on: { k: 'spellCast', side: 'friendly' }, once: true, effects: [{ e: 'custom', fn: 'triggerRandomDeathrattle' }] }] },
  // 樣本鉗爪：在你的對手打出一個手下後，攻擊它
  GDB_107: { abilities: [{ on: { k: 'cardPlayed', side: 'enemy', cardType: 'MINION' }, effects: [{ e: 'custom', fn: 'attackIt' }] }] },
  // 星光反應爐：在你施放一個秘法法術後，再施放一次（目標隨機）
  GDB_108: { abilities: [{ on: { k: 'spellCast', side: 'friendly', school: 'ARCANE' }, effects: [{ e: 'custom', fn: 'recastIt' }] }] },
  // 縛魂尖塔：亡語：召喚一個消耗等同此手下攻擊力的隨機手下（最多 10）
  GDB_112: { abilities: [{ on: { k: 'deathrattle' }, effects: [{ e: 'custom', fn: 'summonCostEqualAttack' }] }] },
  // 艾克索達：戰吼：若你正在建造星艦，發射它並選擇一個協定
  GDB_120: {
    abilities: play({ e: 'cond', cond: { c: 'buildingStarship' }, then: [{ e: 'custom', fn: 'exodar' }] }),
    tokens: ['GDB_100a', 'GDB_100b', 'GDB_100c'],
  },
  GDB_100a: {},
  GDB_100b: {},
  GDB_100c: {},
  // 不祥之兆：2 回合後召喚兩個 6/6 嘲諷惡魔；若你正在建造星艦，立刻召喚
  GDB_124: {
    abilities: play({
      e: 'cond',
      cond: { c: 'buildingStarship' },
      then: [{ e: 'summon', card: 'GDB_124t2', count: 2, who: 'self' }],
      else: [{ e: 'delayed', turns: 2, effects: [{ e: 'summon', card: 'GDB_124t2', count: 2, who: 'self' }] }],
    }),
    tokens: ['GDB_124t2'],
  },
  // 星際狐狸人：戰吼：摧毀一艘敵方星艦或星艦組件
  GDB_340: {
    keywords: ['TRADEABLE'],
    target: { filter: { type: 'minion', side: 'enemy', starship: true }, optional: true },
    abilities: play({ e: 'destroy', target: { t: 'chosen' } }),
  },
  // 翻滾：對一個未受傷的角色造成 5 點傷害；若你正在建造星艦，消耗為 (1)
  GDB_465: {
    target: { filter: { type: 'character', side: 'any', undamaged: true } },
    abilities: play({ e: 'damage', target: { t: 'chosen' }, amount: 5, spell: true }),
    costIf: { cond: { c: 'buildingStarship' }, cost: 1 },
  },
  // 重力移轉裝置：發射時召喚一艘星艦的複製
  GDB_466: { abilities: [{ on: { k: 'launch' }, effects: [{ e: 'summonCopy', target: { t: 'self' }, count: 1 }] }] },
  // 曲速引擎：抽 2 張牌；若你正在建造星艦，它們的消耗減少 (2)
  GDB_474: { abilities: play({ e: 'custom', fn: 'warpDrive' }) },
  // 窒息：消滅一個手下；若你正在建造星艦，也消滅一個隨機的相鄰手下
  GDB_476: { target: chosenMinion, abilities: play({ e: 'custom', fn: 'suffocate' }) },
  // 雷射彈幕：對一個手下造成 3 點傷害；若你正在建造星艦，也對其相鄰手下造成傷害
  GDB_845: {
    target: chosenMinion,
    abilities: play(
      { e: 'damage', target: { t: 'chosen' }, amount: 3, spell: true },
      { e: 'cond', cond: { c: 'buildingStarship' }, then: [{ e: 'damage', target: { t: 'adjacent', of: 'chosen' }, amount: 3, spell: true }] },
    ),
  },
  // 奧薩爾主教：戰吼：若你正在建造星艦，獲得 3 張不同的秘法法術，其消耗減少 (2)
  GDB_856: { abilities: play({ e: 'cond', cond: { c: 'buildingStarship' }, then: [{ e: 'custom', fn: 'othaar' }] }) },
  // 費心張羅的船匠：戰吼：隨機獲得一張其他職業的星艦組件
  GDB_876: { abilities: play({ e: 'addRandom', pool: { type: 'MINION', starshipPiece: true, otherClass: true }, count: 1, who: 'self' }) },

  // ------------------------------------------------------------------ 星海爭霸：人類
  // 吉姆‧雷諾：戰吼：重新發射本場對戰中你發射過的每一艘星艦
  SC_400: {
    abilities: play({ e: 'custom', fn: 'relaunchAll' }),
    heroPower: {
      effects: [
        { e: 'summon', card: 'SC_403t', count: 1, who: 'self' },
        { e: 'buff', target: { t: 'all', filter: { type: 'minion', side: 'friendly', terran: true } }, atk: 2 },
      ],
    },
    tokens: ['SC_403t'],
  },
  // 幽靈特務：戰吼：若你正在建造星艦，摧毀對手手牌中消耗最低的卡
  SC_408: {
    keywords: ['STEALTH'],
    abilities: play({ e: 'cond', cond: { c: 'buildingStarship' }, then: [{ e: 'custom', fn: 'destroyLowestInOppHand' }] }),
  },
  // 升空：抽 2 張人類卡；召喚一個有發射效果的 2/1 星艦組件
  SC_410: {
    abilities: play(
      { e: 'draw', count: 2, who: 'self', pool: { terran: true } },
      { e: 'custom', fn: 'summonOneOf', args: { cards: ['SC_403a', 'SC_403b', 'SC_403d', 'SC_403f'] } },
    ),
    tokens: ['SC_403a', 'SC_403b', 'SC_403d', 'SC_403f'],
  },
  // 惡狼：你的其他手下 +1 攻擊力（發射過星艦後變成戰狼）
  SC_412: { auras: [{ scope: 'otherFriendly', atk: 1 }], launchTransform: 'SC_412t', tokens: ['SC_412t'] },
  SC_412t: { auras: [{ scope: 'otherFriendly', atk: 2, keywords: ['RUSH'] }] },
  // 攻城坦克：戰吼：對一個隨機敵方手下造成 10 點傷害（發射過星艦後，多餘的傷害會打到敵方英雄）
  SC_413: {
    abilities: play({ e: 'damage', target: { t: 'random', filter: { type: 'minion', side: 'enemy' }, count: 1 }, amount: 10 }),
    launchTransform: 'SC_413t',
    tokens: ['SC_413t'],
  },
  SC_413t: { abilities: play({ e: 'custom', fn: 'siegeTank' }) },
  // 雷神號：戰吼：造成 5 點傷害（發射過星艦後，每發射過一艘星艦就對隨機敵人再造成一次）
  SC_414: {
    target: { filter: { type: 'character', side: 'any' }, optional: true },
    abilities: play({ e: 'damage', target: { t: 'chosen' }, amount: 5 }),
    launchTransform: 'SC_414t',
    tokens: ['SC_414t'],
  },
  SC_414t: {
    target: { filter: { type: 'character', side: 'any' }, optional: true },
    abilities: play(
      { e: 'damage', target: { t: 'chosen' }, amount: 5 },
      {
        e: 'repeat',
        times: { dyn: 'starshipsLaunched' },
        effects: [{ e: 'damage', target: { t: 'random', filter: { type: 'character', side: 'enemy' }, count: 1 }, amount: 5 }],
      },
    ),
  },

  // ------------------------------------------------------------------ 克蘇恩
  // 克蘇恩：造成等同其攻擊力的傷害，隨機分配到所有敵人身上
  OG_280: {
    abilities: play({ e: 'splitDamage', filter: { type: 'character', side: 'enemy' }, amount: { dyn: 'selfAttack' } }),
  },
  // 克蘇恩之刃：消滅一個手下，把它的攻擊力和生命值加到你的克蘇恩
  OG_282: {
    target: { filter: { type: 'minion', side: 'any' }, optional: true },
    abilities: play({ e: 'custom', fn: 'bladeOfCthun' }),
  },
  // 厄運召喚者：克蘇恩 +2/+2，若它已死亡則洗入牌堆
  OG_255: {
    abilities: play({ e: 'cthunBuff', atk: 2, hp: 2 }, { e: 'custom', fn: 'cthunRevive' }),
  },
  // 雙子帝王維克洛爾：克蘇恩至少 10 攻擊力時，召喚維克尼拉斯
  OG_131: {
    keywords: ['TAUNT'],
    abilities: [{ on: { k: 'play' }, cond: { c: 'cthunAttack', n: 10 }, effects: [{ e: 'summon', card: 'OG_319', count: 1, who: 'self' }] }],
    tokens: ['OG_319'],
  },
  // 克蘇恩眼柄：克蘇恩獲得攻擊力或生命值時，它也會獲得（由引擎處理）
  WON_144: { keywords: ['TAUNT', 'LIFESTEAL'] },

  // ------------------------------------------------------------------ 2026《浩劫與重生》：碎裂
  // 荒林之環：完整牌先召喚兩個 2/2 樹人，再賦予你的手下「亡語：召喚一個 2/2 樹人」。
  CATA_134: {
    abilities: play(
      { e: 'summon', card: 'EX1_158t', count: 2, who: 'self' },
      { e: 'buff', target: allFriendly, abilities: dr({ e: 'summon', card: 'EX1_158t', count: 1, who: 'self' }) },
    ),
    tokens: ['EX1_158t'],
  },
  // 荒林之環（碎片 1）：召喚兩個 2/2 樹人。
  CATA_134t: {
    abilities: play({ e: 'summon', card: 'EX1_158t', count: 2, who: 'self' }),
    tokens: ['EX1_158t'],
  },
  // 荒林之環（碎片 2）：賦予你的手下「亡語：召喚一個 2/2 樹人」。
  CATA_134t2: {
    abilities: play({ e: 'buff', target: allFriendly, abilities: dr({ e: 'summon', card: 'EX1_158t', count: 1, who: 'self' }) }),
    tokens: ['EX1_158t'],
  },

  // 分裂：完整牌先使一個友方手下 +2/+3 並獲得 Elusive，再召喚該「已強化後」手下的複製。
  // 這個順序符合官方特殊規則：完整分裂可以複製剛獲得 Elusive 的目標。
  CATA_306: {
    target: friendlyMinion,
    abilities: play(
      { e: 'buff', target: { t: 'chosen' }, atk: 2, hp: 3, keywords: ['ELUSIVE'] },
      { e: 'summonCopy', target: { t: 'chosen' }, count: 1 },
    ),
  },
  // 分裂（碎片 1）：+2/+3 並獲得 Elusive。
  CATA_306t1: {
    target: friendlyMinion,
    abilities: play({ e: 'buff', target: { t: 'chosen' }, atk: 2, hp: 3, keywords: ['ELUSIVE'] }),
  },
  // 分裂（碎片 2）：召喚一個友方手下的複製。
  CATA_306t2: {
    target: friendlyMinion,
    abilities: play({ e: 'summonCopy', target: { t: 'chosen' }, count: 1 }),
  },

  // ------------------------------------------------------------------ 回音
  // 葛林達‧鴉羽：你手牌中的手下具有回音
  GIL_618: { auras: [{ scope: 'friendlyHand', keywords: ['ECHO'] }] },
  // 不穩定的進化：把一個友方手下變成隨機一個費用多 (1) 的手下
  LOOT_504: {
    keywords: ['ECHO'],
    target: friendlyMinion,
    abilities: play({ e: 'evolve', target: { t: 'chosen' }, amount: 1 }),
  },
};
