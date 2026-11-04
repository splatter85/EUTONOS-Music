/**
 * Host adapter boundary. The broker and FLP codec are portable; everything that
 * launches or inspects an installed FL Studio lives behind this interface.
 */
import {AuthoringError} from './errors.js';

export interface HostInfo {
  readonly platform: string;
  readonly adapter: string;
  readonly available: boolean;
  readonly fl_executable: string | null;
  readonly fl_version: string | null;
  readonly reason: string | null;
}

export interface HostRun {
  readonly command: string;
  readonly exit_code: number | null;
  readonly duration_ms: number;
}

export interface HostAdapter {
  info(): Promise<HostInfo>;
  /** Window titles of running FL Studio GUI instances (empty when none). */
  runningInstances(): Promise<readonly string[]>;
  /** Render `<dir>/<stem>.flp` to `<dir>/<stem>.wav` with the host's official CLI. */
  renderWav(projectPath: string): Promise<HostRun>;
  /** Export `<dir>/<stem>.flp` to `<dir>/<stem>.mid` with the host's official CLI. */
  exportMidi(projectPath: string): Promise<HostRun>;
  /** Absolute path of an allowlisted factory template, or null when unavailable. */
  templatePath(templateId: string): Promise<string | null>;
}

export const TEMPLATE_IDS = ['fl-factory/create-a-chord-progression'] as const;

export class UnsupportedHost implements HostAdapter {
  constructor(private readonly why: string) {}
  async info(): Promise<HostInfo> {
    return {platform: process.platform, adapter: 'unsupported', available: false, fl_executable: null, fl_version: null, reason: this.why};
  }
  async runningInstances() { return []; }
  async renderWav(): Promise<HostRun> { throw new AuthoringError('UNSUPPORTED_CAPABILITY', this.why); }
  async exportMidi(): Promise<HostRun> { throw new AuthoringError('UNSUPPORTED_CAPABILITY', this.why); }
  async templatePath() { return null; }
}
