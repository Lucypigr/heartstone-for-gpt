import { useEffect, useRef, useState, type CSSProperties } from 'react';
import { HEROES } from '../../cards/registry';
import { CLASS_NAMES } from '../../engine/heroes';
import { validateDeck } from '../../game/decks';
import {
  ensureSeason,
  findOpponent,
  LEAGUES,
  LEGEND,
  LEGEND_STARS,
  ladderRank,
  newLadder,
  rankInfo,
  SEASON_REWARD,
  seasonName,
  type LadderOpponent,
} from '../../game/ladder';
import type { BattleConfig, Screen } from '../App';
import { CLASS_COLORS } from '../cardText';
import { Art } from '../components/Card';
import { RankBadge, RankPips } from '../components/Rank';
import { getProfile, setProfile, useProfile } from '../store';

const LAST_DECK_KEY = 'heartstone-for-gpt/ladder-deck';

const QUEUE_TIPS = ['正在尋找實力相近的對手…', '正在連線到伺服器…', '對手正在載入…', '玩家越多，配對越快'];

type Queue = { k: 'searching'; opponent: LadderOpponent; started: number; wait: number } | { k: 'found'; opponent: LadderOpponent };

export function Ladder({
  onStart,
  go,
  autoQueueDeck,
  onAutoQueued,
}: {
  onStart: (c: BattleConfig) => void;
  go: (s: Screen) => void;
  autoQueueDeck: string | null;
  onAutoQueued: () => void;
}) {
  const p = useProfile();
  const [seasonMsg, setSeasonMsg] = useState('');
  // 進入天梯時處理換季
  useEffect(() => {
    const r = ensureSeason(getProfile());
    if (r.profile !== getProfile()) setProfile(r.profile);
    if (r.reward) setSeasonMsg(`${seasonName(r.reward.season)}結束！最高牌階 ${r.reward.rank}，獲得 🪙 ${r.reward.gold}`);
  }, []);
  const ladder = p.ladder ?? newLadder();
  const info = ladderRank(ladder);
  const best = rankInfo(ladder.best, ladder.best >= LEGEND_STARS ? ladder.bestLegend : null);

  const valid = p.decks.filter((d) => validateDeck(d, p.collection).ok);
  const [deckId, setDeckId] = useState(() => {
    let saved = '';
    try {
      saved = localStorage.getItem(LAST_DECK_KEY) ?? '';
    } catch {
      /* 無法讀取 */
    }
    return autoQueueDeck ?? (valid.some((d) => d.id === saved) ? saved : valid[0]?.id ?? '');
  });
  const deck = valid.find((d) => d.id === deckId);

  const [queue, setQueue] = useState<Queue | null>(null);
  const [now, setNow] = useState(() => performance.now());
  const timers = useRef<number[]>([]);
  useEffect(() => () => timers.current.forEach((t) => window.clearTimeout(t)), []);

  const startQueue = (id = deckId) => {
    if (!valid.some((d) => d.id === id)) return;
    try {
      localStorage.setItem(LAST_DECK_KEY, id);
    } catch {
      /* 無法儲存 */
    }
    const opponent = findOpponent(getProfile().ladder ?? newLadder());
    const factor = p.settings.aiSpeed === 'fast' ? 0.5 : 1;
    const wait = Math.min(opponent.queueSeconds, 14) * 1000 * factor;
    setQueue({ k: 'searching', opponent, started: performance.now(), wait });
    timers.current.push(
      window.setTimeout(() => setQueue({ k: 'found', opponent }), wait),
      window.setTimeout(() => onStart({ deckId: id, difficulty: opponent.difficulty, oppClass: opponent.heroClass, ladder: opponent }), wait + 3200),
    );
  };
  const cancel = () => {
    timers.current.forEach((t) => window.clearTimeout(t));
    timers.current = [];
    setQueue(null);
  };

  // 從對戰按「繼續配對」回來
  const auto = useRef(false);
  useEffect(() => {
    if (!autoQueueDeck || auto.current) return;
    auto.current = true;
    onAutoQueued();
    startQueue(autoQueueDeck);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // 配對中的計時器
  useEffect(() => {
    if (queue?.k !== 'searching') return;
    const t = window.setInterval(() => setNow(performance.now()), 250);
    return () => window.clearInterval(t);
  }, [queue]);

  const winRate = ladder.wins + ladder.losses > 0 ? Math.round((ladder.wins / (ladder.wins + ladder.losses)) * 100) : null;

  return (
    <div className="ladder">
      <section className="ladder-top panel" style={{ '--league': info.color } as CSSProperties}>
        <RankBadge info={info} size={110} />
        <div className="ladder-rank">
          <div className="muted small">{seasonName(ladder.season)}</div>
          <h2 style={{ color: info.color }}>{info.label}</h2>
          <RankPips info={info} />
          <div className="ladder-stats">
            <span>
              本季 <b>{ladder.wins}</b> 勝 <b>{ladder.losses}</b> 敗{winRate !== null && `（勝率 ${winRate}%）`}
            </span>
            {ladder.streak >= 2 && <span className="streak">🔥 {ladder.streak} 連勝</span>}
            <span className="muted">本季最高：{best.label}</span>
          </div>
        </div>
        <div className="league-track">
          {[...LEAGUES, LEGEND].map((L, i) => (
            <span key={L.name} className={`league-step ${i === info.league ? 'current' : i < info.league ? 'done' : ''}`} style={{ '--c': L.color } as CSSProperties}>
              {L.name}
            </span>
          ))}
        </div>
      </section>

      {seasonMsg && <div className="notice">🎁 {seasonMsg}</div>}

      <h2>選擇套牌</h2>
      {valid.length === 0 ? (
        <div className="panel">
          <p>你目前沒有符合組牌規則的完整套牌。</p>
          <button className="btn primary" onClick={() => go('collection')}>
            去組一副套牌
          </button>
        </div>
      ) : (
        <div className="deck-picker">
          {valid.map((d) => (
            <button
              key={d.id}
              className={`deck-tile ${deckId === d.id ? 'active' : ''}`}
              style={{ '--class': CLASS_COLORS[d.heroClass] } as CSSProperties}
              onClick={() => setDeckId(d.id)}
            >
              <Art cardId={HEROES[d.heroClass].hero} className="deck-hero" label={CLASS_NAMES[d.heroClass]} color={CLASS_COLORS[d.heroClass]} />
              <span className="deck-name">{d.name}</span>
              <span className="deck-sub">
                {CLASS_NAMES[d.heroClass]}
                {d.freeform ? '・不限職業' : ''}
              </span>
            </button>
          ))}
        </div>
      )}

      <div className="start-row">
        <button className="btn big primary" disabled={!deck} onClick={() => startQueue()}>
          🔍 開始配對
        </button>
      </div>

      <section className="home-info">
        <div className="panel">
          <h3>📖 天梯規則</h3>
          <ul>
            <li>牌階從青銅 10 開始，依序是青銅、白銀、黃金、白金、鑽石，最後是傳說</li>
            <li>每個牌階有 3 顆星；勝利 +1 星、落敗 −1 星</li>
            <li>3 連勝以上每場 +2 星（鑽石 5 以上沒有連勝加成）</li>
            <li>每個分段的 10 與 5 是保底，到了之後就不會再掉下去；傳說也不會掉</li>
            <li>對手都是依照你的牌階配對的玩家：牌階越高，對手越強、套牌越完整</li>
            <li>每個月是一個賽季，換季時會退回一些牌階</li>
          </ul>
        </div>
        <div className="panel">
          <h3>💰 天梯獎勵</h3>
          <ul>
            <li>
              勝利：<b>40</b> 金幣起，每高一個分段 +10（傳說 <b>90</b>）；落敗：10 金幣
            </li>
            <li>每日首勝：額外 50 金幣</li>
            <li>
              賽季獎勵（依本季最高分段）：
              {[...LEAGUES, LEGEND].map((L, i) => (
                <span key={L.name} className="season-reward" style={{ color: L.color }}>
                  {L.name} 🪙{SEASON_REWARD[i]}
                </span>
              ))}
            </li>
            {ladder.lastReward && (
              <li className="muted">
                上季（{seasonName(ladder.lastReward.season)}）：{ladder.lastReward.rank}，🪙 {ladder.lastReward.gold}
              </li>
            )}
          </ul>
        </div>
      </section>

      {queue && deck && (
        <div className="modal queue-modal">
          {queue.k === 'searching' ? (
            <div className="modal-box queue-box">
              <div className="queue-spinner" />
              <h2>尋找對手中</h2>
              <p className="queue-time">{formatTime(now - queue.started)}</p>
              <p className="muted">{QUEUE_TIPS[Math.floor((now - queue.started) / 3000) % QUEUE_TIPS.length]}</p>
              <p className="muted small">
                {info.label}・{deck.name}
              </p>
              <button className="btn" onClick={cancel}>
                取消
              </button>
            </div>
          ) : (
            <div className="versus">
              <div className="vs-side me" style={{ '--class': CLASS_COLORS[deck.heroClass] } as CSSProperties}>
                <Art cardId={HEROES[deck.heroClass].hero} className="vs-art" label={CLASS_NAMES[deck.heroClass]} color={CLASS_COLORS[deck.heroClass]} />
                <b className="vs-name">你</b>
                <span className="vs-rank">
                  <RankBadge info={info} size={40} /> {info.label}
                </span>
              </div>
              <div className="vs-mark">VS</div>
              <div className="vs-side foe" style={{ '--class': CLASS_COLORS[queue.opponent.heroClass] } as CSSProperties}>
                <Art
                  cardId={HEROES[queue.opponent.heroClass].hero}
                  className="vs-art"
                  label={CLASS_NAMES[queue.opponent.heroClass]}
                  color={CLASS_COLORS[queue.opponent.heroClass]}
                />
                <b className="vs-name">{queue.opponent.name}</b>
                <span className="vs-rank">
                  <RankBadge info={queue.opponent.rank} size={40} /> {queue.opponent.rank.label}・{CLASS_NAMES[queue.opponent.heroClass]}
                </span>
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function formatTime(ms: number): string {
  const sec = Math.floor(ms / 1000);
  return `${Math.floor(sec / 60)}:${String(sec % 60).padStart(2, '0')}`;
}
