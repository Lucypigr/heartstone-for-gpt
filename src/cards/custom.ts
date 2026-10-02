// ============================================================================
// 自訂卡牌：在這裡新增原創卡牌，不需要重新產生資料就會出現在遊戲中。
// 效果使用與官方卡相同的 DSL（見 src/engine/types.ts）。
// 設 collectible: true 就會出現在卡包與收藏中。
//
// 範例（取消註解即可使用）：
// {
//   id: 'CUSTOM_001',
//   dbfId: 9000001,
//   name: '見習冒險者',
//   nameEn: 'Apprentice Adventurer',
//   text: '<b>戰吼：</b>抽一張牌',
//   type: 'MINION',
//   cardClass: 'NEUTRAL',
//   rarity: 'COMMON',
//   set: 9999,
//   cost: 2,
//   attack: 2,
//   health: 2,
//   collectible: true,
//   abilities: [{ on: { k: 'play' }, effects: [{ e: 'draw', count: 1, who: 'self' }] }],
// },
// ============================================================================
import type { CardDef } from '../engine/types';

export const CUSTOM_CARDS: CardDef[] = [
  {
    id: 'VH_SKELETON_REFRESH',
    dbfId: 9900319,
    name: '刷新選項',
    nameEn: 'Refresh Options',
    text: '重新刷新發現選項。每次刷新有 20% 機率受到 5 點傷害。',
    type: 'SPELL',
    cardClass: 'MAGE',
    rarity: 'FREE',
    set: 9999,
    cost: 0,
    collectible: false,
  },
  {
    id: 'VH_ECTOPLASM',
    dbfId: 9900805,
    name: '靈質',
    nameEn: 'Ectoplasm',
    text: '重新召喚被《Slime \'em!》消滅的手下。',
    type: 'SPELL',
    cardClass: 'PRIEST',
    rarity: 'FREE',
    set: 9999,
    cost: 3,
    collectible: false,
    abilities: [{ on: { k: 'play' }, effects: [{ e: 'custom', fn: 'ectoplasm' }] }],
  },
];
