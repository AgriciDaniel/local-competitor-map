/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Lightweight, browser-local settings store for the app's API keys.
 *
 * Keys are persisted in `localStorage` only (client-side). This is fine for a
 * local developer tool, but it is NOT secure storage. Do not ship this as-is
 * to untrusted users. The Gemini agent (index.tsx) and the map / Places
 * competitor search (map_app.ts) read their keys from here; an unset key falls
 * back to RUNTIME_KEYS (the gitignored local-demo keys in runtime-keys.ts).
 */

import {RUNTIME_KEYS} from './runtime-keys';

export interface AppSettings {
  /** Gemini API key for @google/genai. Falls back to RUNTIME_KEYS. */
  geminiKey: string;
  /** Google Maps JS API key. Falls back to RUNTIME_KEYS. */
  mapsKey: string;
}

const STORAGE_KEY = 'mcpMaps3d.settings';

/**
 * Reads settings: a stored (localStorage) value wins; otherwise the key falls
 * back to RUNTIME_KEYS (the gitignored local-demo keys). Never throws.
 */
export function getSettings(): AppSettings {
  let stored: Partial<AppSettings> = {};
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) stored = JSON.parse(raw);
  } catch (e) {
    console.warn('Could not read settings; using defaults.', e);
  }
  return {
    geminiKey: stored.geminiKey || RUNTIME_KEYS.geminiKey || '',
    mapsKey: stored.mapsKey || RUNTIME_KEYS.mapsKey || '',
  };
}

/** Persists settings to localStorage. */
export function saveSettings(settings: AppSettings): void {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(settings));
}
