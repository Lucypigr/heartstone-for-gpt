import { useState } from 'react';
import type { Difficulty } from '../engine/ai';
import type { HeroClass } from '../game/decks';
import type { LadderOpponent } from '../game/ladder';
import { useProfile } from './store';
import { Battle } from './screens/Battle';
import { Collection } from './screens/Collection';
import { Home } from './screens/Home';
import { Ladder } from './screens/Ladder';
import { PackOpen } from './screens/PackOpen';
import { PlaySetup } from './screens/PlaySetup';
import { Settings } from './screens/Settings';
import { Shop } from './screens/Shop';

export type Screen = 'home' | 'play' | 'ladder' | 'battle' | 'collection' | 'shop' | 'packs' | 'settings';

export interface BattleConfig {
  deckId: string;
  difficulty: Difficulty;
  oppClass: HeroClass;
  /** 天梯配對到的對手 */
  ladder?: LadderOpponent;
}

export function App() {
  const [screen, setScreen] = useState<Screen>('home');
  const [battle, setBattle] = useState<BattleConfig | null>(null);
  const [battleKey, setBattleKey] = useState(0);
  /** 從對戰按「繼續配對」回到天梯時，用這副套牌自動開始配對 */
  const [autoQueue, setAutoQueue] = useState<string | null>(null);
  const profile = useProfile();
  const unopened = Object.values(profile.packs).reduce((a, b) => a + b, 0);

  if (screen === 'battle' && battle) {
    return (
      <Battle
        key={battleKey}
        config={battle}
        onExit={() => {
          setAutoQueue(null);
          setScreen(battle.ladder ? 'ladder' : 'home');
        }}
        onRematch={() => {
          if (!battle.ladder) return setBattleKey((k) => k + 1);
          setAutoQueue(battle.deckId);
          setScreen('ladder');
        }}
      />
    );
  }

  return (
    <div className="app">
      <header className="topbar">
        <button className="logo" onClick={() => setScreen('home')}>
          爐石戰記 <small>for GPT</small>
        </button>
        <nav>
          <button className={screen === 'ladder' ? 'active' : ''} onClick={() => setScreen('ladder')}>
            天梯
          </button>
          <button className={screen === 'play' ? 'active' : ''} onClick={() => setScreen('play')}>
            練習
          </button>
          <button className={screen === 'collection' ? 'active' : ''} onClick={() => setScreen('collection')}>
            收藏與套牌
          </button>
          <button className={screen === 'shop' ? 'active' : ''} onClick={() => setScreen('shop')}>
            商店
          </button>
          <button className={screen === 'packs' ? 'active' : ''} onClick={() => setScreen('packs')}>
            開卡包{unopened > 0 && <span className="badge">{unopened}</span>}
          </button>
          <button className={screen === 'settings' ? 'active' : ''} onClick={() => setScreen('settings')}>
            設定
          </button>
        </nav>
        <div className="wallet">
          <span className="gold" title="金幣">
            🪙 {profile.gold}
          </span>
          <span className="dust" title="奧術之塵">
            ✨ {profile.dust}
          </span>
        </div>
      </header>
      <main className="screen">
        {screen === 'home' && <Home go={setScreen} />}
        {screen === 'play' && (
          <PlaySetup
            onStart={(cfg) => {
              setBattle(cfg);
              setBattleKey((k) => k + 1);
              setScreen('battle');
            }}
            go={setScreen}
          />
        )}
        {screen === 'ladder' && (
          <Ladder
            autoQueueDeck={autoQueue}
            onAutoQueued={() => setAutoQueue(null)}
            onStart={(cfg) => {
              setBattle(cfg);
              setBattleKey((k) => k + 1);
              setScreen('battle');
            }}
            go={setScreen}
          />
        )}
        {screen === 'collection' && <Collection />}
        {screen === 'shop' && <Shop go={setScreen} />}
        {screen === 'packs' && <PackOpen go={setScreen} />}
        {screen === 'settings' && <Settings />}
      </main>
    </div>
  );
}
