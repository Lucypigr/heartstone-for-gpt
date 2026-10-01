import type { CSSProperties } from 'react';
import { STARS_PER_RANK, type RankInfo } from '../../game/ladder';

export function RankBadge({ info, size = 64 }: { info: RankInfo; size?: number }) {
  return (
    <div className={`rank-badge league-${info.league}`} style={{ '--league': info.color, '--size': `${size}px` } as CSSProperties}>
      <span className="rank-num">{info.league === 5 ? '★' : info.rank}</span>
    </div>
  );
}

export function RankPips({ info }: { info: RankInfo }) {
  if (info.league === 5) return <span className="rank-pips legend">{info.legend ? `#${info.legend}` : ''}</span>;
  return (
    <span className="rank-pips">
      {Array.from({ length: STARS_PER_RANK }, (_, i) => (
        <span key={i} className={`pip ${i < info.pips ? 'on' : ''}`}>
          ★
        </span>
      ))}
    </span>
  );
}
