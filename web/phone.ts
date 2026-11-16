/**
 * S17 phone page, served by scripts/phone-relay.ts: one remote-plus-speaker. Play starts the DJ
 * on the PC and this phone's sound in the same tap; Pause stops both. The page reports what the
 * relay says (see web/phone-ui.ts) and never claims what is audible.
 */
import type {PhoneCommand, RelayStatus, TransitionInfo} from './phone-protocol.js';
import {audioPlan, phoneView} from './phone-ui.js';
import {StallWatchdog} from './phone-watchdog.js';

function element<T extends HTMLElement>(id: string): T {
  const found = document.getElementById(id);
  if (!found) throw new Error(`Missing UI element: ${id}`);
  return found as T;
}
const audio = element<HTMLAudioElement>('audio');
const play = element<HTMLButtonElement>('play');
const nextSong = element<HTMLButtonElement>('next-song');
const hold = element<HTMLButtonElement>('hold');
const handoff = element<HTMLSelectElement>('handoff');
const auto = element<HTMLButtonElement>('auto');
const connection = element('connection');
const picker = element<HTMLDetailsElement>('picker');
const pickerList = element<HTMLUListElement>('picker-list');

type AudioState = 'off' | 'connecting' | 'playing' | 'blocked';
let audioState: AudioState = 'off';
let byPress = false;
let userPaused = false;
let autoTried = false;
let pressAt = 0;
let commandFailedAt = 0;
let swallowClick = false;
let reconnectTimer: ReturnType<typeof setTimeout> | null = null;
let reconnectDelay = 1000;
let latest: RelayStatus | null = null;
let relayReachable = false;
let lastMetadataKey = '';
let handoffEditing = false;
let pickerKey = '';

function setText(id: string, value: string): void {
  const target = element(id);
  if (target.textContent !== value) target.textContent = value;
}
function setStream(message: string): void { setText('stream', message); }
const watchdog = new StallWatchdog(() => audioState === 'connecting' || audioState === 'playing',
  () => { scheduleReconnect('The live stream stalled.'); });

/** Starts this phone's sound. Call it inside a tap when possible: iOS needs that gesture. */
function connect(): void {
  if (reconnectTimer) { clearTimeout(reconnectTimer); reconnectTimer = null; }
  // A fresh request every time: a resumed old buffer would grow the delay behind the PC.
  audio.src = `/live.mp3?t=${Date.now()}`;
  audioState = 'connecting';
  setStream('Connecting to the live stream…');
  void audio.play().catch(error => {
    if (audioState === 'off') return;
    const blocked = error instanceof DOMException && error.name === 'NotAllowedError';
    if (blocked) { audioState = 'blocked'; setStream('This phone is waiting for a tap before it plays sound.'); }
    else { setStream(`This phone could not start audio: ${error instanceof Error ? error.message : String(error)}.`); audioState = 'blocked'; }
    render();
  });
  render();
}
function disconnect(): void {
  watchdog.fed();
  audio.pause();
  audio.removeAttribute('src');
  audio.load();
}
function stopAudio(message = 'Not listening on this phone. The DJ keeps playing on the PC.'): void {
  audioState = 'off';
  if (reconnectTimer) { clearTimeout(reconnectTimer); reconnectTimer = null; }
  disconnect();
  setStream(message);
  render();
}
function scheduleReconnect(reason: string): void {
  if (audioState === 'off' || audioState === 'blocked' || reconnectTimer) return;
  disconnect();
  audioState = 'connecting';
  setStream(`${reason} Reconnecting in ${Math.round(reconnectDelay / 1000)} s…`);
  reconnectTimer = setTimeout(() => { reconnectTimer = null; if (audioState !== 'off') connect(); }, reconnectDelay);
  reconnectDelay = Math.min(10_000, reconnectDelay * 2);
}

audio.addEventListener('playing', () => { watchdog.fed(); reconnectDelay = 1000; audioState = 'playing'; setStream('Listening — about 2–5 s behind the PC.'); render(); });
audio.addEventListener('timeupdate', () => { if (!audio.paused) watchdog.fed(); });
audio.addEventListener('waiting', () => { watchdog.starved(); if (audioState === 'playing') { audioState = 'connecting'; setStream('Buffering… (the DJ may be stopped or paused on the PC)'); render(); } });
audio.addEventListener('stalled', () => { watchdog.starved(); });
audio.addEventListener('error', () => { scheduleReconnect('The live stream dropped.'); });
audio.addEventListener('ended', () => { scheduleReconnect('The live stream ended.'); });
// The OS can pause the element (call, other app); wait for the next tap instead of fighting it.
audio.addEventListener('pause', () => {
  if ((audioState === 'playing' || audioState === 'connecting') && audio.getAttribute('src') && !reconnectTimer) {
    disconnect(); audioState = 'blocked'; setStream('Paused by the phone. Tap to rejoin live.'); render();
  }
});

async function send(command: PhoneCommand): Promise<void> {
  setText('command', `Sending ${command.command}…`);
  try {
    const response = await fetch('/api/control', {method: 'POST', headers: {'Content-Type': 'application/json'},
      body: JSON.stringify(command), cache: 'no-store'});
    const body = await response.json().catch(() => ({})) as {error?: string};
    if (response.ok) commandFailedAt = 0; else commandFailedAt = Date.now();
    setText('command', response.ok ? `Sent ${command.command} to the PC.`
      : body.error === 'dj-not-connected' ? 'The DJ page is not connected. Turn on "Stream to phone" on the PC.'
      : `The relay refused ${command.command}: ${body.error ?? response.status}.`);
  } catch (error) {
    commandFailedAt = Date.now();
    setText('command', `Could not reach the relay: ${error instanceof Error ? error.message : String(error)}`);
  }
  void poll(false);
}

// The tap that follows a "blocked" state starts this phone's sound, wherever it lands.
document.addEventListener('pointerdown', event => {
  if (audioState !== 'blocked') return;
  userPaused = false;
  connect();
  if (event.target instanceof Node && play.contains(event.target)) swallowClick = true;
}, true);

function pressPlay(): void {
  if (swallowClick) { swallowClick = false; return; }
  const view = currentView();
  if (view.action === 'play') {
    // One tap: DJ play to the PC and this phone's sound, started inside the gesture.
    userPaused = false; byPress = true; pressAt = Date.now(); autoTried = false;
    reconnectDelay = 1000;
    if (audioState === 'off') connect();
    void send({command: 'play'});
  } else if (view.action === 'pause') {
    userPaused = true; byPress = false;
    stopAudio('Paused. The PC DJ is stopping.');
    void send({command: 'stop'});
  } else if (view.action === 'listen') {
    userPaused = false; connect();
  }
}
play.addEventListener('click', pressPlay);
nextSong.addEventListener('click', () => { void send({command: 'next'}); });
hold.addEventListener('click', () => { void send({command: 'hold', enabled: !(latest?.dj.status?.hold ?? false)}); });
auto.addEventListener('click', () => { void send({command: 'auto', enabled: !(latest?.dj.status?.auto ?? false)}); });
handoff.addEventListener('focus', () => { handoffEditing = true; });
handoff.addEventListener('blur', () => { handoffEditing = false; });
handoff.addEventListener('change', () => {
  handoffEditing = false;
  void send({command: 'handoff', mode: handoff.value as 'direct' | 'hybrid' | 'mix'});
});

function setupMediaSession(): void {
  if (!('mediaSession' in navigator)) return;
  const set = (action: MediaSessionAction, handler: MediaSessionActionHandler | null): void => {
    try { navigator.mediaSession.setActionHandler(action, handler); } catch { /* unsupported on this phone */ }
  };
  set('play', () => { userPaused = false; byPress = true; pressAt = Date.now(); connect(); void send({command: 'play'}); });
  set('pause', () => { userPaused = true; stopAudio(); void send({command: 'stop'}); });
  set('stop', () => { userPaused = true; stopAudio(); void send({command: 'stop'}); });
  set('nexttrack', () => { void send({command: 'next'}); });
  set('previoustrack', null);
  set('seekbackward', null);
  set('seekforward', null);
}
function updateMetadata(status: RelayStatus): void {
  if (!('mediaSession' in navigator) || typeof MediaMetadata === 'undefined') return;
  const dj = status.dj.status;
  const title = dj?.now || 'EUTONOS Music DJ';
  const album = dj ? `${dj.state}${dj.next ? ` · next: ${dj.next}` : ''}` : 'DJ not connected';
  const key = `${title}|${album}`;
  if (key === lastMetadataKey) return;
  lastMetadataKey = key;
  navigator.mediaSession.metadata = new MediaMetadata({title, artist: 'EUTONOS Music · live from the PC', album});
}

function currentView(): ReturnType<typeof phoneView> {
  const dj = latest?.dj.status ?? null;
  return phoneView({relayReachable, djConnected: relayReachable && (latest?.dj.connected ?? false), djState: dj?.state ?? 'idle',
    canPlay: dj?.canPlay ?? false, canStop: dj?.canStop ?? false, commandFailed: Date.now() - commandFailedAt < 6000, audio: audioState});
}

function transitionLine(info: TransitionInfo | null | undefined): string {
  if (!info) return '';
  return [info.recipe, info.overlap && `${info.overlap} overlap`, info.tempo && `tempo ${info.tempo}`, info.entry, info.fallback]
    .filter(Boolean).join(' · ');
}

function renderPicker(queue: readonly {id: string; title: string}[], canSetNext: boolean): void {
  picker.hidden = !canSetNext || queue.length === 0;
  const key = queue.map(item => `${item.id}\u0000${item.title}`).join('\u0001');
  if (key === pickerKey) return;
  pickerKey = key;
  pickerList.replaceChildren(...queue.map((item, index) => {
    const row = document.createElement('li');
    const button = document.createElement('button');
    button.type = 'button';
    button.textContent = index === 0 ? `${item.title} (next)` : item.title;
    button.dataset.songId = item.id;
    if (index === 0) button.setAttribute('aria-current', 'true');
    button.addEventListener('click', () => {
      setText('picker-note', `Asking the PC to play “${item.title}” next…`);
      void send({command: 'set-next', songId: item.id});
    });
    row.append(button);
    return row;
  }));
}

function render(): void {
  const dj = latest?.dj.status ?? null;
  const connected = relayReachable && (latest?.dj.connected ?? false);
  connection.className = `pill ${!relayReachable ? 'pill-bad' : connected ? 'pill-ok' : 'pill-wait'}`;
  connection.textContent = !relayReachable ? 'Relay unreachable' : connected
    ? latest?.stream.ingesting ? 'DJ connected · streaming' : 'DJ connected · no audio yet'
    : 'DJ page not connected';
  const view = currentView();
  play.textContent = view.button;
  play.dataset.mode = view.mode;
  play.disabled = view.disabled;
  setText('play-message', view.message);
  element('hint').classList.toggle('invisible', !view.hint);
  setText('hint', view.hint || ' ');
  if ('mediaSession' in navigator) navigator.mediaSession.playbackState = audioState === 'playing' ? 'playing' : 'paused';
  setText('now', dj?.now || 'Nothing playing');
  const queue = dj?.queue ?? [];
  setText('next', dj?.next || queue[0]?.title || 'Nothing scheduled');
  setText('next-status', dj?.nextStatus ?? '');
  renderPicker(queue, dj?.canSetNext ?? false);
  const next = transitionLine(dj?.transitionNext), last = transitionLine(dj?.transitionLast);
  element('transition-card').hidden = !next && !last;
  setText('transition-next', next ? `Planned: ${next}` : '');
  setText('transition-last', last ? `Last: ${last}` : '');
  setText('transition-detail', [dj?.transitionNext?.choreography && `EQ choreography: ${dj.transitionNext.choreography}`,
    dj?.transitionLast?.choreography && `Last EQ choreography: ${dj.transitionLast.choreography}`].filter(Boolean).join(' · '));
  setText('dj-state', dj ? `${dj.state}${dj.requested ? ` · ${dj.requested}` : ''}` : 'Waiting for the DJ page');
  setText('dj-status', dj ? [dj.status, dj.detail].filter(Boolean).join(' · ') : latest?.stream.lastError ?? '');
  nextSong.disabled = !connected || !dj?.canNext;
  hold.disabled = !connected || !dj?.canHold;
  hold.setAttribute('aria-pressed', String(dj?.hold ?? false));
  hold.textContent = dj?.hold ? 'Hold: on' : 'Hold';
  handoff.disabled = !connected || !dj?.canHandoff;
  // S18: Auto exists only on the Studio set page; older DJ pages never report canAuto.
  auto.hidden = !dj?.canAuto && !dj?.auto;
  auto.disabled = !connected || !dj?.canAuto;
  auto.setAttribute('aria-pressed', String(dj?.auto ?? false));
  auto.textContent = dj?.auto ? 'Auto: on' : 'Auto';
  if (!handoffEditing && dj?.handoff && handoff.value !== dj.handoff) handoff.value = dj.handoff;
}

/** Joins or leaves the live sound as the DJ's real state changes (see audioPlan). */
function reconcileAudio(): void {
  const dj = latest?.dj.status ?? null;
  const state = dj?.state ?? 'idle';
  if (!['playing', 'scheduled', 'loading'].includes(state)) autoTried = false;
  const plan = audioPlan({djConnected: relayReachable && (latest?.dj.connected ?? false), djState: state, audio: audioState,
    byPress, userPaused, autoTried, msSincePress: Date.now() - pressAt});
  if (plan === 'attach') { autoTried = true; connect(); }
  else if (plan === 'detach') { byPress = false; stopAudio('The DJ stopped. Sound rejoins when it plays again.'); }
}

let pollTimer: ReturnType<typeof setTimeout> | null = null;
async function poll(reschedule = true): Promise<void> {
  try {
    const response = await fetch('/api/status', {cache: 'no-store'});
    if (!response.ok) throw new Error(String(response.status));
    latest = await response.json() as RelayStatus;
    relayReachable = true;
    updateMetadata(latest);
  } catch {
    relayReachable = false;
  }
  reconcileAudio();
  render();
  if (reschedule) {
    if (pollTimer) clearTimeout(pollTimer);
    pollTimer = setTimeout(() => { void poll(); }, document.hidden ? 5000 : 1500);
  }
}
document.addEventListener('visibilitychange', () => { if (!document.hidden) void poll(); });

setupMediaSession();
render();
void poll();
