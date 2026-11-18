/**
 * DJ booth settings (`em.dj-settings.v1`), EMF-S21. Pure data, no DOM and no Node APIs, so the Studio page, the phone
 * page, the relay and the player share one validator. Imports nothing (the phone page serves this file alone).
 *
 * Every setting has a mode. "dj" (DJ decides) is today's behaviour and the default for everything, so nothing changes until
 * the owner touches a control; "manual" pins the owner's value. The stored value is kept in both modes so switching back to
 * manual restores the last pinned value. The active settings are stamped (snapshot plus a short id) into each transition
 * plan record and rating so different settings can be compared afterwards.
 *
 * A hard cut is never a style here: it stays banned from the automatic engine. The allow-list can only remove passing styles,
 * and when it would leave a pair with no candidate the planner falls to the shortest layered entry and logs the override.
 */

export const DJ_SETTINGS_VERSION = 'em.dj-settings.v1' as const;
export const DJ_SETTINGS_ENVELOPE = 'em.dj-settings-file.v1' as const;
export const SETTING_MODES = ['manual', 'dj'] as const;
export type SettingMode = typeof SETTING_MODES[number];
export const PAIR_SEARCH_VALUES = ['off', 'shadow', 'live'] as const;
export type PairSearchValue = typeof PAIR_SEARCH_VALUES[number];
export const EXPLORE_LEVELS = ['off', 'low', 'high'] as const;
export type ExploreLevel = typeof EXPLORE_LEVELS[number];
export const STRETCH_CHOICES = [8, 15] as const;
export const WAIT_CHOICES = [0, 4, 8] as const;

/** Owner-visible style ids, in display order, with the route-free recipe key the planner uses for each. */
export const STYLE_IDS = ['crossfade', 'echo-reset', 'filter-dissolve', 'tone-dissolve',
  'layered-bass-first', 'layered-mid-first', 'layered-high-first', 'layered-drums-first'] as const;
export type StyleId = typeof STYLE_IDS[number];
export const STYLE_LABELS: Readonly<Record<StyleId, string>> = Object.freeze({
  'crossfade': 'Crossfade', 'echo-reset': 'Echo reset', 'filter-dissolve': 'Filter dissolve', 'tone-dissolve': 'Tone dissolve',
  'layered-bass-first': 'Layered: bass first', 'layered-mid-first': 'Layered: mid first',
  'layered-high-first': 'Layered: high first', 'layered-drums-first': 'Layered: drums first',
});
export const STYLE_RECIPE_KEY: Readonly<Record<StyleId, string>> = Object.freeze({
  'crossfade': 'fallback-crossfade', 'echo-reset': 'fallback-echo-reset', 'filter-dissolve': 'fallback-filter-dissolve',
  'tone-dissolve': 'fallback-tone-dissolve', 'layered-bass-first': 'fallback-layered-entry/bass-first',
  'layered-mid-first': 'fallback-layered-entry/mid-first', 'layered-high-first': 'fallback-layered-entry/high-first',
  'layered-drums-first': 'fallback-layered-entry/drums-first',
});
/** Route-free recipe key (as the planner names it) -> owner style id; null for analyzed recipes (never filtered). */
export function styleIdOfRecipeKey(key: string): StyleId | null {
  for (const id of STYLE_IDS) if (STYLE_RECIPE_KEY[id] === key) return id;
  return null;
}

export interface Pinnable<T> { readonly mode: SettingMode; readonly value: T }
export interface DjSettings {
  readonly version: typeof DJ_SETTINGS_VERSION;
  readonly pairSearch: Pinnable<PairSearchValue>;
  readonly explore: Pinnable<ExploreLevel>;
  readonly styles: Pinnable<readonly StyleId[]>;
  readonly maxStretch: Pinnable<typeof STRETCH_CHOICES[number]>;
  readonly waitBars: Pinnable<typeof WAIT_CHOICES[number]>;
}
export const SETTING_KEYS = ['pairSearch', 'explore', 'styles', 'maxStretch', 'waitBars'] as const;
export type SettingKey = typeof SETTING_KEYS[number];
export const SETTING_LABELS: Readonly<Record<SettingKey, string>> = Object.freeze({
  pairSearch: 'Pair search', explore: 'Explore', styles: 'Allowed styles', maxStretch: 'Max stretch', waitBars: 'Wait for a better exit',
});

/** Everything on "DJ decides"; stored values are the first value an owner pins. */
export function defaultDjSettings(): DjSettings {
  return {version: DJ_SETTINGS_VERSION, pairSearch: {mode: 'dj', value: 'off'}, explore: {mode: 'dj', value: 'low'},
    styles: {mode: 'dj', value: [...STYLE_IDS]}, maxStretch: {mode: 'dj', value: 15}, waitBars: {mode: 'dj', value: 8}};
}
/** True when every setting is in DJ mode (stored pinned values do not matter then). */
export function isAllDj(s: DjSettings): boolean { return SETTING_KEYS.every(key => s[key].mode === 'dj'); }

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
const bad = (message: string): never => { throw new Error(`Invalid DJ settings: ${message}`); };
const parseMode = (value: unknown, key: string): SettingMode =>
  (SETTING_MODES as readonly string[]).includes(value as string) ? value as SettingMode : bad(`${key} mode`);
const oneOf = <T extends string | number>(choices: readonly T[], value: unknown, key: string): T =>
  (choices as readonly unknown[]).includes(value) ? value as T : bad(`${key} value`);
function parseStyles(value: unknown, mode: SettingMode): StyleId[] {
  if (!Array.isArray(value) || value.length > STYLE_IDS.length * 2) return bad('styles value');
  for (const id of value) if (!(STYLE_IDS as readonly unknown[]).includes(id)) return bad('unknown style');
  const set = new Set(value as StyleId[]);
  // At least one passing style must stay ticked while the owner pins the list.
  if (mode === 'manual' && set.size === 0) return bad('at least one style must stay allowed');
  return STYLE_IDS.filter(id => set.has(id));
}

/**
 * Merges `patch` over `base`. Unknown keys (top level and inside a setting) are ignored; a present key with a bad value
 * rejects the whole patch (nothing is half-applied). A missing key keeps its current value. `version` may be omitted.
 * A setting may omit `mode` or `value` and keep the current one.
 */
export function mergeDjSettings(base: DjSettings, patch: unknown): DjSettings {
  if (!isRecord(patch)) return bad('not an object');
  if (patch.version !== undefined && patch.version !== DJ_SETTINGS_VERSION) return bad('version');
  const out = {...base} as {-readonly [K in keyof DjSettings]: DjSettings[K]};
  const part = <T>(key: SettingKey, parseValue: (value: unknown, mode: SettingMode) => T): void => {
    const raw = patch[key];
    if (raw === undefined) return;
    if (!isRecord(raw)) { bad(`${key} is not an object`); return; }
    const current = base[key] as Pinnable<unknown>;
    const mode = raw.mode === undefined ? current.mode : parseMode(raw.mode, key);
    // A value that is not being pinned is still validated when supplied, but is only required to be well formed.
    const value = raw.value === undefined ? current.value as T : parseValue(raw.value, mode);
    if (raw.value === undefined && key === 'styles' && mode === 'manual' && (current.value as readonly unknown[]).length === 0) bad('at least one style must stay allowed');
    (out as Record<string, unknown>)[key] = {mode, value};
  };
  part<PairSearchValue>('pairSearch', v => oneOf(PAIR_SEARCH_VALUES, v, 'pairSearch'));
  part<ExploreLevel>('explore', v => oneOf(EXPLORE_LEVELS, v, 'explore'));
  part<readonly StyleId[]>('styles', (v, mode) => parseStyles(v, mode));
  part('maxStretch', v => oneOf(STRETCH_CHOICES, v, 'maxStretch'));
  part('waitBars', v => oneOf(WAIT_CHOICES, v, 'waitBars'));
  return out as DjSettings;
}
/** A full settings object from untrusted JSON (a missing setting means DJ decides). */
export function parseDjSettings(value: unknown): DjSettings { return mergeDjSettings(defaultDjSettings(), value); }
/** Like `parseDjSettings` but returns the defaults instead of throwing (a damaged cache never blocks the booth). */
export function parseDjSettingsOrDefault(value: unknown): DjSettings {
  try { return parseDjSettings(value); } catch { return defaultDjSettings(); }
}

// ---------------------------------------------------------------------------------------------
// What the engine sees
// ---------------------------------------------------------------------------------------------
export const SETTING_DEFAULTS = Object.freeze({maxStretch: 0.15, waitBars: 8});
export interface EffectiveDjSettings {
  /** Pair search mode after the `?pairsearch=` URL flag (the flag wins) and the setting. */
  readonly pairSearch: PairSearchValue;
  /** Explore on/off and its weight level; `dj` is today's equal weights. */
  readonly explore: {readonly enabled: boolean; readonly level: 'dj' | 'low' | 'high'};
  readonly allowedStyles: readonly StyleId[];
  /** Planner recipe keys of the allowed route-free styles (analyzed recipes are never filtered). */
  readonly allowedRecipeKeys: readonly string[];
  readonly maxStretch: number;
  readonly waitBars: number;
  /** True when the allow-list is narrower than every style. */
  readonly restrictsStyles: boolean;
}
export function resolveDjSettings(s: DjSettings, urlPairSearch?: PairSearchValue | null): EffectiveDjSettings {
  const allowedStyles = s.styles.mode === 'manual' ? [...s.styles.value] : [...STYLE_IDS];
  return {
    pairSearch: urlPairSearch ?? (s.pairSearch.mode === 'manual' ? s.pairSearch.value : 'off'),
    explore: s.explore.mode === 'dj' ? {enabled: true, level: 'dj'}
      : s.explore.value === 'off' ? {enabled: false, level: 'dj'} : {enabled: true, level: s.explore.value},
    allowedStyles, allowedRecipeKeys: allowedStyles.map(id => STYLE_RECIPE_KEY[id]),
    maxStretch: s.maxStretch.mode === 'manual' ? s.maxStretch.value / 100 : SETTING_DEFAULTS.maxStretch,
    waitBars: s.waitBars.mode === 'manual' ? s.waitBars.value : SETTING_DEFAULTS.waitBars,
    restrictsStyles: allowedStyles.length < STYLE_IDS.length,
  };
}
/** The planner-facing slice (what `chooseSetTransition` and the candidate generator take). */
export interface TransitionSettings {
  readonly allowedRecipeKeys?: readonly string[];
  readonly maxStretch?: number;
  readonly waitBars?: number;
  readonly exploreLevel?: 'dj' | 'low' | 'high';
}
export function transitionSettingsOf(e: EffectiveDjSettings): TransitionSettings {
  return {...(e.restrictsStyles ? {allowedRecipeKeys: e.allowedRecipeKeys} : {}), maxStretch: e.maxStretch, waitBars: e.waitBars, exploreLevel: e.explore.level};
}

/**
 * Explore base weights per menu key. `dj` is today's equal weights. `low` leans on the smooth, familiar styles (beat-matched
 * recipes, crossfade, dissolves); `high` leans on the bolder ones (layered entries, echo reset, echo-out, tempo ramp, brake,
 * meet-in-middle). The draw still gives every candidate the explore menu's floor share, so no style is ever starved.
 * Engineering starting points, not listening-qualified.
 */
export const EXPLORE_WEIGHTS = Object.freeze({policy: 'explore-weights@1' as const, strong: 3, weak: 1});
const BOLD_ANALYZED: readonly string[] = ['echo-out', 'tempo-ramp', 'brake', 'meet-in-middle'];
export function isBoldKey(key: string): boolean {
  return key.startsWith('fallback-layered-entry/') || key === 'fallback-echo-reset' || BOLD_ANALYZED.includes(key);
}
export function exploreWeight(level: 'dj' | 'low' | 'high' | undefined, key: string): number {
  if (!level || level === 'dj') return 1;
  const bold = isBoldKey(key);
  return (level === 'high') === bold ? EXPLORE_WEIGHTS.strong : EXPLORE_WEIGHTS.weak;
}

// ---------------------------------------------------------------------------------------------
// Stamp: snapshot + short id, recorded in plan records and ratings
// ---------------------------------------------------------------------------------------------
export type SnapshotEntry =
  | {readonly mode: 'dj'}
  | {readonly mode: 'manual'; readonly value: string | number | readonly string[]};
export interface SettingsSnapshot {
  readonly pairSearch: SnapshotEntry; readonly explore: SnapshotEntry; readonly styles: SnapshotEntry;
  readonly maxStretch: SnapshotEntry; readonly waitBars: SnapshotEntry;
}
export interface SettingsStamp {
  /** `ds-` + FNV-1a of the canonical snapshot and URL flag; the same settings always have the same id. */
  readonly id: string;
  readonly snapshot: SettingsSnapshot;
  /** The `?pairsearch=` URL flag when it overrode the setting. */
  readonly urlPairSearch?: PairSearchValue;
  /** True when the allow-list left this pair no candidate and the shortest layered entry was used anyway (never a cut). */
  readonly allowListOverridden?: boolean;
}
function canonical(value: unknown): string {
  if (value === null || typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`;
  const entries = Object.entries(value as Record<string, unknown>).filter(([, v]) => v !== undefined).sort(([x], [y]) => x < y ? -1 : x > y ? 1 : 0);
  return `{${entries.map(([k, v]) => `${JSON.stringify(k)}:${canonical(v)}`).join(',')}}`;
}
function fnv(text: string): string {
  let h = 0x811c9dc5;
  for (let i = 0; i < text.length; i++) { h ^= text.charCodeAt(i); h = Math.imul(h, 0x01000193) >>> 0; }
  return h.toString(16).padStart(8, '0');
}
export function settingsSnapshot(s: DjSettings): SettingsSnapshot {
  const entry = (p: Pinnable<unknown>): SnapshotEntry => p.mode === 'dj' ? {mode: 'dj'} : {mode: 'manual', value: p.value as string | number | readonly string[]};
  return {pairSearch: entry(s.pairSearch), explore: entry(s.explore), styles: entry(s.styles), maxStretch: entry(s.maxStretch), waitBars: entry(s.waitBars)};
}
export const settingsIdOf = (snapshot: SettingsSnapshot, urlPairSearch?: PairSearchValue | null): string =>
  `ds-${fnv(canonical({snapshot, urlPairSearch: urlPairSearch ?? undefined}))}`;
export function settingsStamp(s: DjSettings, urlPairSearch?: PairSearchValue | null, allowListOverridden = false): SettingsStamp {
  const snapshot = settingsSnapshot(s);
  return {id: settingsIdOf(snapshot, urlPairSearch), snapshot, ...(urlPairSearch ? {urlPairSearch} : {}), ...(allowListOverridden ? {allowListOverridden: true} : {})};
}
export const DEFAULT_SETTINGS_ID = settingsIdOf(settingsSnapshot(defaultDjSettings()));

const entryOk = (key: SettingKey, e: unknown): boolean => {
  if (!isRecord(e)) return false;
  if (e.mode === 'dj') return Object.keys(e).length === 1;
  if (e.mode !== 'manual' || Object.keys(e).some(k => k !== 'mode' && k !== 'value')) return false;
  try {
    mergeDjSettings(defaultDjSettings(), {[key]: {mode: 'manual', value: e.value}});
    return true;
  } catch { return false; }
};
/** Shape check (and id check) for the optional `settings` field of plan records and ratings. */
export function isSettingsStamp(value: unknown): value is SettingsStamp {
  if (!isRecord(value) || typeof value.id !== 'string' || !isRecord(value.snapshot)) return false;
  if (Object.keys(value).some(k => !['id', 'snapshot', 'urlPairSearch', 'allowListOverridden'].includes(k))) return false;
  if (value.urlPairSearch !== undefined && !(PAIR_SEARCH_VALUES as readonly unknown[]).includes(value.urlPairSearch)) return false;
  if (value.allowListOverridden !== undefined && typeof value.allowListOverridden !== 'boolean') return false;
  const snap = value.snapshot;
  if (Object.keys(snap).length !== SETTING_KEYS.length || !SETTING_KEYS.every(key => entryOk(key, snap[key]))) return false;
  return value.id === settingsIdOf(snap as unknown as SettingsSnapshot, value.urlPairSearch as PairSearchValue | undefined);
}

/** One plain sentence per setting, for "Why this handover" and the report legend. */
export function describeSnapshot(snapshot: SettingsSnapshot, urlPairSearch?: PairSearchValue | null): string[] {
  const dj = (e: SnapshotEntry, what: string): string => e.mode === 'dj' ? `DJ decides (${what})` : 'manual';
  const lines: string[] = [];
  const ps = snapshot.pairSearch;
  lines.push(`Pair search: ${urlPairSearch ? `${urlPairSearch} (URL flag)` : ps.mode === 'manual' ? `manual ${ps.value}` : dj(ps, 'off')}`);
  const ex = snapshot.explore;
  lines.push(`Explore: ${ex.mode === 'manual' ? `manual ${ex.value}` : dj(ex, 'on, equal weights')}`);
  const st = snapshot.styles;
  lines.push(`Allowed styles: ${st.mode === 'manual' ? `manual, ${(st.value as readonly string[]).length} of ${STYLE_IDS.length} (${(st.value as readonly StyleId[]).map(id => STYLE_LABELS[id] ?? id).join(', ')})` : dj(st, 'all')}`);
  const ms = snapshot.maxStretch;
  lines.push(`Max stretch: ${ms.mode === 'manual' ? `manual ${ms.value}%` : dj(ms, '15%')}`);
  const wb = snapshot.waitBars;
  lines.push(`Wait for a better exit: ${wb.mode === 'manual' ? `manual ${wb.value} bars` : dj(wb, '8 bars')}`);
  return lines;
}
/** Compact one-line form, for status text and report rows. */
export function summarizeSnapshot(snapshot: SettingsSnapshot, urlPairSearch?: PairSearchValue | null): string {
  const part = (label: string, e: SnapshotEntry, show: (v: never) => string, flag?: string): string =>
    `${label} ${flag ?? (e.mode === 'dj' ? 'DJ' : show(e.value as never))}`;
  return [part('pair-search', snapshotEntryOf(snapshot.pairSearch), v => String(v), urlPairSearch ? `${urlPairSearch}(url)` : undefined),
    part('explore', snapshot.explore, v => String(v)),
    part('styles', snapshot.styles, (v: readonly string[]) => `${v.length}/${STYLE_IDS.length}`),
    part('stretch', snapshot.maxStretch, v => `${v}%`),
    part('wait', snapshot.waitBars, v => `${v}b`)].join(' · ');
}
const snapshotEntryOf = (e: SnapshotEntry): SnapshotEntry => e;
