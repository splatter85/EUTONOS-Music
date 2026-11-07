import {loadBrowserPack, type LoadedBrowserPack} from '../src/browser-pack.js';
import {compilePhrase, type ProceduralPlan} from '../src/phrase-plan.js';
import {SmallPlayer} from '../src/player.js';

const element = <T extends HTMLElement>(id: string): T => {
  const found = document.getElementById(id);
  if (!found) throw new Error(`Missing sampler control: ${id}`);
  return found as T;
};
const seed = element<HTMLInputElement>('seed'), state = element<HTMLSelectElement>('state');
const packInput = element<HTMLSelectElement>('pack');
// Only bundled, eligible engineering fixtures are selectable. No URL import or DJ policy change.
const packs = {
  s01: {manifest: '/fixtures/s01/manifest.json', label: 'S01 original palette'},
  'mock-fl': {manifest: '/generated/s06-mock-fl/pack/manifest.json', label: 'S06 imported mock palette'},
  fl: {manifest: '/local/s09-fl/pack/manifest.json', label: 'S09 real FL palette (owner-local)'},
} as const;
const isPack = (value: string): value is keyof typeof packs => Object.hasOwn(packs, value);
type PackChoice = keyof typeof packs;
let selectedPack: PackChoice = 's01';
let loadingPack = false, loadEpoch = 0;
const play = element<HTMLButtonElement>('play'), pause = element<HTMLButtonElement>('pause');
const stop = element<HTMLButtonElement>('stop'), mute = element<HTMLButtonElement>('mute');
const volume = element<HTMLInputElement>('volume'), progress = element<HTMLProgressElement>('progress');
let loaded: LoadedBrowserPack | null = null, player: SmallPlayer | null = null;
let plan: ProceduralPlan | null = null, activePlan: ProceduralPlan | null = null;
let ownership: Promise<void> | null = null, releaseLock: (() => void) | null = null;
let leaseEpoch = 0, operation = 0, muted = false, pauseReason = '';

function setText(id: string, value: string): void {
  const target = element(id);
  if (target.textContent !== value) target.textContent = value;
}
const message = (error: unknown): string => error instanceof Error ? error.message : String(error);
function releaseOwnership(): void {
  ++leaseEpoch;
  releaseLock?.(); releaseLock = null; ownership = null;
}
function acquireOwnership(): Promise<void> {
  if (ownership) return ownership;
  const epoch = leaseEpoch;
  ownership = new Promise<void>((resolve, reject) => {
    // Use the recording DJ's existing lock, including across these two pages.
    void navigator.locks.request('eutonos-music-s02-playback', {ifAvailable: true}, lock => {
      if (epoch !== leaseEpoch) { reject(new Error('Playback was cancelled.')); return; }
      if (!lock) { reject(new Error('Another tab owns playback. Press Stop there, then Play here.')); return; }
      return new Promise<void>(release => { releaseLock = release; resolve(); });
    }).catch(reject);
  }).catch(error => { if (epoch === leaseEpoch) ownership = null; throw error; });
  return ownership;
}
function prepareSelection(): void {
  plan = null;
  setText('error', '');
  if (!loaded) return;
  try {
    if (!/^\d{1,10}$/.test(seed.value)) throw new Error('Enter a whole-number seed from 0 through 4294967295.');
    const selectedState = state.value;
    if (selectedState !== 'explore' && selectedState !== 'drive') throw new Error('Choose Explore or Drive.');
    const recipe = loaded.pack.recipes[0];
    if (!recipe) throw new Error('The selected pack has no performer recipe.');
    plan = compilePhrase(loaded.pack, {recipe: {id: recipe.id, revision: recipe.revision},
      seed: Number(seed.value), state: selectedState, allowFixtures: true});
  } catch (error) { setText('error', message(error)); }
  render();
}
function getPlayer(): SmallPlayer {
  if (player) return player;
  if (!loaded) throw new Error('The sample palette is still loading.');
  const route = loaded.pack.routes[0];
  if (!route) throw new Error('The selected pack has no playable route.');
  const context = new AudioContext();
  try { player = new SmallPlayer(context, loaded, route.id); }
  catch (error) { void context.close().catch(() => undefined); throw error; }
  player.setVolume(Number(volume.value)); player.setMuted(muted);
  return player;
}
async function begin(): Promise<void> {
  if (!plan) return;
  const epoch = ++operation;
  setText('error', ''); pauseReason = '';
  const selected = plan;
  let owner: SmallPlayer | null = null;
  try {
    owner = getPlayer(); activePlan = selected;
    await owner.playProcedural(selected, acquireOwnership());
  } catch (error) { if (epoch === operation && owner === player) setText('error', message(error)); }
  finally { render(); }
}
async function pauseOrResume(hidden = false): Promise<void> {
  const owner = player;
  if (!owner) return;
  const epoch = ++operation;
  setText('error', '');
  try {
    if (!hidden && owner.snapshot().state === 'paused') {
      pauseReason = '';
      await owner.resume(acquireOwnership());
    } else {
      pauseReason = hidden ? 'Paused because this tab became hidden. Press Resume to continue.' : '';
      await owner.pause();
    }
  } catch (error) { if (epoch === operation && player === owner) setText('error', message(error)); }
  finally { render(); }
}
play.addEventListener('click', () => { void begin(); });
pause.addEventListener('click', () => { void pauseOrResume(); });
stop.addEventListener('click', () => {
  ++operation; player?.stop(); activePlan = null; pauseReason = ''; releaseOwnership(); setText('error', ''); render();
});
mute.addEventListener('click', () => { muted = !muted; player?.setMuted(muted); render(); });
volume.addEventListener('input', () => { player?.setVolume(Number(volume.value)); });
seed.addEventListener('input', prepareSelection); state.addEventListener('change', prepareSelection);
packInput.addEventListener('change', () => { void selectPack(packInput.value); });

function render(): void {
  const snapshot = player?.snapshot(), status = snapshot?.state ?? 'idle';
  const running = ['loading', 'scheduled', 'playing', 'paused'].includes(status);
  seed.disabled = state.disabled = running;
  packInput.disabled = loadingPack || running;
  play.disabled = !plan || running || status === 'closed';
  pause.disabled = !running; pause.textContent = status === 'paused' ? 'Resume' : 'Pause';
  stop.disabled = !loaded || status === 'closed'; mute.disabled = !loaded;
  mute.textContent = muted ? 'Unmute' : 'Mute'; mute.setAttribute('aria-pressed', String(muted));
  setText('selection-title', plan ? `Seed ${plan.seed} · ${plan.state}` : 'No valid selection');
  setText('selection-detail', plan ? `${packs[selectedPack].label} · rhythm plan ready · ${plan.events.length} sample events · 120 BPM · A minor` : 'No plan prepared. Choose an available palette and valid seed.');
  setText('now-title', snapshot?.now.length && activePlan ? `Seed ${activePlan.seed} · ${activePlan.state}` : 'Nothing playing');
  setText('now-detail', `${status}${muted ? ' · muted' : ''} · ${(snapshot?.elapsedSeconds ?? 0).toFixed(1)}s / ${(snapshot?.durationSeconds ?? 0).toFixed(1)}s`);
  setText('status', status === 'loading' ? 'Preparing playback…' : status === 'closed' ? 'Player closed — reload to start a new session.' : status === 'ended' ? 'Performance ended — replay or choose another seed.' : status === 'paused' ? pauseReason || 'Paused — the audio clock is suspended.' : status === 'playing' ? 'Playing the prepared phrase plan' : status === 'scheduled' ? 'Scheduled — waiting for the audio clock' : loaded ? `Ready — ${packs[selectedPack].label} — press Play variation to start` : loadingPack ? 'Loading palette…' : 'Palette unavailable — choose a palette.');
  progress.value = snapshot?.durationSeconds ? snapshot.elapsedSeconds / snapshot.durationSeconds : 0;
  setText('clock-detail', snapshot ? `${snapshot.contextState} · ${snapshot.sampleRate} Hz · frame ${snapshot.currentFrame} · generation ${snapshot.engineGeneration}` : 'The audio context starts on your first Play.');
  setText('plan-detail', plan ? `Recipe ${plan.recipe.id}@${plan.recipe.revision} · palette ${plan.palette.id}@${plan.palette.revision} · performer ${plan.performer.id}@${plan.performer.revision}. One finite 32-quarter plan; each sample keeps its original pitch. No model or DAW is involved in playback.` : 'No plan prepared.');
  if (ownership && snapshot && ['idle', 'ended', 'closed'].includes(status)) releaseOwnership();
}
document.addEventListener('visibilitychange', () => {
  if (document.hidden && player && ['loading', 'scheduled', 'playing'].includes(player.snapshot().state)) void pauseOrResume(true);
});
window.addEventListener('pagehide', () => {
  ++operation; ++loadEpoch; const previous = player; player = null; activePlan = null;
  void previous?.dispose().catch(() => undefined); releaseOwnership();
});
window.addEventListener('pageshow', event => {
  // A restored page may have left while a pack read was pending. Revalidate it;
  // a stale read must neither strand the picker nor prepare playback on return.
  if (event.persisted) void initialize();
  else render();
});
async function initialize(): Promise<void> {
  try {
    if (!window.isSecureContext || !window.AudioContext || !navigator.locks || !crypto.subtle) throw new Error('Use a current browser on http://127.0.0.1 or HTTPS with Web Audio and Web Locks support.');
    await selectPack(new URL(location.href).searchParams.get('pack') ?? 's01');
  } catch (error) { setText('loading', 'Palette unavailable — fix the error and reload.'); setText('error', message(error)); }
  render();
}
async function selectPack(choice: string): Promise<void> {
  const epoch = ++loadEpoch;
  ++operation;
  const previous = player;
  player = null; loaded = null; plan = null; activePlan = null; pauseReason = '';
  loadingPack = true;
  // dispose gates output synchronously; no new context is made until explicit Play.
  const disposed = previous?.dispose();
  releaseOwnership();
  setText('error', ''); setText('loading', 'Loading and validating the selected palette…'); render();
  try {
    await disposed;
    if (epoch !== loadEpoch) return;
    if (!isPack(choice)) throw new Error('Unknown palette. Choose S01 original, S06 imported mock or S09 real FL.');
    selectedPack = choice; packInput.value = choice;
    const url = new URL(location.href); url.searchParams.set('pack', choice);
    history.replaceState(null, '', url);
    const candidate = await loadBrowserPack(new URL(packs[choice].manifest, location.href), true);
    if (epoch !== loadEpoch) return;
    loaded = candidate;
    setText('loading', `${packs[choice].label} · four samples · eight bars · ${choice === 'fl' ? 'rendered by FL Studio on this PC' : 'no FL Studio required'}`);
    prepareSelection();
  } catch (error) {
    if (epoch === loadEpoch) {
      // Clear the picker so choosing any palette, including the same one, retries.
      packInput.selectedIndex = -1;
      if (!isPack(choice)) {
        const url = new URL(location.href); url.searchParams.delete('pack');
        history.replaceState(null, '', url);
      }
      setText('loading', 'Palette unavailable — choose a palette to retry.');
      setText('error', message(error));
    }
  } finally {
    if (epoch === loadEpoch) { loadingPack = false; render(); }
  }
}
function frame(): void { render(); requestAnimationFrame(frame); }
void initialize(); requestAnimationFrame(frame);
