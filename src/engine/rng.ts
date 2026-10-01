// 可重現的亂數（狀態存在 GameState.rng，方便 AI 複製模擬）
export function nextRandom(state: { rng: number }): number {
  let t = (state.rng = (state.rng + 0x6d2b79f5) | 0);
  t = Math.imul(t ^ (t >>> 15), t | 1);
  t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
}

export function randomInt(state: { rng: number }, n: number): number {
  return Math.floor(nextRandom(state) * n);
}

export function pick<T>(state: { rng: number }, arr: T[]): T | undefined {
  if (!arr.length) return undefined;
  return arr[randomInt(state, arr.length)];
}

export function shuffle<T>(state: { rng: number }, arr: T[]): T[] {
  for (let i = arr.length - 1; i > 0; i--) {
    const j = randomInt(state, i + 1);
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr;
}
