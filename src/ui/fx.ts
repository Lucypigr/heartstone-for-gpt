// ============================================================================
// 對戰動畫（仿爐石）：攻擊衝撞、法術飛彈與範圍衝擊、手下落地、治療 / 增益 / 冰凍、
// 抽牌、死亡碎裂。全部用 Web Animations API 在畫面上疊加元素，播完自動移除。
// 已經從畫面消失的角色（死亡），用上一次畫面的快照來定位與複製外觀。
// ============================================================================
import { getCard, hasCard } from '../cards/registry';
import type { Fx, PlayerId } from '../engine/state';

/** 角色在上一次畫面中的位置與外觀 */
export type Snap = { rect: DOMRect; html: string };

const reducedMotion = () => !!window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;

/** 從快照複製出角色的畫面元素 */
function cloneSnap(snap: Snap): HTMLElement | null {
  const holder = document.createElement('div');
  holder.innerHTML = snap.html;
  const el = holder.firstElementChild as HTMLElement | null;
  el?.removeAttribute('data-uid');
  el?.classList.add('fx-clone');
  return el;
}

/** 找到角色的畫面元素；已經消失的話，用最後的畫面做一個殘影 */
function charElement(root: HTMLElement, snap: Map<number, Snap>, uid: number): { el: HTMLElement; ghost: boolean } | null {
  const live = root.querySelector<HTMLElement>(`[data-uid="${uid}"]`);
  if (live) return { el: live, ghost: false };
  const old = snap.get(uid);
  if (!old) return null;
  const el = cloneSnap(old);
  if (!el) return null;
  Object.assign(el.style, {
    position: 'fixed',
    left: `${old.rect.left}px`,
    top: `${old.rect.top}px`,
    width: `${old.rect.width}px`,
    height: `${old.rect.height}px`,
    margin: '0',
    pointerEvents: 'none',
    zIndex: '60',
  });
  root.appendChild(el);
  return { el, ghost: true };
}

/**
 * 攻擊動畫：攻擊者先往後蓄力，再衝向目標撞擊，最後返回；目標在撞擊時閃爍搖晃。
 * 回傳動畫結束的時間，以及要留給碎裂動畫接手的殘影（dying 中的角色）。
 */
export function playAttack(
  root: HTMLElement,
  snap: Map<number, Snap>,
  attackerUid: number,
  targetUid: number,
  delay: number,
  dying: Set<number>,
): { end: number; ghosts: Map<number, HTMLElement> } {
  const ghosts = new Map<number, HTMLElement>();
  if (reducedMotion()) return { end: delay, ghosts };
  const att = charElement(root, snap, attackerUid);
  const tgt = charElement(root, snap, targetUid);
  if (!att || !tgt || typeof att.el.animate !== 'function') {
    if (att?.ghost) att.el.remove();
    if (tgt?.ghost) tgt.el.remove();
    return { end: delay, ghosts };
  }
  const a = att.el.getBoundingClientRect();
  const b = tgt.el.getBoundingClientRect();
  // 停在目標前方一點（兩張卡的邊緣相碰）
  const dx = (b.left + b.width / 2 - (a.left + a.width / 2)) * 0.82;
  const dy = (b.top + b.height / 2 - (a.top + a.height / 2)) * 0.82;
  const DURATION = 620;
  const IMPACT = 0.55;
  const prevZ = att.el.style.zIndex;
  att.el.style.zIndex = '50';
  const lunge = att.el.animate(
    [
      { transform: 'translate(0, 0) scale(1)' },
      { transform: `translate(${-dx * 0.08}px, ${-dy * 0.08}px) scale(1.12)`, offset: 0.25, easing: 'ease-in' },
      { transform: `translate(${dx}px, ${dy}px) scale(1.12)`, offset: IMPACT, easing: 'ease-out' },
      { transform: 'translate(0, 0) scale(1)' },
    ],
    { duration: DURATION, delay, fill: 'backwards' },
  );
  const hit = tgt.el.animate(
    [
      { transform: 'none', filter: 'none' },
      { transform: `translate(${dx * 0.06}px, ${dy * 0.06}px) rotate(-4deg)`, filter: 'brightness(1.8) saturate(1.4)', offset: 0.2 },
      { transform: 'translateX(5px) rotate(3deg)', offset: 0.5 },
      { transform: 'translateX(-3px)', offset: 0.75 },
      { transform: 'none', filter: 'none' },
    ],
    { duration: 360, delay: delay + DURATION * IMPACT },
  );
  // 殘影：死亡的交給碎裂動畫；其他的撞擊後淡出
  const handleGhost = (x: { el: HTMLElement; ghost: boolean }, uid: number, after: Animation) => {
    if (!x.ghost) return;
    if (dying.has(uid)) {
      ghosts.set(uid, x.el);
      return;
    }
    after.onfinish = () => x.el.animate([{ opacity: 1 }, { opacity: 0, transform: 'scale(0.9)' }], { duration: 260 }).finished.then(() => x.el.remove(), () => x.el.remove());
    after.oncancel = () => x.el.remove();
  };
  lunge.onfinish = () => {
    att.el.style.zIndex = prevZ;
  };
  handleGhost(tgt, targetUid, hit);
  handleGhost(att, attackerUid, lunge);
  return { end: delay + DURATION, ghosts };
}

/** 手下死亡：卡片先出現裂痕，接著碎成好幾塊往外飛散並淡出 */
export function shatter(root: HTMLElement, snap: Snap, delay: number, ghost?: HTMLElement) {
  if (reducedMotion() || typeof root.animate !== 'function') {
    ghost?.remove();
    return;
  }
  const { rect } = snap;
  const box = document.createElement('div');
  Object.assign(box.style, {
    position: 'fixed',
    left: `${rect.left}px`,
    top: `${rect.top}px`,
    width: `${rect.width}px`,
    height: `${rect.height}px`,
    pointerEvents: 'none',
    zIndex: '55',
    // 有殘影時，等殘影播完撞擊才換成碎片；否則立刻顯示完整的卡片（碎片在 delay 前保持原狀）
    visibility: ghost ? 'hidden' : 'visible',
  });
  root.appendChild(box);

  // 裂痕中心與邊緣上的點（含四個角），把卡片切成以中心為頂點的三角形碎片
  const cx = 40 + Math.random() * 20;
  const cy = 35 + Math.random() * 25;
  const params = [0, 1, 2, 3];
  for (let i = 0; i < 8; i++) params.push(Math.random() * 4);
  params.sort((a, b) => a - b);
  // 碎片的外框比卡片大一圈，把超出卡片的部分（例如嘲諷盾牌）也一起切進碎片裡
  const [x0, x1, y0, y1] = [-20, 120, -15, 115];
  const edge = (t: number): [number, number] => {
    const side = Math.floor(t) % 4;
    const u = t - Math.floor(t);
    const x = x0 + (x1 - x0) * u;
    const y = y0 + (y1 - y0) * u;
    return side === 0 ? [x, y0] : side === 1 ? [x1, y] : side === 2 ? [x1 + x0 - x, y1] : [x0, y1 + y0 - y];
  };
  const pts = params.map(edge);

  // 裂痕線
  const svgNS = 'http://www.w3.org/2000/svg';
  const svg = document.createElementNS(svgNS, 'svg');
  svg.setAttribute('viewBox', '0 0 100 100');
  svg.setAttribute('preserveAspectRatio', 'none');
  Object.assign(svg.style, { position: 'absolute', inset: '0', width: '100%', height: '100%', zIndex: '2', overflow: 'visible' });
  for (const [x, y] of pts) {
    const line = document.createElementNS(svgNS, 'line');
    line.setAttribute('x1', String(cx));
    line.setAttribute('y1', String(cy));
    line.setAttribute('x2', String(x));
    line.setAttribute('y2', String(y));
    line.setAttribute('stroke', '#fff6d8');
    line.setAttribute('stroke-width', '1.6');
    line.setAttribute('vector-effect', 'non-scaling-stroke');
    svg.appendChild(line);
  }

  const DURATION = 820;
  const CRACK = 0.22;
  const anims: Animation[] = [];
  for (let i = 0; i < pts.length; i++) {
    const a = pts[i];
    const b = pts[(i + 1) % pts.length];
    const piece = cloneSnap(snap);
    if (!piece) continue;
    Object.assign(piece.style, {
      position: 'absolute',
      left: '0',
      top: '0',
      width: '100%',
      height: '100%',
      margin: '0',
      clipPath: `polygon(${cx}% ${cy}%, ${a[0]}% ${a[1]}%, ${b[0]}% ${b[1]}%)`,
    });
    box.appendChild(piece);
    // 往碎片重心的方向飛出，再加一點重力
    const gx = (cx + a[0] + b[0]) / 3 - cx;
    const gy = (cy + a[1] + b[1]) / 3 - cy;
    const len = Math.hypot(gx, gy) || 1;
    const dist = rect.width * (0.45 + Math.random() * 0.5);
    const vx = (gx / len) * dist;
    const vy = (gy / len) * dist + rect.height * 0.35;
    const rot = (Math.random() - 0.5) * 90;
    const anim = piece.animate(
      [
        { transform: 'none', opacity: 1, filter: 'none' },
        { transform: `translate(${(gx / len) * 2}px, ${(gy / len) * 2}px)`, opacity: 1, filter: 'brightness(1.5)', offset: CRACK },
        { transform: `translate(${vx}px, ${vy}px) rotate(${rot}deg) scale(0.8)`, opacity: 0, filter: 'brightness(0.8)' },
      ],
      { duration: DURATION, delay, easing: 'cubic-bezier(.25,.6,.35,1)', fill: 'both' },
    );
    anims.push(anim);
  }
  box.appendChild(svg);
  const crack = svg.animate(
    [
      { opacity: 0 },
      { opacity: 1, offset: 0.08 },
      { opacity: 1, offset: CRACK },
      { opacity: 0, offset: CRACK + 0.08 },
      { opacity: 0 },
    ],
    { duration: DURATION, delay, fill: 'both' },
  );
  anims.push(crack);
  // 殘影播完撞擊後換成碎片；全部碎片的動畫結束後移除
  const swap = box.animate([{ opacity: 1 }, { opacity: 1 }], { duration: Math.max(1, delay) });
  swap.onfinish = () => {
    box.style.visibility = 'visible';
    ghost?.remove();
  };
  Promise.all(anims.map((a) => a.finished)).then(
    () => box.remove(),
    () => box.remove(),
  );
}


// ---------------------------------------------------------------------------
// 基本元件
// ---------------------------------------------------------------------------

/** 各法術派系的顏色 */
const SCHOOL_COLORS: Record<string, string> = {
  FIRE: '#ff7a2a',
  FROST: '#8fdcff',
  ARCANE: '#d38bff',
  NATURE: '#7be07b',
  HOLY: '#ffe27a',
  SHADOW: '#a66bff',
  FEL: '#7dff4a',
};
const DEFAULT_COLOR = '#ffcf6a';
const DAMAGE_COLOR = '#ff5a3c';
const HEAL_COLOR = '#7dffa0';
const BUFF_COLOR = '#ffd94a';

/** 對「全部」目標同時造成傷害的卡（烈焰風暴之類）用衝擊波表現；隨機分配的（秘法飛彈）用一發一發的飛彈 */
function isAreaDamage(cardId: string | undefined): boolean {
  if (!cardId || !hasCard(cardId)) return false;
  return (getCard(cardId).abilities ?? []).some((a) => a.effects.some((e) => e.e === 'damage' && e.target.t === 'all'));
}

export function colorFor(cardId: string | undefined): string {
  if (!cardId || !hasCard(cardId)) return DEFAULT_COLOR;
  return SCHOOL_COLORS[getCard(cardId).spellSchool ?? ''] ?? DEFAULT_COLOR;
}

type Pt = { x: number; y: number };
const center = (r: DOMRect): Pt => ({ x: r.left + r.width / 2, y: r.top + r.height / 2 });

/** 在畫面上放一個固定定位的特效元素，動畫結束後移除 */
function layer(root: HTMLElement, style: Partial<CSSStyleDeclaration>, className = ''): HTMLElement {
  const el = document.createElement('div');
  el.className = `fx-layer ${className}`;
  Object.assign(el.style, { position: 'fixed', pointerEvents: 'none', zIndex: '70', ...style });
  root.appendChild(el);
  return el;
}

/**
 * 特效動畫：元素平常是透明的，只有動畫進行中才由關鍵影格決定透明度，
 * 所以延遲開始的特效不會在等待期間就先出現。每個關鍵影格都要指定 opacity。
 */
function fxAnimate(el: HTMLElement, keyframes: Keyframe[], options: KeyframeAnimationOptions): Animation {
  el.style.opacity = '0';
  return el.animate(keyframes, { ...options, fill: 'none' });
}

function removeAfter(el: HTMLElement, anims: Animation[]) {
  Promise.all(anims.map((a) => a.finished)).then(
    () => el.remove(),
    () => el.remove(),
  );
}

/** 爆開：光環擴散 + 向外噴的粒子 */
function burst(root: HTMLElement, at: Pt, color: string, delay: number, size = 70, particles = 9) {
  const box = layer(root, { left: `${at.x}px`, top: `${at.y}px`, width: '0', height: '0' });
  const anims: Animation[] = [];
  const ring = document.createElement('div');
  Object.assign(ring.style, {
    position: 'absolute',
    left: `${-size / 2}px`,
    top: `${-size / 2}px`,
    width: `${size}px`,
    height: `${size}px`,
    borderRadius: '50%',
    border: `3px solid ${color}`,
    boxShadow: `0 0 18px ${color}, inset 0 0 14px ${color}`,
    background: `radial-gradient(circle, ${color}aa 0%, ${color}33 45%, transparent 70%)`,
  });
  box.appendChild(ring);
  anims.push(
    fxAnimate(ring, 
      [
        { transform: 'scale(0.2)', opacity: 1 },
        { transform: 'scale(1.5)', opacity: 0 },
      ],
      { duration: 460, delay, easing: 'cubic-bezier(.2,.7,.3,1)', },
    ),
  );
  for (let i = 0; i < particles; i++) {
    const p = document.createElement('div');
    const s = 4 + Math.random() * 5;
    Object.assign(p.style, {
      position: 'absolute',
      left: `${-s / 2}px`,
      top: `${-s / 2}px`,
      width: `${s}px`,
      height: `${s}px`,
      borderRadius: '50%',
      background: color,
      boxShadow: `0 0 8px ${color}`,
    });
    box.appendChild(p);
    const a = (Math.PI * 2 * i) / particles + Math.random() * 0.5;
    const d = size * (0.6 + Math.random() * 0.6);
    anims.push(
      fxAnimate(p, 
        [
          { transform: 'translate(0, 0) scale(1)', opacity: 1 },
          { transform: `translate(${Math.cos(a) * d}px, ${Math.sin(a) * d}px) scale(0.3)`, opacity: 0 },
        ],
        { duration: 520, delay, easing: 'cubic-bezier(.1,.6,.3,1)' },
      ),
    );
  }
  removeAfter(box, anims);
}

/** 飛彈：發光的球沿著弧線飛向目標，後面拖著光點 */
function projectile(root: HTMLElement, from: Pt, to: Pt, color: string, delay: number, duration: number) {
  const box = layer(root, { left: '0', top: '0', width: '0', height: '0' });
  const anims: Animation[] = [];
  const dx = to.x - from.x;
  const dy = to.y - from.y;
  const len = Math.hypot(dx, dy) || 1;
  // 弧線：中點往垂直方向偏移
  const bend = Math.min(80, len * 0.25);
  const mid = { x: from.x + dx / 2 + (-dy / len) * bend, y: from.y + dy / 2 + (dx / len) * bend * 0.3 - bend * 0.5 };
  for (let i = 0; i < 5; i++) {
    const s = i === 0 ? 22 : 14 - i * 2;
    const orb = document.createElement('div');
    Object.assign(orb.style, {
      position: 'absolute',
      left: `${-s / 2}px`,
      top: `${-s / 2}px`,
      width: `${s}px`,
      height: `${s}px`,
      borderRadius: '50%',
      background: i === 0 ? `radial-gradient(circle, #fff 0%, ${color} 45%, ${color}00 75%)` : color,
      boxShadow: `0 0 ${i === 0 ? 22 : 10}px ${color}`,
    });
    const op = 1 - i * 0.18;
    box.appendChild(orb);
    anims.push(
      fxAnimate(orb, 
        [
          { transform: `translate(${from.x}px, ${from.y}px) scale(0.6)`, opacity: op },
          { transform: `translate(${mid.x}px, ${mid.y}px) scale(1)`, opacity: op, offset: 0.5 },
          { transform: `translate(${to.x}px, ${to.y}px) scale(1)`, opacity: op },
        ],
        { duration, delay: delay + i * 28, easing: 'ease-in' },
      ),
    );
  }
  removeAfter(box, anims);
}

/** 範圍衝擊：整排目標上方掃過一道光帶 */
function wave(root: HTMLElement, rects: DOMRect[], color: string, delay: number) {
  if (!rects.length) return;
  const left = Math.min(...rects.map((r) => r.left)) - 30;
  const right = Math.max(...rects.map((r) => r.right)) + 30;
  const top = Math.min(...rects.map((r) => r.top)) - 10;
  const bottom = Math.max(...rects.map((r) => r.bottom)) + 10;
  const band = layer(root, {
    left: `${left}px`,
    top: `${top}px`,
    width: `${right - left}px`,
    height: `${bottom - top}px`,
    borderRadius: '40px',
    background: `linear-gradient(90deg, transparent 0%, ${color}cc 35%, #fff8 50%, ${color}cc 65%, transparent 100%)`,
    backgroundSize: '220% 100%',
    boxShadow: `0 0 40px ${color}`,
    mixBlendMode: 'screen',
  });
  removeAfter(band, [
    fxAnimate(band, 
      [
        { opacity: 0, transform: 'scaleY(0.3)', backgroundPosition: '100% 0' },
        { opacity: 0.95, transform: 'scaleY(1.1)', offset: 0.35 },
        { opacity: 0, transform: 'scaleY(0.9)', backgroundPosition: '-20% 0' },
      ],
      { duration: 620, delay, easing: 'ease-out' },
    ),
  ]);
}

/** 往上飄的光點（治療：綠色；增益：金色） */
function sparkles(root: HTMLElement, r: DOMRect, color: string, delay: number) {
  const box = layer(root, { left: `${r.left}px`, top: `${r.top}px`, width: `${r.width}px`, height: `${r.height}px` });
  const anims: Animation[] = [];
  const glow = document.createElement('div');
  Object.assign(glow.style, {
    position: 'absolute',
    inset: '0',
    borderRadius: '45%',
    boxShadow: `0 0 26px 6px ${color}, inset 0 0 20px ${color}`,
  });
  box.appendChild(glow);
  anims.push(fxAnimate(glow, [{ opacity: 0 }, { opacity: 1, offset: 0.3 }, { opacity: 0 }], { duration: 700, delay }));
  for (let i = 0; i < 10; i++) {
    const p = document.createElement('div');
    const s = 4 + Math.random() * 4;
    Object.assign(p.style, {
      position: 'absolute',
      left: `${10 + Math.random() * 80}%`,
      top: `${55 + Math.random() * 40}%`,
      width: `${s}px`,
      height: `${s}px`,
      borderRadius: '50%',
      background: color,
      boxShadow: `0 0 8px ${color}`,
    });
    box.appendChild(p);
    anims.push(
      fxAnimate(p, 
        [
          { transform: 'translateY(0) scale(0.4)', opacity: 0 },
          { transform: `translateY(-${r.height * 0.3}px) scale(1)`, opacity: 1, offset: 0.35 },
          { transform: `translateY(-${r.height * (0.7 + Math.random() * 0.3)}px) scale(0.5)`, opacity: 0 },
        ],
        { duration: 750, delay: delay + Math.random() * 180, easing: 'ease-out' },
      ),
    );
  }
  removeAfter(box, anims);
}

/** 冰凍：冰藍色的霜覆蓋上去 */
function frost(root: HTMLElement, r: DOMRect, delay: number) {
  const el = layer(root, {
    left: `${r.left - 6}px`,
    top: `${r.top - 6}px`,
    width: `${r.width + 12}px`,
    height: `${r.height + 12}px`,
    borderRadius: '40%',
    background: 'radial-gradient(circle, #e8faffcc 0%, #8fdcff99 45%, #4aa8ff33 70%, transparent 80%)',
    boxShadow: '0 0 24px #8fdcff',
  });
  removeAfter(el, [
    fxAnimate(el, 
      [
        { opacity: 0, transform: 'scale(1.3)' },
        { opacity: 1, transform: 'scale(1)', offset: 0.3 },
        { opacity: 0, transform: 'scale(1)' },
      ],
      { duration: 700, delay, easing: 'ease-out' },
    ),
  ]);
}

/** 聖盾破裂：金色光圈擴散 */
function shieldPop(root: HTMLElement, r: DOMRect, delay: number) {
  const s = Math.max(r.width, r.height) * 1.05;
  const c = center(r);
  const el = layer(root, {
    left: `${c.x - s / 2}px`,
    top: `${c.y - s / 2}px`,
    width: `${s}px`,
    height: `${s}px`,
    borderRadius: '50%',
    border: '4px solid #ffe27a',
    boxShadow: '0 0 20px #ffe27a, inset 0 0 20px #ffe27a',
  });
  removeAfter(el, [
    fxAnimate(el, 
      [
        { opacity: 1, transform: 'scale(0.85)' },
        { opacity: 0, transform: 'scale(1.5)' },
      ],
      { duration: 480, delay, easing: 'ease-out' },
    ),
  ]);
}

/** 飄出的數字（傷害 / 治療 / 護甲 / 聖盾） */
function floatText(root: HTMLElement, r: DOMRect, text: string, kind: string, delay: number) {
  const c = center(r);
  const el = layer(root, { left: `${c.x}px`, top: `${c.y}px`, zIndex: '80' }, `fx-float ${kind}`);
  el.textContent = text;
  removeAfter(el, [
    fxAnimate(el, 
      [
        { transform: 'translate(-50%, -50%) scale(0.4)', opacity: 0 },
        { transform: 'translate(-50%, -60%) scale(1.3)', opacity: 1, offset: 0.15 },
        { transform: 'translate(-50%, -80%) scale(1)', opacity: 1, offset: 0.65 },
        { transform: 'translate(-50%, -130%) scale(0.9)', opacity: 0 },
      ],
      { duration: 1250, delay, easing: 'ease-out' },
    ),
  ]);
}

/** 震動整個戰場 */
function shake(root: HTMLElement, delay: number, strength: number) {
  const target = root.querySelector<HTMLElement>('.boards');
  if (!target) return;
  const k = strength;
  target.animate(
    [
      { transform: 'none' },
      { transform: `translate(${-k}px, ${k * 0.6}px)` },
      { transform: `translate(${k}px, ${-k * 0.4}px)` },
      { transform: `translate(${-k * 0.6}px, ${-k * 0.5}px)` },
      { transform: `translate(${k * 0.4}px, ${k * 0.3}px)` },
      { transform: 'none' },
    ],
    { duration: 320, delay },
  );
}

/** 手下登場：從上方落下砸在場上，揚起塵土 */
function landing(root: HTMLElement, el: HTMLElement, played: boolean, heavy: boolean, delay: number) {
  const r = el.getBoundingClientRect();
  el.animate(
    played
      ? [
          { transform: 'translateY(-46px) scale(1.45)', opacity: 0, filter: 'brightness(1.6)' },
          { transform: 'translateY(-30px) scale(1.4)', opacity: 1, offset: 0.35 },
          { transform: 'translateY(0) scale(0.94)', filter: 'brightness(1.2)', offset: 0.8, easing: 'ease-out' },
          { transform: 'none', filter: 'none' },
        ]
      : [
          { transform: 'scale(0.3)', opacity: 0, filter: 'brightness(2)' },
          { transform: 'scale(1.12)', opacity: 1, offset: 0.6 },
          { transform: 'none', filter: 'none' },
        ],
    { duration: played ? 480 : 360, delay, easing: 'ease-in', fill: 'backwards' },
  );
  const bottom = { x: r.left + r.width / 2, y: r.bottom - r.height * 0.12 };
  const impact = delay + (played ? 380 : 200);
  burst(root, bottom, played ? '#d9c8a0' : '#fff2c8', impact, played ? r.width * 1.3 : r.width, played ? 12 : 7);
  if (played && heavy) shake(root, impact, 7);
}

/** 抽牌：卡片從牌堆飛進手牌 */
function drawCard(el: HTMLElement, deck: DOMRect | null, delay: number) {
  const r = el.getBoundingClientRect();
  const from = deck ? center(deck) : { x: window.innerWidth - 60, y: r.top };
  const c = center(r);
  el.animate(
    [
      { transform: `translate(${from.x - c.x}px, ${from.y - c.y}px) scale(0.35) rotate(-12deg)`, opacity: 0.3 },
      { transform: 'translate(0, -30px) scale(1.05)', opacity: 1, offset: 0.7 },
      { transform: 'none', opacity: 1 },
    ],
    { duration: 520, delay, easing: 'cubic-bezier(.3,.7,.4,1)', fill: 'backwards' },
  );
}

/** 英雄能力按鈕翻轉發光 */
function powerFlip(el: HTMLElement, delay: number) {
  el.animate(
    [
      { transform: 'rotateY(0) scale(1)', filter: 'brightness(1)' },
      { transform: 'rotateY(90deg) scale(1.25)', filter: 'brightness(2)', offset: 0.45 },
      { transform: 'rotateY(0) scale(1)', filter: 'brightness(1)' },
    ],
    { duration: 420, delay },
  );
}

// ---------------------------------------------------------------------------
// 導演：依照這次動作產生的特效事件，排出時間軸並播放
// ---------------------------------------------------------------------------

/** 施放中的法術卡顯示位置（畫面寬度的比例，對應 CSS .cast-card 的 left） */
const CAST_X = 0.8;

export interface DirectorApi {
  /** 顯示施放中的法術卡（由畫面用 React 繪製） */
  cast(cardId: string, player: PlayerId, at: number): void;
}

/** 播放一批新的特效事件，回傳全部播完需要的時間（毫秒） */
export function direct(root: HTMLElement, fresh: Fx[], snap: Map<number, Snap>, api: DirectorApi): number {
  const motion = !reducedMotion();
  const rectOf = (uid: number): DOMRect | null => root.querySelector<HTMLElement>(`[data-uid="${uid}"]`)?.getBoundingClientRect() ?? snap.get(uid)?.rect ?? null;
  const heroRect = (pid: PlayerId | undefined) => (pid === undefined ? null : (root.querySelector<HTMLElement>(`[data-hero="${pid}"]`)?.getBoundingClientRect() ?? null));
  const float = (uid: number | undefined, text: string, kind: string, at: number) => {
    const r = uid !== undefined ? rectOf(uid) : null;
    if (r) floatText(root, r, text, kind, motion ? at : 0);
  };

  if (!motion) {
    // 減少動態效果：只顯示數字
    for (const f of fresh) {
      if (f.kind === 'damage') float(f.uid, `-${f.amount}`, 'damage', 0);
      else if (f.kind === 'heal') float(f.uid, `+${f.amount}`, 'heal', 0);
      else if (f.kind === 'armor') float(f.uid, `+${f.amount}🛡`, 'armor', 0);
      else if (f.kind === 'shield') float(f.uid, '聖盾！', 'shield', 0);
    }
    return 0;
  }

  const dying = new Set(fresh.filter((f) => f.kind === 'death' && f.uid !== undefined).map((f) => f.uid!));
  const deathAt = new Map<number, number>();
  const ghosts = new Map<number, HTMLElement>();
  let t = 0;
  let end = 0;
  let attack: { attacker: number; target: number; impact: number; end: number } | null = null;
  let summons = 0;
  let draws = 0;

  for (let i = 0; i < fresh.length; i++) {
    const f = fresh[i];
    switch (f.kind) {
      case 'play': {
        attack = null;
        const def = f.cardId && hasCard(f.cardId) ? getCard(f.cardId) : null;
        if (def?.type === 'SPELL' && f.player !== undefined) {
          // 法術卡在戰場右側亮相後燃燒消散，接著才放出效果
          api.cast(def.id, f.player, t);
          burst(root, { x: window.innerWidth * CAST_X, y: window.innerHeight / 2 }, colorFor(def.id), t + 430, 160, 16);
          t += 470;
        } else if (!def && f.player !== undefined) {
          // 英雄能力
          const el = root.querySelector<HTMLElement>(`[data-power="${f.player}"]`);
          if (el) powerFlip(el, t);
          t += 260;
        }
        break;
      }
      case 'attack': {
        if (f.uid === undefined || f.target === undefined) break;
        const r = playAttack(root, snap, f.uid, f.target, t, dying);
        for (const [uid, ghost] of r.ghosts) ghosts.set(uid, ghost);
        attack = { attacker: f.uid, target: f.target, impact: t + 620 * 0.55, end: r.end };
        for (const uid of [f.uid, f.target]) if (dying.has(uid)) deathAt.set(uid, r.end);
        t = r.end;
        break;
      }
      case 'damage': {
        if (f.uid === undefined) break;
        // 攻擊造成的傷害：在撞擊的瞬間顯示
        if (attack && (f.uid === attack.attacker || f.uid === attack.target)) {
          const r = rectOf(f.uid);
          if (r) burst(root, center(r), DAMAGE_COLOR, attack.impact, 60, 7);
          float(f.uid, `-${f.amount}`, 'damage', attack.impact);
          break;
        }
        // 同一個來源連續造成的傷害視為一組（範圍法術）
        const group = [f];
        while (
          i + 1 < fresh.length &&
          fresh[i + 1].kind === 'damage' &&
          fresh[i + 1].cardId === f.cardId &&
          fresh[i + 1].from === f.from &&
          fresh[i + 1].player === f.player
        ) {
          group.push(fresh[++i]);
        }
        const color = f.from === undefined ? colorFor(f.cardId) : DEFAULT_COLOR;
        const source = f.from !== undefined ? rectOf(f.from) : heroRect(f.player);
        let last = t;
        if (group.length >= 2 && isAreaDamage(f.cardId)) {
          const rects = group.map((x) => rectOf(x.uid!)).filter((r): r is DOMRect => !!r);
          wave(root, rects, color, t);
          group.forEach((x, k) => {
            const r = rectOf(x.uid!);
            const at = t + 220 + k * 45;
            if (r) burst(root, center(r), color, at, 64, 8);
            float(x.uid, `-${x.amount}`, 'damage', at);
            if (dying.has(x.uid!)) deathAt.set(x.uid!, at + 180);
            last = Math.max(last, at);
          });
        } else {
          group.forEach((x, k) => {
            const r = rectOf(x.uid!);
            const start = t + k * 110;
            const self = x.from === x.uid;
            const flight = source && r && !self ? 380 : 0;
            if (source && r && !self) projectile(root, center(source), center(r), color, start, flight);
            const at = start + flight;
            if (r) burst(root, center(r), color === DEFAULT_COLOR ? DAMAGE_COLOR : color, at, 66, 9);
            float(x.uid, `-${x.amount}`, 'damage', at);
            if (dying.has(x.uid!)) deathAt.set(x.uid!, at + 180);
            last = Math.max(last, at);
          });
        }
        if (group.some((x) => (x.amount ?? 0) >= 6)) shake(root, last, 6);
        t = last + 120;
        break;
      }
      case 'heal': {
        const r = f.uid !== undefined ? rectOf(f.uid) : null;
        if (r) sparkles(root, r, HEAL_COLOR, t);
        float(f.uid, `+${f.amount}`, 'heal', t + 100);
        t += 90;
        break;
      }
      case 'buff': {
        const r = f.uid !== undefined ? rectOf(f.uid) : null;
        if (r) sparkles(root, r, BUFF_COLOR, t);
        t += 60;
        break;
      }
      case 'armor': {
        const r = f.uid !== undefined ? rectOf(f.uid) : null;
        if (r) burst(root, center(r), '#c9d3dc', t, r.width, 8);
        float(f.uid, `+${f.amount}🛡`, 'armor', t);
        t += 80;
        break;
      }
      case 'shield': {
        const at = attack && (f.uid === attack.target || f.uid === attack.attacker) ? attack.impact : t;
        const r = f.uid !== undefined ? rectOf(f.uid) : null;
        if (r) shieldPop(root, r, at);
        float(f.uid, '聖盾！', 'shield', at);
        break;
      }
      case 'freeze': {
        const r = f.uid !== undefined ? rectOf(f.uid) : null;
        if (r) frost(root, r, attack && f.uid === attack.target ? attack.impact : t);
        break;
      }
      case 'summon': {
        const el = f.uid !== undefined ? root.querySelector<HTMLElement>(`[data-uid="${f.uid}"]`) : null;
        const def = f.cardId && hasCard(f.cardId) ? getCard(f.cardId) : null;
        const heavy = !!def && (def.rarity === 'LEGENDARY' || def.cost >= 6);
        const at = t + (f.played ? 0 : summons * 110);
        if (el) landing(root, el, !!f.played, heavy, at);
        if (f.played) t += 420;
        else summons++;
        break;
      }
      case 'draw': {
        const el = f.uid !== undefined ? root.querySelector<HTMLElement>(`[data-hand-uid="${f.uid}"]`) : null;
        const deck = f.player !== undefined ? (root.querySelector<HTMLElement>(`[data-deck="${f.player}"]`)?.getBoundingClientRect() ?? null) : null;
        if (el) drawCard(el, deck, t + draws * 140);
        draws++;
        break;
      }
    }
    end = Math.max(end, t);
  }
  if (summons) t += summons * 110 + 250;
  if (draws) t = Math.max(t, draws * 140 + 520);

  // 死亡：在造成致命傷害的那一刻之後碎裂
  let k = 0;
  for (const uid of dying) {
    const s = snap.get(uid);
    const at = deathAt.get(uid) ?? t + 90 * k++;
    if (s) shatter(root, s, at, ghosts.get(uid));
    else ghosts.get(uid)?.remove();
    end = Math.max(end, at + 400);
  }
  return Math.max(end, t);
}
