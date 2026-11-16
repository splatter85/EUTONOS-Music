/**
 * S17 phone-listening protocol shared by the relay (Node), the DJ page and the phone page.
 * Pure data validation only: commands are a strict allowlist and DJ status is copied into a
 * fixed, bounded shape. Nothing here is executable recipe or agent instruction.
 */

export const HANDOFF_MODES = ['direct', 'hybrid', 'mix'] as const;
export type PhoneHandoffMode = typeof HANDOFF_MODES[number];

export type PhoneCommand =
  | {readonly command: 'play'}
  | {readonly command: 'stop'}
  | {readonly command: 'next'}
  | {readonly command: 'hold'; readonly enabled?: boolean}
  | {readonly command: 'handoff'; readonly mode: PhoneHandoffMode}
  /** S18: toggle (or set) Auto on the Studio set page; other pages ignore it. */
  | {readonly command: 'auto'; readonly enabled?: boolean};

/** A relayed command carries the relay's monotonically increasing id. */
export type RelayedCommand = PhoneCommand & {readonly id: number};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
function onlyKeys(value: Record<string, unknown>, allowed: readonly string[]): boolean {
  return Object.keys(value).every(key => allowed.includes(key));
}

/** Returns a fresh, allowlisted command or null; unknown fields are refused, not dropped. */
export function parseControlCommand(value: unknown): PhoneCommand | null {
  if (!isRecord(value)) return null;
  switch (value.command) {
    case 'play': case 'stop': case 'next':
      return onlyKeys(value, ['command']) ? {command: value.command} : null;
    case 'hold': case 'auto':
      if (!onlyKeys(value, ['command', 'enabled'])) return null;
      if (value.enabled === undefined) return {command: value.command};
      return typeof value.enabled === 'boolean' ? {command: value.command, enabled: value.enabled} : null;
    case 'handoff':
      if (!onlyKeys(value, ['command', 'mode'])) return null;
      return typeof value.mode === 'string' && (HANDOFF_MODES as readonly string[]).includes(value.mode)
        ? {command: 'handoff', mode: value.mode as PhoneHandoffMode} : null;
    default:
      return null;
  }
}

export interface DjStatus {
  readonly state: string;
  readonly now: string;
  readonly next: string;
  readonly detail: string;
  readonly status: string;
  readonly requested: string;
  readonly execution: string;
  readonly lastCommand: string;
  readonly hold: boolean;
  readonly handoff: PhoneHandoffMode | null;
  readonly canPlay: boolean;
  readonly canStop: boolean;
  readonly canNext: boolean;
  readonly canHold: boolean;
  readonly canHandoff: boolean;
  /** S18 Studio set page: Auto is on / can be toggled. False on pages without set mode. */
  readonly auto: boolean;
  readonly canAuto: boolean;
}

export const STATUS_TEXT_LIMIT = 240;
const textFields = ['state', 'now', 'next', 'detail', 'status', 'requested', 'execution', 'lastCommand'] as const;
const flagFields = ['hold', 'canPlay', 'canStop', 'canNext', 'canHold', 'canHandoff', 'auto', 'canAuto'] as const;

function text(value: unknown): string {
  if (typeof value !== 'string') return '';
  // Control characters are display noise at best; strip them and bound the length.
  const clean = value.replace(/[\x00-\x1f\x7f]/g, ' ');
  return clean.length > STATUS_TEXT_LIMIT ? `${clean.slice(0, STATUS_TEXT_LIMIT - 1)}…` : clean;
}

/** Copies only known fields with bounded strings and strict booleans; null for non-objects. */
export function sanitizeDjStatus(value: unknown): DjStatus | null {
  if (!isRecord(value)) return null;
  const result: Record<string, unknown> = {};
  for (const field of textFields) result[field] = text(value[field]);
  for (const field of flagFields) result[field] = value[field] === true;
  result.handoff = typeof value.handoff === 'string' && (HANDOFF_MODES as readonly string[]).includes(value.handoff)
    ? value.handoff : null;
  return result as unknown as DjStatus;
}

/** What GET /api/status returns to the phone. */
export interface RelayStatus {
  readonly dj: {readonly connected: boolean; readonly ageMs: number | null; readonly status: DjStatus | null};
  readonly stream: {
    readonly ingesting: boolean;
    readonly listeners: number;
    readonly encoder: 'idle' | 'running' | 'error';
    readonly chunksIn: number;
    readonly bytesOut: number;
    readonly sessions: number;
    readonly lastError: string | null;
  };
  readonly delayNote: string;
}
