import { useState, type CSSProperties } from 'react';
import { HEROES, PLAYABLE_CLASSES } from '../../cards/registry';
import type { Difficulty } from '../../engine/ai';
import { CLASS_NAMES } from '../../engine/heroes';
import { validateDeck, type HeroClass } from '../../game/decks';
import { DIFFICULTY_NAMES, LOSS_REWARD, WIN_REWARD } from '../../game/economy';
import type { BattleConfig, Screen } from '../App';
import { CLASS_COLORS } from '../cardText';
import { Art } from '../components/Card';
import { useProfile } from '../store';

const DIFF_DESC: Record<Difficulty, string> = {
  easy: '使用基本與普通卡，偶爾會犯錯',
  normal: '使用較完整的套牌，會計算交換',
  hard: '強力套牌，會多想一步',
};

export function PlaySetup({ onStart, go }: { onStart: (c: BattleConfig) => void; go: (s: Screen) => void }) {
  const p = useProfile();
  const valid = p.decks.filter((d) => validateDeck(d, p.collection).ok);
  const [deckId, setDeckId] = useState(valid[0]?.id ?? '');
  const [difficulty, setDifficulty] = useState<Difficulty>('normal');
  const [opp, setOpp] = useState<HeroClass | 'random'>('random');

  const start = () => {
    const oppClass = opp === 'random' ? PLAYABLE_CLASSES[Math.floor(Math.random() * PLAYABLE_CLASSES.length)] : opp;
    onStart({ deckId, difficulty, oppClass });
  };

  return (
    <div className="play-setup">
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
          {p.decks.map((d) => {
            const ok = validateDeck(d, p.collection).ok;
            return (
              <button
                key={d.id}
                disabled={!ok}
                className={`deck-tile ${deckId === d.id ? 'active' : ''}`}
                style={{ '--class': CLASS_COLORS[d.heroClass] } as CSSProperties}
                onClick={() => setDeckId(d.id)}
              >
                <Art cardId={HEROES[d.heroClass].hero} className="deck-hero" label={CLASS_NAMES[d.heroClass]} color={CLASS_COLORS[d.heroClass]} />
                <span className="deck-name">{d.name}</span>
                <span className="deck-sub">
                  {CLASS_NAMES[d.heroClass]}
                  {d.freeform ? '・不限職業' : ''}
                  {!ok ? '・未完成' : ''}
                </span>
              </button>
            );
          })}
        </div>
      )}

      <h2>選擇難度</h2>
      <div className="difficulty-picker">
        {(['easy', 'normal', 'hard'] as Difficulty[]).map((d) => (
          <button key={d} className={`diff-tile ${difficulty === d ? 'active' : ''} ${d}`} onClick={() => setDifficulty(d)}>
            <b>{DIFFICULTY_NAMES[d]}</b>
            <span>{DIFF_DESC[d]}</span>
            <span className="reward">
              勝利 🪙{WIN_REWARD[d]}・落敗 🪙{LOSS_REWARD[d]}
            </span>
          </button>
        ))}
      </div>

      <h2>對手職業</h2>
      <div className="class-picker">
        <button className={opp === 'random' ? 'active' : ''} onClick={() => setOpp('random')}>
          🎲 隨機
        </button>
        {PLAYABLE_CLASSES.map((c) => (
          <button key={c} className={opp === c ? 'active' : ''} style={{ '--class': CLASS_COLORS[c] } as CSSProperties} onClick={() => setOpp(c)}>
            {CLASS_NAMES[c]}
          </button>
        ))}
      </div>

      <div className="start-row">
        <button className="btn big primary" disabled={!valid.some((d) => d.id === deckId)} onClick={start}>
          ⚔️ 開始對戰
        </button>
      </div>
    </div>
  );
}
