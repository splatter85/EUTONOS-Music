/**
 * EUTONOS Studio: one page with Produce, DJ Booth and Library tabs over the existing
 * engines. It adds no new audio path: the DJ is the S03/S05 DeterministicDj, the pattern
 * sampler is the S04 SmallPlayer procedural path, and saved patterns use the S11 library.
 * The AI generator is the separate local Music Studio service (optional, loopback only).
 * One playback owner per page: starting any engine stops the others first.
 */
import {loadBrowserPack, type LoadedBrowserPack} from '../src/browser-pack.js';
import {SmallPlayer} from '../src/player.js';
import {DeterministicDj, type DjHandoff} from '../src/dj.js';
import {CONTROL_VERSION, type ControlRequest} from '../src/control.js';
import type {AudioAsset, MusicState} from '../src/pack-types.js';
import {compilePhrase, type ProceduralPlan, type S01PhraseState} from '../src/phrase-plan.js';
import {MusicLibrary, type MusicLibrarySnapshot} from '../src/library.js';
import {IndexedDbLibraryStorage} from '../src/library-indexeddb.js';
import {captureRecipeReplay} from '../src/recipe-library.js';
import {decodeWav} from '../src/audio-analysis.js';

const PACKS = {
  s01: {manifest: '/fixtures/s01/manifest.json', label: 'S01 original'},
  'mock-fl': {manifest: '/generated/s06-mock-fl/pack/manifest.json', label: 'S06 imported mock'},
  fl: {manifest: '/local/s09-fl/pack/manifest.json', label: 'S09 real FL (owner-local)'},
} as const;
type PackChoice = keyof typeof PACKS;
type Tab = 'produce' | 'dj' | 'library';
const STUDIO_API = 'http://127.0.0.1:7870';
const LOCK = 'eutonos-music-s02-playback';
const ACTIVE = ['loading', 'scheduled', 'playing', 'paused'];

const params = new URLSearchParams(location.search);
const requestedPack = params.get('pack') ?? 's01';
const packChoice: PackChoice | null = Object.hasOwn(PACKS, requestedPack) ? requestedPack as PackChoice : null;

const $ = <T extends HTMLElement = HTMLElement>(id: string): T => {
  const found = document.getElementById(id);
  if (!found) throw new Error(`Missing UI element: ${id}`);
  return found as T;
};
const setText = (id: string, value: string): void => { const t = $(id); if (t.textContent !== value) t.textContent = value; };
const message = (error: unknown): string => error instanceof Error ? error.message : String(error);
const clock = (s: number): string => {
  const v = Math.max(0, s), m = Math.floor(v / 60);
  return `${m}:${(v - m * 60).toFixed(1).padStart(4, '0')}`;
};
const make = <K extends keyof HTMLElementTagNameMap>(tag: K, props: Partial<HTMLElementTagNameMap[K]> = {}, ...kids: (Node | string)[]) => {
  const node = Object.assign(document.createElement(tag), props); node.append(...kids); return node;
};
function button(label: string, onClick: () => void, cls = 'chip', aria?: string): HTMLButtonElement {
  const b = make('button', {type: 'button', className: cls, textContent: label});
  if (aria) b.setAttribute('aria-label', aria);
  b.addEventListener('click', onClick);
  return b;
}

// ---------- shared state ----------
let loaded: LoadedBrowserPack | null = null;
let deckAssets: {a: AudioAsset; b: AudioAsset} | null = null;
const peaks = new Map<string, Float32Array | null>();
let djNeedsMute = false;
let dj: DeterministicDj | null = null;
let sampler: SmallPlayer | null = null;
let handoffMode: DjHandoff = 'direct';
let muted = false;
let pauseReason = '';
let ownership: Promise<void> | null = null, releaseLock: (() => void) | null = null, leaseEpoch = 0;
const preview = $<HTMLAudioElement>('preview');
let previewing: string | null = null;

function releaseOwnership(): void { ++leaseEpoch; releaseLock?.(); releaseLock = null; ownership = null; }
function acquireOwnership(): Promise<void> {
  if (ownership) return ownership;
  const epoch = leaseEpoch;
  ownership = new Promise<void>((resolve, reject) => {
    void navigator.locks.request(LOCK, {ifAvailable: true}, lock => {
      if (epoch !== leaseEpoch) { reject(new Error('Playback was cancelled.')); return; }
      if (!lock) { reject(new Error('Another tab is playing. Press Stop there, then Play here.')); return; }
      return new Promise<void>(release => { releaseLock = release; resolve(); });
    }).catch(reject);
  }).catch(error => { if (epoch === leaseEpoch) ownership = null; throw error; });
  return ownership;
}
const djActive = (): boolean => !!dj && ACTIVE.includes(dj.snapshot().player.state);
const samplerActive = (): boolean => !!sampler && ACTIVE.includes(sampler.snapshot().state);
/** One owner: stop whatever else is sounding before `kind` starts. */
async function takeOver(kind: 'dj' | 'sampler' | 'preview'): Promise<void> {
  if (kind !== 'preview' && previewing) stopPreview();
  if (kind !== 'sampler' && samplerActive()) { sampler!.stop(); renderSampler(); }
  if (kind !== 'dj' && djActive()) await send({type: 'transport', action: 'stop'});
}

// ---------- tabs ----------
const tabs: Record<Tab, HTMLButtonElement> = {produce: $('tab-produce'), dj: $('tab-dj'), library: $('tab-library')};
let currentTab: Tab = 'dj';
function showTab(tab: Tab, focus = false): void {
  currentTab = tab;
  for (const [key, el] of Object.entries(tabs) as [Tab, HTMLButtonElement][]) {
    const on = key === tab;
    el.setAttribute('aria-selected', String(on)); el.tabIndex = on ? 0 : -1;
    $(`panel-${key}`).hidden = !on;
  }
  if (focus) tabs[tab].focus();
  const url = new URL(location.href); url.searchParams.set('tab', tab); history.replaceState(null, '', url);
  if (tab === 'library') void refreshLibrary();
  if (tab !== 'dj') void refreshTakes();
}
const order: Tab[] = ['produce', 'dj', 'library'];
for (const tab of order) {
  tabs[tab].addEventListener('click', () => showTab(tab));
  tabs[tab].addEventListener('keydown', event => {
    const step = event.key === 'ArrowRight' ? 1 : event.key === 'ArrowLeft' ? -1 : 0;
    if (step) { event.preventDefault(); showTab(order[(order.indexOf(tab) + step + 3) % 3]!, true); }
  });
}

// ---------- top bar ----------
const packInput = $<HTMLSelectElement>('pack');
const volume = $<HTMLInputElement>('master-volume');
const muteButton = $<HTMLButtonElement>('master-mute');
packInput.addEventListener('change', () => {
  const url = new URL(location.href); url.searchParams.set('pack', packInput.value); url.searchParams.set('tab', currentTab);
  location.assign(url.href);
});
volume.addEventListener('input', () => {
  const v = Number(volume.value); dj?.setVolume(v); sampler?.setVolume(v); preview.volume = v;
});
muteButton.addEventListener('click', () => {
  muted = !muted; sampler?.setMuted(muted); preview.muted = muted;
  if (dj) void send({type: 'transport', action: muted ? 'mute' : 'unmute'});
  renderTop();
});
function renderTop(): void {
  muteButton.setAttribute('aria-pressed', String(muted)); muteButton.textContent = muted ? 'Muted' : 'Mute';
  packInput.disabled = !packChoice || djActive() || samplerActive();
}

// ---------- DJ booth ----------
type Action = ControlRequest extends infer R ? R extends ControlRequest ? Omit<R, 'schemaVersion' | 'commandId' | 'expectedRevision' | 'source'> : never : never;
const djError = $('dj-error');
function getDj(): DeterministicDj {
  if (dj) return dj;
  if (!loaded) throw new Error('The pack is still loading.');
  const route = loaded.pack.routes[0];
  if (!route) throw new Error('This pack has no A → B route.');
  dj = new DeterministicDj(new SmallPlayer(new AudioContext(), loaded, route.id), loaded, 'explore', {handoff: handoffMode});
  dj.setVolume(Number(volume.value)); djNeedsMute = muted;
  return dj;
}
const makeRequest = (c: DeterministicDj, action: Action): ControlRequest =>
  ({...action, schemaVersion: CONTROL_VERSION, commandId: crypto.randomUUID(), expectedRevision: c.snapshot().control.revision, source: 'manual'}) as ControlRequest;
async function send(action: Action): Promise<void> {
  djError.textContent = '';
  try {
    const controller = getDj();
    const isPlay = action.type === 'transport' && action.action === 'play';
    if (isPlay) await takeOver('dj');
    if (djNeedsMute) { djNeedsMute = false; if (!(action.type === 'transport' && action.action === 'mute')) await controller.request(makeRequest(controller, {type: 'transport', action: 'mute'})); }
    const owner = isPlay ? acquireOwnership() : undefined;
    let result = await controller.request(makeRequest(controller, action), owner);
    if (result.receipt.status === 'rejected' && result.receipt.code === 'stale-revision') {
      result = await controller.request(makeRequest(controller, action), owner);
    }
    if (dj !== controller) return;
    if (result.execution.status === 'failed' || result.receipt.status === 'rejected') djError.textContent = result.execution.reason;
    if (isPlay && result.execution.status !== 'failed') pauseReason = '';
  } catch (error) { djError.textContent = message(error); }
  finally { renderDj(); }
}
$('dj-play').addEventListener('click', () => { void send({type: 'transport', action: 'play'}); });
$('dj-pause').addEventListener('click', () => {
  void send({type: 'transport', action: dj?.snapshot().player.state === 'paused' ? 'play' : 'pause'});
});
$('dj-stop').addEventListener('click', () => { pauseReason = ''; void send({type: 'transport', action: 'stop'}); });
$('dj-next').addEventListener('click', () => { void send({type: 'nextSong'}); });
$('dj-cancel').addEventListener('click', () => { void send({type: 'cancelNext'}); });
$('dj-hold').addEventListener('click', () => { void send({type: 'hold', enabled: !dj?.snapshot().control.requested.hold}); });
$('queue-a').addEventListener('click', () => { if (deckAssets) void send({type: 'queueTrack', trackId: deckAssets.a.id}); });
$('queue-b').addEventListener('click', () => { if (deckAssets) void send({type: 'queueTrack', trackId: deckAssets.b.id}); });
for (const pad of Array.from(document.querySelectorAll<HTMLButtonElement>('#state-pads button'))) {
  pad.addEventListener('click', () => { void send({type: 'setState', state: pad.dataset.state as MusicState}); });
}
function setMode(mode: DjHandoff): void { handoffMode = mode; dj?.setHandoff(mode); renderDj(); }
$('mode-direct').addEventListener('click', () => setMode('direct'));
$('mode-hybrid').addEventListener('click', () => setMode('hybrid'));

function titleOf(id: string | null): string {
  if (id === null) return 'Nothing';
  if (loaded?.pack.recipes.some(r => r.id === id)) return 'Bridge pattern';
  return loaded?.pack.assets.find(a => a.id === id)?.title ?? id;
}
function computePeaks(asset: AudioAsset, buckets = 400): Float32Array | null {
  const bytes = loaded?.files.get(asset.file.path);
  if (!bytes) return null;
  try {
    const wav = decodeWav(bytes), out = new Float32Array(buckets), per = Math.max(1, Math.floor(wav.frames / buckets));
    for (let b = 0; b < buckets; b++) {
      let max = 0;
      for (let i = b * per, end = Math.min(wav.frames, i + per); i < end; i += 4) {
        for (const ch of wav.samples) { const v = Math.abs(ch[i] ?? 0); if (v > max) max = v; }
      }
      out[b] = max;
    }
    let top = 0; for (const v of out) top = Math.max(top, v);
    if (top > 0) for (let b = 0; b < buckets; b++) out[b] = out[b]! / top;
    return out;
  } catch { return null; }
}
function drawWave(canvas: HTMLCanvasElement, data: Float32Array | null, color: string, progress: number | null, live: boolean): void {
  const ctx = canvas.getContext('2d'); if (!ctx) return;
  const w = canvas.width, h = canvas.height, mid = h / 2;
  ctx.clearRect(0, 0, w, h);
  ctx.fillStyle = '#1a1f26'; for (let x = 0; x < w; x += w / 8) ctx.fillRect(Math.round(x), 0, 1, h);
  if (!data) { ctx.fillStyle = '#4a515c'; ctx.font = '13px system-ui'; ctx.fillText('No waveform', 12, mid + 4); return; }
  const bar = w / data.length, cut = progress === null ? -1 : progress * w;
  for (let i = 0; i < data.length; i++) {
    const x = i * bar, amp = Math.max(1, data[i]! * (mid - 6));
    ctx.fillStyle = x < cut ? color : live ? `${color}88` : `${color}55`;
    ctx.fillRect(x, mid - amp, Math.max(1, bar - 1), amp * 2);
  }
  if (progress !== null) { ctx.fillStyle = '#ffffff'; ctx.fillRect(Math.round(cut), 0, 2, h); }
}
/** Seconds into the asset for its current voice, from the audio clock (not measured output). */
function deckPosition(asset: AudioAsset): number | null {
  const player = dj?.snapshot().player;
  if (!player) return null;
  const voice = player.voices.find(v => v.source.id === asset.id && v.start.engineGeneration === player.engineGeneration);
  if (!voice) return null;
  const rate = player.sampleRate, duration = asset.file.frames / asset.file.sample_rate;
  const offset = duration - (voice.endFrame - voice.start.frame) / rate;
  return Math.min(duration, Math.max(offset, offset + (player.currentFrame - voice.start.frame) / rate));
}
const bridgeText = {'lead-in': 'Bridge coming in — A fades out over one bar', bridge: 'Bridge pattern playing between the songs',
  tail: 'B is in — the bridge fades away', complete: 'Mix complete'} as const;
let lastQueueKey = '';
function renderDj(): void {
  const snap = dj?.snapshot(), player = snap?.player, control = snap?.control, state = player?.state ?? 'idle';
  const running = ACTIVE.includes(state), ready = !!loaded && !!deckAssets;
  for (const id of ['dj-play', 'dj-stop', 'dj-next', 'dj-hold', 'queue-a', 'queue-b', 'mode-direct', 'mode-hybrid']) $<HTMLButtonElement>(id).disabled = !ready;
  const play = $<HTMLButtonElement>('dj-play'), pause = $<HTMLButtonElement>('dj-pause');
  play.disabled = !ready || (running && state !== 'paused');
  play.classList.toggle('is-on', state === 'playing');
  pause.disabled = !ready || !running; pause.textContent = state === 'paused' ? '▶' : '❚❚';
  pause.setAttribute('aria-label', state === 'paused' ? 'Resume' : 'Pause');
  $<HTMLButtonElement>('dj-cancel').disabled = !ready || !snap?.pending || snap.pending.phase !== 'scheduled'
    || (player?.handoff != null && player.handoff.phase !== 'scheduled');
  const hold = control?.requested.hold ?? false;
  $('dj-hold').setAttribute('aria-pressed', String(hold)); setText('dj-hold', hold ? 'Hold on' : 'Hold');
  $('mode-direct').setAttribute('aria-checked', String(handoffMode === 'direct'));
  $('mode-hybrid').setAttribute('aria-checked', String(handoffMode === 'hybrid'));
  const requestedState = control?.requested.state ?? 'explore';
  for (const pad of Array.from(document.querySelectorAll<HTMLButtonElement>('#state-pads button'))) {
    pad.disabled = !ready; pad.setAttribute('aria-pressed', String(pad.dataset.state === requestedState));
  }
  // decks
  if (deckAssets) {
    for (const side of ['a', 'b'] as const) {
      const asset = deckAssets[side], live = !!player?.now.includes(asset.id) && running;
      const pos = deckPosition(asset), duration = asset.file.frames / asset.file.sample_rate;
      $(`deck-${side}`).classList.toggle('is-live', live);
      drawWave($<HTMLCanvasElement>(`deck-${side}-wave`), peaks.get(asset.id) ?? null, side === 'a' ? '#22d3ee' : '#f59e0b', pos === null ? null : pos / duration, live);
      setText(`deck-${side}-time`, clock(pos ?? 0));
      setText(`deck-${side}-remain`, `-${clock(duration - (pos ?? 0))}`);
    }
  }
  // crossfader
  let knob = 0;
  const hybrid = player?.handoff && !['scheduled', 'complete'].includes(player.handoff.phase);
  if (player && deckAssets) {
    const hasA = player.now.includes(deckAssets.a.id), hasB = player.now.includes(deckAssets.b.id);
    if (hybrid) knob = player.handoff!.phase === 'lead-in' ? 0.3 : player.handoff!.phase === 'bridge' ? 0.5 : 0.75;
    else if (hasA && hasB && player.transitionAt && player.transitionEnd) {
      const span = player.transitionEnd.frame - player.transitionAt.frame;
      const p = span > 0 ? Math.min(1, Math.max(0, (player.currentFrame - player.transitionAt.frame) / span)) : 0.5;
      const aFirst = (player.voices.find(v => v.source.id === deckAssets!.a.id)?.start.frame ?? 0) <= (player.voices.find(v => v.source.id === deckAssets!.b.id)?.start.frame ?? 0);
      knob = aFirst ? p : 1 - p;
    } else knob = hasB && !hasA ? 1 : 0;
  }
  $('xf-knob').style.left = `${knob * 100}%`;
  $('bridge-lamp').classList.toggle('is-on', !!hybrid);
  const status = state === 'loading' ? 'Getting ready…' : state === 'closed' ? 'Player closed — reload the page.'
    : state === 'ended' ? 'Set finished. Press ▶ to start again.' : state === 'paused' ? pauseReason || 'Paused'
    : player?.handoff && player.handoff.phase !== 'scheduled' ? bridgeText[player.handoff.phase]
    : player?.transition === 'mixing' ? 'Crossfading A → B' : player?.transition === 'complete' ? 'Mix complete'
    : player?.transition === 'scheduled' && player.transitionInSeconds !== null ? `Mix starts in ${player.transitionInSeconds.toFixed(1)}s (on the next phrase)`
    : state === 'playing' ? 'Playing — press “Mix to next” when you want B' : state === 'scheduled' ? 'Starting on the beat…'
    : ready ? 'Ready — press ▶ to start Deck A' : 'Loading…';
  setText('mix-status', status);
  setText('dj-now', player?.now.length && running ? player.now.map(titleOf).join(' + ') : 'Nothing');
  setText('dj-next-title', player?.next ? titleOf(player.next) : 'Nothing scheduled');
  setText('dj-requested', `${requestedState}${control?.requested.genreId ? ` · ${control.requested.genreId}` : ''}${hold ? ' · held' : ''}`);
  // queue
  const queue = control?.queue ?? [], list = $('dj-queue');
  const key = queue.map(e => `${e.commandId}:${e.trackId}`).join('|');
  if (key !== lastQueueKey || !list.childElementCount) {
    lastQueueKey = key; list.replaceChildren();
    if (!queue.length) list.append(make('li', {className: 'empty', textContent: 'Nothing queued. Queue a deck, or press Mix to next.'}));
    for (const [i, entry] of queue.entries()) {
      list.append(make('li', {}, make('span', {textContent: `${i + 1}. ${titleOf(entry.trackId)}`}),
        button('Remove', () => { void send({type: 'cancelQueue', queueCommandId: entry.commandId}); }, 'chip', `Remove ${titleOf(entry.trackId)} from the queue`)));
    }
  }
}

// ---------- pattern sampler ----------
const seedInput = $<HTMLInputElement>('seed');
let samplerState: S01PhraseState = 'explore';
let plan: ProceduralPlan | null = null, activePlan: ProceduralPlan | null = null;
const samplerError = $('sampler-error');
/** A one-off note (saved, opened) shown while stopped until the selection or transport changes. */
let samplerNote = '';
function preparePlan(): void {
  plan = null; samplerError.textContent = ''; samplerNote = '';
  if (!loaded) return;
  try {
    if (!/^\d{1,10}$/.test(seedInput.value) || Number(seedInput.value) > 0xffffffff) throw new Error('Seed must be a whole number from 0 to 4294967295.');
    const recipe = loaded.pack.recipes[0];
    if (!recipe) throw new Error('This pack has no pattern recipe.');
    plan = compilePhrase(loaded.pack, {recipe: {id: recipe.id, revision: recipe.revision}, seed: Number(seedInput.value), state: samplerState, allowFixtures: true});
  } catch (error) { samplerError.textContent = message(error); }
  renderSampler();
}
function setSamplerState(next: S01PhraseState): void { samplerState = next; preparePlan(); }
$('s-explore').addEventListener('click', () => setSamplerState('explore'));
$('s-drive').addEventListener('click', () => setSamplerState('drive'));
seedInput.addEventListener('input', preparePlan);
$('dice').addEventListener('click', () => { seedInput.value = String(crypto.getRandomValues(new Uint32Array(1))[0]); preparePlan(); });
function getSampler(): SmallPlayer {
  if (sampler) return sampler;
  if (!loaded) throw new Error('The pack is still loading.');
  const route = loaded.pack.routes[0];
  if (!route) throw new Error('This pack has no playable route.');
  const context = new AudioContext();
  try { sampler = new SmallPlayer(context, loaded, route.id); } catch (error) { void context.close().catch(() => undefined); throw error; }
  sampler.setVolume(Number(volume.value)); sampler.setMuted(muted);
  return sampler;
}
$('s-play').addEventListener('click', () => { void (async () => {
  if (!plan) return;
  samplerError.textContent = ''; samplerNote = '';
  const selected = plan;
  try {
    const owner = getSampler();
    if (owner.snapshot().state === 'paused') { await owner.resume(acquireOwnership()); return; }
    await takeOver('sampler');
    activePlan = selected;
    await owner.playProcedural(selected, acquireOwnership());
  } catch (error) { samplerError.textContent = message(error); }
  finally { renderSampler(); }
})(); });
$('s-stop').addEventListener('click', () => { sampler?.stop(); activePlan = null; renderSampler(); });
$('s-save').addEventListener('click', () => { void saveVibe(); });

const ROWS: {role: string; color: string}[] = [
  {role: 'harmony', color: '#a78bfa'}, {role: 'bass', color: '#f59e0b'}, {role: 'percussion', color: '#34d399'}, {role: 'drum', color: '#22d3ee'}];
function drawGrid(target: ProceduralPlan | null, progress: number | null): void {
  const canvas = $<HTMLCanvasElement>('grid'), ctx = canvas.getContext('2d'); if (!ctx) return;
  const w = canvas.width, h = canvas.height, left = 0, rowH = h / ROWS.length, steps = 128, cell = (w - left) / steps;
  ctx.clearRect(0, 0, w, h);
  for (let s = 0; s < steps; s++) {
    ctx.fillStyle = s % 16 === 0 ? '#232933' : s % 4 === 0 ? '#191d24' : '#141820';
    ctx.fillRect(left + s * cell, 0, 1, h);
  }
  for (let r = 1; r < ROWS.length; r++) { ctx.fillStyle = '#1d222a'; ctx.fillRect(0, r * rowH, w, 1); }
  if (target) {
    for (const event of target.events) {
      const row = ROWS.findIndex(x => x.role === event.role); if (row < 0) continue;
      const step = Math.round(event.atQuarters * 4);
      ctx.globalAlpha = 0.35 + 0.65 * Math.min(1, event.gain);
      ctx.fillStyle = ROWS[row]!.color;
      ctx.fillRect(left + step * cell + 1, row * rowH + 5, Math.max(2, cell * 2 - 2), rowH - 10);
    }
    ctx.globalAlpha = 1;
  }
  ctx.fillStyle = '#5b6370'; ctx.font = '10px system-ui';
  ROWS.forEach((x, r) => {
    const label = x.role.toUpperCase(); ctx.fillStyle = '#0d1014cc'; ctx.fillRect(2, r * rowH + 3, ctx.measureText(label).width + 6, 12);
    ctx.fillStyle = '#8b93a1'; ctx.fillText(label, 5, r * rowH + 12);
  });
  if (progress !== null) { ctx.fillStyle = '#ffffff'; ctx.fillRect(Math.round(progress * w), 0, 2, h); }
}
function renderSampler(): void {
  const snap = sampler?.snapshot(), state = snap?.state ?? 'idle', running = ACTIVE.includes(state);
  $<HTMLButtonElement>('s-play').disabled = !plan || (running && state !== 'paused') || state === 'closed';
  $('s-play').classList.toggle('is-on', state === 'playing');
  $<HTMLButtonElement>('s-stop').disabled = !running;
  $<HTMLButtonElement>('s-save').disabled = !plan;
  seedInput.disabled = running; $<HTMLButtonElement>('dice').disabled = running || !loaded;
  for (const [id, s] of [['s-explore', 'explore'], ['s-drive', 'drive']] as const) {
    $(id).setAttribute('aria-checked', String(samplerState === s)); $<HTMLButtonElement>(id).disabled = running || !loaded;
  }
  const shown = running && activePlan ? activePlan : plan;
  drawGrid(shown, running && snap?.durationSeconds ? snap.elapsedSeconds / snap.durationSeconds : null);
  setText('sampler-status', state === 'playing' ? `Playing seed ${activePlan?.seed} · ${activePlan?.state} · ${(snap?.elapsedSeconds ?? 0).toFixed(1)}s of ${(snap?.durationSeconds ?? 0).toFixed(1)}s`
    : state === 'loading' || state === 'scheduled' ? 'Getting ready…' : state === 'paused' ? 'Paused' : state === 'ended' ? 'Pattern finished. Press ▶ to hear it again or roll a new seed.'
    : samplerNote ? samplerNote : plan ? `Seed ${plan.seed} · ${plan.state} · ${plan.events.length} hits ready. Press ▶ to hear it.` : loaded ? 'Pick a valid seed.' : 'Loading…');
}

// ---------- library ----------
let library: MusicLibrary | null = null;
let librarySnapshot: MusicLibrarySnapshot | null = null;
const libError = $('lib-error');
async function getLibrary(): Promise<MusicLibrary> {
  if (!library) library = new MusicLibrary(await IndexedDbLibraryStorage.open());
  return library;
}
const safeId = (raw: string): string => raw.toLowerCase().replace(/[^a-z0-9._-]+/g, '-').replace(/^[^a-z0-9]+/, '').slice(0, 96);
async function saveVibe(): Promise<void> {
  if (!loaded || !plan) return;
  samplerError.textContent = '';
  const pack = loaded.pack, recipe = pack.recipes[0]!;
  try {
    const lib = await getLibrary();
    let snap = await lib.read();
    if (!snap.catalogue.some(e => e.pack.id === pack.id && e.pack.revision === pack.revision)) snap = await lib.registerPack(pack, snap.revision);
    const replay = await captureRecipeReplay(pack, {recipe: {id: recipe.id, revision: recipe.revision}, seed: plan.seed, state: plan.state, allowFixtures: true});
    const id = safeId(`${pack.id}-${pack.revision}-seed-${plan.seed}-${plan.state}`);
    librarySnapshot = await lib.saveVibe({id, label: `Seed ${plan.seed} · ${plan.state === 'drive' ? 'Drive' : 'Explore'} · ${packChoice ? PACKS[packChoice].label : pack.id}`, replay}, snap.revision);
    samplerNote = `Saved to Library as “Seed ${plan.seed} · ${plan.state}”.`; renderSampler();
    renderVibes();
  } catch (error) { samplerError.textContent = `Couldn’t save: ${message(error)}`; }
}
async function refreshLibrary(): Promise<void> {
  try { librarySnapshot = await (await getLibrary()).read(); libError.textContent = ''; }
  catch (error) { libError.textContent = message(error); }
  renderVibes();
}
function renderVibes(): void {
  const list = $('lib-vibes'); list.replaceChildren();
  const vibes = librarySnapshot?.vibes ?? [];
  if (!vibes.length) { list.append(make('li', {className: 'empty', textContent: 'Nothing saved yet. Press ♥ in Produce.'})); return; }
  for (const vibe of vibes) {
    const samePack = !!loaded && vibe.replay.pack.id === loaded.pack.id && vibe.replay.pack.revision === loaded.pack.revision;
    const restore = button('Open', () => { void restoreVibe(vibe.id); }, 'chip', `Open ${vibe.label} in Produce`);
    restore.disabled = !samePack;
    if (!samePack) restore.title = 'Saved with another pack — switch packs in the top bar first.';
    list.append(make('li', {}, make('span', {textContent: vibe.label}),
      make('span', {className: 'tag', textContent: samePack ? 'this pack' : `pack ${vibe.replay.pack.id}`}), restore,
      button('Delete', () => { void removeVibe(vibe.id); }, 'chip', `Delete ${vibe.label}`)));
  }
}
async function restoreVibe(id: string): Promise<void> {
  if (!loaded) return;
  libError.textContent = '';
  try {
    const restored = await (await getLibrary()).resolveVibe(id, loaded.pack, {allowFixtures: true});
    if (samplerActive()) sampler!.stop();
    seedInput.value = String(restored.seed); samplerState = restored.state; plan = restored; activePlan = null;
    samplerNote = `Opened seed ${restored.seed} · ${restored.state}. Stopped — press ▶ to hear it.`;
    showTab('produce'); renderSampler();
  } catch (error) { libError.textContent = message(error); }
}
async function removeVibe(id: string): Promise<void> {
  try {
    const lib = await getLibrary(), snap = await lib.read();
    librarySnapshot = await lib.removeVibe(id, snap.revision);
  } catch (error) { libError.textContent = message(error); }
  renderVibes();
}
function renderTracks(): void {
  const body = $('lib-tracks'); body.replaceChildren();
  for (const asset of loaded?.pack.assets ?? []) {
    const rec = asset.source_kind === 'recording';
    body.append(make('tr', {},
      make('td', {textContent: asset.title}),
      make('td', {}, make('span', {className: `tag ${rec ? 'rec' : 'smp'}`, textContent: rec ? 'Song' : 'Sample'})),
      make('td', {textContent: asset.timing ? String(asset.timing.bpm) : '—'}),
      make('td', {textContent: asset.key ?? '—'}),
      make('td', {textContent: clock(asset.file.frames / asset.file.sample_rate)}),
      make('td', {}, make('span', {className: 'tag', textContent: asset.eligibility}))));
  }
}

// ---------- AI generator (Music Studio service) ----------
interface Take { id: string; title?: string; description?: string; duration_seconds?: number; bpm?: number; key?: string; starred?: boolean; rejected?: boolean; rating?: Rating | null; created_at?: string; }
type Rating = 'love' | 'like' | 'dislike';
const RATINGS: ReadonlyArray<[Rating, string, string]> = [['love', '❤️', 'Love'], ['like', '👍', 'Like'], ['dislike', '👎', 'Nope']];
/** Music Studio's rating; older servers only sent starred (= love) and rejected (= dislike). */
function ratingOf(take: Take): Rating | null { return take.rating ?? (take.starred ? 'love' : take.rejected ? 'dislike' : null); }
let engine: 'offline' | 'stopped' | 'loading' | 'ready' | 'busy' = 'offline';
let takes: Take[] = [];
let jobId: string | null = null;
let jobStage = '';
const genError = $('gen-error');
async function api<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(`${STUDIO_API}${path}`, {...init, headers: {'content-type': 'application/json', ...(init?.headers ?? {})}});
  const body = await response.json().catch(() => ({})) as T & {error?: string};
  if (!response.ok) throw new Error(body.error ?? `Music Studio answered ${response.status}`);
  return body;
}
async function pollHealth(): Promise<void> {
  const before = engine;
  try {
    const health = await api<{engine: string}>('/api/health', {signal: AbortSignal.timeout(2500)});
    engine = (['stopped', 'loading', 'ready', 'busy'].includes(health.engine) ? health.engine : 'stopped') as typeof engine;
  } catch { engine = 'offline'; }
  if (before === 'offline' && engine !== 'offline') void refreshTakes();
  renderGenerator();
}
async function refreshTakes(): Promise<void> {
  if (engine === 'offline') { renderTakes(); return; }
  try {
    const body = await api<Take[] | {takes: Take[]}>('/api/takes');
    takes = (Array.isArray(body) ? body : body.takes ?? []).filter(t => t && typeof t.id === 'string');
  } catch (error) { genError.textContent = message(error); }
  renderTakes();
}
$('gen-engine').addEventListener('click', () => { void (async () => {
  genError.textContent = '';
  try { await api('/api/engine/start', {method: 'POST', body: '{}'}); engine = 'loading'; } catch (error) { genError.textContent = message(error); }
  renderGenerator();
})(); });
$('gen-form').addEventListener('submit', event => { event.preventDefault(); void generate(); });
async function generate(): Promise<void> {
  genError.textContent = '';
  const body = {
    description: $<HTMLTextAreaElement>('gen-description').value.trim(),
    bpm: Number($<HTMLInputElement>('gen-bpm').value), key: $<HTMLSelectElement>('gen-key').value,
    duration_seconds: Number($<HTMLSelectElement>('gen-length').value), instrumental: $<HTMLInputElement>('gen-instrumental').checked,
    variations: Number($<HTMLSelectElement>('gen-variations').value),
    thinking: !$<HTMLInputElement>('gen-quick').checked,
  };
  if (!body.description) { genError.textContent = 'Describe the music first.'; return; }
  try {
    const job = await api<{job_id: string}>('/api/generate', {method: 'POST', body: JSON.stringify(body)});
    jobId = job.job_id; jobStage = 'Queued'; engine = 'busy'; renderGenerator();
    for (;;) {
      await new Promise(r => setTimeout(r, 1500));
      const status = await api<{status: string; progress?: number; error?: string; stage?: string}>(`/api/jobs/${encodeURIComponent(job.job_id)}`);
      if (status.stage) { jobStage = status.stage; renderGenerator(); }
      $('gen-progress-bar').style.width = `${Math.round((status.progress ?? 0) * 100)}%`;
      if (status.status === 'failed' || status.status === 'error') throw new Error(status.error ?? 'Generation failed.');
      if (status.status === 'done' || status.status === 'complete' || status.status === 'completed') break;
    }
    await refreshTakes();
  } catch (error) { genError.textContent = message(error); }
  finally { jobId = null; jobStage = ''; void pollHealth(); }
}
function renderGenerator(): void {
  const light = $('gen-light');
  light.className = `light ${engine === 'offline' ? 'off' : engine === 'ready' ? 'ok' : engine === 'stopped' ? '' : 'busy'}`;
  setText('gen-status', engine === 'offline' ? 'Music Studio not running' : jobId ? (jobStage || 'Generating…') : engine === 'stopped' ? 'Engine off — Generate starts it (about 1½ minutes the first time)' : engine === 'loading' ? 'Engine warming up (about 1½ minutes)…' : engine === 'busy' ? 'Busy with another job…' : 'Ready');
  $('gen-offline').hidden = engine !== 'offline';
  const engineButton = $<HTMLButtonElement>('gen-engine'); engineButton.hidden = engine !== 'stopped';
  const canGenerate = (engine === 'ready' || engine === 'stopped') && jobId === null;
  const form = $<HTMLFormElement>('gen-form'); form.classList.toggle('is-disabled', engine === 'offline');
  $<HTMLButtonElement>('gen-go').disabled = !canGenerate;
  setText('gen-go', jobId ? 'Generating…' : 'Generate');
  $('gen-progress').hidden = jobId === null;
  $('lib-takes-hint').hidden = engine !== 'offline';
}
function stopPreview(): void { preview.pause(); preview.removeAttribute('src'); previewing = null; renderTakes(); }
async function togglePreview(take: Take): Promise<void> {
  if (previewing === take.id) { stopPreview(); return; }
  await takeOver('preview');
  preview.src = `${STUDIO_API}/api/takes/${encodeURIComponent(take.id)}/audio`;
  preview.volume = Number(volume.value); preview.muted = muted; previewing = take.id;
  try { await preview.play(); } catch (error) { genError.textContent = message(error); previewing = null; }
  renderTakes();
}
preview.addEventListener('ended', () => { previewing = null; renderTakes(); });
async function patchTake(take: Take, change: Partial<Take>): Promise<void> {
  try { Object.assign(take, await api<Take>(`/api/takes/${encodeURIComponent(take.id)}`, {method: 'PATCH', body: JSON.stringify(change)}), change); }
  catch (error) { genError.textContent = message(error); }
  renderTakes();
}
async function exportTake(take: Take, note: HTMLElement): Promise<void> {
  note.textContent = 'Exporting…';
  try { const r = await api<{path: string}>(`/api/takes/${encodeURIComponent(take.id)}/export`, {method: 'POST', body: JSON.stringify({target: 'eutonos'})}); note.textContent = `Saved: ${r.path}`; }
  catch (error) { note.textContent = `Export failed: ${message(error)}`; }
}
function takeRow(take: Take, full: boolean): HTMLLIElement {
  const meta = [take.duration_seconds ? `${Math.round(take.duration_seconds)}s` : '', take.bpm ? `${take.bpm} BPM` : '', take.key ?? ''].filter(Boolean).join(' · ');
  const rating = ratingOf(take);
  const row = make('li', {className: `take${rating ? ' is-' + rating : ''}`},
    button(previewing === take.id ? '■' : '▶', () => { void togglePreview(take); }, 'chip', `${previewing === take.id ? 'Stop' : 'Preview'} ${take.title ?? take.id}`),
    make('span', {className: 'take-title', textContent: take.title ?? take.description ?? take.id, title: take.description ?? ''}),
    make('span', {className: 'take-meta', textContent: meta}));
  for (const [value, icon, label] of RATINGS) {
    const on = rating === value;
    const chip = button(icon, () => { void patchTake(take, {rating: on ? null : value}); }, `chip rate${on ? ' on' : ''}`, `${label} ${take.title ?? take.id}`);
    chip.setAttribute('aria-pressed', String(on));
    row.append(chip);
  }
  if (full) {
    const note = make('span', {className: 'take-meta'});
    row.append(button('Send to EUTONOS', () => { void exportTake(take, note); }, 'chip', `Export ${take.title ?? take.id} for EUTONOS`), note);
  }
  return row;
}
function renderTakes(): void {
  const recent = $('gen-takes'), all = $('lib-takes');
  recent.replaceChildren(...takes.filter(t => ratingOf(t) !== 'dislike').slice(0, 4).map(t => takeRow(t, false)));
  all.replaceChildren(...(engine === 'offline' ? [] : takes.length ? takes.map(t => takeRow(t, true)) : [make('li', {className: 'empty', textContent: 'No takes yet. Generate one in Produce.'})]));
}

// ---------- lifecycle ----------
document.addEventListener('visibilitychange', () => {
  if (!document.hidden) return;
  if (dj && ['loading', 'scheduled', 'playing'].includes(dj.snapshot().player.state)) {
    pauseReason = 'Paused because the tab was hidden. Press ▶ to continue.'; void send({type: 'transport', action: 'pause'});
  }
  if (sampler && ['loading', 'scheduled', 'playing'].includes(sampler.snapshot().state)) void sampler.pause().catch(() => undefined);
  if (previewing) preview.pause();
});
window.addEventListener('pagehide', () => {
  const a = dj, b = sampler; dj = null; sampler = null;
  void a?.dispose().catch(() => undefined); void b?.dispose().catch(() => undefined);
  stopPreview(); releaseOwnership();
});
function tick(): void {
  renderTop();
  if (currentTab === 'dj') renderDj();
  if (currentTab === 'produce') renderSampler();
  const idle = (s: string | undefined) => !s || ['idle', 'ended', 'closed'].includes(s);
  if (ownership && idle(dj?.snapshot().player.state) && idle(sampler?.snapshot().state)) releaseOwnership();
}
function frame(): void { tick(); requestAnimationFrame(frame); }
// Some embedded or occluded windows stop animation frames; keep the clock reconciling anyway.
setInterval(tick, 250);
async function initialize(): Promise<void> {
  const tab = params.get('tab');
  showTab(tab === 'produce' || tab === 'library' ? tab : 'dj');
  try {
    if (!window.isSecureContext || !window.AudioContext || !navigator.locks || !crypto.subtle) throw new Error('Open this page on http://127.0.0.1 in a current browser.');
    if (!packChoice) throw new Error('Unknown pack. Choose one in the top bar.');
    packInput.value = packChoice;
    const candidate = await loadBrowserPack(new URL(PACKS[packChoice].manifest, location.href), true);
    const route = candidate.pack.routes[0];
    const find = (ref: {id: string; revision: number}) => candidate.pack.assets.find(a => a.id === ref.id && a.revision === ref.revision);
    const a = route && find(route.from), b = route && find(route.to);
    if (!a?.timing || !b?.timing) throw new Error('This pack needs one A → B route between two timed songs.');
    loaded = candidate; deckAssets = {a, b};
    for (const [side, asset] of [['a', a], ['b', b]] as const) {
      setText(`deck-${side}-title`, asset.title);
      setText(`deck-${side}-meta`, `${asset.timing!.bpm} BPM · ${asset.key ?? 'no key'} · ${asset.timing!.bars} bars`);
      peaks.set(asset.id, computePeaks(asset));
    }
    setText('sampler-sub', `${PACKS[packChoice].label} · 8 bars · 120 BPM · A minor`);
    setText('global-status', `${PACKS[packChoice].label} loaded · ${candidate.pack.assets.length} sounds · ${a.timing.bpm} BPM · ${a.key ?? 'no key'}`);
    renderTracks(); preparePlan();
  } catch (error) {
    if (!packChoice) packInput.selectedIndex = -1;
    setText('global-status', `Couldn’t load the pack: ${message(error)}`);
    djError.textContent = message(error);
  }
  renderDj(); renderSampler(); renderGenerator(); void refreshLibrary();
  void pollHealth(); setInterval(() => { if (!document.hidden) void pollHealth(); }, 4000);
}
void initialize();
requestAnimationFrame(frame);
