'use client';
import { createContext, useContext, useSyncExternalStore, type ReactNode } from 'react';
import { parseProgress, PROGRESS_KEY } from '@/lib/progress';
type Snapshot = { completed: string[]; enabled: boolean; notice: string };
type Progress = Snapshot & {
  complete: (id: string) => void;
  toggle: () => void;
  clear: () => void;
};
const initial: Snapshot = { completed: [], enabled: false, notice: '' };
let snapshot = initial;
let initialized = false;
const listeners = new Set<() => void>();
function update(next: Snapshot) {
  snapshot = next;
  listeners.forEach((listener) => listener());
}
function load() {
  try {
    const stored = localStorage.getItem(PROGRESS_KEY);
    update({ completed: parseProgress(stored), enabled: stored !== null, notice: '' });
  } catch {
    update({
      ...snapshot,
      notice: 'Browser storage is unavailable. Progress will last for this visit only.',
    });
  }
}
function onStorage(event: StorageEvent) {
  if (event.key === PROGRESS_KEY || event.key === null) load();
}
function subscribe(listener: () => void) {
  listeners.add(listener);
  if (!initialized) {
    initialized = true;
    load();
  }
  if (listeners.size === 1) window.addEventListener('storage', onStorage);
  return () => {
    listeners.delete(listener);
    if (!listeners.size) window.removeEventListener('storage', onStorage);
  };
}
function persist(next: Snapshot) {
  try {
    localStorage.setItem(PROGRESS_KEY, JSON.stringify(next.completed));
    update(next);
  } catch {
    update({
      ...next,
      enabled: false,
      notice: 'Progress could not be saved. You can keep learning for this visit.',
    });
  }
}
function clear() {
  let notice = 'Saved progress cleared from this browser.';
  try {
    localStorage.removeItem(PROGRESS_KEY);
  } catch {
    notice =
      'Storage access was blocked. Clear site data in your browser to remove previously saved progress.';
  }
  update({ completed: [], enabled: false, notice });
}
function toggle() {
  if (snapshot.enabled) clear();
  else persist({ ...snapshot, enabled: true, notice: '' });
}
function complete(id: string) {
  const next = { ...snapshot, completed: [...new Set([...snapshot.completed, id])] };
  if (next.enabled) persist(next);
  else update(next);
}
const Context = createContext<Progress | null>(null);
export function ProgressProvider({ children }: { children: ReactNode }) {
  const state = useSyncExternalStore(
    subscribe,
    () => snapshot,
    () => initial,
  );
  return (
    <Context.Provider value={{ ...state, complete, toggle, clear }}>{children}</Context.Provider>
  );
}
export function useProgress() {
  const context = useContext(Context);
  if (!context) throw new Error('ProgressProvider is required');
  return context;
}
