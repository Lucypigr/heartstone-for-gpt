import { useState } from 'react';
import { COLLECTIBLE, DATA_BUILD } from '../../cards/registry';
import { redeemRewardCode } from '../../game/profile';
import { exportProfile, importProfile, resetProfile, setProfile, useProfile } from '../store';

export function Settings() {
  const p = useProfile();
  const [text, setText] = useState('');
  const [msg, setMsg] = useState('');
  const [rewardCode, setRewardCode] = useState('');
  const [rewardMsg, setRewardMsg] = useState('');

  const download = () => {
    const blob = new Blob([exportProfile()], { type: 'application/json' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = 'hearthstone-save.json';
    a.click();
    URL.revokeObjectURL(a.href);
  };

  return (
    <div className="settings">
      <h2>⚙️ 設定</h2>
      <div className="panel">
        <h3>電腦出牌速度</h3>
        <div className="row">
          {(['slow', 'normal', 'fast'] as const).map((sp) => (
            <button key={sp} className={`btn ${p.settings.aiSpeed === sp ? 'primary' : ''}`} onClick={() => setProfile({ ...p, settings: { ...p.settings, aiSpeed: sp } })}>
              {sp === 'slow' ? '慢' : sp === 'normal' ? '一般' : '快'}
            </button>
          ))}
        </div>
      </div>
      <div className="panel">
        <h3>🎁 獎勵碼</h3>
        <p className="muted small">輸入獎勵碼兌換金幣。可重複兌換有效獎勵碼。</p>
        <form
          className="reward-code-row"
          onSubmit={(e) => {
            e.preventDefault();
            const r = redeemRewardCode(p, rewardCode);
            if (!r.ok) {
              setRewardMsg(r.error ?? '兌換失敗');
              return;
            }
            setProfile(r.profile);
            setRewardMsg(`兌換成功！獲得 🪙 ${r.reward.toLocaleString()} 金幣`);
            setRewardCode('');
          }}
        >
          <label className="sr-only" htmlFor="reward-code-input">
            獎勵碼
          </label>
          <input
            id="reward-code-input"
            value={rewardCode}
            onChange={(e) => setRewardCode(e.target.value)}
            placeholder="輸入獎勵碼"
            autoComplete="off"
          />
          <button className="btn primary" type="submit" disabled={!rewardCode.trim()}>
            兌換
          </button>
        </form>
        {rewardMsg && <p className="message">{rewardMsg}</p>}
      </div>
      <div className="panel">
        <h3>存檔</h3>
        <p className="muted small">存檔保存在這個瀏覽器中。可以匯出備份，或在其他裝置匯入。</p>
        <div className="row">
          <button className="btn" onClick={download}>
            ⬇️ 匯出存檔
          </button>
          <button
            className="btn danger"
            onClick={() => {
              if (confirm('確定要重置所有進度嗎？此動作無法復原。')) {
                resetProfile();
                setMsg('已重置存檔');
              }
            }}
          >
            重置進度
          </button>
        </div>
        <textarea placeholder="貼上匯出的存檔 JSON 後按「匯入」" value={text} onChange={(e) => setText(e.target.value)} rows={4} />
        <button className="btn" onClick={() => setMsg(importProfile(text) ? '匯入成功！' : '存檔格式錯誤')}>
          ⬆️ 匯入存檔
        </button>
        {msg && <p className="message">{msg}</p>}
      </div>
      <div className="panel">
        <h3>關於</h3>
        <p className="small">
          卡牌資料來自 HearthSim 的 CardDefs.xml（hsreplay.net 使用的同一份資料，版本 {DATA_BUILD}），目前有 <b>{COLLECTIBLE.length}</b> 張卡的效果可以在遊戲中完整執行。
          卡圖由 HearthstoneJSON 提供。爐石戰記為 Blizzard Entertainment 的商標，本專案為個人學習用途的非官方作品。
        </p>
      </div>
    </div>
  );
}
