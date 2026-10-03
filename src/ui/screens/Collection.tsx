import { useMemo, useState, type CSSProperties } from 'react';
import { cardClasses, COLLECTIBLE, getCard, HEROES, PLAYABLE_CLASSES } from '../../cards/registry';
import { CLASS_NAMES } from '../../engine/heroes';
import type { CardClass, CardDef, Rarity } from '../../engine/types';
import { buildDeck, cardAllowed, deckCurve, deckRunes, deckSize, MAX_RUNES, maxCopies, RUNE_KINDS, RUNE_NAMES, runesFit, validateDeck, type Deck } from '../../game/decks';
import { CRAFT_COST, DISENCHANT_VALUE, RARITY_NAMES } from '../../game/economy';
import { decodeDeck, encodeDeck } from '../../game/deckstring';
import { craftCard, deleteDeck, disenchantCard, disenchantExtras, newId, saveDeck, type Profile } from '../../game/profile';
import { setName } from '../../game/sets';
import { CLASS_COLORS, plainText, RACE_NAMES } from '../cardText';
import { Art, CardView, Tile } from '../components/Card';
import { setProfile, useProfile } from '../store';

const PAGE = 24;

type ClassFilter = 'ALL' | CardClass;

export function Collection() {
  const p = useProfile();
  const [cls, setCls] = useState<ClassFilter>('ALL');
  const [cost, setCost] = useState<number | null>(null);
  const [search, setSearch] = useState('');
  const [rarity, setRarity] = useState<Rarity | ''>('');
  const [set, setSet] = useState<number | ''>('');
  const [ownedOnly, setOwnedOnly] = useState(false);
  const [page, setPage] = useState(0);
  const [detail, setDetail] = useState<string | null>(null);
  const [editing, setEditing] = useState<Deck | null>(null);
  const [newDeck, setNewDeck] = useState(false);
  const [importing, setImporting] = useState(false);
  const [importText, setImportText] = useState('');
  const [message, setMessage] = useState('');

  const sets = useMemo(() => [...new Set(COLLECTIBLE.map((c) => c.set))].sort((a, b) => a - b), []);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return COLLECTIBLE.filter((c) => {
      if (editing && !cardAllowed(c, editing.heroClass, editing.freeform)) return false;
      if (cls !== 'ALL' && !cardClasses(c).includes(cls)) return false;
      if (cost !== null && (cost >= 7 ? c.cost < 7 : c.cost !== cost)) return false;
      if (rarity && c.rarity !== rarity) return false;
      if (set !== '' && c.set !== set) return false;
      if (ownedOnly && !p.collection[c.id]) return false;
      if (q) {
        const races = c.races?.map((r) => RACE_NAMES[r]).join('') ?? '';
        const hay = `${c.name} ${c.nameEn} ${plainText(c.text)} ${races}`.toLowerCase();
        if (!hay.includes(q)) return false;
      }
      return true;
    }).sort((a, b) => a.cost - b.cost || a.name.localeCompare(b.name, 'zh-Hant'));
  }, [cls, cost, search, rarity, set, ownedOnly, editing, p.collection]);

  const pages = Math.max(1, Math.ceil(filtered.length / PAGE));
  const pageCards = filtered.slice(page * PAGE, page * PAGE + PAGE);
  const resetPage = () => setPage(0);

  const inDeck = (id: string) => editing?.cards.filter((x) => x === id).length ?? 0;

  const addToDeck = (c: CardDef) => {
    if (!editing) return;
    const owned = p.collection[c.id] ?? 0;
    const n = inDeck(c.id);
    const size = deckSize([...editing.cards, c.id]);
    if (editing.cards.length >= size) return setMessage(`這副套牌上限為 ${size} 張；請先移除多餘的卡牌`);
    if (n >= maxCopies(c)) return setMessage(`【${c.name}】最多只能放 ${maxCopies(c)} 張`);
    if (n >= owned) return setMessage(`你只有 ${owned} 張【${c.name}】`);
    if (!runesFit(deckRunes(editing.cards), c)) return setMessage(`符文最多 ${MAX_RUNES} 個，【${c.name}】的符文放不下`);
    setMessage('');
    setEditing({ ...editing, cards: [...editing.cards, c.id] });
  };

  const removeFromDeck = (id: string) => {
    if (!editing) return;
    const i = editing.cards.lastIndexOf(id);
    if (i < 0) return;
    const cards = [...editing.cards];
    cards.splice(i, 1);
    setEditing({ ...editing, cards });
  };

  const classTabs: ClassFilter[] = editing
    ? editing.freeform
      ? ['ALL', ...PLAYABLE_CLASSES, 'NEUTRAL']
      : ['ALL', editing.heroClass, 'NEUTRAL']
    : ['ALL', ...PLAYABLE_CLASSES, 'NEUTRAL'];

  return (
    <div className="collection">
      <div className="collection-main">
        <div className="filters">
          <div className="class-tabs">
            {classTabs.map((c) => (
              <button
                key={c}
                className={cls === c ? 'active' : ''}
                style={c !== 'ALL' ? ({ '--class': CLASS_COLORS[c] } as CSSProperties) : undefined}
                onClick={() => {
                  setCls(c);
                  resetPage();
                }}
              >
                {c === 'ALL' ? '全部' : CLASS_NAMES[c]}
              </button>
            ))}
          </div>
          <div className="filter-row">
            <div className="cost-filter">
              {[0, 1, 2, 3, 4, 5, 6, 7].map((n) => (
                <button
                  key={n}
                  className={cost === n ? 'active' : ''}
                  onClick={() => {
                    setCost(cost === n ? null : n);
                    resetPage();
                  }}
                >
                  {n === 7 ? '7+' : n}
                </button>
              ))}
            </div>
            <input
              className="search"
              placeholder="搜尋名稱、敘述、種族…"
              value={search}
              onChange={(e) => {
                setSearch(e.target.value);
                resetPage();
              }}
            />
            <select
              value={rarity}
              onChange={(e) => {
                setRarity(e.target.value as Rarity | '');
                resetPage();
              }}
            >
              <option value="">全部稀有度</option>
              {(['FREE', 'COMMON', 'RARE', 'EPIC', 'LEGENDARY'] as Rarity[]).map((r) => (
                <option key={r} value={r}>
                  {RARITY_NAMES[r]}
                </option>
              ))}
            </select>
            <select
              value={set}
              onChange={(e) => {
                setSet(e.target.value === '' ? '' : Number(e.target.value));
                resetPage();
              }}
            >
              <option value="">全部系列</option>
              {sets.map((s) => (
                <option key={s} value={s}>
                  {setName(s)}
                </option>
              ))}
            </select>
            <label className="check">
              <input
                type="checkbox"
                checked={ownedOnly}
                onChange={(e) => {
                  setOwnedOnly(e.target.checked);
                  resetPage();
                }}
              />
              只顯示已擁有
            </label>
          </div>
        </div>

        {message && <div className="message">{message}</div>}
        <div className="card-grid">
          {pageCards.map((c) => {
            const owned = p.collection[c.id] ?? 0;
            const used = inDeck(c.id);
            return (
              <div key={c.id} className="grid-cell" onContextMenu={(e) => { e.preventDefault(); setDetail(c.id); }}>
                <CardView
                  cardId={c.id}
                  width={150}
                  count={owned}
                  dimmed={owned === 0 || (!!editing && used >= Math.min(owned, maxCopies(c)))}
                  onClick={() => (editing ? addToDeck(c) : setDetail(c.id))}
                />
                {editing && used > 0 && <span className="in-deck">套牌中 {used}</span>}
              </div>
            );
          })}
          {pageCards.length === 0 && <p className="muted">沒有符合條件的卡牌</p>}
        </div>
        <div className="pager">
          <button className="btn small" disabled={page === 0} onClick={() => setPage(page - 1)}>
            ◀ 上一頁
          </button>
          <span>
            {page + 1} / {pages}（共 {filtered.length} 張）
          </span>
          <button className="btn small" disabled={page >= pages - 1} onClick={() => setPage(page + 1)}>
            下一頁 ▶
          </button>
        </div>
        <p className="muted small">提示：{editing ? '點卡牌加入套牌，右鍵查看詳情。' : '點卡牌查看詳情、合成或分解。'}</p>
      </div>

      <aside className="deck-panel">
        {editing ? (
          <DeckEditor
            deck={editing}
            collection={p.collection}
            onChange={setEditing}
            onRemove={removeFromDeck}
            onInspect={setDetail}
            onMessage={setMessage}
            onSave={() => {
              setProfile((pr) => saveDeck(pr, editing));
              setEditing(null);
              setMessage('');
            }}
            onCancel={() => {
              setEditing(null);
              setMessage('');
            }}
            onDelete={() => {
              if (!confirm(`確定要刪除「${editing.name}」嗎？`)) return;
              setProfile((pr) => deleteDeck(pr, editing.id));
              setEditing(null);
            }}
          />
        ) : (
          <>
            <h3>我的套牌（{p.decks.length}）</h3>
            <button className="btn primary full" onClick={() => setNewDeck(true)}>
              ＋ 新增套牌
            </button>
            <button className="btn full" onClick={() => setImporting(true)}>
              📥 匯入牌組代碼
            </button>
            <div className="deck-list">
              {p.decks.map((d) => {
                const ok = validateDeck(d, p.collection).ok;
                return (
                  <button
                    key={d.id}
                    className="deck-row"
                    style={{ '--class': CLASS_COLORS[d.heroClass] } as CSSProperties}
                    onClick={() => {
                      setEditing({ ...d, cards: [...d.cards] });
                      setCls('ALL');
                      resetPage();
                    }}
                  >
                    <Art cardId={HEROES[d.heroClass].hero} className="deck-row-art" label={CLASS_NAMES[d.heroClass].slice(0, 1)} color={CLASS_COLORS[d.heroClass]} />
                    <span className="deck-row-name">{d.name}</span>
                    <span className={`deck-row-count ${ok ? '' : 'bad'}`}>{d.cards.length}/{deckSize(d.cards)}</span>
                  </button>
                );
              })}
            </div>
            <button
              className="btn full"
              onClick={() => {
                const r = disenchantExtras(p);
                if (!r.count) return setMessage('沒有多餘的卡牌可以分解');
                if (!confirm(`要分解 ${r.count} 張多餘的卡牌，獲得 ${r.dust} 奧術之塵嗎？`)) return;
                setProfile(r.profile);
                setMessage(`分解了 ${r.count} 張卡，獲得 ✨${r.dust}`);
              }}
            >
              ♻️ 分解多餘卡牌
            </button>
          </>
        )}
      </aside>

      {newDeck && (
        <div className="modal" onClick={() => setNewDeck(false)}>
          <div className="modal-box" onClick={(e) => e.stopPropagation()}>
            <h2>選擇職業</h2>
            <div className="class-grid">
              {PLAYABLE_CLASSES.map((c) => (
                <button
                  key={c}
                  className="class-choice"
                  style={{ '--class': CLASS_COLORS[c] } as CSSProperties}
                  onClick={() => {
                    setEditing({ id: newId(), name: `我的${CLASS_NAMES[c]}套牌`, heroClass: c, freeform: false, cards: [] });
                    setNewDeck(false);
                    setCls('ALL');
                    resetPage();
                  }}
                >
                  <Art cardId={HEROES[c].hero} className="class-choice-art" label={CLASS_NAMES[c]} color={CLASS_COLORS[c]} />
                  <b>{CLASS_NAMES[c]}</b>
                  <small>{HEROES[c].name}</small>
                </button>
              ))}
            </div>
          </div>
        </div>
      )}

      {importing && (
        <div className="modal" onClick={() => setImporting(false)}>
          <div className="modal-box import-box" onClick={(e) => e.stopPropagation()}>
            <h2>匯入牌組代碼</h2>
            <p className="muted small">貼上從 hsreplay.net 或爐石戰記複製的牌組代碼。遊戲尚未支援的卡會被略過；還沒擁有的卡可以用奧術之塵合成。</p>
            <textarea rows={6} value={importText} onChange={(e) => setImportText(e.target.value)} placeholder="AAECAR8G..." />
            <div className="row">
              <button
                className="btn primary"
                onClick={() => {
                  try {
                    const d = decodeDeck(importText);
                    const deck: Deck = { id: newId(), name: d.name ?? `匯入的${CLASS_NAMES[d.heroClass]}套牌`, heroClass: d.heroClass, freeform: false, cards: d.cards };
                    deck.freeform = deck.cards.some((id) => !cardAllowed(getCard(id), d.heroClass, false));
                    const missing = countMissing(deck, p.collection);
                    setEditing(deck);
                    setImporting(false);
                    setImportText('');
                    setCls('ALL');
                    resetPage();
                    setMessage(
                      `匯入了 ${deck.cards.length} 張卡` +
                        (d.unsupported ? `，${d.unsupported} 張遊戲尚未支援已略過` : '') +
                        (missing.count ? `；你還缺 ${missing.count} 張卡（合成需要 ✨${missing.dust}）` : ''),
                    );
                  } catch (err) {
                    setMessage(`無法匯入：${(err as Error).message}`);
                    setImporting(false);
                  }
                }}
              >
                匯入
              </button>
              <button className="btn" onClick={() => setImporting(false)}>
                取消
              </button>
            </div>
          </div>
        </div>
      )}

      {detail && <CardDetail cardId={detail} onClose={() => setDetail(null)} />}
    </div>
  );
}

/** 套牌中還沒擁有的卡 */
function countMissing(deck: Deck, collection: Record<string, number>): { ids: string[]; count: number; dust: number } {
  const need = new Map<string, number>();
  for (const id of deck.cards) need.set(id, (need.get(id) ?? 0) + 1);
  const ids: string[] = [];
  let dust = 0;
  for (const [id, n] of need) {
    const lack = n - (collection[id] ?? 0);
    for (let i = 0; i < lack; i++) {
      ids.push(id);
      dust += CRAFT_COST[getCard(id).rarity];
    }
  }
  return { ids, count: ids.length, dust };
}

function craftAll(p: Profile, ids: string[]): Profile {
  let cur = p;
  for (const id of ids) {
    const r = craftCard(cur, id);
    if (!r.ok) break;
    cur = r.profile;
  }
  return cur;
}

function DeckEditor({
  deck,
  collection,
  onChange,
  onRemove,
  onInspect,
  onSave,
  onCancel,
  onDelete,
  onMessage,
}: {
  deck: Deck;
  collection: Record<string, number>;
  onChange: (d: Deck) => void;
  onRemove: (id: string) => void;
  onInspect: (id: string) => void;
  onSave: () => void;
  onCancel: () => void;
  onDelete: () => void;
  onMessage: (m: string) => void;
}) {
  const profile = useProfile();
  const missing = countMissing(deck, collection);
  const grouped = useMemo(() => {
    const m = new Map<string, number>();
    for (const id of deck.cards) m.set(id, (m.get(id) ?? 0) + 1);
    return [...m.entries()].map(([id, n]) => ({ def: getCard(id), n })).sort((a, b) => a.def.cost - b.def.cost || a.def.name.localeCompare(b.def.name, 'zh-Hant'));
  }, [deck.cards]);
  const problems = validateDeck(deck, collection);
  const curve = deckCurve(deck.cards);
  const runes = deckRunes(deck.cards);
  const runeSlots = RUNE_KINDS.flatMap((k) => Array<keyof typeof runes>(runes[k]).fill(k));
  const showRunes = deck.heroClass === 'DEATHKNIGHT' || runeSlots.length > 0;
  const maxCurve = Math.max(1, ...curve);
  const beatrixOptions = useMemo(
    () => COLLECTIBLE.filter((c) => c.type === 'MINION' && c.cost === 2 && cardAllowed(c, 'PALADIN', false) && !deck.cards.includes(c.id)),
    [deck.cards],
  );
  const underbellyOptions = useMemo(
    () => COLLECTIBLE.filter((c) => {
      const cls = cardClasses(c);
      return c.type === 'MINION' && !!(c.races?.includes('BEAST') || c.races?.includes('ALL')) && !cls.includes('HUNTER') && !cls.includes('NEUTRAL');
    }),
    [],
  );
  const setSideboard = (key: string, picks: string[]) =>
    onChange({ ...deck, sideboards: { ...(deck.sideboards ?? {}), [key]: picks.filter(Boolean) } });

  const autoFill = () => {
    const remaining = { ...collection };
    for (const id of deck.cards) remaining[id] = (remaining[id] ?? 0) - 1;
    const pool: Record<string, number> = {};
    for (const [id, n] of Object.entries(remaining)) {
      const def = getCard(id);
      if (n > 0 && cardAllowed(def, deck.heroClass, deck.freeform)) pool[id] = n;
    }
    const extra = buildDeck(deck.heroClass, { seed: Date.now() % 100000, noise: 1, size: deckSize(deck.cards), owned: pool, runes: deckRunes(deck.cards) }).filter((id) => {
      const def = getCard(id);
      return deck.cards.filter((x) => x === id).length < maxCopies(def);
    });
    const cards = [...deck.cards];
    for (const id of extra) {
      if (cards.length >= deckSize(cards)) break;
      if (cards.length >= deckSize([...cards, id])) continue;
      const def = getCard(id);
      if (cards.filter((x) => x === id).length >= Math.min(maxCopies(def), collection[id] ?? 0)) continue;
      if (!runesFit(deckRunes(cards), def)) continue;
      cards.push(id);
    }
    onChange({ ...deck, cards });
  };

  return (
    <div className="deck-editor" style={{ '--class': CLASS_COLORS[deck.heroClass] } as CSSProperties}>
      <div className="deck-editor-head">
        <Art cardId={HEROES[deck.heroClass].hero} className="deck-editor-art" label={CLASS_NAMES[deck.heroClass]} color={CLASS_COLORS[deck.heroClass]} />
        <div>
          <input className="deck-name-input" value={deck.name} maxLength={24} onChange={(e) => onChange({ ...deck, name: e.target.value })} />
          <div className="muted small">{CLASS_NAMES[deck.heroClass]}</div>
        </div>
      </div>
      <label className="check" title="開啟後可以放入任何職業的卡牌">
        <input type="checkbox" checked={deck.freeform} onChange={(e) => onChange({ ...deck, freeform: e.target.checked })} />
        不限職業（自由搭配所有職業的卡）
      </label>
      <div className="curve">
        {curve.map((n, i) => (
          <div key={i} className="curve-col">
            <div className="curve-bar" style={{ height: `${(n / maxCurve) * 100}%` }}>
              {n > 0 && <span>{n}</span>}
            </div>
            <small>{i === 7 ? '7+' : i}</small>
          </div>
        ))}
      </div>
      {showRunes && (
        <div className="deck-runes" title="死亡騎士的卡牌需要符文，一副套牌最多 3 個符文">
          <span className="muted small">符文</span>
          {Array.from({ length: Math.max(MAX_RUNES, runeSlots.length) }, (_, i) => {
            const k = runeSlots[i];
            return <span key={i} className={`rune ${k ?? 'empty'} ${i >= MAX_RUNES ? 'over' : ''}`} title={k ? `${RUNE_NAMES[k]}符文` : '空的符文欄'} />;
          })}
        </div>
      )}
      <div className={`deck-count ${deck.cards.length === deckSize(deck.cards) ? 'full' : ''}`}>
        {deck.cards.length} / {deckSize(deck.cards)}
      </div>
      {deck.cards.includes('JAIL_397') && (
        <div className="problems" style={{ padding: 10 }}>
          <b>Commander Beatrix 副牌</b>
          <div className="muted small">選 1 張聖騎士或中立 2 費手下；開局加入 10 張複製。</div>
          <select value={deck.sideboards?.JAIL_397?.[0] ?? ''} onChange={(e) => setSideboard('JAIL_397', e.target.value ? [e.target.value] : [])}>
            <option value="">選擇 2 費手下</option>
            {beatrixOptions.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
          </select>
        </div>
      )}
      {deck.cards.includes('JAIL_831') && (
        <div className="problems" style={{ padding: 10 }}>
          <b>King of the Underbelly 違禁野獸</b>
          <div className="muted small">選 3 張不同的非獵人、非中立職業野獸。</div>
          {[0, 1, 2].map((slot) => (
            <select
              key={slot}
              value={deck.sideboards?.JAIL_831?.[slot] ?? ''}
              onChange={(e) => {
                const picks = [...(deck.sideboards?.JAIL_831 ?? ['', '', ''])];
                picks[slot] = e.target.value;
                setSideboard('JAIL_831', picks);
              }}
            >
              <option value="">選擇違禁野獸 {slot + 1}</option>
              {underbellyOptions
                .filter((c) => c.id === deck.sideboards?.JAIL_831?.[slot] || !(deck.sideboards?.JAIL_831 ?? []).includes(c.id))
                .map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
            </select>
          ))}
        </div>
      )}
      <ul className="deck-cards">
        {grouped.map(({ def, n }) => (
          <li
            key={def.id}
            className={`deck-card rarity-${def.rarity.toLowerCase()} ${cardAllowed(def, deck.heroClass, deck.freeform) ? '' : 'invalid'}`}
            onClick={() => onRemove(def.id)}
            onContextMenu={(e) => {
              e.preventDefault();
              onInspect(def.id);
            }}
            title="點擊移除，右鍵查看"
          >
            <span className="dc-cost">{def.cost}</span>
            <span className="dc-name">{def.name}</span>
            <Tile cardId={def.id} className="dc-art" />
            <span className="dc-n">{def.rarity === 'LEGENDARY' ? '★' : n > 1 ? `×${n}` : ''}</span>
          </li>
        ))}
      </ul>
      {!problems.ok && deck.cards.length > 0 && (
        <ul className="problems">
          {problems.errors.slice(0, 4).map((e) => (
            <li key={e}>{e}</li>
          ))}
        </ul>
      )}
      <div className="deck-actions">
        <button className="btn" onClick={autoFill} disabled={deck.cards.length >= deckSize(deck.cards)}>
          🪄 自動補滿
        </button>
        <button className="btn" onClick={() => onChange({ ...deck, cards: [] })}>
          清空
        </button>
        <button className="btn danger" onClick={onDelete}>
          刪除
        </button>
      </div>
      {missing.count > 0 && (
        <button
          className="btn full"
          disabled={profile.dust < missing.dust}
          onClick={() => {
            setProfile((pr) => craftAll(pr, missing.ids));
            onMessage(`合成了 ${missing.count} 張卡`);
          }}
          title={profile.dust < missing.dust ? '奧術之塵不足' : ''}
        >
          ✨ 合成缺少的 {missing.count} 張卡（✨{missing.dust}）
        </button>
      )}
      <button
        className="btn full"
        disabled={!deck.cards.length}
        onClick={() => {
          const code = encodeDeck(deck);
          const text = `### ${deck.name}\n${code}`;
          navigator.clipboard?.writeText(text).then(
            () => onMessage('已複製牌組代碼'),
            () => window.prompt('複製這段牌組代碼：', code),
          ) ?? window.prompt('複製這段牌組代碼：', code);
        }}
      >
        📤 複製牌組代碼
      </button>
      <div className="deck-actions">
        <button className="btn primary" onClick={onSave}>
          💾 儲存
        </button>
        <button className="btn" onClick={onCancel}>
          取消
        </button>
      </div>
    </div>
  );
}

export function CardDetail({ cardId, onClose }: { cardId: string; onClose: () => void }) {
  const p = useProfile();
  const def = getCard(cardId);
  const owned = p.collection[cardId] ?? 0;
  const [msg, setMsg] = useState('');
  const canCraft = def.rarity !== 'FREE';
  return (
    <div className="modal" onClick={onClose}>
      <div className="modal-box detail" onClick={(e) => e.stopPropagation()}>
        <CardView cardId={cardId} width={260} />
        <div className="detail-info">
          <h2>{def.name}</h2>
          <p className="muted">{def.nameEn}</p>
          <p>
            {CLASS_NAMES[def.cardClass]}・{RARITY_NAMES[def.rarity]}・{setName(def.set)}
          </p>
          {def.flavor && <p className="flavor">{def.flavor.replace(/<[^>]+>/g, '')}</p>}
          <p>
            擁有：<b>{owned}</b> 張
          </p>
          {canCraft ? (
            <div className="craft">
              <button
                className="btn primary"
                disabled={p.dust < CRAFT_COST[def.rarity]}
                onClick={() => {
                  const r = craftCard(p, cardId);
                  setMsg(r.ok ? '合成成功！' : r.error ?? '');
                  if (r.ok) setProfile(r.profile);
                }}
              >
                合成（✨{CRAFT_COST[def.rarity]}）
              </button>
              <button
                className="btn"
                disabled={owned <= 0}
                onClick={() => {
                  const r = disenchantCard(p, cardId);
                  setMsg(r.ok ? `分解獲得 ✨${DISENCHANT_VALUE[def.rarity]}` : r.error ?? '');
                  if (r.ok) setProfile(r.profile);
                }}
              >
                分解（+✨{DISENCHANT_VALUE[def.rarity]}）
              </button>
            </div>
          ) : (
            <p className="muted">基本卡無法合成或分解</p>
          )}
          {msg && <p className="message">{msg}</p>}
          <p className="muted small">你目前有 ✨{p.dust} 奧術之塵</p>
          <a className="small" href={`https://hsreplay.net/zh-hant/cards/${def.dbfId}/`} target="_blank" rel="noreferrer">
            在 HSReplay 查看這張卡 ↗
          </a>
          <button className="btn" onClick={onClose}>
            關閉
          </button>
        </div>
      </div>
    </div>
  );
}

