/**
 * S17 "Stream to phone" for the DJ page. Opt-in and off by default. It records the player's
 * observational stream tap with MediaRecorder, posts ordered chunks to the local phone relay,
 * receives allowlisted phone commands over Server-Sent Events and posts DJ status back.
 *
 * Failure isolation: nothing here is awaited by playback. Every relay or recorder failure is
 * caught, shown in the stream panel and retried; the DJ keeps playing on the PC regardless.
 */
import {parseControlCommand, type DjStatus, type PhoneCommand} from './phone-protocol.js';

export const DEFAULT_RELAY = 'http://127.0.0.1:4180';
const MIME = 'audio/webm;codecs=opus';
const TIMESLICE_MS = 250;
const MAX_PENDING_CHUNKS = 40;
const RETRY_MS = 3000;
const STATUS_MS = 1000;
const BUSY_RETRY_MS = 5000;
const TOKEN_PATTERN = /^[0-9a-f]{32,128}$/;
export const TOKEN_HELP = 'No valid relay token. Open the DJ address that `npm run phone` printed (it ends with #relayToken=…); the token changes each time the relay starts.';

export interface StreamTapSource {
  createStreamTap(): MediaStream;
  releaseStreamTap(): void;
}
export interface PhoneStreamHost {
  /** Returns the player tap source, creating the DJ if needed; throws when the pack is not ready. */
  tapSource(): StreamTapSource;
  /** Runs a phone command through the page's own controls; returns a short outcome. */
  run(command: PhoneCommand): string;
  status(): Omit<DjStatus, 'lastCommand'>;
}
export interface PhoneStreamView {
  readonly enabled: boolean;
  readonly relay: string;
  readonly control: 'off' | 'connecting' | 'connected' | 'reconnecting' | 'refused';
  readonly recorder: 'off' | 'waiting' | 'recording' | 'unsupported' | 'retrying';
  readonly chunksSent: number;
  readonly bytesSent: number;
  readonly sessions: number;
  readonly commands: number;
  readonly lastCommand: string;
  readonly error: string;
}

/** Only a loopback http relay is accepted from the page URL; everything else uses the default. */
export function relayFromLocation(search: string): string {
  const candidate = new URLSearchParams(search).get('relay');
  if (candidate && /^http:\/\/(?:127\.0\.0\.1|localhost):\d{1,5}$/.test(candidate)) return candidate;
  return DEFAULT_RELAY;
}

/**
 * Reads the per-run relay token from the #relayToken= fragment (never sent in requests), keeps
 * it in sessionStorage for this tab and removes it from the address bar. Falls back to storage.
 */
export function takeRelayToken(relay: string): string | null {
  const key = `eutonos-music-relay-token:${relay}`;
  const match = /(?:^#|&)relayToken=([^&]*)/.exec(location.hash);
  if (match) {
    const candidate = match[1] ?? '';
    try { history.replaceState(history.state, '', location.pathname + location.search); } catch { /* keep going */ }
    if (TOKEN_PATTERN.test(candidate)) {
      try { sessionStorage.setItem(key, candidate); } catch { /* storage blocked: token lives for this page only */ }
      return candidate;
    }
  }
  try {
    const stored = sessionStorage.getItem(key);
    return stored && TOKEN_PATTERN.test(stored) ? stored : null;
  } catch { return null; }
}

function errorText(code: string | undefined, status: number): string {
  if (code === 'relay-token-required') return `The relay refused the token. ${TOKEN_HELP}`;
  if (code === 'another-dj-connected') return 'Another DJ tab is streaming to the phone. Turn Stream to phone off there first; retrying.';
  return `Relay refused (${code ?? status}).`;
}

function message(error: unknown): string { return error instanceof Error ? error.message : String(error); }

export class PhoneStream {
  private enabledState = false;
  private source: StreamTapSource | null = null;
  private recorder: MediaRecorder | null = null;
  private sessionId = '';
  private seq = 0;
  private pending = 0;
  private chain: Promise<void> = Promise.resolve();
  private eventsAbort: AbortController | null = null;
  private statusTimer: ReturnType<typeof setInterval> | null = null;
  private retryTimer: ReturnType<typeof setTimeout> | null = null;
  private view: {-readonly [K in keyof PhoneStreamView]: PhoneStreamView[K]};

  constructor(private readonly host: PhoneStreamHost, readonly relay: string, private readonly token: string | null,
    private readonly onChange: () => void) {
    this.view = {enabled: false, relay, control: 'off', recorder: 'off', chunksSent: 0, bytesSent: 0, sessions: 0,
      commands: 0, lastCommand: '', error: ''};
  }

  get enabled(): boolean { return this.enabledState; }
  snapshot(): PhoneStreamView { return {...this.view}; }

  /** Call from the toggle's click handler. Never throws. */
  start(): void {
    if (this.enabledState) return;
    this.enabledState = true;
    this.view.enabled = true;
    this.view.error = '';
    if (!this.token) { this.fail(TOKEN_HELP); this.stop(); return; }
    this.view.recorder = 'waiting';
    try {
      this.source = this.host.tapSource();
    } catch (error) {
      this.fail(`Cannot stream yet: ${message(error)}`);
      this.stop();
      return;
    }
    // Audio starts only once this tab owns the relay's control connection, so a second DJ tab
    // (refused with 409) can never replace the streaming tab's audio session.
    void this.runEvents();
    this.statusTimer = setInterval(() => { this.postStatus(); }, STATUS_MS);
    this.postStatus();
    this.changed();
  }

  /** Tears down recorder, tap, events and timers. Never throws. */
  stop(): void {
    const wasEnabled = this.enabledState;
    this.enabledState = false;
    this.view.enabled = false;
    if (this.retryTimer) { clearTimeout(this.retryTimer); this.retryTimer = null; }
    if (this.statusTimer) { clearInterval(this.statusTimer); this.statusTimer = null; }
    const session = this.sessionId;
    this.stopRecorder();
    if (wasEnabled && session) this.post(`/api/dj/ingest?session=${session}&final=1`, new Blob([]), 'application/octet-stream').catch(() => undefined);
    try { this.source?.releaseStreamTap(); } catch { /* player already disposed */ }
    this.source = null;
    this.eventsAbort?.abort();
    this.eventsAbort = null;
    this.view.control = 'off';
    this.view.recorder = 'off';
    this.changed();
  }

  private changed(): void { try { this.onChange(); } catch { /* rendering must not break streaming */ } }
  private fail(text: string): void { this.view.error = text; this.changed(); }

  private post(path: string, body: Blob | string, type: string): Promise<Response> {
    return fetch(`${this.relay}${path}`, {method: 'POST', body, headers: {'Content-Type': type, 'X-Relay-Token': this.token ?? ''},
      mode: 'cors', cache: 'no-store', credentials: 'omit'});
  }

  /**
   * Control events as a fetch-streamed Server-Sent Events response (EventSource cannot send the
   * X-Relay-Token header or expose 401/409). Reconnects until streaming is turned off.
   */
  private async runEvents(): Promise<void> {
    const abort = new AbortController();
    this.eventsAbort = abort;
    const pause = (ms: number): Promise<void> => new Promise(resolve => {
      const timer = setTimeout(resolve, ms);
      abort.signal.addEventListener('abort', () => { clearTimeout(timer); resolve(); }, {once: true});
    });
    this.view.control = 'connecting';
    while (this.enabledState && !abort.signal.aborted) {
      let wait = RETRY_MS;
      try {
        const response = await fetch(`${this.relay}/api/dj/events`, {headers: {'X-Relay-Token': this.token ?? ''},
          mode: 'cors', cache: 'no-store', credentials: 'omit', signal: abort.signal});
        if (!response.ok || !response.body) {
          const code = (await response.json().catch(() => ({})) as {error?: string}).error;
          this.view.control = 'refused';
          if (code === 'another-dj-connected') { wait = BUSY_RETRY_MS; this.stopRecorder(); this.view.recorder = 'waiting'; }
          this.fail(errorText(code, response.status));
        } else {
          this.view.control = 'connected';
          this.view.error = '';
          this.changed();
          this.postStatus();
          if (!this.recorder && !this.retryTimer) this.startRecorder();
          const reader = response.body.pipeThrough(new TextDecoderStream()).getReader();
          let buffer = '';
          for (;;) {
            const {value, done} = await reader.read();
            if (done) break;
            buffer += value;
            if (buffer.length > 65_536) buffer = buffer.slice(-65_536);
            for (let end = buffer.indexOf('\n\n'); end >= 0; end = buffer.indexOf('\n\n')) {
              this.handleEvent(buffer.slice(0, end));
              buffer = buffer.slice(end + 2);
            }
          }
          if (!abort.signal.aborted) { this.view.control = 'reconnecting'; this.changed(); }
        }
      } catch {
        if (abort.signal.aborted) return;
        this.view.control = 'reconnecting';
        this.fail(`Relay unreachable at ${this.relay}. Is \`npm run phone\` running?`);
      }
      await pause(wait);
    }
  }

  private handleEvent(block: string): void {
    if (!this.enabledState) return;
    let name = 'message';
    const data: string[] = [];
    for (const line of block.split('\n')) {
      if (line.startsWith('event:')) name = line.slice(6).trim();
      else if (line.startsWith('data:')) data.push(line.slice(5).replace(/^ /, ''));
    }
    if (name !== 'command' || !data.length) return;
    let parsed: unknown;
    try { parsed = JSON.parse(data.join('\n')); } catch { return; }
    const id = typeof parsed === 'object' && parsed !== null ? (parsed as {id?: unknown}).id : undefined;
    if (typeof parsed === 'object' && parsed !== null) delete (parsed as {id?: unknown}).id;
    const command = parseControlCommand(parsed);
    if (!command) return;
    let outcome: string;
    try { outcome = this.host.run(command); } catch (error) { outcome = `failed: ${message(error)}`; }
    this.view.commands++;
    this.view.lastCommand = `#${typeof id === 'number' ? id : '?'} ${command.command}${command.command === 'handoff' ? ` ${command.mode}` : ''}: ${outcome}`;
    this.changed();
    // Status after the command's synchronous part; the DJ request itself may settle later.
    setTimeout(() => { this.postStatus(); }, 50);
  }

  private postStatus(): void {
    if (!this.enabledState) return;
    let status: DjStatus;
    try { status = {...this.host.status(), lastCommand: this.view.lastCommand}; } catch { return; }
    this.post('/api/dj/status', JSON.stringify(status), 'application/json').catch(() => undefined);
  }

  private startRecorder(): void {
    if (!this.enabledState || !this.source) return;
    if (typeof MediaRecorder === 'undefined' || !MediaRecorder.isTypeSupported(MIME)) {
      this.view.recorder = 'unsupported';
      this.fail(`This browser cannot record ${MIME}. Use current Edge or Chrome.`);
      return;
    }
    let recorder: MediaRecorder;
    try {
      recorder = new MediaRecorder(this.source.createStreamTap(), {mimeType: MIME, audioBitsPerSecond: 192_000});
    } catch (error) { this.retry(`Recorder could not start: ${message(error)}`); return; }
    const session = crypto.randomUUID();
    this.sessionId = session;
    this.seq = 0;
    this.pending = 0;
    this.chain = Promise.resolve();
    this.recorder = recorder;
    this.view.sessions++;
    this.view.recorder = 'waiting';
    recorder.addEventListener('dataavailable', event => {
      if (this.sessionId !== session || event.data.size === 0) return;
      this.view.recorder = 'recording';
      this.enqueue(session, this.seq++, event.data);
    });
    recorder.addEventListener('error', () => { if (this.sessionId === session) this.retry('The recorder stopped with an error.'); });
    try { recorder.start(TIMESLICE_MS); } catch (error) { this.retry(`Recorder could not start: ${message(error)}`); return; }
    this.changed();
  }

  private stopRecorder(): void {
    const recorder = this.recorder;
    this.recorder = null;
    this.sessionId = '';
    if (recorder && recorder.state !== 'inactive') { try { recorder.stop(); } catch { /* already stopped */ } }
  }

  /** Chunks are posted strictly in order; one failure ends the session and a new one starts later. */
  private enqueue(session: string, seq: number, chunk: Blob): void {
    if (++this.pending > MAX_PENDING_CHUNKS) { this.retry('The relay is not keeping up; restarting the stream.'); return; }
    this.chain = this.chain.then(async () => {
      if (this.sessionId !== session) return;
      try {
        const response = await this.post(`/api/dj/ingest?session=${session}&seq=${seq}`, chunk, 'application/octet-stream');
        if (this.sessionId !== session) return;
        if (!response.ok) {
          const body = await response.json().catch(() => ({})) as {error?: string};
          this.retry(`Audio not accepted: ${errorText(body.error, response.status)}`);
          return;
        }
        this.pending--;
        this.view.chunksSent++;
        this.view.bytesSent += chunk.size;
        if (this.view.error) this.view.error = '';
        this.changed();
      } catch (error) {
        if (this.sessionId === session) this.retry(`Relay unreachable at ${this.relay} (${message(error)}). Is \`npm run phone\` running?`);
      }
    });
  }

  private retry(reason: string): void {
    this.stopRecorder();
    this.view.recorder = 'retrying';
    this.fail(reason);
    if (!this.enabledState || this.retryTimer) return;
    this.retryTimer = setTimeout(() => { this.retryTimer = null; this.startRecorder(); }, RETRY_MS);
  }
}
