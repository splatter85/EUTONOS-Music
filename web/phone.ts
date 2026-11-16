/**
 * S17 phone page, served by scripts/phone-relay.ts. Listen/Pause only changes this phone's
 * listening; remote buttons post allowlisted commands that the PC DJ page executes through
 * its own buttons. The page never claims what is audible: it reports stream and DJ state.
 */
import type {PhoneCommand, RelayStatus} from './phone-protocol.js';

function element<T extends HTMLElement>(id: string): T {
  const found = document.getElementById(id);
  if (!found) throw new Error(`Missing UI element: ${id}`);
  return found as T;
}
const audio = element<HTMLAudioElement>('audio');
const listen = element<HTMLButtonElement>('listen');
const nextSong = element<HTMLButtonElement>('next-song');
const hold = element<HTMLButtonElement>('hold');
const djPlay = element<HTMLButtonElement>('dj-play');
const djStop = element<HTMLButtonElement>('dj-stop');
const handoff = element<HTMLSelectElement>('handoff');
const connection = element('connection');

let wantListening = false;
let reconnectTimer: ReturnType<typeof setTimeout> | null = null;
let reconnectDelay = 1000;
let latest: RelayStatus | null = null;
let relayReachable = false;
let lastMetadataKey = '';
let handoffEditing = false;

function setText(id: string, value: string): void {
  const target = element(id);
  if (target.textContent !== value) target.textContent = value;
}
function setStream(message: string): void { setText('stream', message); }

function connect(): void {
  if (reconnectTimer) { clearTimeout(reconnectTimer); reconnectTimer = null; }
  // A fresh request every time: a resumed old buffer would grow the delay behind the PC.
  audio.src = `/live.mp3?t=${Date.now()}`;
  setStream('Connecting to the live stream…');
  void audio.play().catch(error => {
    setStream(`This phone refused to start audio: ${error instanceof Error ? error.message : String(error)}. Tap Listen again.`);
    stopListening();
  });
}
function disconnect(): void {
  audio.pause();
  audio.removeAttribute('src');
  audio.load();
}
function startListening(): void {
  wantListening = true;
  reconnectDelay = 1000;
  connect();
  renderListen();
}
function stopListening(): void {
  wantListening = false;
  if (reconnectTimer) { clearTimeout(reconnectTimer); reconnectTimer = null; }
  disconnect();
  setStream('Not listening on this phone. The DJ keeps playing on the PC.');
  renderListen();
}
function scheduleReconnect(reason: string): void {
  if (!wantListening || reconnectTimer) return;
  disconnect();
  setStream(`${reason} Reconnecting in ${Math.round(reconnectDelay / 1000)} s…`);
  reconnectTimer = setTimeout(() => { reconnectTimer = null; if (wantListening) connect(); }, reconnectDelay);
  reconnectDelay = Math.min(10_000, reconnectDelay * 2);
}
function renderListen(): void {
  listen.setAttribute('aria-pressed', String(wantListening));
  listen.textContent = wantListening ? 'Pause listening' : 'Listen';
  if ('mediaSession' in navigator) navigator.mediaSession.playbackState = wantListening ? 'playing' : 'paused';
}

audio.addEventListener('playing', () => { reconnectDelay = 1000; setStream('Listening — about 2–5 s behind the PC.'); });
audio.addEventListener('waiting', () => { if (wantListening) setStream('Buffering… (the DJ may be stopped or paused on the PC)'); });
audio.addEventListener('error', () => { scheduleReconnect('The live stream dropped.'); });
audio.addEventListener('ended', () => { scheduleReconnect('The live stream ended.'); });
// The OS can pause the element (call, other app); reflect it rather than fighting it.
audio.addEventListener('pause', () => {
  if (wantListening && audio.getAttribute('src') && !reconnectTimer) { wantListening = false; disconnect(); setStream('Paused by the phone. Tap Listen to rejoin live.'); renderListen(); }
});
listen.addEventListener('click', () => { if (wantListening) stopListening(); else startListening(); });

async function send(command: PhoneCommand): Promise<void> {
  setText('command', `Sending ${command.command}…`);
  try {
    const response = await fetch('/api/control', {method: 'POST', headers: {'Content-Type': 'application/json'},
      body: JSON.stringify(command), cache: 'no-store'});
    const body = await response.json().catch(() => ({})) as {error?: string};
    setText('command', response.ok ? `Sent ${command.command} to the PC.`
      : body.error === 'dj-not-connected' ? 'The DJ page is not connected. Turn on "Stream to phone" on the PC.'
      : `The relay refused ${command.command}: ${body.error ?? response.status}.`);
  } catch (error) {
    setText('command', `Could not reach the relay: ${error instanceof Error ? error.message : String(error)}`);
  }
  void poll(false);
}
nextSong.addEventListener('click', () => { void send({command: 'next'}); });
djPlay.addEventListener('click', () => { void send({command: 'play'}); });
djStop.addEventListener('click', () => { void send({command: 'stop'}); });
hold.addEventListener('click', () => { void send({command: 'hold', enabled: !(latest?.dj.status?.hold ?? false)}); });
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
  set('play', () => { startListening(); });
  set('pause', () => { stopListening(); });
  set('stop', () => { stopListening(); });
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

function render(): void {
  const dj = latest?.dj.status ?? null;
  const connected = relayReachable && (latest?.dj.connected ?? false);
  connection.className = `pill ${!relayReachable ? 'pill-bad' : connected ? 'pill-ok' : 'pill-wait'}`;
  connection.textContent = !relayReachable ? 'Relay unreachable' : connected
    ? latest?.stream.ingesting ? 'DJ connected · streaming' : 'DJ connected · no audio yet'
    : 'DJ page not connected';
  setText('now', dj?.now || 'Nothing playing');
  setText('state', dj ? `${dj.state}${dj.requested ? ` · ${dj.requested}` : ''}` : 'Waiting for the DJ page');
  setText('next', dj?.next || 'Nothing scheduled');
  setText('dj-status', dj ? [dj.status, dj.detail].filter(Boolean).join(' · ') : latest?.stream.lastError ?? '');
  nextSong.disabled = !connected || !dj?.canNext;
  djPlay.disabled = !connected || !dj?.canPlay;
  djStop.disabled = !connected || !dj?.canStop;
  hold.disabled = !connected || !dj?.canHold;
  hold.setAttribute('aria-pressed', String(dj?.hold ?? false));
  hold.textContent = dj?.hold ? 'Hold: on' : 'Hold';
  handoff.disabled = !connected || !dj?.canHandoff;
  if (!handoffEditing && dj?.handoff && handoff.value !== dj.handoff) handoff.value = dj.handoff;
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
  render();
  if (reschedule) {
    if (pollTimer) clearTimeout(pollTimer);
    pollTimer = setTimeout(() => { void poll(); }, document.hidden ? 5000 : 1500);
  }
}
document.addEventListener('visibilitychange', () => { if (!document.hidden) void poll(); });

setupMediaSession();
renderListen();
void poll();
