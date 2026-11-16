/**
 * S17 phone stall watchdog. When the live stream reports waiting/stalled and does not resume
 * playing within the timeout while the listener still wants audio, onStall fires once so the
 * page can tear down and reconnect. Timers are injectable for tests.
 */
export const STALL_TIMEOUT_MS = 8000;

export interface WatchdogTimers {
  set(callback: () => void, ms: number): unknown;
  clear(handle: unknown): void;
}
const realTimers: WatchdogTimers = {
  set: (callback, ms) => setTimeout(callback, ms),
  clear: handle => { clearTimeout(handle as ReturnType<typeof setTimeout>); },
};

export class StallWatchdog {
  private handle: unknown = null;

  constructor(private readonly wantsAudio: () => boolean, private readonly onStall: () => void,
    private readonly timeoutMs = STALL_TIMEOUT_MS, private readonly timers: WatchdogTimers = realTimers) {}

  get armed(): boolean { return this.handle !== null; }

  /** waiting / stalled: start the clock unless it is already running. */
  starved(): void {
    if (this.handle !== null || !this.wantsAudio()) return;
    this.handle = this.timers.set(() => {
      this.handle = null;
      if (this.wantsAudio()) this.onStall();
    }, this.timeoutMs);
  }

  /** playing / progress / listening stopped: cancel any pending stall. */
  fed(): void {
    if (this.handle === null) return;
    this.timers.clear(this.handle);
    this.handle = null;
  }
}
