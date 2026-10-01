import { describe, expect, it } from 'vitest';
import { AiBrain, type AiPersona } from '../engine/ai';
import { Game } from '../engine/game';
import { buildDeck, validateDeck } from './decks';
import { applyLadderResult, ensureSeason, findOpponent, LEGEND_STARS, newLadder, rankInfo, recordLadderMatch } from './ladder';
import { newProfile, sanitizeProfile } from './profile';

const seq = (...xs: number[]) => {
  let i = 0;
  return () => xs[i++ % xs.length];
};

describe('天梯牌階', () => {
  it('星星換算成牌階', () => {
    expect(rankInfo(0, null).label).toBe('青銅 10');
    expect(rankInfo(3, null).label).toBe('青銅 9');
    expect(rankInfo(29, null)).toMatchObject({ label: '青銅 1', pips: 2 });
    expect(rankInfo(30, null).label).toBe('白銀 10');
    expect(rankInfo(149, null).label).toBe('鑽石 1');
    expect(rankInfo(LEGEND_STARS, 321).label).toBe('傳說 #321');
  });

  it('勝利 +1 星，第三連勝起 +2 星；落敗 −1 星並中斷連勝', () => {
    let l = newLadder('2026-09');
    l = applyLadderResult(l, 'win').ladder;
    l = applyLadderResult(l, 'win').ladder;
    expect(l.stars).toBe(2);
    const third = applyLadderResult(l, 'win');
    expect(third.change.stars).toBe(2);
    expect(third.change.streakBonus).toBe(true);
    expect(third.ladder.stars).toBe(4);
    const loss = applyLadderResult(third.ladder, 'loss');
    expect(loss.ladder.stars).toBe(3);
    expect(loss.ladder.streak).toBe(0);
  });

  it('每 5 個牌階有保底', () => {
    const l = { ...newLadder('2026-09'), stars: 15 }; // 青銅 5
    const r = applyLadderResult(l, 'loss');
    expect(r.ladder.stars).toBe(15);
    expect(r.change.protectedByFloor).toBe(true);
    expect(applyLadderResult({ ...l, stars: 16 }, 'loss').ladder.stars).toBe(15);
  });

  it('晉升分段與達成傳說；傳說名次隨勝敗變動', () => {
    const up = applyLadderResult({ ...newLadder('2026-09'), stars: 29 }, 'win');
    expect(up.change.promoted).toBe('晉升到白銀！');
    const legend = applyLadderResult({ ...newLadder('2026-09'), stars: LEGEND_STARS - 1 }, 'win', seq(0.5));
    expect(legend.ladder.legend).toBeGreaterThan(0);
    expect(legend.change.promoted).toBe('達成傳說！');
    const n = legend.ladder.legend!;
    expect(applyLadderResult(legend.ladder, 'win', seq(0.5)).ladder.legend).toBeLessThan(n);
    expect(applyLadderResult(legend.ladder, 'loss', seq(0.5)).ladder.legend).toBeGreaterThan(n);
  });

  it('鑽石 5 以上沒有連勝加成', () => {
    const r = applyLadderResult({ ...newLadder('2026-09'), stars: 140, streak: 5 }, 'win');
    expect(r.change.stars).toBe(1);
  });

  it('換季時依最高牌階發獎勵並退回牌階', () => {
    const p = { ...newProfile(), ladder: { ...newLadder('2026-08'), stars: 70, best: 75, wins: 10, losses: 5 } };
    const r = ensureSeason(p, new Date(2026, 8, 3));
    expect(r.reward?.rank).toBe('黃金 5');
    expect(r.profile.gold).toBe(p.gold + r.reward!.gold);
    expect(r.profile.ladder!.season).toBe('2026-09');
    expect(r.profile.ladder!.stars).toBe(57); // 退回 4 個牌階，從該牌階的 0 星開始
    expect(ensureSeason(r.profile, new Date(2026, 8, 20)).reward).toBeNull();
  });

  it('記錄天梯對戰：金幣、牌階與戰績', () => {
    const p = { ...newProfile(), ladder: newLadder('2026-09') };
    const opp = findOpponent(p.ladder, 5);
    const r = recordLadderMatch(p, 'win', 'MAGE', opp, Math.random, new Date(2026, 8, 3));
    expect(r.profile.ladder!.stars).toBe(1);
    expect(r.gold).toBe(40 + r.dailyBonus);
    const last = r.profile.history[r.profile.history.length - 1];
    expect(last).toMatchObject({ mode: 'ladder', opp: opp.name, result: 'win' });
    // 存檔讀回來還在
    expect(sanitizeProfile(JSON.parse(JSON.stringify(r.profile))).ladder!.stars).toBe(1);
  });
});

describe('配對到的對手', () => {
  it('套牌合法，牌階越高技術越好、主流套牌越多', () => {
    const sample = (stars: number, legend: number | null) => {
      let skill = 0;
      let netdeck = 0;
      for (let i = 0; i < 30; i++) {
        const o = findOpponent({ stars, legend }, 1000 + i * 17);
        expect(o.deck.length).toBe(30);
        expect(validateDeck({ id: '', name: '', heroClass: o.heroClass, freeform: false, cards: o.deck }).ok).toBe(true);
        skill += o.persona.skill;
        if (o.deckKind === 'netdeck') netdeck++;
      }
      return { skill: skill / 30, netdeck };
    };
    const bronze = sample(0, null);
    const gold = sample(70, null);
    const legend = sample(LEGEND_STARS, 200);
    expect(bronze.skill).toBeLessThan(gold.skill);
    expect(gold.skill).toBeLessThan(legend.skill);
    expect(legend.netdeck).toBeGreaterThan(bronze.netdeck);
  });

  it('同一個種子會配到同一個對手', () => {
    const a = findOpponent({ stars: 40, legend: null }, 42);
    const b = findOpponent({ stars: 40, legend: null }, 42);
    expect(a.name).toBe(b.name);
    expect(a.deck).toEqual(b.deck);
  });
});

describe('像真人的對手', () => {
  const persona = (skill: number, seed: number, concede = 0.5): AiPersona => ({ skill, aggression: 0, chatty: 0.5, concede, speed: 'normal', seed });

  it('一步就能致命時一定會打（連新手也會）', () => {
    const deck = Array(30).fill('CS2_182');
    const g = Game.create({ decks: [deck, deck], classes: ['MAGE', 'WARRIOR'], names: ['A', 'B'], ai: [true, true], seed: 1, first: 0 });
    g.apply({ type: 'mulligan', player: 0, replace: [] });
    g.apply({ type: 'mulligan', player: 1, replace: [] });
    const m = g.makeMinion(0, 'CS2_182');
    m.sleeping = false;
    g.s.players[0].board.push(m);
    g.s.players[1].hero.hp = 3;
    for (let seed = 1; seed <= 5; seed++) {
      expect(new AiBrain(persona(0.03, seed)).choose(g)).toEqual({ type: 'attack', attacker: m.uid, target: g.s.players[1].hero.uid });
    }
  });

  it('必死的局面會投降（看個性）', () => {
    const deck = Array(30).fill('CS2_182');
    const g = Game.create({ decks: [deck, deck], classes: ['MAGE', 'WARRIOR'], names: ['A', 'B'], ai: [true, true], seed: 1, first: 0 });
    g.apply({ type: 'mulligan', player: 0, replace: [] });
    g.apply({ type: 'mulligan', player: 1, replace: [] });
    g.s.players[0].hand = [];
    g.s.players[0].hero.hp = 4;
    for (let i = 0; i < 3; i++) g.s.players[1].board.push(g.makeMinion(1, 'CS2_182'));
    expect(new AiBrain(persona(0.8, 3, 1)).shouldConcede(g)).toBe(true);
    expect(new AiBrain(persona(0.8, 3, 0)).shouldConcede(g)).toBe(false);
  });

  it('技術好的對手比較常贏', () => {
    let high = 0;
    let low = 0;
    for (let i = 0; i < 10; i++) {
      const deck = buildDeck('HUNTER', { seed: 30 + i, noise: 0.5 });
      const lo = new AiBrain(persona(0.12, i + 1, 0));
      const hi = new AiBrain(persona(0.9, i + 50, 0));
      const brains = i % 2 ? [lo, hi] : [hi, lo];
      const g = Game.create({ decks: [deck, deck], classes: ['HUNTER', 'HUNTER'], names: ['A', 'B'], ai: [true, true], seed: i + 3 });
      g.apply({ type: 'mulligan', player: 0, replace: brains[0].mulligan(g, 0) });
      g.apply({ type: 'mulligan', player: 1, replace: brains[1].mulligan(g, 1) });
      for (let n = 0; n < 800 && g.s.phase === 'play'; n++) if (!g.apply(brains[g.s.current].choose(g))) g.apply({ type: 'endTurn' });
      if (g.s.winner === 0 || g.s.winner === 1) {
        if (brains[g.s.winner] === hi) high++;
        else low++;
      }
    }
    expect(high).toBeGreaterThan(low);
  }, 120000);
});
