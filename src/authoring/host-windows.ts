/**
 * Windows FL Studio adapter: official command-line render (/R /Ewav) and MIDI
 * export (/M) of a saved project, plus running-instance detection.
 *
 * Verified on FL Studio 26.1.7 (build 5654), Windows 11. Observed host facts:
 * - CLI render/export exits 0 within seconds when FL is not running.
 * - When an FL GUI instance is already running, the CLI call exits 0 in ~1 s
 *   and writes NOTHING, so the adapter refuses with HOST_BUSY instead.
 */
import {execFile, spawn} from 'node:child_process';
import {readdir, stat} from 'node:fs/promises';
import {join} from 'node:path';
import {AuthoringError} from './errors.js';
import type {HostAdapter, HostInfo, HostRun} from './host.js';

const IMAGE_LINE = 'C:\\Program Files\\Image-Line';
const TEMPLATES: Record<string, string> = {
  'fl-factory/create-a-chord-progression': 'Data\\Templates\\Utility\\Create a chord progression\\Create a chord progression.flp',
};

function run(file: string, args: string[], timeout: number): Promise<string> {
  return new Promise((resolve, reject) => {
    execFile(file, args, {timeout, windowsHide: true, maxBuffer: 1 << 20}, (error, stdout) => error ? reject(error) : resolve(stdout));
  });
}

export class WindowsFlHost implements HostAdapter {
  private exe: Promise<string | null> | undefined;
  private version: Promise<string | null> | undefined;

  constructor(private readonly options: {exe?: string; timeoutMs?: number} = {}) {}

  private executable(): Promise<string | null> {
    this.exe ??= (async () => {
      const explicit = this.options.exe ?? process.env.EUTONOS_FL_EXE;
      if (explicit) return (await stat(explicit).catch(() => null))?.isFile() ? explicit : null;
      const dirs = (await readdir(IMAGE_LINE).catch(() => [] as string[])).filter(d => /^FL Studio \d{4}$/.test(d)).sort().reverse();
      for (const d of dirs) {
        const candidate = join(IMAGE_LINE, d, 'FL64.exe');
        if ((await stat(candidate).catch(() => null))?.isFile()) return candidate;
      }
      return null;
    })();
    return this.exe;
  }

  async info(): Promise<HostInfo> {
    const exe = await this.executable();
    if (!exe) return {platform: 'win32', adapter: 'windows-fl-cli', available: false, fl_executable: null, fl_version: null,
      reason: 'FL64.exe not found; set EUTONOS_FL_EXE'};
    this.version ??= run('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command',
      `(Get-Item -LiteralPath '${exe.replace(/'/g, "''")}').VersionInfo.FileVersion`], 20000).then(s => s.trim() || null, () => null);
    return {platform: 'win32', adapter: 'windows-fl-cli', available: true, fl_executable: exe, fl_version: await this.version, reason: null};
  }

  async runningInstances(): Promise<readonly string[]> {
    // Fails closed: an error here propagates, and callers treat it as HOST_BUSY.
    const csv = await run('tasklist.exe', ['/v', '/fo', 'csv', '/nh', '/fi', 'imagename eq FL64.exe'], 15000);
    return csv.split(/\r?\n/).filter(l => l.startsWith('"FL64.exe"'))
      .map(l => (l.match(/"([^"]*)"\s*$/)?.[1] ?? '').trim());
  }

  private async cli(args: string, projectPath: string): Promise<HostRun> {
    const exe = await this.executable();
    if (!exe) throw new AuthoringError('HOST_UNAVAILABLE', 'FL Studio executable not found');
    if (/["\r\n]/.test(projectPath)) throw new AuthoringError('INVALID_PAYLOAD', 'unsupported characters in project path');
    const running = await this.runningInstances().catch(e => {
      throw new AuthoringError('HOST_BUSY', `cannot determine whether FL Studio is running (${String((e as Error).message)})`);
    });
    if (running.length) {
      throw new AuthoringError('HOST_BUSY', `FL Studio is already running (${running.join('; ')}); the CLI hands off and renders nothing. Close FL first.`);
    }
    const commandLine = args.replace('{P}', `"${projectPath}"`);
    const started = Date.now(), timeout = this.options.timeoutMs ?? 300000;
    const code = await new Promise<number | null>((resolve, reject) => {
      // windowsVerbatimArguments: FL parses `/M"path"` itself; Node must not re-quote it.
      // argv0 is quoted explicitly because verbatim mode does not quote the program path either.
      const child = spawn(exe, [commandLine], {argv0: `"${exe}"`, windowsVerbatimArguments: true, windowsHide: true, stdio: 'ignore'});
      const timer = setTimeout(() => { child.kill(); reject(new AuthoringError('OUTCOME_UNKNOWN', `FL CLI exceeded ${timeout} ms and was stopped`, true)); }, timeout);
      child.on('error', e => { clearTimeout(timer); reject(new AuthoringError('HOST_UNAVAILABLE', String(e))); });
      child.on('exit', c => { clearTimeout(timer); resolve(c); });
    });
    const shown = args.replace('{P}', `"<workspace>/.../${projectPath.split(/[\\/]/).pop()}"`);
    return {command: `FL64.exe ${shown}`, exit_code: code, duration_ms: Date.now() - started};
  }

  renderWav(projectPath: string) { return this.cli('/R /Ewav {P}', projectPath); }
  exportMidi(projectPath: string) { return this.cli('/M{P}', projectPath); }

  async templatePath(templateId: string): Promise<string | null> {
    const rel = TEMPLATES[templateId], exe = await this.executable();
    if (!rel || !exe) return null;
    const path = join(exe, '..', rel);
    return (await stat(path).catch(() => null))?.isFile() ? path : null;
  }
}
