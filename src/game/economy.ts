// 經濟數值（金幣獎勵 / 卡包 / 合成）集中在這裡，方便調整平衡
import type { Difficulty } from '../engine/ai';
import type { Rarity } from '../engine/types';

export const STARTING_GOLD = 300;
export const STARTING_PACKS: Record<string, number> = { classic: 3 };

export const WIN_REWARD: Record<Difficulty, number> = { easy: 30, normal: 50, hard: 80 };
export const LOSS_REWARD: Record<Difficulty, number> = { easy: 5, normal: 10, hard: 15 };
/** 每日首勝額外獎勵 */
export const DAILY_FIRST_WIN_BONUS = 50;

export const DIFFICULTY_NAMES: Record<Difficulty, string> = { easy: '簡單', normal: '普通', hard: '困難' };

export const CARDS_PER_PACK = 5;

/** 每一格的稀有度：累積機率門檻（傳說 1.2%、史詩 3.3%、稀有 18.5%，其餘普通） */
export const RARITY_ODDS: [Rarity, number][] = [
  ['LEGENDARY', 0.012],
  ['EPIC', 0.045],
  ['RARE', 0.23],
  ['COMMON', 1],
];

/** 連續多少包沒有傳說就保底 */
export const LEGENDARY_PITY = 30;

export const CRAFT_COST: Record<Rarity, number> = { FREE: 0, COMMON: 40, RARE: 100, EPIC: 400, LEGENDARY: 1600 };
export const DISENCHANT_VALUE: Record<Rarity, number> = { FREE: 0, COMMON: 5, RARE: 20, EPIC: 100, LEGENDARY: 400 };

export const RARITY_NAMES: Record<Rarity, string> = {
  FREE: '基本',
  COMMON: '普通',
  RARE: '稀有',
  EPIC: '史詩',
  LEGENDARY: '傳說',
};
