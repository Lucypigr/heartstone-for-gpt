import { useState, type CSSProperties, type ReactNode } from 'react';
import { getCard, hasCard } from '../../cards/registry';
import { CLASS_NAMES } from '../../engine/heroes';
import type { CardDef } from '../../engine/types';
import { artUrl, CLASS_COLORS, formatCardText, RACE_NAMES, RARITY_COLORS, renderUrl, tileUrl } from '../cardText';

/** 卡圖（載入失敗時以職業色塊代替） */
export function Art({
  cardId,
  className,
  style,
  label,
  color: colorProp,
}: {
  cardId: string;
  className?: string;
  style?: CSSProperties;
  /** 圖片載入失敗時顯示的文字 */
  label?: string;
  color?: string;
}) {
  const [failed, setFailed] = useState(false);
  const def: CardDef | null = hasCard(cardId) ? getCard(cardId) : null;
  const color = colorProp ?? (def ? CLASS_COLORS[def.cardClass] : '#555');
  if (failed) {
    return (
      <div className={`art-fallback ${className ?? ''}`} style={{ ...style, background: `radial-gradient(circle at 50% 35%, ${color}, #1b1510 85%)` }}>
        <span>{label ?? def?.name.slice(0, 2) ?? '?'}</span>
      </div>
    );
  }
  return <img className={className} style={style} src={artUrl(cardId)} alt="" loading="lazy" draggable={false} onError={() => setFailed(true)} />;
}

export interface CardViewProps {
  cardId: string;
  /** 動態合成的卡（例如殭屍獸）：一律用自繪卡面顯示 */
  def?: CardDef;
  width?: number;
  cost?: number;
  attack?: number;
  health?: number;
  spellDamage?: number;
  count?: number;
  dimmed?: boolean;
  selected?: boolean;
  playable?: boolean;
  onClick?: () => void;
  onMouseEnter?: () => void;
  onMouseLeave?: () => void;
  footer?: ReactNode;
  className?: string;
}

/** 載入失敗過的官方卡面（改用自繪卡面，避免重複請求） */
const failedRenders = new Set<string>();

export function CardView(p: CardViewProps) {
  const def = p.def ?? getCard(p.cardId);
  const width = p.width ?? 160;
  const cost = p.cost ?? def.cost;
  const attack = p.attack ?? def.attack;
  const health = p.health ?? def.health;
  const [, setFailedTick] = useState(0);

  if (!p.def && !def.custom && !failedRenders.has(def.id)) {
    const changed = (v: number | undefined, base: number | undefined) => v !== undefined && base !== undefined && v !== base;
    return (
      <div
        className={`card rendered card-${def.type.toLowerCase()} ${p.dimmed ? 'dimmed' : ''} ${p.selected ? 'selected' : ''} ${p.playable ? 'playable' : ''} ${p.className ?? ''}`}
        style={{ '--w': `${width}px` } as CSSProperties}
        onClick={p.onClick}
        onMouseEnter={p.onMouseEnter}
        onMouseLeave={p.onMouseLeave}
        title={def.name}
      >
        <img
          className="card-render"
          src={renderUrl(def.id, width)}
          alt={def.name}
          loading="lazy"
          draggable={false}
          onError={() => {
            failedRenders.add(def.id);
            setFailedTick((t) => t + 1);
          }}
        />
        {cost !== def.cost && <div className={`card-cost ov ${cost < def.cost ? 'lower' : 'higher'}`}>{cost}</div>}
        {(def.type === 'MINION' || def.type === 'WEAPON') && changed(attack, def.attack) && (
          <div className={`card-atk ov ${attack! > def.attack! ? 'buffed' : 'nerfed'}`}>{attack}</div>
        )}
        {(def.type === 'MINION' || def.type === 'WEAPON') && changed(health, def.health) && (
          <div className={`card-hp ov ${def.type === 'WEAPON' ? 'is-weapon' : ''} ${health! > def.health! ? 'buffed' : 'nerfed'}`}>{health}</div>
        )}
        {p.count !== undefined && <div className={`card-count ${p.count === 0 ? 'none' : ''}`}>×{p.count}</div>}
        {p.footer}
      </div>
    );
  }
  return <DrawnCard {...p} />;
}

/** 自繪卡面（官方卡面無法載入或自訂卡牌時使用） */
function DrawnCard(p: CardViewProps) {
  const def = p.def ?? getCard(p.cardId);
  const width = p.width ?? 160;
  const cost = p.cost ?? def.cost;
  const attack = p.attack ?? def.attack;
  const health = p.health ?? def.health;
  const color = CLASS_COLORS[def.cardClass];
  const style = { '--w': `${width}px`, '--class': color, '--rarity': RARITY_COLORS[def.rarity] } as CSSProperties;
  const costClass = cost < def.cost ? 'lower' : cost > def.cost ? 'higher' : '';
  const race = def.races?.[0];
  const label = race ? RACE_NAMES[race] : def.classes && def.classes.length > 1 ? def.classes.map((c) => CLASS_NAMES[c]).join('/') : '';
  return (
    <div
      className={`card card-${def.type.toLowerCase()} ${p.dimmed ? 'dimmed' : ''} ${p.selected ? 'selected' : ''} ${p.playable ? 'playable' : ''} ${p.className ?? ''}`}
      style={style}
      onClick={p.onClick}
      onMouseEnter={p.onMouseEnter}
      onMouseLeave={p.onMouseLeave}
      title={def.name}
    >
      <div className="card-frame">
        <div className="card-art">
          <Art cardId={def.id} />
        </div>
        <div className="card-name">
          <span>{def.name}</span>
        </div>
        {def.rarity !== 'FREE' && <div className="card-gem" />}
        <div className="card-text">
          <span dangerouslySetInnerHTML={{ __html: formatCardText(def.text, def.type === 'SPELL' ? p.spellDamage : 0) }} />
        </div>
        {label && <div className="card-race">{label}</div>}
      </div>
      <div className={`card-cost ${costClass}`}>{cost}</div>
      {def.runes && (
        <div className="card-runes">
          {(['blood', 'frost', 'unholy'] as const).flatMap((k) => Array.from({ length: def.runes?.[k] ?? 0 }, (_, i) => <span key={k + i} className={`rune ${k}`} />))}
        </div>
      )}
      {def.type === 'HERO' && !!def.armor && <div className="card-hp is-armor">{def.armor}</div>}
      {(def.type === 'MINION' || def.type === 'WEAPON') && (
        <>
          <div className={`card-atk ${def.type === 'WEAPON' ? 'is-weapon' : ''} ${attack !== undefined && def.attack !== undefined && attack > def.attack ? 'buffed' : ''}`}>{attack}</div>
          <div className={`card-hp ${def.type === 'WEAPON' ? 'is-weapon' : ''} ${health !== undefined && def.health !== undefined && health > def.health ? 'buffed' : ''}`}>{health}</div>
        </>
      )}
      {p.count !== undefined && <div className={`card-count ${p.count === 0 ? 'none' : ''}`}>×{p.count}</div>}
      {p.footer}
    </div>
  );
}

/** 牌組清單的橫條卡圖（載入失敗時退回一般卡圖） */
export function Tile({ cardId, className }: { cardId: string; className?: string }) {
  const [failed, setFailed] = useState(false);
  if (failed) return <Art cardId={cardId} className={className} />;
  return <img className={className} src={tileUrl(cardId)} alt="" loading="lazy" draggable={false} onError={() => setFailed(true)} />;
}

export function CardBack({ width = 60 }: { width?: number }) {
  return <div className="card-back" style={{ '--w': `${width}px` } as CSSProperties} />;
}
