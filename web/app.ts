import {loadBrowserPack, type LoadedBrowserPack} from '../src/browser-pack.js';
import {SmallPlayer} from '../src/player.js';

function element<T extends HTMLElement>(id: string): T {
  const found = document.getElementById(id);
  if (!found) throw new Error(`Missing UI element: ${id}`);
  return found as T;
}
const buttons = Object.fromEntries(['play-a', 'play-b', 'pause', 'stop', 'transition', 'mute']
  .map(id => [id, element<HTMLButtonElement>(id)])) as Record<string, HTMLButtonElement>;
const volume = element<HTMLInputElement>('volume');
const progress = element<HTMLProgressElement>('progress');
const errorBox = element('error');
let loaded: LoadedBrowserPack | null = null;
let player: SmallPlayer | null = null;
let uiOperation = 0;
let muted = false;
let pauseReason = '';
let ownership: Promise<void> | null = null;
let releaseLock: (() => void) | null = null;
let leaseEpoch = 0;

function message(error: unknown): string { return error instanceof Error ? error.message : String(error); }
function showError(error: unknown): void { errorBox.textContent = message(error); }
function releaseOwnership(): void {
  ++leaseEpoch;
  releaseLock?.();
  releaseLock = null;
  ownership = null;
}
function acquireOwnership(): Promise<void> {
  if (ownership) return ownership;
  const epoch = leaseEpoch;
  ownership = new Promise<void>((resolve, reject) => {
    // A same-origin tab owns the demo until Stop/end/close. No takeover or polling.
    void navigator.locks.request('eutonos-music-s02-playback', {ifAvailable: true}, lock => {
      if (epoch !== leaseEpoch) { reject(new Error('Playback was cancelled.')); return; }
      if (!lock) { reject(new Error('Another tab owns playback. Press Stop there, then Play here.')); return; }
      return new Promise<void>(release => { releaseLock = release; resolve(); });
    }).catch(reject);
  }).catch(error => { if (epoch === leaseEpoch) ownership = null; throw error; });
  return ownership;
}

function getPlayer(): SmallPlayer {
  if (player) return player;
  if (!loaded) throw new Error('The fixture pack is still loading.');
  const route = loaded.pack.routes[0];
  if (!route) throw new Error('The fixture pack has no A → B route.');
  player = new SmallPlayer(new AudioContext(), loaded, route.id);
  player.setVolume(Number(volume.value));
  player.setMuted(muted);
  return player;
}

async function play(selection: 'a' | 'b'): Promise<void> {
  const operation = ++uiOperation;
  errorBox.textContent = '';
  pauseReason = '';
  try {
    const active = getPlayer();
    const action = active.play(selection, acquireOwnership());
    render();
    await action;
  } catch (error) {
    if (operation === uiOperation) { releaseOwnership(); showError(error); }
  }
  render();
}

buttons['play-a']!.addEventListener('click', () => { void play('a'); });
buttons['play-b']!.addEventListener('click', () => { void play('b'); });
buttons.pause!.addEventListener('click', () => {
  const operation = ++uiOperation;
  errorBox.textContent = '';
  pauseReason = '';
  const active = player;
  if (!active) return;
  const action = active.snapshot().state === 'paused' ? active.resume(acquireOwnership()) : active.pause();
  render();
  void action.catch(error => {
    if (operation !== uiOperation) return;
    if (['idle', 'closed'].includes(active.snapshot().state)) releaseOwnership();
    showError(error);
  }).finally(render);
});
buttons.stop!.addEventListener('click', () => {
  ++uiOperation;
  player?.stop();
  releaseOwnership();
  pauseReason = '';
  errorBox.textContent = '';
  render();
});
buttons.transition!.addEventListener('click', () => {
  errorBox.textContent = '';
  void player?.scheduleAB().catch(showError).finally(render);
});
buttons.mute!.addEventListener('click', () => {
  muted = !muted;
  player?.setMuted(muted);
  render();
});
volume.addEventListener('input', () => { player?.setVolume(Number(volume.value)); render(); });

function title(id: string | null): string {
  return loaded?.pack.assets.find(a => a.id === id)?.title ?? '';
}
function setText(id: string, text: string): void {
  const target = element(id);
  if (target.textContent !== text) target.textContent = text;
}
function render(): void {
  if (!loaded) return;
  const state = player?.snapshot();
  const phase = state?.state ?? 'idle';
  const running = ['loading', 'scheduled', 'playing', 'paused'].includes(phase);
  buttons['play-a']!.disabled = false;
  buttons['play-b']!.disabled = false;
  buttons.pause!.disabled = !running;
  buttons.pause!.textContent = phase === 'paused' ? 'Resume' : 'Pause';
  buttons.stop!.disabled = !running && !ownership;
  buttons.transition!.disabled = !state || state.requested !== player!.pair.from.id ||
    !['scheduled', 'playing', 'paused'].includes(phase) || state.transition !== 'none' || state.durationSeconds === 0;
  buttons.mute!.disabled = false;
  buttons.mute!.setAttribute('aria-pressed', String(muted));
  buttons.mute!.textContent = muted ? 'Unmute' : 'Mute';
  volume.disabled = false;
  volume.setAttribute('aria-valuetext', `${Math.round(Number(volume.value) * 100)} percent`);
  const now = state?.now ?? [];
  setText('now-title', now.length ? now.map(title).join(' + ') : 'Nothing playing');
  const elapsed = state?.elapsedSeconds ?? 0, duration = state?.durationSeconds ?? 0;
  const phaseLabel = phase === 'paused' ? 'Paused' : state?.transition === 'mixing' ? 'Crossfading' :
    phase === 'playing' ? 'Playing' : phase === 'ended' ? 'Finished' : 'Ready';
  setText('now-detail', duration ? `${phaseLabel}${muted ? ' · Muted' : ''} · ${elapsed.toFixed(1)} / ${duration.toFixed(1)} s` : 'Choose a recording to begin.');
  setText('next-title', title(state?.next ?? null) || 'Nothing queued');
  setText('next-detail', state?.transition === 'scheduled' ?
    `B enters in ${state.transitionInSeconds!.toFixed(1)} s · 4 s overlap` :
    state?.transition === 'mixing' ? 'A → B handoff in progress.' :
    state?.transition === 'complete' ? 'Handoff complete.' : 'Play A, then schedule the handoff.');
  const status = phase === 'loading' ? 'Preparing audio…' : phase === 'paused' ?
    pauseReason || 'Paused. Press Resume to continue.' : phase === 'scheduled' ? 'Start scheduled.' :
    phase === 'playing' ? (state?.transition === 'mixing' ? 'Crossfading A → B.' : muted ? 'Playing · muted.' : 'Playing.') :
    phase === 'ended' ? 'Finished. Choose A or B to play again.' : phase === 'closed' ? 'Player closed. Reload the page.' :
    'Ready · fixture pack validated.';
  setText('status', status);
  progress.value = duration ? elapsed / duration : 0;
  element('track-a').classList.toggle('is-active', now.includes(player?.pair.from.id ?? ''));
  element('track-b').classList.toggle('is-active', now.includes(player?.pair.to.id ?? ''));
  setText('clock-detail', state ? `Context: ${state.contextState} · ${state.sampleRate} Hz · frame ${state.currentFrame} · generation ${state.engineGeneration}. Now/Next follow the audio clock; device output is not measured.` : 'Audio starts only after Play.');
  if ((phase === 'ended' || phase === 'closed') && ownership) releaseOwnership();
}

document.addEventListener('visibilitychange', () => {
  if (document.hidden && player && ['loading', 'scheduled', 'playing'].includes(player.snapshot().state)) {
    ++uiOperation;
    pauseReason = 'Paused because this tab was hidden. Press Resume to continue.';
    void player.pause().catch(showError).finally(render);
  }
});
window.addEventListener('pagehide', () => {
  ++uiOperation;
  const old = player;
  player = null;
  void old?.dispose().catch(() => undefined);
  releaseOwnership();
});
window.addEventListener('pageshow', render);

async function initialize(): Promise<void> {
  try {
    if (!window.isSecureContext || !window.AudioContext || !navigator.locks || !crypto.subtle) {
      throw new Error('Use a current browser on http://127.0.0.1 or HTTPS with Web Audio and Web Locks support.');
    }
    loaded = await loadBrowserPack(new URL('/fixtures/s01/manifest.json', window.location.href), true);
    setText('loading', 'Two original recordings · 120 BPM · A minor');
    render();
  } catch (error) {
    setText('status', 'Audio unavailable.');
    setText('loading', 'Fix the error and reload this page.');
    showError(error);
  }
}
void initialize();
// UI refresh only. Audio starts, fades and stops were already scheduled in Web Audio.
function refresh(): void { render(); requestAnimationFrame(refresh); }
requestAnimationFrame(refresh);
