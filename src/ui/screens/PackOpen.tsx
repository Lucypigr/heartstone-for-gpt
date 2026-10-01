import { useState } from 'react';
import { getCard } from '../../cards/registry';
import { RARITY_NAMES } from '../../game/economy';
import { openPack } from '../../game/profile';
import { PACKS } from '../../game/sets';
import type { Screen } from '../App';
import { CardView } from '../components/Card';
import { getProfile, setProfile, useProfile } from '../store';
import { PackArt } from './Shop';

interface Opened {
  packId: string;
  cards: { id: string; isNew: boolean }[];
  revealed: boolean[];
}

export function PackOpen({ go }: { go: (s: Screen) => void }) {
  const p = useProfile();
  const [opened, setOpened] = useState<Opened | null>(null);
  const available = PACKS.filter((pk) => (p.packs[pk.id] ?? 0) > 0);

  const open = (packId: string) => {
    const before = getProfile();
    const r = openPack(before, packId);
    if (!r.ok) return;
    const seen = new Set<string>();
    const cards = r.cards.map((id) => {
      const isNew = !before.collection[id] && !seen.has(id);
      seen.add(id);
      return { id, isNew };
    });
    setProfile(r.profile);
    setOpened({ packId, cards, revealed: cards.map(() => false) });
  };

  if (opened) {
    const all = opened.revealed.every(Boolean);
    const left = p.packs[opened.packId] ?? 0;
    return (
      <div className="pack-open">
        <h2>{PACKS.find((x) => x.id === opened.packId)?.name}</h2>
        <p className="muted">點擊卡牌翻開</p>
        <div className="reveal-row">
          {opened.cards.map((c, i) => {
            const def = getCard(c.id);
            return (
              <div
                key={i}
                className={`reveal ${opened.revealed[i] ? 'flipped' : ''} rarity-${def.rarity.toLowerCase()}`}
                onClick={() => {
                  const revealed = [...opened.revealed];
                  revealed[i] = true;
                  setOpened({ ...opened, revealed });
                }}
              >
                <div className="reveal-inner">
                  <div className="reveal-back" />
                  <div className="reveal-front">
                    <CardView cardId={c.id} width={170} />
                    {c.isNew && <span className="new-badge">NEW</span>}
                    <span className="rarity-label">{RARITY_NAMES[def.rarity]}</span>
                  </div>
                </div>
              </div>
            );
          })}
        </div>
        <div className="row">
          {!all && (
            <button className="btn" onClick={() => setOpened({ ...opened, revealed: opened.revealed.map(() => true) })}>
              全部翻開
            </button>
          )}
          {all && left > 0 && (
            <button className="btn primary big" onClick={() => open(opened.packId)}>
              再開一包（剩 {left} 包）
            </button>
          )}
          {all && (
            <button className="btn big" onClick={() => setOpened(null)}>
              完成
            </button>
          )}
        </div>
      </div>
    );
  }

  return (
    <div className="pack-open">
      <h2>🎁 開啟卡包</h2>
      {available.length === 0 ? (
        <div className="panel">
          <p>你沒有未開啟的卡包。</p>
          <button className="btn primary" onClick={() => go('shop')}>
            去商店購買
          </button>
        </div>
      ) : (
        <div className="pack-list">
          {available.map((pk) => (
            <button key={pk.id} className="pack-choice" onClick={() => open(pk.id)}>
              <PackArt pack={pk} />
              <span className="pack-count">× {p.packs[pk.id]}</span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
