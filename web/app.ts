import {loadBrowserPack, type LoadedBrowserPack} from '../src/browser-pack.js';
import {SmallPlayer} from '../src/player.js';
import {DeterministicDj, type DjCommandResult} from '../src/dj.js';
import {CONTROL_VERSION, type ControlRequest} from '../src/control.js';
import type {MusicState} from '../src/pack-types.js';

function element<T extends HTMLElement>(id: string): T {
  const found = document.getElementById(id);
  if (!found) throw new Error(`Missing UI element: ${id}`);
  return found as T;
}
const buttonIds = ['queue-a', 'queue-b', 'play', 'pause', 'stop', 'next-song', 'cancel-next', 'hold', 'apply-state', 'apply-genre', 'mute'] as const;
const buttons = Object.fromEntries(buttonIds.map(id => [id, element<HTMLButtonElement>(id)])) as Record<typeof buttonIds[number], HTMLButtonElement>;
const volume = element<HTMLInputElement>('volume');
const stateInput = element<HTMLSelectElement>('state');
const genreInput = element<HTMLInputElement>('genre');
const progress = element<HTMLProgressElement>('progress');
const queueList = element<HTMLUListElement>('queue');
const errorBox = element('error');
let loaded: LoadedBrowserPack | null = null;
let dj: DeterministicDj | null = null;
let ownership: Promise<void> | null = null;
let releaseLock: (() => void) | null = null;
let leaseEpoch = 0;
let pauseReason = '';
let lastQueueKey = '';
let lastResult: DjCommandResult | null = null;

function message(error: unknown): string { return error instanceof Error ? error.message : String(error); }
function setText(id: string, value: string): void {
  const target = element(id);
  if (target.textContent !== value) target.textContent = value;
}
function title(id: string | null): string {
  return id === 's01-recording-a' ? 'S01 A — slow triangle pulse' : id === 's01-recording-b' ? 'S01 B — syncopated pulse' : id ?? 'None';
}
function seconds(value: number): string { return `${Math.max(0, value).toFixed(1)}s`; }
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
    void navigator.locks.request('eutonos-music-s02-playback', {ifAvailable: true}, lock => {
      if (epoch !== leaseEpoch) { reject(new Error('Playback was cancelled.')); return; }
      if (!lock) { reject(new Error('Another tab owns playback. Press Stop there, then Play here.')); return; }
      return new Promise<void>(release => { releaseLock = release; resolve(); });
    }).catch(reject);
  }).catch(error => {
    if (epoch === leaseEpoch) ownership = null;
    throw error;
  });
  return ownership;
}
function getDj(): DeterministicDj {
  if (dj) return dj;
  if (!loaded) throw new Error('The fixture pack is still loading.');
  const route = loaded.pack.routes[0];
  if (!route) throw new Error('The fixture pack has no A → B route.');
  dj = new DeterministicDj(new SmallPlayer(new AudioContext(), loaded, route.id), loaded, 'explore');
  dj.setVolume(Number(volume.value));
  return dj;
}
type Action = ControlRequest extends infer Request ? Request extends ControlRequest ? Omit<Request, 'schemaVersion' | 'commandId' | 'expectedRevision' | 'source'> : never : never;
function makeRequest(controller: DeterministicDj, action: Action): ControlRequest {
  return {...action, schemaVersion: CONTROL_VERSION, commandId: crypto.randomUUID(), expectedRevision: controller.snapshot().control.revision, source: 'manual'} as ControlRequest;
}
async function request(action: Action): Promise<void> {
  errorBox.textContent = '';
  try {
    const controller = getDj();
    const ownershipPromise = action.type === 'transport' && action.action === 'play' ? acquireOwnership() : undefined;
    let result = await controller.request(makeRequest(controller, action), ownershipPromise);
    if (action.type === 'transport' && result.receipt.status === 'rejected' && result.receipt.code === 'stale-revision') {
      result = await controller.request(makeRequest(controller, action), ownershipPromise);
    }
    if (dj !== controller) return;
    lastResult = result;
    if (result.execution.status === 'failed' || result.receipt.status === 'rejected') errorBox.textContent = result.execution.reason;
    if (action.type === 'transport' && action.action === 'play' && result.execution.status !== 'failed') pauseReason = '';
  } catch (error) { errorBox.textContent = message(error); }
  finally { render(); }
}

buttons['queue-a'].addEventListener('click', () => { void request({type: 'queueTrack', trackId: 's01-recording-a'}); });
buttons['queue-b'].addEventListener('click', () => { void request({type: 'queueTrack', trackId: 's01-recording-b'}); });
buttons.play.addEventListener('click', () => { void request({type: 'transport', action: 'play'}); });
buttons.pause.addEventListener('click', () => { void request({type: 'transport', action: dj?.snapshot().player.state === 'paused' ? 'play' : 'pause'}); });
buttons.stop.addEventListener('click', () => { pauseReason = ''; void request({type: 'transport', action: 'stop'}); });
buttons['next-song'].addEventListener('click', () => { void request({type: 'nextSong'}); });
buttons['cancel-next'].addEventListener('click', () => { void request({type: 'cancelNext'}); });
buttons.hold.addEventListener('click', () => { void request({type: 'hold', enabled: !dj?.snapshot().control.requested.hold}); });
buttons['apply-state'].addEventListener('click', () => { void request({type: 'setState', state: stateInput.value as MusicState}); });
buttons['apply-genre'].addEventListener('click', () => { void request({type: 'requestGenre', genreId: genreInput.value.trim() || null}); });
buttons.mute.addEventListener('click', () => { void request({type: 'transport', action: dj?.snapshot().control.requested.muted ? 'unmute' : 'mute'}); });
volume.addEventListener('input', () => { if (dj) dj.setVolume(Number(volume.value)); });

function render(): void {
  const snapshot = dj?.snapshot();
  const player = snapshot?.player;
  const control = snapshot?.control;
  const state = player?.state ?? 'idle';
  const running = ['loading', 'scheduled', 'playing', 'paused'].includes(state);
  const ready = loaded !== null;
  for (const button of Object.values(buttons)) button.disabled = !ready;
  buttons.pause.disabled = !ready || !running;
  buttons.pause.textContent = state === 'paused' ? 'Resume' : 'Pause';
  buttons['cancel-next'].disabled = !ready || !snapshot?.pending || snapshot.pending.phase !== 'scheduled';
  buttons.play.disabled = !ready || (running && state !== 'paused');
  buttons.hold.setAttribute('aria-pressed', String(control?.requested.hold ?? false));
  buttons.hold.textContent = control?.requested.hold ? 'Hold: on' : 'Hold state & genre';
  buttons.mute.setAttribute('aria-pressed', String(control?.requested.muted ?? false));
  buttons.mute.textContent = control?.requested.muted ? 'Unmute' : 'Mute';
  setText('requested-target', `${control?.requested.state ?? 'explore'} · ${control?.requested.genreId ?? 'any genre'}${control?.requested.hold ? ' · held' : ''}`);
  setText('now-title', player?.now.length ? player.now.map(title).join(' + ') : 'Nothing playing');
  setText('now-detail', `${state}${player?.muted ? ' · muted' : ''} · ${seconds(player?.elapsedSeconds ?? 0)} / ${seconds(player?.durationSeconds ?? 0)}`);
  setText('next-title', player?.next ? title(player.next) : 'Nothing scheduled');
  setText('next-detail', snapshot?.pending ? `${snapshot.pending.kind} · ${snapshot.pending.phase}${player?.transitionInSeconds !== null && player?.transitionInSeconds !== undefined ? ` · in ${seconds(player.transitionInSeconds)}` : ''}` : 'Choose Next Song or add a track to the queue.');
  setText('status', state === 'loading' ? 'Preparing audio…' : state === 'closed' ? 'Player closed — reload to start a new session.' : state === 'ended' ? 'Playback ended' : state === 'paused' ? pauseReason || 'Paused — the audio clock is suspended.' : player?.transition === 'mixing' ? 'Crossfading A → B' : player?.transition === 'complete' ? 'Handoff complete' : state === 'playing' ? 'Playing' : state === 'scheduled' ? 'Scheduled — waiting for the audio clock' : ready ? 'Ready — press Play to start' : 'Loading fixture…');
  progress.value = player && player.durationSeconds > 0 ? Math.min(1, player.elapsedSeconds / player.durationSeconds) : 0;
  setText('clock-detail', player ? `${player.contextState} · ${player.sampleRate} Hz · frame ${player.currentFrame} · generation ${player.engineGeneration}` : 'Audio context starts on your first control request.');
  const result = snapshot?.last ?? lastResult;
  setText('execution', result ? `${result.receipt.status} · ${result.execution.status} · ${result.execution.reason}` : 'No command yet. Acceptance and playback are separate steps.');
  setText('revision', `Revision ${control?.revision ?? 0}`);
  for (const id of ['a', 'b']) element(`track-${id}`).classList.toggle('is-active', player?.now.includes(`s01-recording-${id}`) ?? false);
  const queue = control?.queue ?? [];
  const queueKey = queue.map(entry => `${entry.commandId}:${entry.trackId}`).join('|');
  if (queueKey !== lastQueueKey || !queueList.childElementCount) {
    lastQueueKey = queueKey;
    queueList.replaceChildren();
    if (!queue.length) {
      const empty = document.createElement('li'); empty.className = 'empty-queue'; empty.textContent = 'Manual queue is empty.'; queueList.append(empty);
    }
    for (const [index, entry] of queue.entries()) {
      const item = document.createElement('li');
      const label = document.createElement('span'); label.textContent = `${index + 1}. ${title(entry.trackId)}`;
      const cancel = document.createElement('button'); cancel.type = 'button'; cancel.textContent = 'Cancel'; cancel.setAttribute('aria-label', `Cancel queued ${index + 1}: ${title(entry.trackId)}`);
      cancel.addEventListener('click', () => { void request({type: 'cancelQueue', queueCommandId: entry.commandId}); });
      item.append(label, cancel); queueList.append(item);
    }
  }
  // A new Play sets loading synchronously. Idle/ended/closed can therefore
  // release old work without waiting for a cancelled decode or ownership promise.
  if (ownership && player && ['idle', 'ended', 'closed'].includes(state)) releaseOwnership();
}
document.addEventListener('visibilitychange', () => {
  if (document.hidden && dj && ['loading', 'scheduled', 'playing'].includes(dj.snapshot().player.state)) {
    pauseReason = 'Paused because this tab became hidden. Press Resume to continue.';
    void request({type: 'transport', action: 'pause'});
  }
});
window.addEventListener('pagehide', () => {
  const previous = dj;
  dj = null;
  lastResult = null;
  // dispose gates output synchronously, before its context-close promise settles.
  void previous?.dispose().catch(() => undefined);
  releaseOwnership();
});
window.addEventListener('pageshow', () => { render(); });
async function initialize(): Promise<void> {
  try {
    if (!window.isSecureContext || !window.AudioContext || !navigator.locks || !crypto.subtle) throw new Error('Use a current browser on http://127.0.0.1 or HTTPS with Web Audio and Web Locks support.');
    loaded = await loadBrowserPack(new URL('/fixtures/s01/manifest.json', window.location.href), true);
    setText('loading', 'Two original recordings · 120 BPM · A minor');
  } catch (error) {
    setText('loading', 'Audio unavailable — fix the error and reload.');
    errorBox.textContent = message(error);
  }
  render();
}
function frame(): void { render(); requestAnimationFrame(frame); }
void initialize();
requestAnimationFrame(frame);
