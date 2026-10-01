// 卡牌敘述的顯示格式
import type { CardClass, Race } from '../engine/types';

function escapeHtml(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

/** 把官方卡牌敘述轉成安全的 HTML（只保留粗體 / 斜體 / 換行） */
export function formatCardText(text: string, spellDamage = 0): string {
  let t = text.replace(/<i>\(@\)<\/i>|\(@\)/g, '').split('@')[0];
  t = t.replace(/\[x\]/g, '').replace(/\{\d+\}/g, '');
  t = escapeHtml(t);
  t = t
    .replace(/&lt;b&gt;/g, '<b>')
    .replace(/&lt;\/b&gt;/g, '</b>')
    .replace(/&lt;i&gt;/g, '<i>')
    .replace(/&lt;\/i&gt;/g, '</i>')
    .replace(/\$[ad]?(\d+)/g, (_m, n) => (spellDamage ? `<span class="boosted">*${Number(n) + spellDamage}*</span>` : n))
    .replace(/#(\d+)/g, '$1')
    .replace(/_/g, ' ')
    .replace(/\n/g, '<br>');
  return t;
}

export function plainText(text: string): string {
  return formatCardText(text).replace(/<br>/g, ' ').replace(/<[^>]+>/g, '');
}

export const RACE_NAMES: Record<Race, string> = {
  BEAST: '野獸',
  DEMON: '惡魔',
  DRAGON: '龍類',
  ELEMENTAL: '元素',
  MECHANICAL: '機械',
  MURLOC: '魚人',
  PIRATE: '海盜',
  TOTEM: '圖騰',
  NAGA: '納迦',
  UNDEAD: '不死族',
  QUILBOAR: '野豬人',
  DRAENEI: '德萊尼',
  ALL: '全部',
};

export const CLASS_COLORS: Record<CardClass, string> = {
  NEUTRAL: '#8c7b61',
  DEATHKNIGHT: '#2f8fae',
  DEMONHUNTER: '#2c7a4b',
  DRUID: '#8a5a2b',
  HUNTER: '#3f8b39',
  MAGE: '#3b6fd6',
  PALADIN: '#c99a2e',
  PRIEST: '#b9b9c4',
  ROGUE: '#4b4b52',
  SHAMAN: '#2d4fa6',
  WARLOCK: '#7b3aa9',
  WARRIOR: '#b23a2c',
};

export const RARITY_COLORS: Record<string, string> = {
  FREE: 'transparent',
  COMMON: '#f2f2f2',
  RARE: '#2f7fe0',
  EPIC: '#a647f0',
  LEGENDARY: '#ff8a1c',
};

export function artUrl(cardId: string): string {
  return `https://art.hearthstonejson.com/v1/256x/${cardId}.jpg`;
}

/** 官方完整卡面（含外框、寶石、名稱、敘述），繁體中文 */
export function renderUrl(cardId: string, cssWidth: number): string {
  const dpr = typeof window !== 'undefined' ? window.devicePixelRatio || 1 : 1;
  const res = cssWidth * dpr > 256 ? '512x' : '256x';
  return `https://art.hearthstonejson.com/v1/render/latest/zhTW/${res}/${cardId}.png`;
}

/** 牌組清單用的橫條圖 */
export function tileUrl(cardId: string): string {
  return `https://art.hearthstonejson.com/v1/tiles/${cardId}.png`;
}
