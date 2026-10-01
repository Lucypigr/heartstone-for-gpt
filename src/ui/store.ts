// 存檔（localStorage）與 React 綁定
import { useSyncExternalStore } from 'react';
import { newProfile, sanitizeProfile, type Profile } from '../game/profile';

const KEY = 'hearthstone-for-claude/profile-v1';

function load(): Profile {
  try {
    const raw = localStorage.getItem(KEY);
    if (raw) return sanitizeProfile(JSON.parse(raw));
  } catch {
    /* 無法讀取時使用新存檔 */
  }
  return newProfile();
}

let profile: Profile = load();
const listeners = new Set<() => void>();

function persist() {
  try {
    localStorage.setItem(KEY, JSON.stringify(profile));
  } catch {
    /* 私密瀏覽等情況無法儲存 */
  }
}
persist();

export function getProfile(): Profile {
  return profile;
}

export function setProfile(next: Profile | ((p: Profile) => Profile)) {
  profile = typeof next === 'function' ? next(profile) : next;
  persist();
  for (const l of listeners) l();
}

export function useProfile(): Profile {
  return useSyncExternalStore(
    (cb) => {
      listeners.add(cb);
      return () => listeners.delete(cb);
    },
    () => profile,
  );
}

export function exportProfile(): string {
  return JSON.stringify(profile, null, 2);
}

export function importProfile(json: string): boolean {
  try {
    setProfile(sanitizeProfile(JSON.parse(json)));
    return true;
  } catch {
    return false;
  }
}

export function resetProfile() {
  setProfile(newProfile());
}
