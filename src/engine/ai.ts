// ============================================================================
// 電腦對手
// 每次呼叫 chooseAction 決定一個動作：列舉所有合法動作，在複製的狀態上模擬，
// 用盤面評估函數挑出最好的；沒有更好的動作就結束回合。
// ============================================================================
import { getCard } from '../cards/registry';
import { Game, opp } from './game';
import { nextRandom, pick } from './rng';
import type { Action, GameState, Minion, PlayerId } from './state';

export type Difficulty = 'easy' | 'normal' | 'hard';

export function legalActions(g: Game): Action[] {
  const s = g.s;
  if (s.phase !== 'play' || s.pendingChoice) return [];
  const p = s.players[s.current];
  const out: Action[] = [];
  for (const hc of p.hand) {
    const def = getCard(hc.cardId);
    if (g.canPrepare(hc.uid).ok) out.push({ type: 'prepare', handUid: hc.uid });
    const options = def.chooseOne ? def.chooseOne.map((_o, i) => i) : [undefined];
    for (const option of options) {
      if (!g.canPlay(hc.uid, option).ok) continue;
      const req = g.playTargetReq(hc.uid, option);
      const targets = req ? g.validTargets(req, s.current, def.type === 'SPELL') : [];
      if (req && targets.length) {
        for (const t of targets) out.push({ type: 'play', handUid: hc.uid, target: t, option });
      } else if (!req || req.optional) out.push({ type: 'play', handUid: hc.uid, option });
    }
  }
  if (g.canHeroPower()) {
    const options = g.heroPowerOptions() ? g.heroPowerOptions()!.map((_o, i) => i) : [undefined];
    for (const option of options) {
      if (!g.canHeroPower(option)) continue;
      if (g.heroPowerNeedsTarget(option)) for (const t of g.heroPowerTargets(option)) out.push({ type: 'heroPower', target: t, option });
      else out.push({ type: 'heroPower', option });
    }
  }
  if (g.canLaunch().ok) out.push({ type: 'launch' });
  for (const c of [p.hero, ...p.board]) {
    if (!g.canAttack(c.uid)) continue;
    for (const t of g.attackTargets(c.uid)) out.push({ type: 'attack', attacker: c.uid, target: t });
  }
  return out;
}

// ---------------------------------------------------------------------------
// 盤面評估
// ---------------------------------------------------------------------------

function minionValue(g: Game, m: Minion): number {
  if (m.hp <= 0 || m.dead) return 0;
  const atk = g.atkOf(m);
  let v = atk * 1.1 + m.hp;
  if (g.hasKw(m, 'TAUNT')) v += 1 + m.hp * 0.2;
  if (g.hasKw(m, 'DIVINE_SHIELD')) v += atk * 0.8 + 1;
  if (g.hasKw(m, 'POISONOUS')) v += 2;
  if (g.hasKw(m, 'LIFESTEAL')) v += atk * 0.5;
  if (g.hasKw(m, 'WINDFURY')) v += atk * 0.6;
  if (g.hasKw(m, 'STEALTH')) v += 1;
  if (g.hasKw(m, 'REBORN')) v += 1.5;
  if (g.hasKw(m, 'CANT_ATTACK')) v -= atk * 0.8;
  if (m.frozen) v -= atk * 0.4;
  if (!m.silenced) {
    v += m.spellDamage * 1.2;
    v += m.auras.length * 1.5;
    v += m.abilities.filter((a) => a.on.k !== 'play').length * 1.2;
  }
  return Math.max(0.5, v);
}

function heroValue(hp: number, armor: number): number {
  const eff = hp + armor;
  // 血量越低，每一點血越重要
  return eff + (eff < 15 ? (15 - eff) * 0.5 : 0) + (eff < 8 ? (8 - eff) * 1.0 : 0);
}

/** 評估盤面時的權重（不同玩家風格：打臉 / 控場） */
export interface EvalWeights {
  /** 對手英雄血量的權重 */
  face: number;
  /** 對手場面的權重 */
  enemyBoard: number;
}

const DEFAULT_WEIGHTS: EvalWeights = { face: 1.1, enemyBoard: 1.25 };

export function evaluate(g: Game, me: PlayerId, w: EvalWeights = DEFAULT_WEIGHTS): number {
  const s = g.s;
  if (s.phase === 'over') {
    if (s.winner === me) return 100000;
    if (s.winner === 'draw') return -5000;
    return -100000;
  }
  const a = s.players[me];
  const b = s.players[opp(me)];
  let score = 0;
  score += heroValue(a.hero.hp, a.hero.armor) - heroValue(b.hero.hp, b.hero.armor) * w.face;
  score += a.board.reduce((x, m) => x + minionValue(g, m), 0);
  score -= b.board.reduce((x, m) => x + minionValue(g, m), 0) * w.enemyBoard;
  // 回音的複製回合結束就會消失，不算手牌優勢
  const handSize = (p: typeof a) => p.hand.filter((h) => !h.echo).length;
  score += Math.min(handSize(a), 8) * 1.6 - Math.min(handSize(b), 8) * 0.8;
  // 預備的永久減費是未來節奏價值，讓 AI 願意在合適時機投資剩餘法力。
  const preparedValue = (p: typeof a) => p.hand.reduce((v, h) => v + Math.min(h.prepareDiscount ?? 0, 8) * 0.55, 0);
  score += preparedValue(a) - preparedValue(b) * 0.45;
  if (a.weapon) score += a.weapon.atk * Math.min(a.weapon.durability, 3) * 0.6;
  if (b.weapon) score -= b.weapon.atk * Math.min(b.weapon.durability, 3) * 0.6;
  score += a.secrets.length * 2 - b.secrets.length * 2;
  // 正在建造的星艦（發射後會變成一個大手下）
  const ship = (p: typeof a) => (p.starship ?? []).reduce((x, c) => x + c.atk + c.hp, 0) * 0.5;
  score += ship(a) - ship(b) * 0.8;
  // 死亡騎士的屍體是可以消耗的資源
  const corpses = (p: typeof a) => (p.heroClass === 'DEATHKNIGHT' ? Math.min(p.corpses ?? 0, 10) * 0.4 : 0);
  score += corpses(a) - corpses(b) * 0.3;
  // 打出英雄卡後的強化英雄能力
  if (a.heroPower.heroCard) score += 6;
  if (b.heroPower.heroCard) score -= 6;
  // 對手場上的攻擊力威脅
  const threat = b.board.reduce((x, m) => x + (m.hp > 0 && !m.dead ? g.atkOf(m) : 0), 0);
  if (threat >= a.hero.hp + a.hero.armor) score -= 50;
  score -= a.overloadOwed * 0.8;
  return score;
}

// ---------------------------------------------------------------------------
// 模擬
// ---------------------------------------------------------------------------

function cloneForSim(state: GameState, me: PlayerId, salt: number): GameState {
  const copy: GameState = structuredClone({ ...state, log: [], fx: [] });
  // AI 不知道對手的奧秘內容
  copy.players[opp(me)].secrets = [];
  copy.rng = (state.rng ^ (salt * 2654435761)) | 0;
  return copy;
}

function simulate(state: GameState, me: PlayerId, action: Action, salt: number): Game | null {
  const g = new Game(cloneForSim(state, me, salt), { autoAll: true });
  if (!g.apply(action)) return null;
  return g;
}

function scoreActions(g: Game, me: PlayerId, w: EvalWeights): { action: Action; score: number; game: Game }[] {
  const scored: { action: Action; score: number; game: Game }[] = [];
  let salt = 1;
  for (const action of legalActions(g)) {
    const sim = simulate(g.s, me, action, salt++);
    if (sim) scored.push({ action, score: evaluate(sim, me, w), game: sim });
  }
  return scored.sort((x, y) => y.score - x.score);
}

function bestAction(g: Game, me: PlayerId, depth: number): { action: Action | null; score: number } {
  const actions = legalActions(g);
  const base = evaluate(g, me);
  let best: { action: Action | null; score: number } = { action: null, score: base };
  const scored: { action: Action; score: number; game: Game }[] = [];
  let salt = 1;
  for (const action of actions) {
    const sim = simulate(g.s, me, action, salt++);
    if (!sim) continue;
    const score = evaluate(sim, me);
    scored.push({ action, score, game: sim });
  }
  scored.sort((x, y) => y.score - x.score);
  if (depth > 1) {
    // 困難：對前幾名動作再往後看一步
    for (const cand of scored.slice(0, 6)) {
      if (cand.game.s.phase === 'over' || cand.game.s.current !== me) continue;
      const next = bestAction(cand.game, me, depth - 1);
      cand.score = Math.max(cand.score, next.score - 0.01);
    }
    scored.sort((x, y) => y.score - x.score);
  }
  if (scored.length && scored[0].score > base + 0.05) best = { action: scored[0].action, score: scored[0].score };
  return best;
}

/**
 * 困難：在整個回合的動作序列上做 beam search，找出回合結束時盤面最好的出牌順序，
 * 再執行其中的第一步（每一步都重新規劃，因為隨機效果會改變結果）。
 */
function planTurn(g: Game, me: PlayerId, width: number, depth: number, w: EvalWeights = DEFAULT_WEIGHTS): Action | null {
  const base = evaluate(g, me, w);
  type Node = { game: Game; first: Action | null; score: number };
  let beam: Node[] = [{ game: g, first: null, score: base }];
  let best: Node = beam[0];
  let salt = 1;
  for (let d = 0; d < depth; d++) {
    const next: Node[] = [];
    for (const node of beam) {
      if (node.game.s.phase !== 'play' || node.game.s.current !== me) continue;
      for (const action of legalActions(node.game)) {
        const sim = simulate(node.game.s, me, action, salt++);
        if (!sim) continue;
        next.push({ game: sim, first: node.first ?? action, score: evaluate(sim, me, w) });
      }
    }
    if (!next.length) break;
    next.sort((a, b) => b.score - a.score);
    // 去除分數幾乎相同的重複分支，保留多樣性
    const seen = new Set<string>();
    beam = [];
    for (const n of next) {
      const key = n.score.toFixed(2);
      if (seen.has(key)) continue;
      seen.add(key);
      beam.push(n);
      if (beam.length >= width) break;
    }
    if (beam[0].score > best.score) best = beam[0];
    if (best.score >= 100000) break; // 找到致命
  }
  return best.first && best.score > base + 0.05 ? best.first : null;
}

/** 決定電腦的下一個動作 */
export function chooseAction(g: Game, difficulty: Difficulty): Action {
  const s = g.s;
  const me = s.current;
  const actions = legalActions(g);
  if (!actions.length) return { type: 'endTurn' };
  if (difficulty === 'easy' && nextRandom({ rng: s.rng + s.turn * 7919 + s.fxSeq }) < 0.35) {
    // 簡單：偶爾做出隨機動作
    const a = pick({ rng: s.rng + s.fxSeq * 31 }, actions);
    if (a) return a;
  }
  if (difficulty === 'hard') return planTurn(g, me, 5, 8) ?? { type: 'endTurn' };
  const { action } = bestAction(g, me, 1);
  return action ?? { type: 'endTurn' };
}

/** 起手換牌：換掉高費卡 */
export function aiMulligan(g: Game, pid: PlayerId, difficulty: Difficulty): number[] {
  if (difficulty === 'easy') return [];
  const p = g.s.players[pid];
  return p.hand.filter((h) => getCard(h.cardId).cost > 3).map((h) => h.uid);
}

/** 讓電腦完成自己整個回合（測試 / 模擬用） */
export function playAiTurn(g: Game, difficulty: Difficulty, maxActions = 60): number {
  const me = g.s.current;
  let n = 0;
  while (g.s.phase === 'play' && g.s.current === me && n < maxActions) {
    const action = chooseAction(g, difficulty);
    if (!g.apply(action)) {
      g.apply({ type: 'endTurn' });
      break;
    }
    n++;
    if (action.type === 'endTurn') break;
  }
  if (g.s.phase === 'play' && g.s.current === me) g.apply({ type: 'endTurn' });
  return n;
}


// ============================================================================
// 像真人一樣的對手（天梯）
// 技術好壞、打法風格、會不會投降、愛不愛聊天都不一樣。
// ============================================================================

export interface AiPersona {
  /** 0（新手，常常犯錯）～ 1（高手，會規劃整個回合） */
  skill: number;
  /** -1 偏好控場，1 偏好打臉 */
  aggression: number;
  /** 0 ～ 1：多常使用表情 */
  chatty: number;
  /** 0 ～ 1：劣勢時多容易投降 */
  concede: number;
  /** 出牌速度 */
  speed: 'fast' | 'normal' | 'slow';
  /** 不太有禮貌（贏的時候會嗆聲） */
  rude?: boolean;
  seed: number;
}

export type Emote = 'greet' | 'wellPlayed' | 'thanks' | 'wow' | 'oops' | 'threaten';

export const EMOTE_TEXT: Record<Emote, string> = {
  greet: '你好！',
  wellPlayed: '打得好！',
  thanks: '謝謝。',
  wow: '哇！',
  oops: '抱歉……',
  threaten: '準備受死吧！',
};

export const EMOTE_NAMES: Record<Emote, string> = {
  greet: '問候',
  wellPlayed: '讚美',
  thanks: '感謝',
  wow: '驚嘆',
  oops: '抱歉',
  threaten: '威脅',
};

/** 天梯對手的大腦：每場對戰一個，會記住這場的狀態（例如剛剛是不是按錯了） */
export class AiBrain {
  private rng: { rng: number };
  private checkedTurn = -1;
  private turnStartTurn = -1;
  private lastEval: number | null = null;
  private lastThinkTurn = -1;
  private emoted = new Set<string>();
  /** 上一個動作是失誤（用來決定要不要說「抱歉」） */
  blundered = false;
  readonly weights: EvalWeights;

  constructor(readonly persona: AiPersona) {
    this.rng = { rng: persona.seed | 0 || 1 };
    const a = persona.aggression;
    this.weights = { face: 1.1 + Math.max(0, a) * 0.9 + Math.min(0, a) * 0.3, enemyBoard: 1.25 - Math.max(0, a) * 0.35 - Math.min(0, a) * 0.35 };
  }

  private rand(): number {
    return nextRandom(this.rng);
  }

  /** 常態分佈的雜訊 */
  private gauss(): number {
    return (this.rand() + this.rand() + this.rand() - 1.5) * 1.4;
  }

  choose(g: Game): Action {
    const s = g.s;
    const me = s.current;
    const { skill } = this.persona;
    this.blundered = false;
    const actions = legalActions(g);
    if (!actions.length) return { type: 'endTurn' };
    const newTurn = this.turnStartTurn !== s.turn;
    this.turnStartTurn = s.turn;

    const scored = scoreActions(g, me, this.weights);
    // 看得到的致命一定會打（一步就能贏）
    if (scored[0]?.score >= 100000) return scored[0].action;
    const base = evaluate(g, me, this.weights);

    // 新手偶爾整個亂打、或還有法力就結束回合
    const dumb = 0.3 * Math.pow(1 - skill, 2.2);
    if (!newTurn && this.rand() < dumb * 0.35) {
      this.blundered = true;
      return { type: 'endTurn' };
    }
    if (this.rand() < dumb) {
      const a = pick(this.rng, actions);
      if (a) {
        this.blundered = true;
        return a;
      }
    }

    // 高手：規劃整個回合的出牌順序
    if (skill >= 0.62) {
      const width = Math.round(2 + skill * 3);
      const depth = Math.round(3 + skill * 5);
      if (this.rand() > 0.4 * Math.pow(1 - skill, 1.5)) return planTurn(g, me, width, depth, this.weights) ?? { type: 'endTurn' };
    }

    // 一般玩家：一步一步挑看起來最好的動作，但判斷會有誤差
    const noise = (1 - skill) * 3.2;
    const judged = scored.map((x) => ({ ...x, score: x.score + this.gauss() * noise })).sort((x, y) => y.score - x.score);
    let choice = judged[0];
    // 手滑：選到第二、第三好的動作
    const slip = 0.35 * Math.pow(1 - skill, 1.5);
    if (judged.length > 1 && this.rand() < slip) {
      choice = judged[1 + Math.floor(this.rand() * Math.min(2, judged.length - 1))];
      this.blundered = choice.score < judged[0].score - 3;
    }
    if (!choice || choice.score <= base + 0.05) return { type: 'endTurn' };
    return choice.action;
  }

  mulligan(g: Game, pid: PlayerId): number[] {
    const { skill, aggression } = this.persona;
    const hand = g.s.players[pid].hand;
    if (skill < 0.2 && this.rand() < 0.6) return [];
    const max = aggression > 0.4 ? 2 : aggression < -0.4 ? 4 : 3;
    return hand.filter((h) => getCard(h.cardId).cost > max || (skill < 0.35 && this.rand() < 0.15)).map((h) => h.uid);
  }

  /** 回合開始時看看局勢：沒救了就投降（真人常常這樣） */
  shouldConcede(g: Game): boolean {
    const s = g.s;
    if (this.checkedTurn === s.turn || s.phase !== 'play') return false;
    this.checkedTurn = s.turn;
    const me = s.current;
    const foe = opp(me);
    const p = s.players[me];
    // 用簡單的方式模擬自己這回合能做的事，看看回合結束後會不會被斬殺
    const sim = new Game(cloneForSim(s, me, 7), { autoAll: true });
    for (let i = 0; i < 25 && sim.s.phase === 'play' && sim.s.current === me; i++) {
      const { action } = bestAction(sim, me, 1);
      if (!action || !sim.apply(action)) break;
    }
    if (sim.s.phase === 'over') return false;
    const after = sim.s.players[me];
    const threat = sim.s.players[foe].board.reduce((x, m) => x + (m.hp > 0 && !m.dead && !sim.hasKw(m, 'CANT_ATTACK') ? sim.atkOf(m) : 0), 0) + (sim.s.players[foe].weapon?.atk ?? 0);
    const taunts = after.board.some((m) => m.hp > 0 && sim.hasKw(m, 'TAUNT'));
    const doomed = !taunts && threat >= after.hero.hp + after.hero.armor;
    const hopeless = evaluate(g, me) < -60 && s.turn >= 14;
    if (doomed) return this.rand() < this.persona.concede;
    if (hopeless) return this.rand() < this.persona.concede * 0.35;
    return p.hero.hp <= 3 && this.rand() < this.persona.concede * 0.1;
  }

  /** 每個動作前要想多久（毫秒） */
  thinkTime(g: Game): number {
    const base = { fast: 450, normal: 800, slow: 1250 }[this.persona.speed];
    let t = base * (0.7 + this.rand() * 0.9);
    const newTurn = this.lastThinkTurn !== g.s.turn;
    this.lastThinkTurn = g.s.turn;
    if (newTurn) t += 700 + this.rand() * 1600; // 回合開始先看一下場面
    if (this.rand() < 0.07) t += 2500 + this.rand() * 3500; // 偶爾想很久
    return t;
  }

  /** 有事件發生時決定要不要用表情回應；回傳 null 表示不說話 */
  react(event: 'start' | 'playerEmote' | 'swingFor' | 'swingAgainst' | 'blunder' | 'concede' | 'win' | 'lose', extra?: Emote): Emote | null {
    const { chatty, rude } = this.persona;
    const r = this.rand();
    switch (event) {
      case 'start':
        return r < chatty * 0.9 ? 'greet' : null;
      case 'playerEmote':
        if (extra === 'greet') return !this.emoted.has('greetBack') && r < chatty * 0.8 ? (this.emoted.add('greetBack'), 'greet') : null;
        if (extra === 'wellPlayed') return r < chatty * 0.7 ? 'thanks' : null;
        if (extra === 'threaten') return r < chatty * 0.4 ? (rude ? 'threaten' : 'wow') : null;
        if (extra === 'oops') return r < chatty * 0.3 ? (rude ? 'thanks' : 'greet') : null;
        return r < chatty * 0.2 ? 'wow' : null;
      case 'swingFor':
        return r < chatty * (rude ? 0.5 : 0.18) ? 'threaten' : null;
      case 'swingAgainst':
        return r < chatty * 0.35 ? (this.rand() < 0.5 ? 'wow' : 'wellPlayed') : null;
      case 'blunder':
        return r < chatty * 0.3 ? 'oops' : null;
      case 'concede':
        return r < 0.3 + chatty * 0.5 ? 'wellPlayed' : null;
      case 'win':
        return r < chatty * 0.6 ? (rude ? 'thanks' : 'wellPlayed') : null;
      case 'lose':
        return r < 0.2 + chatty * 0.6 ? 'wellPlayed' : null;
    }
  }

  /** 雙方動作後盤面的變化（用來判斷有沒有「大翻盤」可以說話） */
  swing(g: Game, me: PlayerId): number {
    const now = evaluate(g, me);
    const prev = this.lastEval;
    this.lastEval = now;
    return prev === null ? 0 : now - prev;
  }
}
