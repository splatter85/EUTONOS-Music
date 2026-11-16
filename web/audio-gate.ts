/**
 * Fallback for a DJ page opened in a normal browser: the autoplay policy keeps the AudioContext
 * suspended until a real click, so a remote (phone) Play would sit on "Getting ready" silently.
 * The supported setup is the dedicated launcher (`npm run phone:host`), which starts the browser
 * with the documented autoplay flag. This only makes the failure visible and lets one click
 * finish the pending Play; it never tries to bypass the policy.
 */
export const GATE_DELAY_MS = 1500;

/** True when a Play has been loading for a while and the context is still suspended. */
export function audioNeedsClick(input: {readonly playerState: string; readonly contextState: string; readonly loadingMs: number}): boolean {
  return input.playerState === 'loading' && input.contextState === 'suspended' && input.loadingMs >= GATE_DELAY_MS;
}

export class AudioGate {
  private since: number | null = null;
  private box: HTMLElement | null = null;
  constructor(private readonly resume: () => Promise<unknown> | undefined, private readonly clock: () => number = Date.now) {}

  /** Call on every render/status tick. Returns whether the page is waiting for a click. */
  observe(playerState: string, contextState: string): boolean {
    if (playerState === 'loading') this.since ??= this.clock(); else this.since = null;
    const needs = audioNeedsClick({playerState, contextState, loadingMs: this.since === null ? 0 : this.clock() - this.since});
    this.show(needs);
    return needs;
  }

  private show(visible: boolean): void {
    if (typeof document === 'undefined') return;
    if (!this.box) {
      if (!visible) return;
      const box = document.createElement('div');
      box.className = 'gesture-gate'; box.setAttribute('role', 'alert'); box.id = 'gesture-gate';
      const button = document.createElement('button');
      button.type = 'button'; button.id = 'gesture-gate-button'; button.className = 'gesture-gate-button';
      button.textContent = 'Click here once to allow sound';
      const note = document.createElement('p');
      note.textContent = 'A phone asked to play, but this browser blocks sound until you click this page once.';
      button.addEventListener('click', () => { void this.resume()?.catch(() => undefined); });
      box.append(note, button);
      document.body.append(box);
      this.box = box;
    }
    this.box.hidden = !visible;
  }
}
