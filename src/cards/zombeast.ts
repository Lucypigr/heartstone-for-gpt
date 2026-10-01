// 殭屍獸（『死屍獸王』雷克薩的英雄能力「製造殭屍獸」）
// 兩隻野獸縫合成一張卡：費用、攻擊、生命相加（費用上限 10），並擁有兩者的關鍵字與效果。
import type { CardDef } from '../engine/types';
import { getCard } from './registry';

export const ZOMBEAST_ID = 'ICC_828t';

/** 第二次「發現」使用的 6 種殭屍獸專用野獸（官方資料 ICC_828t2 ~ t7） */
export const ZOMBEAST_PARTS = ['ICC_828t2', 'ICC_828t3', 'ICC_828t4', 'ICC_828t5', 'ICC_828t6', 'ICC_828t7'];

const cache = new Map<string, CardDef>();

export function zombeastDef(parts: [string, string]): CardDef {
  const key = parts.join('+');
  const hit = cache.get(key);
  if (hit) return hit;
  const [a, b] = parts.map(getCard);
  const base = getCard(ZOMBEAST_ID);
  const strip = (t: string) => t.replace(/\[x\]/g, '').split('@')[0].trim();
  const def: CardDef = {
    ...base,
    cost: Math.min(10, a.cost + b.cost),
    attack: (a.attack ?? 0) + (b.attack ?? 0),
    health: (a.health ?? 0) + (b.health ?? 0),
    races: ['BEAST'],
    text: [strip(a.text), strip(b.text)].filter(Boolean).join('\n'),
    keywords: [...new Set([...(a.keywords ?? []), ...(b.keywords ?? [])])],
    abilities: [...(a.abilities ?? []), ...(b.abilities ?? [])],
    auras: [...(a.auras ?? []), ...(b.auras ?? [])],
    spellDamage: (a.spellDamage ?? 0) + (b.spellDamage ?? 0) || undefined,
    target: a.target ?? b.target,
    collectible: false,
  };
  cache.set(key, def);
  return def;
}
