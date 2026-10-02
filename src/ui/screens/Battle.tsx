import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type CSSProperties, type ReactNode } from 'react';
import { getCard, hasCard, HEROES } from '../../cards/registry';
import { AiBrain, aiMulligan, chooseAction, EMOTE_NAMES, EMOTE_TEXT, type Emote } from '../../engine/ai';
import { Game } from '../../engine/game';
import { CLASS_NAMES } from '../../engine/heroes';
import type { Action, Hero, Minion, PlayerId, PlayerState } from '../../engine/state';
import type { CardDef } from '../../engine/types';
import { DIFFICULTY_NAMES } from '../../game/economy';
import { RUNE_NAMES } from '../../game/decks';
import { DECK_KIND_NAMES, recordLadderMatch, type LadderChange } from '../../game/ladder';
import { makeAiDeck } from '../../game/opponents';
import { recordMatch } from '../../game/profile';
import type { BattleConfig } from '../App';
import { CLASS_COLORS, formatCardText } from '../cardText';
import { Art, CardBack, CardView } from '../components/Card';
import { RankBadge, RankPips } from '../components/Rank';
import { direct, type Snap } from '../fx';
import { clamp, useViewport } from '../hooks';
import { getProfile, setProfile, useProfile } from '../store';

type Mode =
  | { k: 'idle' }
  | { k: 'card'; handUid: number; stage: 'select' | 'choose' | 'place' | 'target'; option?: number; position?: number }
  | { k: 'attack'; attacker: number }
  | { k: 'heroPower'; option?: number }
  | { k: 'powerChoose' };

const AI_DELAY = { slow: 1300, normal: 800, fast: 350 };
const LONG_PRESS_MS = 450;

const ME: PlayerId = 0;
const AI: PlayerId = 1;

const SPEED_FACTOR = { slow: 1.35, normal: 1, fast: 0.55 };
/** 兩次表情之間至少間隔（毫秒） */
const EMOTE_GAP = 6000;
const MAX_AI_EMOTES = 6;

export function Battle({ config, onExit, onRematch }: { config: BattleConfig; onExit: () => void; onRematch: () => void }) {
  const profile = useProfile();
  const gameRef = useRef<Game | null>(null);
  const ladder = config.ladder;
  // 天梯對手的大腦（每場一個）
  const brain = useMemo(() => (ladder ? new AiBrain(ladder.persona) : null), [ladder]);
  const [error] = useState(() => {
    const deck = getProfile().decks.find((d) => d.id === config.deckId);
    if (!deck) return '找不到套牌';
    const aiDeck = ladder ? ladder.deck : makeAiDeck(config.oppClass, config.difficulty, Math.floor(Math.random() * 1e9));
    const g = Game.create({
      decks: [deck.cards, aiDeck],
      classes: [deck.heroClass, config.oppClass],
      names: ['你', ladder ? ladder.name : HEROES[config.oppClass].name],
      ai: [false, true],
    });
    g.apply({ type: 'mulligan', player: AI, replace: brain ? brain.mulligan(g, AI) : aiMulligan(g, AI, config.difficulty) });
    gameRef.current = g;
    return '';
  });
  const [version, setVersion] = useState(0);
  const refresh = useCallback(() => setVersion((v) => v + 1), []);
  const [mode, setMode] = useState<Mode>({ k: 'idle' });
  const [inspect, setInspect] = useState<{ cardId: string; atk?: number; hp?: number; cost?: number; spellDamage?: number; uid?: number; def?: CardDef } | { power: PlayerId } | null>(null);
  const [banner, setBanner] = useState<{ id: number; cardId?: string; text: string } | null>(null);
  const [mulliganPick, setMulliganPick] = useState<Set<number>>(new Set());
  const [reward, setReward] = useState<{ gold: number; daily: number; result: 'win' | 'loss' | 'draw'; change?: LadderChange } | null>(null);
  const [emotes, setEmotes] = useState<{ id: number; player: PlayerId; emote: Emote }[]>([]);
  const [emoteMenu, setEmoteMenu] = useState(false);
  const lastEmote = useRef<Record<PlayerId, number>>({ 0: -Infinity, 1: -Infinity });
  const aiEmotes = useRef(0);
  const [showLog, setShowLog] = useState(false);
  const [turnBanner, setTurnBanner] = useState(0);
  const lastTurn = useRef(0);
  const [menu, setMenu] = useState(false);
  const [toast, setToast] = useState('');
  const lastFx = useRef(0);
  const vp = useViewport();
  const cw = Math.round(vp.w < 600 ? clamp(Math.min(vp.w * 0.22, vp.h * 0.13), 64, 104) : clamp(Math.min(vp.w * 0.12, vp.h * 0.15), 64, 128));
  const mw = Math.round(clamp(Math.min(vp.w * 0.115, vp.h * 0.105), 46, 96));
  const hw = Math.round(clamp(Math.min(vp.h * 0.12, vp.w * 0.2), 58, 110));

  const g = gameRef.current!;
  const s = g?.s;
  // 開發模式：讓自動化測試可以直接擺好盤面（正式版不會包含）
  if (import.meta.env.DEV) (window as unknown as { __battle?: unknown }).__battle = { g, refresh, brain };

  // ------------------------------------------------------------ 動作
  const act = useCallback(
    (a: Action) => {
      const ok = g.apply(a);
      setMode({ k: 'idle' });
      if (!ok) {
        const r = g.check(a);
        if (r.reason) flash(r.reason);
      }
      refresh();
      return ok;
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [g],
  );

  const flash = (msg: string) => {
    setToast(msg);
    window.setTimeout(() => setToast((t) => (t === msg ? '' : t)), 1600);
  };

  // ------------------------------------------------------------ 電腦回合
  // 只在遊戲狀態改變（version）時排程，滑鼠移動等重繪不會打斷電腦
  useEffect(() => {
    if (!s || s.phase !== 'play' || s.current !== AI || s.pendingChoice) return;
    const wait = brain ? brain.thinkTime(g) * SPEED_FACTOR[profile.settings.aiSpeed] : AI_DELAY[profile.settings.aiSpeed];
    const t = window.setTimeout(() => {
      if (brain) {
        // 真人會在沒救的時候投降
        if (brain.shouldConcede(g)) {
          const e = brain.react('concede');
          if (e) say(AI, e, true);
          window.setTimeout(() => {
            g.apply({ type: 'concede', player: AI });
            refresh();
          }, e ? 1400 : 300);
          return;
        }
        const a = brain.choose(g);
        if (!g.apply(a)) g.apply({ type: 'endTurn' });
        if (brain.blundered) aiSay(brain.react('blunder'), 900);
        else if (brain.swing(g, AI) > 14) aiSay(brain.react('swingFor'), 700);
      } else {
        const a = chooseAction(g, config.difficulty);
        if (!g.apply(a)) g.apply({ type: 'endTurn' });
      }
      refresh();
    }, Math.max(wait, busyUntil.current - performance.now() + 150));
    return () => window.clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [version, profile.settings.aiSpeed]);

  // ------------------------------------------------------------ 表情
  const say = (player: PlayerId, emote: Emote, force = false, gap = player === AI ? EMOTE_GAP : 1500) => {
    const now = performance.now();
    if (!force && now - lastEmote.current[player] < gap) return false;
    if (player === AI && !force && aiEmotes.current >= MAX_AI_EMOTES) return false;
    lastEmote.current[player] = now;
    if (player === AI) aiEmotes.current++;
    const id = now + Math.random();
    setEmotes((list) => [...list.filter((x) => x.player !== player), { id, player, emote }]);
    window.setTimeout(() => setEmotes((list) => list.filter((x) => x.id !== id)), 2600);
    return true;
  };
  const aiSay = (e: Emote | null, delay: number, gap = EMOTE_GAP) => {
    if (!e) return;
    window.setTimeout(() => say(AI, e, false, gap), delay * (0.7 + Math.random() * 0.8));
  };
  const playerEmote = (e: Emote) => {
    setEmoteMenu(false);
    if (!say(ME, e)) return;
    // 回應玩家的表情不用等太久
    if (brain) aiSay(brain.react('playerEmote', e), 1500, 2000);
  };
  // 開場打招呼
  const greeted = useRef(false);
  useEffect(() => {
    if (!brain || greeted.current || !s || s.phase !== 'play') return;
    greeted.current = true;
    aiSay(brain.react('start'), 1800);
  });
  // 玩家打出漂亮的一手時，對手可能會說「哇！」或「打得好」
  useEffect(() => {
    if (!brain || !s || s.phase !== 'play' || s.current !== ME) return;
    if (brain.swing(g, AI) < -14) aiSay(brain.react('swingAgainst'), 1200);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [version]);

  // ------------------------------------------------------------ 特效
  useEffect(() => {
    if (!s) return;
    const fresh = s.fx.filter((f) => f.id > lastFx.current);
    if (!fresh.length) return;
    lastFx.current = fresh[fresh.length - 1].id;
    for (const f of fresh) {
      if (f.kind === 'play' && f.player === AI) {
        const def = f.cardId && hasCard(f.cardId) ? getCard(f.cardId) : null;
        // 法術由施放動畫顯示；對手的奧秘不能讓玩家看到是哪一張
        if (def?.secret) setBanner({ id: f.id, text: `${s.players[AI].name}打出了一張奧秘` });
        else if (def?.type === 'SPELL') continue;
        else if (def) setBanner({ id: f.id, cardId: def.id, text: `${s.players[AI].name}打出了` });
        else setBanner({ id: f.id, text: `${s.players[AI].name}使用了英雄能力：${g.powerInfo(s.players[AI]).name}` });
      }
      if (f.kind === 'secret' && f.cardId) setBanner({ id: f.id, cardId: f.cardId, text: '奧秘揭露！' });
    }
  });

  // 輪到玩家時顯示「你的回合」
  useEffect(() => {
    if (!s || s.phase !== 'play' || s.current !== ME || s.turn === lastTurn.current) return;
    lastTurn.current = s.turn;
    setTurnBanner(s.turn);
  });
  useEffect(() => {
    if (!turnBanner) return;
    const t = window.setTimeout(() => setTurnBanner(0), 1300);
    return () => window.clearTimeout(t);
  }, [turnBanner]);

  useEffect(() => {
    if (!banner) return;
    const t = window.setTimeout(() => setBanner(null), 1500);
    return () => window.clearTimeout(t);
  }, [banner]);

  // 對戰動畫：每次狀態更新後，依照新的特效事件排出時間軸播放（見 ../fx.ts）。
  // 已經從畫面消失的角色，用上一次畫面的快照來播放。
  const battleRef = useRef<HTMLDivElement>(null);
  const placeGhostRef = useRef<HTMLDivElement>(null);
  const snapshot = useRef(new Map<number, Snap>());
  const lastAnimFx = useRef<number | null>(null);
  /** 動畫播完的時間（電腦會等動畫播完才行動） */
  const busyUntil = useRef(0);
  const [cast, setCast] = useState<{ id: number; cardId: string; player: PlayerId } | null>(null);
  useLayoutEffect(() => {
    const root = battleRef.current;
    if (!root || !s) return;
    const fresh = s.fx.filter((f) => f.id > (lastAnimFx.current ?? Infinity));
    const newest = s.fx.length ? s.fx[s.fx.length - 1].id : 0;
    lastAnimFx.current = Math.max(lastAnimFx.current ?? newest, newest);
    if (fresh.length) {
      const duration = direct(root, fresh, snapshot.current, {
        cast: (cardId, player, at) => {
          const id = Date.now() + Math.random();
          window.setTimeout(() => setCast({ id, cardId, player }), at);
          window.setTimeout(() => setCast((c) => (c?.id === id ? null : c)), at + 720);
        },
      });
      busyUntil.current = Math.max(busyUntil.current, performance.now() + duration);
    }
    const next = new Map<number, Snap>();
    root.querySelectorAll<HTMLElement>('[data-uid]').forEach((el) => next.set(Number(el.dataset.uid), { rect: el.getBoundingClientRect(), html: el.outerHTML }));
    snapshot.current = next;
  });

  // ------------------------------------------------------------ 對戰結束 → 發放獎勵
  useEffect(() => {
    if (!s || s.phase !== 'over' || reward) return;
    const result = s.winner === ME ? 'win' : s.winner === 'draw' ? 'draw' : 'loss';
    if (ladder) {
      const r = recordLadderMatch(getProfile(), result, s.players[ME].heroClass, ladder);
      setProfile(r.profile);
      setReward({ gold: r.gold, daily: r.dailyBonus, result, change: r.change });
      const conceded = s.log.some((l) => l.player === AI && l.text.endsWith('投降了'));
      if (brain && !conceded) aiSay(brain.react(result === 'win' ? 'lose' : 'win'), 600);
      return;
    }
    const r = recordMatch(getProfile(), result, config.difficulty, s.players[ME].heroClass, config.oppClass);
    setProfile(r.profile);
    setReward({ gold: r.gold, daily: r.dailyBonus, result });
  });

  // ------------------------------------------------------------ Esc 取消
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setMode({ k: 'idle' });
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  const myTurn = !!s && s.phase === 'play' && s.current === ME && !s.pendingChoice;

  const validTargets = useMemo(() => {
    if (!s || !myTurn) return new Set<number>();
    if (mode.k === 'attack') return new Set(g.attackTargets(mode.attacker));
    if (mode.k === 'heroPower') return new Set(g.heroPowerTargets(mode.option));
    if (mode.k === 'card' && mode.stage === 'target') {
      const req = g.playTargetReq(mode.handUid, mode.option);
      if (req) return new Set(g.validTargets(req, ME, g.cardIsSpell(mode.handUid)));
    }
    return new Set<number>();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mode, s?.fxSeq, s?.turn, myTurn]);

  if (error || !g || !s) {
    return (
      <div className="battle-error">
        <p>{error || '無法開始對戰'}</p>
        <button className="btn" onClick={onExit}>
          返回
        </button>
      </div>
    );
  }

  const me = s.players[ME];
  const foe = s.players[AI];

  // ------------------------------------------------------------ 點擊處理
  const needsTarget = (handUid: number, option?: number) => {
    const req = g.playTargetReq(handUid, option);
    if (!req) return false;
    return g.validTargets(req, ME, g.cardIsSpell(handUid)).length > 0;
  };

  const afterOption = (handUid: number, option: number | undefined) => {
    const def = g.handDef(me.hand.find((h) => h.uid === handUid)!);
    if (def.type === 'MINION') setMode({ k: 'card', handUid, option, stage: 'place' });
    else if (needsTarget(handUid, option)) setMode({ k: 'card', handUid, option, stage: 'target' });
    else act({ type: 'play', handUid, option });
  };

  const onHandClick = (handUid: number) => {
    const hc = me.hand.find((h) => h.uid === handUid)!;
    const def = g.handDef(hc);
    if (!myTurn) return;
    if (mode.k === 'card' && mode.handUid === handUid && mode.stage === 'select') {
      act({ type: 'play', handUid });
      return;
    }
    const can = g.canPlay(handUid);
    if (!can.ok) {
      flash(can.reason ?? '無法打出');
      return;
    }
    setInspect(null);
    if (def.chooseOne) setMode({ k: 'card', handUid, stage: 'choose' });
    else if (def.type === 'MINION') setMode({ k: 'card', handUid, stage: 'place' });
    else if (needsTarget(handUid)) setMode({ k: 'card', handUid, stage: 'target' });
    else setMode({ k: 'card', handUid, stage: 'select' });
  };

  const onPlace = (position: number) => {
    if (mode.k !== 'card') return;
    if (needsTarget(mode.handUid, mode.option)) setMode({ ...mode, position, stage: 'target' });
    else act({ type: 'play', handUid: mode.handUid, option: mode.option, position });
  };

  const onTarget = (uid: number) => {
    if (mode.k === 'attack') act({ type: 'attack', attacker: mode.attacker, target: uid });
    else if (mode.k === 'heroPower') act({ type: 'heroPower', target: uid, option: mode.option });
    else if (mode.k === 'card') act({ type: 'play', handUid: mode.handUid, target: uid, option: mode.option, position: mode.position });
  };

  const onCharClick = (c: Minion | Hero) => {
    if (validTargets.has(c.uid)) {
      onTarget(c.uid);
      return;
    }
    if (myTurn && c.owner === ME && g.canAttack(c.uid)) {
      if (mode.k === 'attack' && mode.attacker === c.uid) setMode({ k: 'idle' });
      else setMode({ k: 'attack', attacker: c.uid });
      setInspect(null);
      return;
    }
    if (mode.k !== 'idle') {
      setMode({ k: 'idle' });
      return;
    }
  };

  const onHeroPower = () => {
    if (!myTurn) return;
    if (!g.canHeroPower()) {
      flash(me.heroPower.used ? '本回合已使用過英雄能力' : '無法使用英雄能力');
      return;
    }
    if (mode.k === 'heroPower' || mode.k === 'powerChoose') {
      setMode({ k: 'idle' });
      return;
    }
    if (g.heroPowerOptions()) setMode({ k: 'powerChoose' });
    else if (g.heroPowerNeedsTarget()) setMode({ k: 'heroPower' });
    else act({ type: 'heroPower' });
  };

  const onLaunch = () => {
    if (!myTurn) return;
    const r = g.canLaunch();
    if (!r.ok) {
      flash(r.reason ?? '無法發射星艦');
      return;
    }
    setMode({ k: 'idle' });
    act({ type: 'launch' });
  };

  const inspectShip = (pid: PlayerId) => (on: boolean) => {
    const def = g.starshipPreview(pid);
    setInspect(on && def ? { cardId: def.id, def, atk: def.attack, hp: def.health } : null);
  };

  const onPowerOption = (option: number) => {
    if (g.heroPowerNeedsTarget(option)) setMode({ k: 'heroPower', option });
    else act({ type: 'heroPower', option });
  };

  const selectedHand = mode.k === 'card' ? mode.handUid : null;
  const selectedCard = selectedHand !== null ? (me.hand.find((h) => h.uid === selectedHand) ?? null) : null;
  const canTrade = selectedHand !== null && g.check({ type: 'trade', handUid: selectedHand }).ok;
  const selectedDef = selectedCard ? g.handDef(selectedCard) : null;
  const selectedStats = selectedCard && selectedDef?.type === 'MINION' ? g.handStats(ME, selectedCard) : null;
  const placing = mode.k === 'card' && mode.stage === 'place';

  const hint = (() => {
    if (s.phase === 'mulligan') return '';
    if (!myTurn) return s.pendingChoice ? '' : `${foe.name}的回合…`;
    if (mode.k === 'card') {
      if (mode.stage === 'place') return '點選位置放置手下；點其他地方取消';
      if (mode.stage === 'target') return '選擇目標；點其他地方取消';
      if (mode.stage === 'select') return '再點一次卡牌使用；點其他地方取消';
    }
    if (mode.k === 'attack') return '選擇攻擊目標；點其他地方取消';
    if (mode.k === 'heroPower') return '選擇英雄能力的目標';
    return '';
  })();

  const charClasses = (c: Minion | Hero) => {
    const cls: string[] = [];
    if (validTargets.has(c.uid)) cls.push('targetable');
    if (myTurn && c.owner === ME && mode.k === 'idle' && g.canAttack(c.uid)) cls.push('can-attack');
    if (mode.k === 'attack' && mode.attacker === c.uid) cls.push('attacking-selected');
    return cls.join(' ');
  };

  const renderMinion = (m: Minion) => (
    <MinionView
      key={m.uid}
      m={m}
      g={g}
      className={charClasses(m)}
      onClick={() => onCharClick(m)}
      onLongPress={() => {
        setMode({ k: 'idle' });
        setInspect({ cardId: m.cardId, atk: g.atkOf(m), hp: m.hp, uid: m.uid, def: m.parts || m.starship ? g.minionDef(m) : undefined });
      }}
    />
  );

  return (
    <div
      ref={battleRef}
      className={`battle ${myTurn ? 'my-turn' : ''} ${placing ? 'placing-card' : ''}`}
      style={{ '--mw': `${mw}px`, '--hw': `${hw}px`, '--cw': `${cw}px` } as CSSProperties}
      onPointerDown={(e) => {
        if (!placing || !placeGhostRef.current) return;
        placeGhostRef.current.style.left = `${e.clientX}px`;
        placeGhostRef.current.style.top = `${e.clientY}px`;
        placeGhostRef.current.classList.add('visible');
      }}
      onPointerMove={(e) => {
        if (!placing || !placeGhostRef.current) return;
        placeGhostRef.current.style.left = `${e.clientX}px`;
        placeGhostRef.current.style.top = `${e.clientY}px`;
        placeGhostRef.current.classList.add('visible');
      }}
      onPointerUp={(e) => {
        if (e.pointerType !== 'mouse') placeGhostRef.current?.classList.remove('visible');
      }}
      onPointerCancel={() => placeGhostRef.current?.classList.remove('visible')}
      onPointerLeave={() => placeGhostRef.current?.classList.remove('visible')}
      onClick={() => {
        if (mode.k !== 'idle') setMode({ k: 'idle' });
        if (inspect) setInspect(null);
      }}
      onContextMenu={(e) => {
        e.preventDefault();
        setMode({ k: 'idle' });
      }}
    >
      <div className="battle-topbar">
        <button className="btn small" onClick={() => setMenu(!menu)}>
          ☰ 選單
        </button>
        <span className="battle-title">
          {ladder ? (
            <>
              🏆 天梯・{foe.name}（{ladder.rank.label}・{CLASS_NAMES[foe.heroClass]}）
            </>
          ) : (
            <>
              對戰 {CLASS_NAMES[foe.heroClass]}（{DIFFICULTY_NAMES[config.difficulty]}）
            </>
          )}
          ・第 {Math.max(1, Math.ceil(s.turn / 2))} 回合
        </span>
        <button className="btn small" onClick={() => setShowLog(!showLog)}>
          📜 紀錄
        </button>
      </div>
      {menu && (
        <div className="battle-menu">
          <button
            className="btn danger"
            onClick={() => {
              setMenu(false);
              if (s.phase !== 'over') act({ type: 'concede', player: ME });
            }}
          >
            🏳️ 投降
          </button>
          <button className="btn" onClick={() => setMenu(false)}>
            繼續對戰
          </button>
        </div>
      )}

      {/* ---------------- 對手區 ---------------- */}
      <div className="side foe-side">
        <div className="hand foe-hand">
          {foe.hand.map((h) => (
            <span key={h.uid} data-hand-uid={h.uid}>
              <CardBack width={46} />
            </span>
          ))}
        </div>
        <div className="hero-row">
          <PlayerInfo p={foe} />
          <WeaponView p={foe} />
          <HeroView p={foe} g={g} className={charClasses(foe.hero)} onClick={() => onCharClick(foe.hero)}>
            {emotes
              .filter((x) => x.player === AI)
              .map((x) => (
                <div key={x.id} className="emote-bubble">
                  {EMOTE_TEXT[x.emote]}
                </div>
              ))}
          </HeroView>
          <HeroPowerView p={foe} g={g} usable={false} onHover={(on) => setInspect(on ? { power: AI } : null)} />
          <StarshipView p={foe} g={g} usable={false} onHover={inspectShip(AI)} />
        </div>
      </div>

      <div className="boards">
        <div className="board foe-board">{foe.board.map(renderMinion)}</div>
        <div className="board-divider">
          <span className="hint">{hint}</span>
          <button className={`end-turn ${myTurn ? 'ready' : ''}`} disabled={!myTurn} onClick={(e) => { e.stopPropagation(); act({ type: 'endTurn' }); }}>
            {myTurn ? '結束回合' : '對手回合'}
          </button>
        </div>
        <div
          className={`board my-board ${placing ? 'placing' : ''}`}
          onClick={(e) => {
            if (placing) {
              e.stopPropagation();
              onPlace(me.board.length);
            }
          }}
        >
          {placing && <Slot onClick={() => onPlace(0)} />}
          {me.board.map((m, i) => (
            <span className="board-cell" key={m.uid}>
              {renderMinion(m)}
              {placing && <Slot onClick={() => onPlace(i + 1)} />}
            </span>
          ))}
          {placing && selectedDef && <div className="ghost-minion">{selectedDef.name}</div>}
        </div>
      </div>

      {/* ---------------- 我方區 ---------------- */}
      <div className="side my-side">
        <div className="hero-row">
          <PlayerInfo p={me} />
          <WeaponView p={me} />
          <HeroView p={me} g={g} className={charClasses(me.hero)} onClick={() => onCharClick(me.hero)}>
            {emotes
              .filter((x) => x.player === ME)
              .map((x) => (
                <div key={x.id} className="emote-bubble">
                  {EMOTE_TEXT[x.emote]}
                </div>
              ))}
            {ladder && (
              <button
                className="emote-toggle"
                title="表情"
                onClick={(e) => {
                  e.stopPropagation();
                  setEmoteMenu(!emoteMenu);
                }}
              >
                💬
              </button>
            )}
            {emoteMenu && (
              <div className="emote-menu" onClick={(e) => e.stopPropagation()}>
                {(Object.keys(EMOTE_NAMES) as Emote[]).map((e) => (
                  <button key={e} onClick={() => playerEmote(e)}>
                    {EMOTE_NAMES[e]}
                  </button>
                ))}
              </div>
            )}
          </HeroView>
          <HeroPowerView
            p={me}
            g={g}
            usable={myTurn && g.canHeroPower()}
            active={mode.k === 'heroPower' || mode.k === 'powerChoose'}
            onClick={onHeroPower}
            onHover={(on) => setInspect(on ? { power: ME } : null)}
          />
          <StarshipView p={me} g={g} usable={myTurn && g.canLaunch().ok} onClick={onLaunch} onHover={inspectShip(ME)} />
        </div>
        <div className="hand my-hand" style={{ '--n': me.hand.length } as CSSProperties}>
          {me.hand.map((h, i) => {
            const def = g.handDef(h);
            const playable = myTurn && g.canPlay(h.uid).ok;
            const echo = g.hasEcho(ME, h);
            return (
              <PressableCardSurface
                key={h.uid}
                handUid={h.uid}
                className={`hand-slot ${selectedHand === h.uid ? 'selected' : ''} ${h.echo ? 'echo-copy' : ''}`}
                style={{ '--i': i } as CSSProperties}
                title={h.echo ? '回音的複製：只能在本回合使用' : undefined}
                onClick={() => onHandClick(h.uid)}
                onLongPress={() => {
                  const stats = def.type === 'MINION' ? g.handStats(ME, h) : undefined;
                  setMode({ k: 'idle' });
                  setInspect({
                    cardId: h.cardId,
                    def: h.parts ? def : undefined,
                    atk: stats?.atk,
                    hp: stats?.hp,
                    cost: g.costOf(me, h),
                    spellDamage: g.spellDamage(ME),
                  });
                }}
              >
                <CardView
                  cardId={h.cardId}
                  def={h.parts ? def : undefined}
                  width={cw}
                  cost={g.costOf(me, h)}
                  attack={def.type === 'MINION' ? g.handStats(ME, h).atk : undefined}
                  health={def.type === 'MINION' ? g.handStats(ME, h).hp : undefined}
                  spellDamage={g.spellDamage(ME)}
                  playable={playable}
                  selected={selectedHand === h.uid}
                />
                {echo && <span className="echo-badge">回音</span>}
                {g.costKind(me, h) !== 'mana' && (
                  <span className={`cost-kind ${g.costKind(me, h)}`} title={g.costKind(me, h) === 'health' ? '消耗生命值而不是法力' : '消耗屍體而不是法力'}>
                    {g.costKind(me, h) === 'health' ? '❤' : '💀'}
                  </span>
                )}
              </PressableCardSurface>
            );
          })}
        </div>
      </div>

      {/* ---------------- 放置手下：半透明卡牌跟隨滑鼠 / 手指 ---------------- */}
      {placing && selectedCard && selectedDef && (
        <div ref={placeGhostRef} className="placement-card-ghost" aria-hidden="true">
          <CardView
            cardId={selectedCard.cardId}
            def={selectedCard.parts ? selectedDef : undefined}
            width={Math.round(clamp(cw * 1.12, 84, 146))}
            cost={g.costOf(me, selectedCard)}
            attack={selectedStats?.atk}
            health={selectedStats?.hp}
            spellDamage={g.spellDamage(ME)}
            selected
          />
        </div>
      )}

      {/* ---------------- 浮動資訊 ---------------- */}
      {inspect && 'power' in inspect && (
        <div className="inspect" onClick={() => setInspect(null)}>
          <div className="power-card">
            <b>{g.powerInfo(s.players[inspect.power]).name}</b>
            <span className="muted small">英雄能力・消耗 {s.players[inspect.power].heroPower.cost}</span>
            <p dangerouslySetInnerHTML={{ __html: formatCardText(g.powerInfo(s.players[inspect.power]).text) }} />
          </div>
        </div>
      )}
      {inspect && 'cardId' in inspect && hasCard(inspect.cardId) && (
        <div className="inspect" onClick={() => setInspect(null)}>
          <CardView cardId={inspect.cardId} def={inspect.def} width={220} cost={inspect.cost} attack={inspect.atk} health={inspect.hp} spellDamage={inspect.spellDamage} />
          <Glossary cardId={inspect.cardId} minion={inspect.uid !== undefined ? g.minion(inspect.uid) : null} g={g} />
        </div>
      )}
      {toast && <div className="toast">{toast}</div>}
      {canTrade && selectedHand !== null && (
        <button className="btn trade-btn" onClick={() => act({ type: 'trade', handUid: selectedHand })}>
          🔁 交易（1 法力：洗回牌堆並抽一張）
        </button>
      )}
      {turnBanner > 0 && (
        <div className="turn-banner" key={`turn-${turnBanner}`}>
          你的回合
        </div>
      )}
      {cast && (
        <div className={`cast-card ${cast.player === ME ? 'mine' : 'theirs'}`} key={`cast-${cast.id}`}>
          {cast.player !== ME && getCard(cast.cardId).secret ? <div className="secret-card">?</div> : <CardView cardId={cast.cardId} width={210} />}
        </div>
      )}
      {banner && (
        <div className="play-banner" key={`banner-${banner.id}`}>
          <div className="banner-text">{banner.text}</div>
          {banner.cardId && <CardView cardId={banner.cardId} width={200} />}
        </div>
      )}
      {showLog && (
        <div className="log-panel">
          <div className="log-head">
            對戰紀錄 <button onClick={() => setShowLog(false)}>✕</button>
          </div>
          <ul>
            {[...s.log].reverse().map((l, i) => (
              <li key={i} className={l.player === ME ? 'mine' : l.player === AI ? 'theirs' : ''}>
                {l.text}
              </li>
            ))}
          </ul>
        </div>
      )}

      {/* ---------------- 視窗 ---------------- */}
      {s.phase === 'mulligan' && !me.mulliganDone && (
        <div className="modal">
          <div className="modal-box">
            <h2>起手換牌</h2>
            <p>{s.first === ME ? '你是先攻' : '你是後攻（會獲得幸運幣）'}，點選想換掉的卡牌。</p>
            <div className="card-row">
              {me.hand.map((h) => (
                <div key={h.uid} className={`mulligan-card ${mulliganPick.has(h.uid) ? 'replace' : ''}`}>
                  <CardView
                    cardId={h.cardId}
                    def={h.parts ? g.handDef(h) : undefined}
                    width={150}
                    onClick={() => {
                      const next = new Set(mulliganPick);
                      if (next.has(h.uid)) next.delete(h.uid);
                      else next.add(h.uid);
                      setMulliganPick(next);
                    }}
                  />
                </div>
              ))}
            </div>
            <button
              className="btn big primary"
              onClick={() => {
                g.apply({ type: 'mulligan', player: ME, replace: [...mulliganPick] });
                refresh();
              }}
            >
              確定
            </button>
          </div>
        </div>
      )}

      {mode.k === 'powerChoose' && g.heroPowerOptions() && (
        <div className="modal" onClick={() => setMode({ k: 'idle' })}>
          <div className="modal-box" onClick={(e) => e.stopPropagation()}>
            <h2>{g.powerInfo(me).name}：二選一</h2>
            <div className="card-row">
              {g.heroPowerOptions()!.map((o, i) => {
                const ok = g.canHeroPower(i);
                return (
                  <button key={o.id} className={`choose-option ${ok ? '' : 'disabled'}`} disabled={!ok} onClick={() => onPowerOption(i)}>
                    <Art cardId={o.id} className="choose-art" label={(o.name ?? '').slice(0, 2)} color={CLASS_COLORS[me.heroClass]} />
                    <b>{o.name}</b>
                    <span dangerouslySetInnerHTML={{ __html: formatCardText(o.text ?? '') }} />
                  </button>
                );
              })}
            </div>
            <button className="btn" onClick={() => setMode({ k: 'idle' })}>
              取消
            </button>
          </div>
        </div>
      )}

      {mode.k === 'card' && mode.stage === 'choose' && selectedDef?.chooseOne && (
        <div className="modal" onClick={() => setMode({ k: 'idle' })}>
          <div className="modal-box" onClick={(e) => e.stopPropagation()}>
            <h2>二選一</h2>
            <div className="card-row">
              {selectedDef.chooseOne.map((o, i) => {
                const ok = g.canPlay(mode.handUid, i).ok;
                return (
                  <button key={o.id} className={`choose-option ${ok ? '' : 'disabled'}`} disabled={!ok} onClick={() => afterOption(mode.handUid, i)}>
                    <Art cardId={o.transformInto ?? selectedDef.id} className="choose-art" />
                    <b>{o.name}</b>
                    <span dangerouslySetInnerHTML={{ __html: formatCardText(o.text) }} />
                  </button>
                );
              })}
            </div>
            <button className="btn" onClick={() => setMode({ k: 'idle' })}>
              取消
            </button>
          </div>
        </div>
      )}

      {s.pendingChoice && s.pendingChoice.player === ME && (
        <div className="modal">
          <div className="modal-box">
            <h2>{s.pendingChoice.title}</h2>
            <div className="card-row">
              {s.pendingChoice.options.map((id, i) => (
                <CardView key={id + i} cardId={id} width={170} playable onClick={() => act({ type: 'choose', index: i })} />
              ))}
            </div>
          </div>
        </div>
      )}

      {s.phase === 'over' && (
        <div className="modal">
          <div className={`modal-box result ${reward?.result ?? ''}`}>
            <h1>{s.winner === ME ? '🏆 勝利！' : s.winner === 'draw' ? '平手' : '💀 落敗'}</h1>
            {reward?.change && ladder && <RankChangeView change={reward.change} />}
            {ladder && (
              <p className="muted small">
                對手：{ladder.name}・{ladder.deckName}（{DECK_KIND_NAMES[ladder.deckKind]}）
              </p>
            )}
            {reward && (
              <p className="reward-line">
                獲得 <b>🪙 {reward.gold}</b> 金幣{reward.daily > 0 && <>（含每日首勝 {reward.daily}）</>}
              </p>
            )}
            <p className="muted">目前金幣：{profile.gold}</p>
            <div className="row">
              <button className="btn big primary" onClick={onRematch}>
                {ladder ? '🔍 繼續配對' : '再戰一場'}
              </button>
              <button className="btn big" onClick={onExit}>
                {ladder ? '返回天梯' : '返回主選單'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

// ============================================================================
// 子元件
// ============================================================================

function useLongPress(onLongPress: () => void) {
  const timer = useRef<number | null>(null);
  const fired = useRef(false);

  const clear = () => {
    if (timer.current !== null) {
      window.clearTimeout(timer.current);
      timer.current = null;
    }
  };

  const start = () => {
    clear();
    fired.current = false;
    timer.current = window.setTimeout(() => {
      timer.current = null;
      fired.current = true;
      onLongPress();
    }, LONG_PRESS_MS);
  };

  useEffect(() => clear, []);

  const consumeClick = () => {
    if (!fired.current) return false;
    fired.current = false;
    return true;
  };

  return { start, clear, consumeClick };
}

function PressableCardSurface({
  handUid,
  className,
  style,
  title,
  onClick,
  onLongPress,
  children,
}: {
  handUid: number;
  className: string;
  style?: CSSProperties;
  title?: string;
  onClick: () => void;
  onLongPress: () => void;
  children: ReactNode;
}) {
  const press = useLongPress(onLongPress);
  return (
    <div
      data-hand-uid={handUid}
      className={className}
      style={style}
      title={title}
      onPointerDown={press.start}
      onPointerUp={press.clear}
      onPointerCancel={press.clear}
      onPointerLeave={press.clear}
      onClick={(e) => {
        e.stopPropagation();
        if (press.consumeClick()) return;
        onClick();
      }}
    >
      {children}
    </div>
  );
}

function RankChangeView({ change }: { change: LadderChange }) {
  const { before, after } = change;
  const legendDelta = before.legend && after.legend ? before.legend - after.legend : 0;
  return (
    <div className="rank-change">
      <div className="rank-change-row">
        <RankBadge info={after} size={72} />
        <div>
          <b style={{ color: after.color }}>{after.label}</b>
          <RankPips info={after} />
        </div>
      </div>
      <div className="rank-change-note">
        {change.promoted && <span className="promoted">🎉 {change.promoted}</span>}
        {change.stars > 0 && <span className="up">+{change.stars} ★{change.streakBonus && '（連勝加成）'}</span>}
        {change.stars < 0 && <span className="down">−1 ★</span>}
        {change.protectedByFloor && <span className="muted">保底：這個牌階不會再往下掉</span>}
        {legendDelta > 0 && <span className="up">名次上升 {legendDelta}</span>}
        {legendDelta < 0 && <span className="down">名次下降 {-legendDelta}</span>}
        {before.label !== after.label && !after.legend && <span className="muted">{before.label} → {after.label}</span>}
      </div>
    </div>
  );
}

const KEYWORD_HELP: [string, string][] = [
  ['TAUNT', '嘲諷：敵人必須先攻擊有嘲諷的角色'],
  ['DIVINE_SHIELD', '聖盾：抵擋下一次受到的傷害'],
  ['CHARGE', '衝鋒：上場當回合就能攻擊'],
  ['RUSH', '突襲：上場當回合就能攻擊手下'],
  ['WINDFURY', '風怒：每回合可以攻擊兩次'],
  ['MEGA_WINDFURY', '超級風怒：每回合可以攻擊四次'],
  ['STEALTH', '潛行：在攻擊前無法被敵人指定為目標'],
  ['POISONOUS', '劇毒：對手下造成傷害時直接消滅它'],
  ['LIFESTEAL', '生命竊取：造成傷害時為你的英雄恢復等量生命'],
  ['REBORN', '復生：第一次死亡時以 1 點生命值復活'],
  ['ELUSIVE', '法術免疫：無法成為法術或英雄能力的目標'],
  ['CANT_ATTACK', '無法攻擊'],
  ['FREEZE_ON_DAMAGE', '冰凍被它傷害的角色（下回合無法攻擊）'],
  ['TRADEABLE', '可交易：花 1 法力把它洗回牌堆並抽一張牌'],
  ['TWINSPELL', '雙生法術：施放後會把一張沒有雙生法術的複製放到你的手中'],
  ['ECHO', '回音：打出後會把一張複製加入手牌，本回合可以重複使用（複製在回合結束時消失，消耗不會低於 1）'],
];

function Glossary({ cardId, minion, g }: { cardId: string; minion: Minion | null; g: Game }) {
  const def = getCard(cardId);
  const kws = new Set<string>(def.keywords ?? []);
  if (minion) for (const k of KEYWORD_HELP) if (g.hasKw(minion, k[0] as Parameters<Game['hasKw']>[1])) kws.add(k[0]);
  const lines = KEYWORD_HELP.filter(([k]) => kws.has(k)).map(([, t]) => t);
  const kinds = new Set((def.abilities ?? []).map((a) => a.on.k));
  if (kinds.has('deathrattle')) lines.push('亡語：死亡時觸發效果');
  if (kinds.has('secret')) lines.push('奧秘：在對手回合滿足條件時才會揭露並觸發');
  if (def.starshipPiece) lines.push('星艦組件：上場時組裝進你的星艦。花 5 點法力發射星艦，它會擁有所有組件的攻擊力、生命值與效果');
  if (kinds.has('launch')) lines.push('發射時：星艦發射時觸發');
  if (kinds.has('overkill')) lines.push('滅殺：在你的回合造成的傷害超過消滅手下所需時觸發');
  if (def.runes) {
    const need = (['blood', 'frost', 'unholy'] as const).filter((k) => def.runes?.[k]).map((k) => `${RUNE_NAMES[k]}×${def.runes![k]}`).join('、');
    lines.push(`符文：套牌需要 ${need}（一副套牌最多 3 個符文）`);
  }
  if (def.castsWhenDrawn) lines.push('抽中時施放：抽到這張牌時會立即施放，然後再抽一張牌');
  if (def.costsHealth) lines.push('消耗生命值而不是法力（生命值不夠就不能打出）');
  if (def.costsHealthIf) lines.push('條件成立時改為消耗生命值而不是法力');
  if (def.costsCorpses) lines.push('消耗屍體而不是法力');
  if (def.flags?.includes('noTurnDraw')) lines.push('在場上時，你的回合開始時不會抽牌');
  if (def.flags?.includes('enemyNoHeal')) lines.push('在場上時，敵方角色無法被治療');
  if (def.flags?.includes('doubleCorpses')) lines.push('在場上時，你獲得的屍體加倍');
  if (/屍體/.test(def.text)) lines.push('屍體：友方手下死亡時，死亡騎士獲得 1 個屍體，可以被卡牌消耗');
  if (def.starship) lines.push('星艦：由組件組成，擁有所有組件的攻擊力、生命值與效果');
  if (def.overload) lines.push(`超載：下回合鎖住 ${def.overload} 顆法力水晶`);
  if (def.spellDamage) lines.push(`法術傷害 +${def.spellDamage}：你的法術多造成 ${def.spellDamage} 點傷害`);
  if (minion?.frozen) lines.push('已被冰凍：錯過下一次攻擊');
  if (minion?.silenced) lines.push('已被沉默：失去所有卡牌敘述的效果');
  if (!lines.length) return null;
  return (
    <ul className="glossary">
      {lines.map((l) => (
        <li key={l}>{l}</li>
      ))}
    </ul>
  );
}

function Slot({ onClick }: { onClick: () => void }) {
  return (
    <button
      className="slot"
      onClick={(e) => {
        e.stopPropagation();
        onClick();
      }}
    />
  );
}

function MinionView({
  m,
  g,
  className,
  onClick,
  onLongPress,
  children,
}: {
  m: Minion;
  g: Game;
  className: string;
  onClick: () => void;
  onLongPress: () => void;
  children?: ReactNode;
}) {
  const press = useLongPress(onLongPress);
  const def = g.minionDef(m);
  const atk = g.atkOf(m);
  const kw = (k: Parameters<Game['hasKw']>[1]) => g.hasKw(m, k);
  const hasDeathrattle = !m.silenced && m.abilities.some((a) => a.on.k === 'deathrattle');
  const hasTrigger = !m.silenced && (m.abilities.some((a) => a.on.k !== 'play' && a.on.k !== 'deathrattle') || m.auras.length > 0);
  const hpClass = m.hp < m.maxHp ? 'damaged' : m.maxHp > (def.health ?? 0) ? 'buffed' : '';
  const atkClass = atk > (def.attack ?? 0) ? 'buffed' : atk < (def.attack ?? 0) ? 'damaged' : '';
  return (
    <div
      data-uid={m.uid}
      className={`minion ${kw('TAUNT') ? 'taunt' : ''} ${kw('DIVINE_SHIELD') ? 'shield' : ''} ${kw('STEALTH') ? 'stealth' : ''} ${m.frozen ? 'frozen' : ''} ${def.rarity === 'LEGENDARY' ? 'legendary' : ''} ${className}`}
      onPointerDown={press.start}
      onPointerUp={press.clear}
      onPointerCancel={press.clear}
      onPointerLeave={press.clear}
      onClick={(e) => {
        e.stopPropagation();
        if (press.consumeClick()) return;
        onClick();
      }}
    >
      <div className="minion-portrait">
        <Art cardId={m.cardId} />
      </div>
      <div className={`minion-atk ${atkClass}`}>{atk}</div>
      <div className={`minion-hp ${hpClass}`}>{m.hp}</div>
      <div className="minion-icons">
        {hasDeathrattle && <span title="亡語">💀</span>}
        {hasTrigger && <span title="觸發 / 光環">⚡</span>}
        {kw('POISONOUS') && <span title="劇毒">🧪</span>}
        {kw('LIFESTEAL') && <span title="生命竊取">🩸</span>}
        {(kw('WINDFURY') || kw('MEGA_WINDFURY')) && <span title="風怒">🌀</span>}
        {kw('REBORN') && <span title="復生">👼</span>}
        {m.spellDamage > 0 && !m.silenced && <span title="法術傷害">🔮</span>}
        {m.silenced && <span title="已沉默">🔇</span>}
      </div>
      {m.sleeping && !kw('CHARGE') && m.owner === g.s.current && <div className="zzz">z z</div>}
      {children}
    </div>
  );
}

function HeroView({ p, g, className, onClick, children }: { p: PlayerState; g: Game; className: string; onClick: () => void; children?: ReactNode }) {
  const h = p.hero;
  const atk = g.atkOf(h);
  return (
    <div
      data-uid={h.uid}
      data-hero={p.id}
      className={`hero ${h.frozen ? 'frozen' : ''} ${h.immune ? 'immune' : ''} ${className}`}
      style={{ '--class': CLASS_COLORS[p.heroClass] } as CSSProperties}
      onClick={(e) => {
        e.stopPropagation();
        onClick();
      }}
    >
      <div className="hero-portrait">
        <Art cardId={h.cardId} label={CLASS_NAMES[p.heroClass]} color={CLASS_COLORS[p.heroClass]} />
      </div>
      {p.secrets.length > 0 && (
        <div className="secrets">
          {p.secrets.map((sec) => (
            <span key={sec.uid} className="secret" title={p.id === ME ? getCard(sec.cardId).name : '奧秘'}>
              ?
            </span>
          ))}
        </div>
      )}
      {atk > 0 && <div className="hero-atk">{atk}</div>}
      <div className={`hero-hp ${h.hp < h.maxHp ? 'damaged' : ''}`}>{h.hp}</div>
      {h.armor > 0 && <div className="hero-armor">{h.armor}</div>}
      <div className="hero-name">{p.name}</div>
      {children}
    </div>
  );
}

function HeroPowerView({
  p,
  g,
  usable,
  active,
  onClick,
  onHover,
}: {
  p: PlayerState;
  g: Game;
  usable: boolean;
  active?: boolean;
  onClick?: () => void;
  onHover?: (on: boolean) => void;
}) {
  const info = g.powerInfo(p);
  return (
    <button
      data-power={p.id}
      className={`hero-power ${p.heroPower.used ? 'used' : ''} ${usable ? 'usable' : ''} ${active ? 'active' : ''}`}
      onClick={(e) => {
        e.stopPropagation();
        onClick?.();
      }}
      onMouseEnter={() => onHover?.(true)}
      onMouseLeave={() => onHover?.(false)}
    >
      <Art cardId={p.heroPower.id} className="hp-art" label={info.name.slice(0, 2)} color={CLASS_COLORS[p.heroClass]} />
      <span className="hp-cost">{p.heroPower.cost}</span>
      <span className="hp-name">{info.name}</span>
    </button>
  );
}

/** 正在建造的星艦：顯示組件數量、目前的數值與發射消耗 */
function StarshipView({
  p,
  g,
  usable,
  onClick,
  onHover,
}: {
  p: PlayerState;
  g: Game;
  usable: boolean;
  onClick?: () => void;
  onHover?: (on: boolean) => void;
}) {
  const def = g.starshipPreview(p.id);
  if (!def) return null;
  return (
    <button
      className={`starship ${usable ? 'usable' : ''}`}
      title={`${def.name}：${p.starship!.length} 個組件，花 ${g.launchCost(p)} 點法力發射`}
      onClick={(e) => {
        e.stopPropagation();
        onClick?.();
      }}
      onMouseEnter={() => onHover?.(true)}
      onMouseLeave={() => onHover?.(false)}
    >
      <Art cardId={def.id} className="ship-art" label="星艦" color="#3c4f7a" />
      <span className="ship-cost">{g.launchCost(p)}</span>
      <span className="ship-atk">{def.attack}</span>
      <span className="ship-hp">{def.health}</span>
      <span className="ship-label">{usable ? '發射！' : `星艦 ×${p.starship!.length}`}</span>
    </button>
  );
}

function WeaponView({ p }: { p: PlayerState }) {
  const w = p.weapon;
  if (!w) return <div className="weapon empty" />;
  return (
    <div className="weapon" title={getCard(w.cardId).name}>
      <Art cardId={w.cardId} />
      <span className="w-atk">{w.atk}</span>
      <span className="w-dur">{w.durability}</span>
    </div>
  );
}

function PlayerInfo({ p }: { p: PlayerState }) {
  return (
    <div className="player-info">
      <div className="mana">
        <span className="mana-text">
          💎 {p.mana}/{p.maxMana}
        </span>
        <div className="crystals">
          {Array.from({ length: 10 }, (_, i) => (
            <span key={i} className={`crystal ${i < p.mana ? 'full' : i < p.maxMana ? 'empty' : 'none'} ${i >= p.maxMana - p.overloadLocked && i < p.maxMana ? 'locked' : ''}`} />
          ))}
        </div>
        {p.overloadOwed > 0 && <span className="overload">超載 {p.overloadOwed}</span>}
      </div>
      <div className="deck-count" title="牌庫剩餘" data-deck={p.id}>
        🂠 {p.deck.length}
      </div>
      <div className="hand-count" title="手牌數">
        ✋ {p.hand.length}
      </div>
      {(p.heroClass === 'DEATHKNIGHT' || !!p.corpses) && (
        <div className="corpse-count" title="屍體：友方手下死亡時獲得，可被死亡騎士的卡牌消耗">
          <span key={p.corpses} className="corpse-n">
            💀 {p.corpses ?? 0}
          </span>
        </div>
      )}
    </div>
  );
}
