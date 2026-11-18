/**
 * The "Song sources" card, shared by the Studio set page and the phone page. Pure DOM, no inline styles or scripts (the
 * phone page's CSP forbids them); classes are styled in studio.css and phone.css. The card never stores anything: it renders
 * the view it is given and reports what the owner did. The Studio copy (`admin`) can also add and remove folders; the phone
 * copy cannot and never sees a folder path. Rights wording stays out of the UI beyond the small "local only" labels.
 */
import {RATING_WORDS, type DislikedSong, type PoolSong, type RateAction, type SongRating, type SourceStatus, type SourcesView} from './dj-sources.js';

export interface SourcesCardHandlers {
  tick(id: string, on: boolean): void;
  addFolder(path: string): void;
  removeFolder(id: string): void;
  rescan(): void;
  /** `null` clears the rating. */
  rate(assetId: string, action: RateAction): void;
}
export interface SourcesCardOptions {
  /** The Studio page: shows the add-folder field, Remove and Rescan. */
  readonly admin: boolean;
  /** The phone page: also lists every song with its rating buttons (the Studio has its own song list). */
  readonly songs: boolean;
}
function el<K extends keyof HTMLElementTagNameMap>(tag: K, className?: string, text?: string): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}
const put = (node: HTMLElement, text: string): void => { if (node.textContent !== text) node.textContent = text; };
const sourceText = (s: SourceStatus): string =>
  `${s.songs === null ? (s.ticked ? '…' : 'off') : `${s.songs} song${s.songs === 1 ? '' : 's'}`}${s.available ? '' : ' · unavailable'}`;

/** Rating buttons for one song: pressing the current rating again clears it. */
export function ratingButtons(assetId: string, current: SongRating, rate: (action: RateAction) => void, label: string): HTMLElement {
  const group = el('span', 'src-rate');
  group.setAttribute('role', 'group'); group.setAttribute('aria-label', `Rate ${label}`);
  for (const [action, text] of [['love', 'Love'], ['like', 'Like'], ['dislike', 'Dislike']] as const) {
    const b = el('button', 'src-rate-btn', text); b.type = 'button'; b.dataset.rate = action; b.dataset.asset = assetId;
    b.setAttribute('aria-pressed', String(current === action));
    b.setAttribute('aria-label', `${text} ${label}`);
    b.addEventListener('click', () => rate(b.getAttribute('aria-pressed') === 'true' ? null : action));
    group.append(b);
  }
  return group;
}
/** Updates the pressed state of a group made by `ratingButtons` without rebuilding it. */
export function markRating(group: HTMLElement, current: SongRating, rate: (action: RateAction) => void): void {
  for (const b of Array.from(group.querySelectorAll<HTMLButtonElement>('button[data-rate]'))) {
    b.setAttribute('aria-pressed', String(b.dataset.rate === current));
  }
  void rate;
}

export class SourcesCard {
  private readonly pool: HTMLElement;
  private readonly list: HTMLElement;
  private readonly message: HTMLElement;
  private readonly songsList: HTMLElement | null = null;
  private readonly dislikedWrap: HTMLElement;
  private readonly dislikedList: HTMLElement;
  private readonly pathInput: HTMLInputElement | null = null;
  private listKey = '';
  private songsKey = '';
  private dislikedKey = '';

  constructor(readonly root: HTMLElement, private readonly handlers: SourcesCardHandlers, readonly prefix: string, private readonly options: SourcesCardOptions) {
    root.classList.add('src-card');
    this.pool = el('p', 'src-pool'); this.pool.id = `${prefix}-pool`; this.pool.setAttribute('role', 'status');
    this.list = el('ul', 'src-list'); this.list.id = `${prefix}-list`;
    root.append(this.pool, this.list);
    if (options.admin) {
      const add = el('div', 'src-add');
      const input = el('input', 'src-path'); input.type = 'text'; input.id = `${prefix}-path`; input.maxLength = 400; input.autocomplete = 'off';
      input.spellcheck = false; input.placeholder = 'Full path of a folder of WAV files, e.g. D:\\Music\\Beats';
      input.setAttribute('aria-label', 'Folder path to add');
      const addButton = el('button', 'src-btn', 'Add folder'); addButton.type = 'button'; addButton.id = `${prefix}-add`;
      const rescan = el('button', 'src-btn', 'Rescan'); rescan.type = 'button'; rescan.id = `${prefix}-rescan`;
      const submit = (): void => { const value = input.value.trim(); if (value) { handlers.addFolder(value); } };
      addButton.addEventListener('click', submit);
      input.addEventListener('keydown', event => { if (event.key === 'Enter') { event.preventDefault(); submit(); } });
      rescan.addEventListener('click', () => handlers.rescan());
      add.append(input, addButton, rescan);
      root.append(add);
      this.pathInput = input;
    }
    this.message = el('p', 'src-message'); this.message.id = `${prefix}-message`; this.message.setAttribute('role', 'status');
    root.append(this.message);
    if (options.songs) {
      this.songsList = el('ul', 'src-songs'); this.songsList.id = `${prefix}-songs`;
      root.append(this.songsList);
    }
    this.dislikedWrap = el('details', 'src-disliked'); this.dislikedWrap.id = `${prefix}-disliked-wrap`;
    this.dislikedWrap.append(el('summary', undefined, 'Disliked songs (never played)'));
    this.dislikedList = el('ul', 'src-disliked-list'); this.dislikedList.id = `${prefix}-disliked`;
    this.dislikedWrap.append(this.dislikedList);
    root.append(this.dislikedWrap);
  }

  /** Clears the path field after a folder was added. */
  clearPath(): void { if (this.pathInput) this.pathInput.value = ''; }
  say(text: string): void { put(this.message, text); }

  render(view: SourcesView | null, ticks: Readonly<Record<string, boolean>>, note = ''): void {
    if (!view) { put(this.pool, 'Waiting for the PC…'); this.say(note); return; }
    put(this.pool, `${view.pool.message}${view.pool.scanning ? ' (scanning…)' : ''}`);
    this.pool.classList.toggle('is-bad', !view.pool.ok);
    const key = JSON.stringify([view.sources.map(s => [s.id, s.label, s.available, s.songs, s.message]), view.folders.map(f => [f.id, 'path' in f ? 1 : 0]), this.options.admin]);
    if (key !== this.listKey) { this.listKey = key; this.buildList(view); }
    for (const box of Array.from(this.list.querySelectorAll<HTMLInputElement>('input[data-source]'))) {
      const id = box.dataset.source!;
      const on = Object.hasOwn(ticks, id) ? ticks[id] === true : (view.sources.find(s => s.id === id)?.ticked ?? false);
      if (box.checked !== on) box.checked = on;
    }
    this.say(note);
    if (this.songsList) this.renderSongs(view.songs);
    this.renderDisliked(view.disliked);
  }

  private buildList(view: SourcesView): void {
    this.list.replaceChildren();
    for (const source of view.sources) {
      const li = el('li', 'src-item'); li.dataset.sourceRow = source.id;
      const label = el('label', 'src-label');
      const box = el('input'); box.type = 'checkbox'; box.id = `${this.prefix}-tick-${source.id}`; box.dataset.source = source.id; box.autocomplete = 'off';
      box.checked = source.ticked;
      box.addEventListener('change', () => this.handlers.tick(source.id, box.checked));
      const name = el('span', 'src-name', source.label);
      const count = el('span', 'src-count', sourceText(source));
      label.append(box, name, count);
      li.append(label);
      if (this.options.admin && source.kind === 'folder') {
        const remove = el('button', 'src-btn', 'Remove'); remove.type = 'button'; remove.dataset.remove = source.id;
        remove.setAttribute('aria-label', `Remove ${source.label} from the list (files are not deleted)`);
        remove.addEventListener('click', () => this.handlers.removeFolder(source.id));
        li.append(remove);
        const folder = view.folders.find(f => f.id === source.id);
        if (folder?.path) { const where = el('span', 'src-where', folder.path); li.append(where); }
      }
      if (source.message) li.append(el('span', 'src-note', source.message));
      li.classList.toggle('is-unavailable', !source.available);
      this.list.append(li);
    }
  }

  private renderSongs(songs: readonly PoolSong[]): void {
    if (!this.songsList) return;
    const key = JSON.stringify(songs.map(s => [s.assetId, s.title, s.sourceLabel, s.rating]));
    if (key === this.songsKey) return;
    this.songsKey = key;
    this.songsList.replaceChildren();
    if (!songs.length) { this.songsList.append(el('li', 'src-empty', 'No playable songs yet.')); return; }
    for (const song of songs) {
      const li = el('li', 'src-song'); li.dataset.srcSong = song.assetId;
      const text = el('div', 'src-song-text');
      text.append(el('strong', 'src-song-title', song.title), el('span', 'src-song-meta', `${song.sourceLabel} · ${RATING_WORDS[song.rating]}`));
      li.append(text, ratingButtons(song.assetId, song.rating, action => this.handlers.rate(song.assetId, action), song.title));
      this.songsList.append(li);
    }
  }

  private renderDisliked(disliked: readonly DislikedSong[]): void {
    const key = JSON.stringify(disliked.map(d => [d.assetId, d.title, d.sourceLabel]));
    this.dislikedWrap.hidden = disliked.length === 0;
    if (key === this.dislikedKey) return;
    this.dislikedKey = key;
    this.dislikedList.replaceChildren();
    for (const song of disliked) {
      const li = el('li', 'src-disliked-item'); li.dataset.disliked = song.assetId;
      const undo = el('button', 'src-btn', 'Undo'); undo.type = 'button'; undo.dataset.undo = song.assetId;
      undo.setAttribute('aria-label', `Undo dislike of ${song.title}`);
      undo.addEventListener('click', () => this.handlers.rate(song.assetId, null));
      li.append(el('span', 'src-song-title', song.title), el('span', 'src-song-meta', ` · ${song.sourceLabel}`), undo);
      this.dislikedList.append(li);
    }
  }
}
