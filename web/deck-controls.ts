/** Studio's two-deck view. Audio-clock snapshots drive display; gestures go to SmallPlayer. */
import type {AudioAsset} from '../src/pack-types.js';
import type {SmallPlayer, DeckView} from '../src/player.js';
import type {DeckControl, DeckId, ChannelControls} from './deck-mixer.js';

const time = (seconds: number): string => {
  const s = Math.max(0, seconds), m = Math.floor(s / 60);
  return m + ':' + (s - m * 60).toFixed(1).padStart(4, '0');
};
const signed = (n: number, digits = 1): string => (n > 0 ? '+' : '') + n.toFixed(digits);
const put = (node: HTMLElement, text: string): void => { if (node.textContent !== text) node.textContent = text; };
const el = <K extends keyof HTMLElementTagNameMap>(tag: K, cls = '') => {
  const node = document.createElement(tag); node.className = cls; return node;
};
const get = <T extends HTMLElement>(id: string): T => document.getElementById(id) as T;
interface Knob {input: HTMLInputElement; value: HTMLOutputElement; owner: HTMLElement; back: HTMLButtonElement;}
export class SetDeckControls {
  private readonly knobs = new Map<string, Knob>();
  private readonly waves = {a: new Float32Array(512), b: new Float32Array(512)};
  private readonly fader = get<HTMLInputElement>('deck-crossfader');
  private readonly faderBack = get<HTMLButtonElement>('deck-crossfader-return');
  constructor(private readonly player: () => SmallPlayer | null) {
    get('automatic-xfader').hidden = true; get('set-crossfader').hidden = false; get('deck-control-help').hidden = false;
    for (const side of ['a', 'b'] as const) {
      const host = get('deck-' + side + '-controls'); host.hidden = false;
      get('deck-' + side + '-motion').hidden = false;
      get<HTMLCanvasElement>('deck-' + side + '-wave').setAttribute('aria-label', 'Deck ' + side.toUpperCase() + ' live output waveform');
      for (const control of ['low', 'mid', 'high', 'filter'] as const) this.addKnob(host, side, control);
    }
    this.fader.addEventListener('input', () => this.act(p => p.setCrossfader(Number(this.fader.value))));
    this.faderBack.addEventListener('click', () => this.act(p => p.returnCrossfader()));
  }
  private act(fn: (player: SmallPlayer) => void): void {
    const p = this.player(); if (!p) return;
    try { fn(p); get('dj-error').textContent = ''; } catch (error) { get('dj-error').textContent = error instanceof Error ? error.message : String(error); }
  }
  private addKnob(host: HTMLElement, side: DeckId, control: DeckControl): void {
    const wrap = el('div', 'deck-control'), label = el('label'), name = control === 'filter' ? 'Filter' : control[0]!.toUpperCase() + control.slice(1);
    label.textContent = name;
    const input = el('input', 'deck-dial'); input.type = 'range'; input.id = 'deck-' + side + '-' + control;
    input.min = control === 'filter' ? '-1' : '-24'; input.max = control === 'filter' ? '1' : '6';
    input.step = control === 'filter' ? '0.01' : '0.5'; input.value = '0'; label.htmlFor = input.id;
    input.setAttribute('aria-label', 'Deck ' + side.toUpperCase() + ' ' + name);
    input.setAttribute('aria-describedby', 'deck-control-help');
    const face = el('span', 'dial-face'), needle = el('span', 'dial-needle'); face.append(needle, input);
    const value = el('output', 'dial-value'), owner = el('span', 'control-owner');
    const back = el('button', 'control-return'); back.type = 'button'; back.textContent = 'Return to DJ';
    back.setAttribute('aria-label', 'Return Deck ' + side.toUpperCase() + ' ' + name + ' to DJ');
    input.addEventListener('input', () => this.act(p => p.setDeckControl(side, control, Number(input.value))));
    back.addEventListener('click', () => this.act(p => p.returnDeckControl(side, control)));
    let drag: {id: number; x: number; y: number; value: number} | null = null;
    input.addEventListener('pointerdown', event => {
      if (input.disabled || event.button !== 0) return;
      event.preventDefault(); input.focus(); input.setPointerCapture(event.pointerId);
      drag = {id: event.pointerId, x: event.clientX, y: event.clientY, value: Number(input.value)};
    });
    input.addEventListener('pointermove', event => {
      if (!drag || event.pointerId !== drag.id) return;
      const step = Number(input.step), min = Number(input.min), max = Number(input.max);
      const target = drag.value + (event.clientX - drag.x + drag.y - event.clientY) * (max - min) / 160;
      input.value = String(Math.min(max, Math.max(min, Math.round(target / step) * step)));
      input.dispatchEvent(new Event('input'));
    });
    const end = (): void => { drag = null; };
    input.addEventListener('pointerup', end); input.addEventListener('pointercancel', end); input.addEventListener('lostpointercapture', end);
    wrap.append(label, face, value, owner, back); host.append(wrap);
    this.knobs.set(side + ':' + control, {input, value, owner, back});
  }
  render(upcoming: readonly AudioAsset[]): void {
    const player = this.player(), snapshot = player?.deckSnapshot();
    const occupied = new Set([snapshot?.a.assetId, snapshot?.b.assetId].filter(Boolean));
    const next = upcoming.filter(a => !occupied.has(a.id));
    for (const side of ['a', 'b'] as const) {
      const view = snapshot?.[side], queued = !view?.assetId ? next.shift() : undefined;
      const hasSong = !!view?.assetId, live = view?.live ?? false;
      const deck = get('deck-' + side); deck.classList.toggle('is-live', live);
      put(get('deck-' + side + '-title'), hasSong ? view.title : queued?.title ?? 'Deck ' + side.toUpperCase());
      put(get('deck-' + side + '-meta'), hasSong ? view.bpm!.toFixed(1) + ' BPM · ' + view.grid + ' grid'
        : queued ? queued.timing!.bpm + ' requested BPM · queued' : 'Waiting for a song');
      put(get('deck-' + side + '-air'), live ? 'On air' : hasSong ? 'Loaded' : queued ? 'Queued' : 'Empty');
      const duration = hasSong ? view.durationSeconds : queued ? queued.file.frames / queued.file.sample_rate : 0;
      put(get('deck-' + side + '-time'), time(hasSong ? view.positionSeconds : 0));
      put(get('deck-' + side + '-remain'), '-' + time(duration - (hasSong ? view.positionSeconds : 0)));
      put(get('deck-' + side + '-motion'), hasSong ? this.motion(view) : 'Original tempo and pitch when started');
      if (player && hasSong) player.copyDeckWaveform(side, this.waves[side]); else this.waves[side].fill(0);
      this.draw(side, hasSong, live);
      for (const control of ['low', 'mid', 'high', 'filter'] as const) this.renderKnob(side, control, view?.controls);
    }
    const fader = snapshot?.crossfader;
    this.fader.disabled = !snapshot;
    if (fader && (document.activeElement !== this.fader || fader.owner === 'dj')) this.fader.value = String(fader.value);
    this.fader.setAttribute('aria-valuetext', fader ? Math.round((1 - fader.value) * 100) + '% A / ' + Math.round(fader.value * 100) + '% B · ' + (fader.owner === 'dj' ? 'DJ' : 'You') : 'Not ready');
    this.faderBack.disabled = !fader || fader.owner === 'dj';
    put(get('deck-crossfader-owner'), fader?.owner === 'you' ? 'You control the crossfader' : 'DJ controls the crossfader');
    get('set-crossfader').classList.toggle('is-manual', fader?.owner === 'you');
  }
  private renderKnob(side: DeckId, control: DeckControl, controls?: ChannelControls): void {
    const k = this.knobs.get(side + ':' + control)!, v = controls?.[control];
    k.input.disabled = !v; k.back.disabled = !v || v.owner === 'dj';
    if (v && (document.activeElement !== k.input || v.owner === 'dj')) k.input.value = String(v.value);
    const number = Number(k.input.value), min = Number(k.input.min), max = Number(k.input.max);
    const angle = control === 'filter' ? number * 135 : number < 0 ? number / -min * 135 : number / max * 135;
    k.input.parentElement!.style.setProperty('--dial-angle', String(angle) + 'deg');
    k.input.parentElement!.classList.toggle('is-manual', v?.owner === 'you');
    put(k.owner, v?.owner === 'you' ? 'You' : 'DJ');
    const text = !v ? '—' : control !== 'filter' ? signed(v.value) + ' dB'
      : controls!.highPassHz > 1 ? 'HP ' + Math.round(controls!.highPassHz) + ' Hz'
      : Math.abs(v.value) > 0.001 ? 'LP ' + Math.round(controls!.lowPassHz) + ' Hz' : 'Open';
    put(k.value, text); k.input.setAttribute('aria-valuetext', text + ' · ' + (v?.owner === 'you' ? 'You' : 'DJ'));
  }
  private motion(view: DeckView): string {
    const speed = signed((view.speed - 1) * 100) + '% tempo';
    return speed + ' · ' + (view.pitchMode === 'rate-linked' ? 'Pitch follows speed (' + signed(view.pitchSemitones, 2) + ' st)'
      : view.pitchMode === 'independent' ? Math.abs(view.pitchSemitones) < 0.001 ? 'Pitch preserved' : 'Independent pitch ' + signed(view.pitchSemitones, 2) + ' st'
      : 'Original pitch');
  }
  private draw(side: DeckId, loaded: boolean, live: boolean): void {
    const canvas = get<HTMLCanvasElement>('deck-' + side + '-wave'), context = canvas.getContext('2d'); if (!context) return;
    const w = Math.max(1, canvas.clientWidth), h = Math.max(1, canvas.clientHeight), ratio = window.devicePixelRatio || 1;
    const pixelsWide = Math.round(w * ratio), pixelsHigh = Math.round(h * ratio);
    if (canvas.width !== pixelsWide || canvas.height !== pixelsHigh) { canvas.width = pixelsWide; canvas.height = pixelsHigh; }
    context.setTransform(ratio, 0, 0, ratio, 0, 0);
    const mid = h / 2, samples = this.waves[side];
    context.clearRect(0, 0, w, h); context.strokeStyle = '#28313b'; context.lineWidth = 1;
    context.beginPath(); context.moveTo(0, mid); context.lineTo(w, mid); context.stroke();
    context.fillStyle = '#8b93a1'; context.font = '12px system-ui';
    context.fillText(loaded ? 'LIVE DECK SIGNAL' : 'Waveform appears when this deck plays', 12, 18);
    if (!loaded) return;
    context.strokeStyle = side === 'a' ? '#22d3ee' : '#f59e0b'; context.globalAlpha = live ? 1 : 0.4;
    context.lineWidth = 1.5; context.beginPath();
    samples.forEach((sample, i) => { const x = i * w / (samples.length - 1), y = mid - Math.max(-1, Math.min(1, sample)) * (mid - 22);
      if (i) context.lineTo(x, y); else context.moveTo(x, y); });
    context.stroke(); context.globalAlpha = 1;
  }
}
