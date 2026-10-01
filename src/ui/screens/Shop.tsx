import { useState, type CSSProperties } from 'react';
import { buyPacks, packPool } from '../../game/profile';
import { PACKS, type PackType } from '../../game/sets';
import type { Screen } from '../App';
import { setProfile, useProfile } from '../store';

export function PackArt({ pack, small }: { pack: PackType; small?: boolean }) {
  return (
    <div className={`pack-art ${small ? 'small' : ''}`} style={{ '--pack': pack.color } as CSSProperties}>
      <div className="pack-emblem">✦</div>
      <div className="pack-title">{pack.name}</div>
    </div>
  );
}

export function Shop({ go }: { go: (s: Screen) => void }) {
  const p = useProfile();
  const [msg, setMsg] = useState('');
  const buy = (packId: string, count: number) => {
    const r = buyPacks(p, packId, count);
    if (!r.ok) {
      setMsg(r.error ?? '無法購買');
      return;
    }
    setProfile(r.profile);
    setMsg(`購買成功！獲得 ${count} 包`);
  };
  return (
    <div className="shop">
      <div className="shop-head">
        <h2>🛒 卡包商店</h2>
        <p className="muted">每包 5 張卡，至少 1 張稀有以上；連續 30 包沒開到傳說必定保底。</p>
        {msg && <div className="message">{msg}</div>}
      </div>
      <div className="shop-grid">
        {PACKS.map((pack) => {
          const pool = packPool(pack);
          const owned = pool.filter((c) => p.collection[c.id]).length;
          return (
            <div key={pack.id} className="shop-item">
              <PackArt pack={pack} />
              <h3>{pack.name}</h3>
              <p className="muted small">{pack.description}</p>
              <p className="small">
                收集進度：{owned} / {pool.length}
              </p>
              <div className="shop-buttons">
                <button className="btn primary" disabled={p.gold < pack.price} onClick={() => buy(pack.id, 1)}>
                  買 1 包 🪙{pack.price}
                </button>
                <button className="btn" disabled={p.gold < pack.price * 5} onClick={() => buy(pack.id, 5)}>
                  買 5 包 🪙{pack.price * 5}
                </button>
              </div>
              {(p.packs[pack.id] ?? 0) > 0 && (
                <button className="btn small full" onClick={() => go('packs')}>
                  尚未開啟：{p.packs[pack.id]} 包 → 去開包
                </button>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
