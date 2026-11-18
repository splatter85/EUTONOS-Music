/**
 * The "DJ booth settings" card, shared by the Studio set page and the phone page so both show the same controls.
 * Pure DOM, no inline styles or scripts (the phone page's CSP forbids them); classes are styled in studio.css and
 * phone.css. Every setting has a visible Manual / DJ decides toggle. Touching a control pins it (flips it to Manual) with
 * the value just chosen. The card never stores anything: it renders the settings it is given and reports patches.
 */
import {EXPLORE_LEVELS, PAIR_SEARCH_VALUES, SETTING_LABELS, STRETCH_CHOICES, STYLE_IDS, STYLE_LABELS, WAIT_CHOICES,
  type DjSettings, type SettingKey, type StyleId} from './dj-settings.js';

export interface SettingsCardHandlers {
  /** A partial settings object in the shape the relay accepts (`{styles: {mode: 'manual', value: [...]}}`). */
  patch(patch: Record<string, unknown>): void;
  reset(): void;
}
const PAIR_LABELS: Readonly<Record<string, string>> = {off: 'off', shadow: 'shadow (logs only)', live: 'live'};
const EXPLORE_TEXT: Readonly<Record<string, string>> = {off: 'off (deterministic Auto)', low: 'low (mostly safe styles)', high: 'high (mostly bold styles)'};
/** What "DJ decides" means for each setting, shown under the toggle. */
export const DJ_DECIDES: Readonly<Record<SettingKey, string>> = Object.freeze({
  pairSearch: 'off today', explore: 'on, every style equally likely', styles: 'every style may be chosen',
  maxStretch: 'up to 15%', waitBars: 'up to 8 bars',
});
const SIMPLE_NOTE: Readonly<Record<SettingKey, string>> = Object.freeze({
  pairSearch: 'Off: the DJ plans at Next. Shadow: it also searches in the background and logs what it would pick. Live: Next uses the search.',
  explore: 'How the style is drawn. Low favours safe styles, high favours bold ones; the seed makes a draw replayable.',
  styles: 'Unticked styles are never chosen. A hard cut is never a style. If none of the ticked styles fits a pair, the shortest layered entry is used and logged.',
  maxStretch: 'The most either song may be time-stretched.',
  waitBars: 'How long Next may wait past the requested boundary for a better exit. 0 uses only the requested bar.',
});

function el<K extends keyof HTMLElementTagNameMap>(tag: K, className?: string, text?: string): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}

export class SettingsCard {
  private readonly rows = new Map<SettingKey, {row: HTMLElement; manual: HTMLButtonElement; dj: HTMLButtonElement; note: HTMLElement}>();
  private readonly pair: HTMLSelectElement; private readonly explore: HTMLSelectElement;
  private readonly boxes = new Map<StyleId, HTMLInputElement>();
  private readonly stretch: HTMLSelectElement; private readonly wait: HTMLSelectElement;
  private readonly message: HTMLElement;
  private readonly resetButton: HTMLButtonElement;
  private current: DjSettings | null = null;

  constructor(readonly root: HTMLElement, private readonly handlers: SettingsCardHandlers, readonly prefix: string) {
    root.classList.add('dj-set');
    const row = (key: SettingKey, control: HTMLElement): void => {
      const wrap = el('div', 'dj-set-row'); wrap.dataset.setting = key;
      const head = el('div', 'dj-set-head');
      head.append(el('span', 'dj-set-name', SETTING_LABELS[key]));
      const seg = el('div', 'dj-set-seg'); seg.setAttribute('role', 'group'); seg.setAttribute('aria-label', `${SETTING_LABELS[key]} mode`);
      const manual = el('button', 'dj-set-mode', 'Manual'); manual.type = 'button'; manual.dataset.mode = 'manual'; manual.id = `${prefix}-${key}-manual`;
      const dj = el('button', 'dj-set-mode', 'DJ decides'); dj.type = 'button'; dj.dataset.mode = 'dj'; dj.id = `${prefix}-${key}-dj`;
      manual.addEventListener('click', () => this.handlers.patch({[key]: {mode: 'manual'}}));
      dj.addEventListener('click', () => this.handlers.patch({[key]: {mode: 'dj'}}));
      seg.append(manual, dj); head.append(seg);
      const note = el('p', 'dj-set-note');
      wrap.append(head, control, note);
      this.rows.set(key, {row: wrap, manual, dj, note});
      root.append(wrap);
    };
    const select = (id: string, options: readonly (string | number)[], label: (v: string) => string, key: SettingKey, toValue: (v: string) => unknown): HTMLSelectElement => {
      const s = el('select', 'dj-set-select'); s.id = id; s.autocomplete = 'off'; s.setAttribute('aria-label', SETTING_LABELS[key]);
      for (const option of options) { const o = el('option', undefined, label(String(option))); o.value = String(option); s.append(o); }
      s.addEventListener('change', () => this.handlers.patch({[key]: {mode: 'manual', value: toValue(s.value)}}));
      return s;
    };
    this.pair = select(`${prefix}-pairSearch`, PAIR_SEARCH_VALUES, v => PAIR_LABELS[v] ?? v, 'pairSearch', v => v);
    row('pairSearch', this.pair);
    this.explore = select(`${prefix}-explore`, EXPLORE_LEVELS, v => EXPLORE_TEXT[v] ?? v, 'explore', v => v);
    row('explore', this.explore);
    const styles = el('div', 'dj-set-styles'); styles.setAttribute('role', 'group'); styles.setAttribute('aria-label', 'Allowed styles');
    for (const id of STYLE_IDS) {
      const label = el('label', 'dj-set-style');
      const box = el('input'); box.type = 'checkbox'; box.id = `${prefix}-style-${id}`; box.dataset.style = id; box.autocomplete = 'off';
      box.addEventListener('change', () => this.toggleStyle(id, box.checked));
      label.append(box, el('span', undefined, STYLE_LABELS[id]));
      this.boxes.set(id, box); styles.append(label);
    }
    row('styles', styles);
    this.stretch = select(`${prefix}-maxStretch`, STRETCH_CHOICES, v => `${v}%`, 'maxStretch', v => Number(v));
    row('maxStretch', this.stretch);
    this.wait = select(`${prefix}-waitBars`, WAIT_CHOICES, v => v === '0' ? '0 bars (requested bar only)' : `${v} bars`, 'waitBars', v => Number(v));
    row('waitBars', this.wait);
    this.resetButton = el('button', 'dj-set-reset', 'Reset to safe defaults'); this.resetButton.type = 'button'; this.resetButton.id = `${prefix}-reset`;
    this.resetButton.addEventListener('click', () => this.handlers.reset());
    this.message = el('p', 'dj-set-message'); this.message.id = `${prefix}-message`; this.message.setAttribute('role', 'status');
    root.append(this.resetButton, this.message);
  }

  private toggleStyle(id: StyleId, on: boolean): void {
    const ticked = STYLE_IDS.filter(s => s === id ? on : this.boxes.get(s)?.checked ?? false);
    if (!ticked.length) {
      // The last allowed style cannot be removed: put the box back and say why.
      this.boxes.get(id)!.checked = true;
      this.say('At least one style must stay allowed, so the last one cannot be unticked.');
      return;
    }
    this.handlers.patch({styles: {mode: 'manual', value: ticked}});
  }

  /** Shows a short status line under the card (saved, refused, offline). */
  say(text: string): void { if (this.message.textContent !== text) this.message.textContent = text; }

  render(settings: DjSettings): void {
    this.current = settings;
    const mark = (key: SettingKey, extra: string): void => {
      const r = this.rows.get(key)!;
      const manual = settings[key].mode === 'manual';
      r.row.classList.toggle('is-dj', !manual); r.row.classList.toggle('is-manual', manual);
      r.manual.setAttribute('aria-pressed', String(manual)); r.dj.setAttribute('aria-pressed', String(!manual));
      r.note.textContent = `${manual ? 'Manual: you pinned this.' : `DJ decides (${DJ_DECIDES[key]}).`} ${extra}`.trim();
    };
    if (this.pair.value !== String(settings.pairSearch.value)) this.pair.value = String(settings.pairSearch.value);
    if (this.explore.value !== String(settings.explore.value)) this.explore.value = String(settings.explore.value);
    for (const [id, box] of this.boxes) box.checked = settings.styles.value.includes(id);
    if (this.stretch.value !== String(settings.maxStretch.value)) this.stretch.value = String(settings.maxStretch.value);
    if (this.wait.value !== String(settings.waitBars.value)) this.wait.value = String(settings.waitBars.value);
    mark('pairSearch', SIMPLE_NOTE.pairSearch); mark('explore', SIMPLE_NOTE.explore); mark('styles', SIMPLE_NOTE.styles);
    mark('maxStretch', SIMPLE_NOTE.maxStretch); mark('waitBars', SIMPLE_NOTE.waitBars);
  }
}
