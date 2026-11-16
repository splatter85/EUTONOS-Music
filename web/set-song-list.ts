/** Set catalogue display only. Queue/analysis actions still use the existing player/DJ. */
import type {AudioAsset} from '../src/pack-types.js';
import type {SmallPlayer} from '../src/player.js';
import type {MixAnalysis} from '../src/mix-analysis.js';
import type {SongWaveform} from './set-waveform.js';
import type {PersistentSetAnalysisCache} from './set-analysis-cache.js';

const element = <K extends keyof HTMLElementTagNameMap>(tag: K, className = '') => {
  const node = document.createElement(tag); node.className = className; return node;
};
const put = (node: HTMLElement, text: string): void => { if (node.textContent !== text) node.textContent = text; };
const time = (seconds: number): string => Math.floor(seconds / 60) + ':' + Math.floor(seconds % 60).toString().padStart(2, '0');
export function measuredSongLabel(analysis: MixAnalysis): string {
  const bpm = analysis.tempo.bpm === null ? 'Tempo uncertain' : analysis.tempo.bpm.toFixed(1) + ' BPM measured estimate';
  const key = analysis.key.status === 'estimated' && analysis.key.name ? analysis.key.name + ' key estimate' : 'Key uncertain';
  return bpm + ' · ' + key;
}
interface Row {
  root: HTMLLIElement; title: HTMLElement; metadata: HTMLElement; analysis: HTMLElement; window: HTMLElement;
  canvas: HTMLCanvasElement; analyze: HTMLButtonElement; wave: SongWaveform | null; drawn: string;
}
export class SetSongList {
  private readonly rows = new Map<string, Row>();
  private readonly errors = new Map<string, string>();
  private busy: string | null = null;
  constructor(private readonly host: HTMLElement, private readonly cache: PersistentSetAnalysisCache,
    private readonly player: () => SmallPlayer | null, private readonly enqueue: (id: string) => void,
    private readonly rating: (id: string) => string) {}
  private create(asset: AudioAsset): Row {
    const root = element('li', 'set-song-row'), detail = element('div', 'song-detail'), title = element('strong', 'song-title');
    const metadata = element('div', 'song-meta'), analysis = element('div', 'song-analysis'), window = element('div', 'song-window');
    const actions = element('div', 'song-actions'), analyze = element('button', 'chip'), queue = element('button', 'chip');
    const canvas = element('canvas', 'song-wave'); canvas.height = 64; canvas.width = 640;
    canvas.setAttribute('aria-label', asset.title + ' full-song waveform');
    analyze.type = queue.type = 'button';
    analyze.setAttribute('aria-label', 'Analyze ' + asset.title);
    queue.setAttribute('aria-label', 'Add ' + asset.title + ' to the queue'); queue.textContent = 'Add to queue';
    queue.addEventListener('click', () => this.enqueue(asset.id));
    analyze.addEventListener('click', () => {
      const player = this.player();
      if (!player || this.busy || !['idle', 'ended', 'paused'].includes(player.snapshot().state)) return;
      this.busy = asset.id; this.errors.delete(asset.id);
      void player.warmSetSong(asset.id).then(result => { if (!result.ok) this.errors.set(asset.id, result.reason); },
        error => this.errors.set(asset.id, error instanceof Error ? error.message : String(error)))
        .finally(() => { this.busy = null; });
    });
    detail.append(title, metadata, analysis, window); actions.append(analyze, queue); root.append(detail, actions, canvas);
    this.host.append(root);
    return {root, title, metadata, analysis, window, canvas, analyze, wave: null, drawn: ''};
  }
  render(assets: readonly AudioAsset[]): void {
    const ids = new Set(assets.map(asset => asset.id));
    for (const [id, row] of this.rows) if (!ids.has(id)) { row.root.remove(); this.rows.delete(id); }
    const player = this.player(), state = player?.snapshot(), rate = player?.clock.sampleRate;
    const decks = player?.deckSnapshot(), views = [decks?.a, decks?.b];
    for (const asset of assets) {
      let row = this.rows.get(asset.id);
      if (!row) { row = this.create(asset); this.rows.set(asset.id, row); }
      const rating = this.rating(asset.id), duration = asset.file.frames / asset.file.sample_rate;
      put(row.title, asset.title);
      put(row.metadata, (asset.timing?.bpm ?? '?') + ' BPM requested · ' + time(duration) + (rating ? ' · ' + rating : ''));
      if (rate) void this.cache.restore(asset, rate);
      const data = rate ? this.cache.presentation(asset, rate) : null;
      const running = data?.analyzing || this.busy === asset.id, analysis = data?.analysis;
      const error = this.errors.get(asset.id) ?? data?.error;
      put(row.analysis, analysis ? measuredSongLabel(analysis) : running ? 'Analyzing…' : error ? 'Analysis unavailable — retry when stopped.' : 'Not analyzed yet');
      const window = analysis?.analyzedWindow;
      put(row.window, window && analysis ? 'Analyzed ' + time(window.startFrame / analysis.sampleRate) + '–' +
        time((window.startFrame + window.frames) / analysis.sampleRate) + ' of ' + time(duration) : '');
      row.analysis.title = error ?? '';
      row.analyze.disabled = !player || !!this.busy || !!(analysis && data?.waveform) || !!running || !!data?.wavePending || !['idle', 'ended', 'paused'].includes(state!.state);
      put(row.analyze, analysis ? data?.waveform ? 'Analyzed' : data?.wavePending ? 'Waveform…' : 'Get waveform'
        : running ? 'Analyzing…' : error ? 'Retry analysis' : 'Analyze');
      const view = views.find(view => view?.assetId === asset.id);
      this.draw(row, data?.waveform ?? null, view && duration ? view.positionSeconds / duration : null);
    }
  }
  private draw(row: Row, wave: SongWaveform | null, progress: number | null): void {
    const canvas = row.canvas, context = canvas.getContext('2d'); if (!context) return;
    const w = Math.max(1, canvas.clientWidth), h = Math.max(1, canvas.clientHeight), ratio = window.devicePixelRatio || 1;
    const position = progress === null ? -1 : Math.round(Math.max(0, Math.min(1, progress)) * w);
    const signature = w + ':' + h + ':' + ratio + ':' + position;
    if (row.wave === wave && row.drawn === signature) return;
    row.wave = wave; row.drawn = signature;
    canvas.width = Math.round(w * ratio); canvas.height = Math.round(h * ratio);
    context.setTransform(ratio, 0, 0, ratio, 0, 0); context.clearRect(0, 0, w, h);
    context.strokeStyle = '#28313b'; context.beginPath(); context.moveTo(0, h / 2); context.lineTo(w, h / 2); context.stroke();
    if (!wave) {
      context.fillStyle = '#8b93a1'; context.font = '11px system-ui'; context.fillText('Waveform appears after Play or Analyze', 10, 18); return;
    }
    const peak = Math.max(0.000001, ...wave.peaks), step = w / wave.peaks.length;
    for (let i = 0; i < wave.peaks.length; i++) {
      const x = i * step, height = wave.peaks[i]! / peak * (h / 2 - 5);
      context.fillStyle = position >= 0 && x < position ? '#22d3ee' : '#697a90';
      context.fillRect(x, h / 2 - height, Math.max(1, step), Math.max(1, 2 * height));
    }
    if (position >= 0) { context.fillStyle = '#fff'; context.fillRect(position, 0, 1, h); }
  }
}
