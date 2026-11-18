/**
 * `npm run transitions:report`: descriptive analysis of the owner's transition ratings.
 * Reads `local/transition-ratings/ratings.jsonl`, prints a plain-text report and writes
 * `local/transition-ratings/report.json`. Counts only: no significance tests, no model, and it
 * never touches the planner. With few ratings it says so instead of drawing conclusions.
 */
import {lstat, writeFile} from 'node:fs/promises';
import {join, resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import {FEEDBACK_RATINGS, FEEDBACK_TAG_LABELS, POSITIVE_TAGS, type FeedbackRating, type FeedbackTag} from '../web/feedback-vocabulary.js';
import {latestPerPlan, type TransitionFeedback} from '../web/transition-feedback.js';
import {describeSnapshot, summarizeSnapshot} from '../web/dj-settings.js';
import {defaultFeedbackRoot, FeedbackFile} from './transition-feedback-file.js';

export const REPORT_VERSION = 'em.transition-report.v1' as const;
/** Below this many rated plans overall, nothing below is a finding. */
export const MIN_TOTAL = 20;
/** A group smaller than this is shown but marked too small. */
export const MIN_GROUP = 5;
const SHOWN = 5;

export type RatingCounts = Readonly<Record<FeedbackRating, number>>;
export interface GroupRow {
  readonly key: string; readonly n: number; readonly counts: RatingCounts;
  /** (love + like) / n and dislike / n, as plain proportions of this group. */
  readonly likedShare: number; readonly dislikedShare: number; readonly tooSmall: boolean;
}
export interface PlanSummary {
  readonly planId: string; readonly rating: FeedbackRating; readonly at: string; readonly device: string;
  readonly recipe: string; readonly mode: string; readonly seed: number | null; readonly choreography: string; readonly overlapBars: number | null;
  readonly swapMs: number | null; readonly gapBars: number | null; readonly tempoGapPercent: number; readonly tempoBand: string;
  readonly entryFraction: number; readonly entryRank: number | null; readonly precheck: string; readonly fallbackAfterFailedChecks: number | null;
  readonly tags: readonly string[]; readonly note: string;
}
export interface TransitionReport {
  readonly version: typeof REPORT_VERSION;
  readonly source: {readonly lines: number; readonly skippedLines: number; readonly ratingsEntries: number};
  readonly ratedPlans: number;
  readonly replacedRatings: number;
  readonly enoughData: boolean;
  readonly verdict: string;
  readonly byRating: RatingCounts;
  readonly groups: Readonly<Record<string, readonly GroupRow[]>>;
  /** DJ booth settings: what each settings id in the groups meant (ids are stable hashes of the settings). */
  readonly settingsLegend: Readonly<Record<string, {readonly summary: string; readonly lines: readonly string[]; readonly urlPairSearch: string | null}>>;
  readonly negativeTagsByRecipe: Readonly<Record<string, readonly {readonly tag: string; readonly label: string; readonly count: number}[]>>;
  readonly best: readonly PlanSummary[];
  readonly worst: readonly PlanSummary[];
  readonly notes: readonly string[];
}

const zero = (): Record<FeedbackRating, number> => ({love: 0, like: 0, ok: 0, dislike: 0});
const percent = (x: number): string => `${Math.round(x * 100)}%`;

export function skippedBucket(fraction: number): string {
  return fraction < 0.1 ? 'enters in the first 10%' : fraction < 0.25 ? 'enters 10-25% in' : fraction < 0.5 ? 'enters 25-50% in' : 'enters 50%+ in';
}
/** The style of a plan: the layered entry style when it has one, else the recipe. */
export function styleOfEntry(e: TransitionFeedback): string {
  const s = e.plan.entryStyle;
  return s && s.source === 'layered-entry@1' ? `layered ${s.style}${s.lastRung ? ' (last rung)' : ''}` : e.plan.recipe;
}
export const NO_SETTINGS = 'no settings recorded (before the booth settings)';
export const settingsIdOfEntry = (e: TransitionFeedback): string => e.settings?.id ?? e.plan.settings?.id ?? NO_SETTINGS;
function gapBucket(gapFraction: number): string { return `${(gapFraction * 100).toFixed(1)}%`; }

const DIMENSIONS: readonly {readonly name: string; readonly of: (e: TransitionFeedback) => string}[] = [
  {name: 'recipe', of: e => e.plan.recipe},
  {name: 'tempo-gap band', of: e => e.plan.tempo.band},
  {name: 'choreography', of: e => e.plan.choreography?.name ?? 'none (recipe uses its own automation)'},
  {name: 'overlap bars', of: e => e.plan.overlapBars === null ? 'none' : `${e.plan.overlapBars} bars`},
  {name: 'skipped fraction (where B enters)', of: e => skippedBucket(e.plan.to.skippedFraction)},
  {name: 'fallback after failed pre-check', of: e => e.measured?.fallbackAfterFailedChecks != null ? 'yes: reached after failed pre-check(s)' : 'no'},
  {name: 'explore vs auto', of: e => e.plan.mode},
  // Owner decisions 2026-11-16: layered-entry style and the explore-menu draw (both optional in older records).
  {name: 'entry style', of: e => e.plan.entryStyle
    ? `${e.plan.entryStyle.style}${e.plan.entryStyle.bars ? ` ${e.plan.entryStyle.bars} bars` : ''}${e.plan.entryStyle.lastRung ? ' (last rung)' : ''}`
    : 'none recorded'},
  {name: 'explore menu', of: e => e.plan.menu ? `drawn from ${e.plan.menu.alternatives.length} candidates` : 'no menu (deterministic or manual)'},
  // DJ booth settings: group by the exact settings that were active, by style, and by style within each settings id.
  {name: 'settings id', of: e => settingsIdOfEntry(e) + (e.plan.settings?.allowListOverridden ? ' (allow-list overridden)' : '')},
  {name: 'style (recipe or layered entry)', of: styleOfEntry},
  {name: 'style within settings id', of: e => `${settingsIdOfEntry(e)} · ${styleOfEntry(e)}`},
  {name: 'pre-check verdict at the time', of: e => e.measured?.status ?? 'not recorded'},
  {name: 'rated on', of: e => e.device},
];

function row(key: string, entries: readonly TransitionFeedback[]): GroupRow {
  const counts = zero();
  for (const e of entries) counts[e.rating]++;
  const n = entries.length;
  return {key, n, counts, likedShare: n ? (counts.love + counts.like) / n : 0, dislikedShare: n ? counts.dislike / n : 0, tooSmall: n < MIN_GROUP};
}
function groupBy(entries: readonly TransitionFeedback[], of: (e: TransitionFeedback) => string): GroupRow[] {
  const map = new Map<string, TransitionFeedback[]>();
  for (const e of entries) { const k = of(e); map.set(k, [...(map.get(k) ?? []), e]); }
  return [...map.entries()].map(([k, v]) => row(k, v)).sort((a, b) => b.n - a.n || (a.key < b.key ? -1 : 1));
}
function summarize(e: TransitionFeedback): PlanSummary {
  const c = e.plan.choreography as (typeof e.plan.choreography & {swapMs?: number; gapBars?: number}) | null;
  return {planId: e.planId, rating: e.rating, at: e.at, device: e.device, recipe: e.plan.recipe, mode: e.plan.mode, seed: e.plan.seed,
    choreography: c?.name ?? 'none', overlapBars: e.plan.overlapBars, swapMs: c?.swapMs ?? null, gapBars: c?.gapBars ?? null,
    tempoGapPercent: Math.round(e.plan.tempo.gap * 1000) / 10, tempoBand: e.plan.tempo.band, entryFraction: Math.round(e.plan.to.skippedFraction * 1000) / 1000,
    entryRank: e.plan.to.entryRank, precheck: e.measured ? `${e.measured.status}${e.measured.reason ? `: ${e.measured.reason}` : ''}` : 'not recorded',
    fallbackAfterFailedChecks: e.measured?.fallbackAfterFailedChecks ?? null, tags: [...e.tags], note: e.note};
}

/** `all` is every stored line (re-ratings included); only the latest rating per plan is analysed. */
export function buildReport(all: readonly TransitionFeedback[], source: {lines: number; skipped: number}): TransitionReport {
  const entries = latestPerPlan(all);
  const byRating = zero();
  for (const e of entries) byRating[e.rating]++;
  const groups: Record<string, GroupRow[]> = {};
  for (const d of DIMENSIONS) groups[d.name] = groupBy(entries, d.of);
  const settingsLegend: Record<string, {summary: string; lines: string[]; urlPairSearch: string | null}> = {};
  for (const e of entries) {
    const stamp = e.settings ?? e.plan.settings;
    if (stamp && !settingsLegend[stamp.id]) settingsLegend[stamp.id] = {summary: summarizeSnapshot(stamp.snapshot, stamp.urlPairSearch),
      lines: describeSnapshot(stamp.snapshot, stamp.urlPairSearch), urlPairSearch: stamp.urlPairSearch ?? null};
  }
  const negativeTagsByRecipe: Record<string, {tag: string; label: string; count: number}[]> = {};
  for (const recipeRow of groups.recipe ?? []) {
    const counts = new Map<string, number>();
    for (const e of entries.filter(x => x.plan.recipe === recipeRow.key)) {
      for (const tag of e.tags) if (!POSITIVE_TAGS.includes(tag)) counts.set(tag, (counts.get(tag) ?? 0) + 1);
    }
    negativeTagsByRecipe[recipeRow.key] = [...counts.entries()].sort((a, b) => b[1] - a[1] || (a[0] < b[0] ? -1 : 1))
      .slice(0, SHOWN).map(([tag, count]) => ({tag, label: FEEDBACK_TAG_LABELS[tag as FeedbackTag], count}));
  }
  const order = (e: TransitionFeedback): number => FEEDBACK_RATINGS.indexOf(e.rating);
  const newest = (a: TransitionFeedback, b: TransitionFeedback): number => Date.parse(b.at) - Date.parse(a.at);
  const best = [...entries].sort((a, b) => order(a) - order(b) || newest(a, b)).filter(e => e.rating === 'love' || e.rating === 'like').slice(0, SHOWN);
  const worst = [...entries].sort((a, b) => order(b) - order(a) || newest(a, b)).filter(e => e.rating === 'dislike' || e.rating === 'ok').slice(0, SHOWN);
  const enoughData = entries.length >= MIN_TOTAL;
  const verdict = entries.length === 0 ? 'No ratings yet. Rate the last transition from the phone or the Studio page, then run this again.'
    : enoughData ? `${entries.length} rated plans. Differences between groups are descriptive; groups under ${MIN_GROUP} plans are marked too small, and no significance is computed.`
      : `Too few ratings (${entries.length} rated plans; at least ${MIN_TOTAL} are needed before even a rough pattern is worth reading). Treat everything below as individual anecdotes, not as findings.`;
  return {version: REPORT_VERSION, source: {lines: source.lines, skippedLines: source.skipped, ratingsEntries: all.length}, ratedPlans: entries.length,
    replacedRatings: all.length - entries.length, enoughData, verdict, byRating, groups, settingsLegend, negativeTagsByRecipe,
    best: best.map(summarize), worst: worst.map(summarize),
    notes: ['Counts only. No significance test is run and nothing here changes the planner (learning is a later slice).',
      'Groups overlap: the recipe, tempo band and choreography are chosen together, so a difference may belong to a different dimension than the one it appears under.',
      'One listener on a few songs is not a general result; phone speakers and the lossy MP3 stream hide bass and mud problems, so a PC rating is stronger evidence for those.',
      'Ratings record what the owner said, not measured quality. The pre-check column is the DJ\'s own offline model, not listening.']};
}

export function formatReport(report: TransitionReport): string {
  const lines: string[] = [];
  lines.push('EUTONOS Music transition ratings report', `${report.ratedPlans} rated plans from ${report.source.ratingsEntries} stored ratings (${report.replacedRatings} replaced by a later rating of the same plan; ${report.source.skippedLines} unreadable line(s) skipped)`, '', report.verdict, '');
  if (report.ratedPlans === 0) return lines.join('\n') + '\n';
  const b = report.byRating;
  lines.push(`Ratings: love ${b.love} | like ${b.like} | ok ${b.ok} | dislike ${b.dislike}`, '');
  for (const [name, rows] of Object.entries(report.groups)) {
    lines.push(`By ${name}:`);
    for (const r of rows) {
      lines.push(`  ${r.key.padEnd(44)} n=${String(r.n).padStart(3)}  love ${r.counts.love} like ${r.counts.like} ok ${r.counts.ok} dislike ${r.counts.dislike}  (liked ${percent(r.likedShare)}, disliked ${percent(r.dislikedShare)})${r.tooSmall ? '  [too small to read]' : ''}`);
    }
    lines.push('');
  }
  if (Object.keys(report.settingsLegend).length) {
    lines.push('Settings ids (DJ booth settings active when each plan was made):');
    for (const [id, s] of Object.entries(report.settingsLegend)) lines.push(`  ${id}: ${s.summary}`);
    lines.push('');
  }
  lines.push('Most common complaint tags per recipe:');
  for (const [recipe, tags] of Object.entries(report.negativeTagsByRecipe)) {
    lines.push(`  ${recipe}: ${tags.length ? tags.map(t => `${t.label} x${t.count}`).join(', ') : 'no complaint tags'}`);
  }
  const plan = (p: PlanSummary): string => `  ${p.planId} ${p.rating.toUpperCase()} (${p.at.slice(0, 10)}, ${p.device}): ${p.recipe}${p.choreography !== 'none' ? `/${p.choreography}` : ''}, overlap ${p.overlapBars ?? 'none'} bars` +
    `${p.swapMs !== null ? `, swap ${p.swapMs} ms` : ''}${p.gapBars !== null ? `, gap ${p.gapBars} bar(s)` : ''}, tempo gap ${p.tempoGapPercent}% (${p.tempoBand}), B enters ${percent(p.entryFraction)} in` +
    `${p.entryRank !== null ? ` (candidate #${p.entryRank + 1})` : ''}, ${p.mode}${p.seed !== null ? ` seed ${p.seed}` : ''}, pre-check ${p.precheck}` +
    `${p.fallbackAfterFailedChecks !== null ? ` after ${p.fallbackAfterFailedChecks} failed` : ''}${p.tags.length ? `, tags: ${p.tags.join(', ')}` : ''}${p.note ? `, note: "${p.note}"` : ''}`;
  lines.push('', `Best (loved/liked, newest first, up to ${SHOWN}):`, ...(report.best.length ? report.best.map(plan) : ['  none']));
  lines.push('', `Worst (disliked/ok, disliked first, up to ${SHOWN}):`, ...(report.worst.length ? report.worst.map(plan) : ['  none']));
  lines.push('', 'Read this carefully:', ...report.notes.map(n => `  - ${n}`));
  return lines.join('\n') + '\n';
}

async function run(args: readonly string[]): Promise<number> {
  let root = defaultFeedbackRoot, write = true;
  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--root' && args[i + 1]) root = resolve(args[++i]!);
    else if (args[i] === '--no-write') write = false;
    else { console.error('Usage: node dist/scripts/transitions-report.js [--root DIR] [--no-write]'); return 1; }
  }
  const file = new FeedbackFile(root);
  const stored = await file.readAll();
  const report = buildReport(stored.entries, {lines: stored.lines, skipped: stored.skipped});
  process.stdout.write(formatReport(report));
  if (write) {
    const target = join(file.directory, 'report.json');
    const info = await lstat(target).catch(() => null);
    if (info && (info.isSymbolicLink() || !info.isFile())) { console.error('report.json is not a plain file; not written.'); return 1; }
    await writeFile(target, JSON.stringify(report, null, 2) + '\n', {flag: 'w'});
    console.log(`Wrote ${target}`);
  }
  return 0;
}
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  run(process.argv.slice(2)).then(code => { process.exitCode = code; }, error => { console.error(error instanceof Error ? error.message : String(error)); process.exitCode = 1; });
}
