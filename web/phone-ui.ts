/**
 * Pure state machine for the simplified phone page: one Play/Pause button that reflects the
 * relay's real DJ state (never an optimistic guess), plus the rule for when the phone's own
 * audio should attach or detach. No DOM here so Node tests cover it.
 */
export type PhoneMode = 'unreachable' | 'no-dj' | 'idle' | 'loading' | 'playing' | 'needs-click' | 'error';

export interface PhoneUiInput {
  readonly relayReachable: boolean;
  readonly djConnected: boolean;
  /** DJ player state text from status (`idle`, `loading`, `scheduled`, `playing`, `paused`, `ended`, `needs-click`, ...). */
  readonly djState: string;
  readonly canPlay: boolean;
  readonly canStop: boolean;
  /** The last remote command was refused or failed (relay or DJ said so). */
  readonly commandFailed: boolean;
  /** This phone's audio element: not attached, connecting, playing, or refused (needs a tap). */
  readonly audio: 'off' | 'connecting' | 'playing' | 'blocked';
}
export interface PhoneUiView {
  readonly mode: PhoneMode;
  readonly button: 'Play' | 'Pause' | 'Starting…';
  /** What a press does: send play, send stop, or (blocked audio) just start this phone's sound. */
  readonly action: 'play' | 'pause' | 'listen' | 'none';
  readonly disabled: boolean;
  readonly message: string;
  /** One-line iOS hint, shown only while the phone's sound waits for a tap. */
  readonly hint: string;
}

const RUNNING = ['playing', 'scheduled'];

export function phoneView(input: PhoneUiInput): PhoneUiView {
  const view = (mode: PhoneMode, button: PhoneUiView['button'], action: PhoneUiView['action'], disabled: boolean, message: string, hint = ''): PhoneUiView =>
    ({mode, button, action, disabled, message, hint});
  const running = RUNNING.includes(input.djState);
  if (!input.relayReachable) return view('unreachable', 'Play', 'none', true, 'Cannot reach the PC. Retrying…');
  if (!input.djConnected) return view('no-dj', 'Play', 'none', true, 'Waiting for the DJ page on the PC…');
  if (input.djState === 'needs-click') {
    return view('needs-click', 'Play', 'play', false, 'Tap play on the PC page once (the browser blocked sound).');
  }
  if (input.commandFailed) {
    return view('error', running ? 'Pause' : 'Play', running ? 'pause' : 'play', false, 'The last command did not work. Try again.');
  }
  if (input.djState === 'loading') return view('loading', 'Starting…', 'pause', false, 'Getting ready…');
  if (running) {
    if (input.audio === 'blocked') {
      return view('playing', 'Pause', 'listen', false, 'Playing on the PC.', 'Tap once to hear it on this phone (iOS needs a tap to start sound).');
    }
    return view('playing', 'Pause', 'pause', false, input.audio === 'playing' ? 'Playing — about 2–5 s behind the PC.' : 'Playing — connecting sound…');
  }
  return view('idle', 'Play', 'play', !input.canPlay && input.djState !== 'paused', input.djState === 'paused' ? 'Paused.' : 'Ready.');
}

export interface AudioPlanInput {
  readonly djConnected: boolean;
  readonly djState: string;
  readonly audio: 'off' | 'connecting' | 'playing' | 'blocked';
  /** Phone audio is on because the owner pressed Play (rather than auto-attached). */
  readonly byPress: boolean;
  /** The owner pressed Pause and has not pressed Play since. */
  readonly userPaused: boolean;
  /** An attach was already tried (and refused) for the current playing spell. */
  readonly autoTried: boolean;
  readonly msSincePress: number;
}
export const PRESS_GRACE_MS = 20_000;

/** Whether to attach this phone's audio, release it, or leave things alone. */
export function audioPlan(input: AudioPlanInput): 'attach' | 'detach' | 'keep' {
  const running = RUNNING.includes(input.djState);
  if (input.audio === 'off') return running && input.djConnected && !input.userPaused && !input.autoTried ? 'attach' : 'keep';
  // Audio is on: release it when the DJ really stopped, but never right after a Play press.
  const stopped = input.djConnected && ['idle', 'ended'].includes(input.djState);
  if (stopped && !(input.byPress && input.msSincePress < PRESS_GRACE_MS)) return 'detach';
  return 'keep';
}
