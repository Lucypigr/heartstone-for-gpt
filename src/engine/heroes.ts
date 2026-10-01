// 各職業的基本英雄能力
import type { CardClass, HeroPowerSpec } from './types';

export const HERO_POWERS: Record<Exclude<CardClass, 'NEUTRAL'>, HeroPowerSpec> = {
  MAGE: {
    effects: [{ e: 'damage', target: { t: 'chosen' }, amount: 1 }],
    target: { filter: { type: 'character', side: 'any' } },
  },
  WARRIOR: { effects: [{ e: 'armor', amount: 2 }] },
  PRIEST: {
    effects: [{ e: 'heal', target: { t: 'chosen' }, amount: 2 }],
    target: { filter: { type: 'character', side: 'any' } },
  },
  HUNTER: { effects: [{ e: 'damage', target: { t: 'hero', side: 'enemy' }, amount: 2 }] },
  ROGUE: { effects: [{ e: 'equip', card: 'CS2_082' }] },
  PALADIN: { effects: [{ e: 'summon', card: 'CS2_101t', count: 1, who: 'self' }], needsBoardSpace: true },
  SHAMAN: { effects: [{ e: 'custom', fn: 'totemicCall' }], needsBoardSpace: true },
  WARLOCK: {
    effects: [
      { e: 'draw', count: 1, who: 'self' },
      { e: 'damage', target: { t: 'hero', side: 'friendly' }, amount: 2 },
    ],
  },
  DRUID: {
    effects: [
      { e: 'heroAttack', amount: 1 },
      { e: 'armor', amount: 1 },
    ],
  },
  DEMONHUNTER: { effects: [{ e: 'heroAttack', amount: 1 }] },
  DEATHKNIGHT: { effects: [{ e: 'summon', card: 'HERO_11bpt', count: 1, who: 'self' }], needsBoardSpace: true },
};

export const BASIC_TOTEMS = ['CS2_050', 'CS2_051', 'NEW1_009', 'CS2_052'];

export const CLASS_NAMES: Record<CardClass, string> = {
  NEUTRAL: '中立',
  DEATHKNIGHT: '死亡騎士',
  DEMONHUNTER: '惡魔獵人',
  DRUID: '德魯伊',
  HUNTER: '獵人',
  MAGE: '法師',
  PALADIN: '聖騎士',
  PRIEST: '牧師',
  ROGUE: '盜賊',
  SHAMAN: '薩滿',
  WARLOCK: '術士',
  WARRIOR: '戰士',
};
