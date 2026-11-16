import assert from 'node:assert/strict';
import {test} from 'node:test';
import {AUTOPLAY_FLAG, browserArgs, browserCandidates, findBrowser, parseHostArgs} from '../scripts/phone-host.js';
import {audioNeedsClick, GATE_DELAY_MS} from '../web/audio-gate.js';
import {audioPlan, phoneView, PRESS_GRACE_MS, type PhoneUiInput} from '../web/phone-ui.js';
import {plainRecipe} from '../web/phone-transition.js';

const base: PhoneUiInput = {relayReachable: true, djConnected: true, djState: 'idle', canPlay: true, canStop: false, commandFailed: false, audio: 'off'};

test('phone Play/Pause reflects the relay state, not a guess', () => {
  assert.equal(phoneView({...base, relayReachable: false}).mode, 'unreachable');
  assert.equal(phoneView({...base, relayReachable: false}).disabled, true);
  assert.equal(phoneView({...base, djConnected: false}).mode, 'no-dj');
  const idle = phoneView(base);
  assert.deepEqual([idle.mode, idle.button, idle.action, idle.disabled], ['idle', 'Play', 'play', false]);
  assert.equal(phoneView({...base, canPlay: false}).disabled, true, 'nothing to play yet');
  const loading = phoneView({...base, djState: 'loading'});
  assert.deepEqual([loading.mode, loading.button, loading.action], ['loading', 'Starting…', 'pause']);
  const playing = phoneView({...base, djState: 'playing', audio: 'playing'});
  assert.deepEqual([playing.mode, playing.button, playing.action], ['playing', 'Pause', 'pause']);
  assert.equal(phoneView({...base, djState: 'scheduled', audio: 'connecting'}).mode, 'playing');
  const click = phoneView({...base, djState: 'needs-click'});
  assert.equal(click.mode, 'needs-click');
  assert.match(click.message, /Tap play on the PC page once/);
  assert.equal(phoneView({...base, djState: 'paused', canPlay: false}).disabled, false);
  const failed = phoneView({...base, commandFailed: true});
  assert.deepEqual([failed.mode, failed.action], ['error', 'play']);
});

test('blocked phone audio asks for one tap with a one-line hint and no extra button', () => {
  const view = phoneView({...base, djState: 'playing', audio: 'blocked'});
  assert.equal(view.action, 'listen');
  assert.match(view.hint, /Tap once/);
  assert.equal(phoneView({...base, djState: 'playing', audio: 'playing'}).hint, '');
});

test('phone audio attaches when the DJ plays, once per spell, never against a Pause, and detaches after a real stop', () => {
  const plan = {djConnected: true, djState: 'playing', audio: 'off' as const, byPress: false, userPaused: false, autoTried: false, msSincePress: 1e9};
  assert.equal(audioPlan(plan), 'attach');
  assert.equal(audioPlan({...plan, autoTried: true}), 'keep');
  assert.equal(audioPlan({...plan, userPaused: true}), 'keep');
  assert.equal(audioPlan({...plan, djConnected: false}), 'keep');
  assert.equal(audioPlan({...plan, djState: 'idle'}), 'keep');
  const on = {...plan, audio: 'playing' as const, djState: 'idle'};
  assert.equal(audioPlan(on), 'detach');
  assert.equal(audioPlan({...on, byPress: true, msSincePress: 1000}), 'keep', 'grace right after a Play press');
  assert.equal(audioPlan({...on, byPress: true, msSincePress: PRESS_GRACE_MS + 1}), 'detach');
  assert.equal(audioPlan({...on, djState: 'playing'}), 'keep');
});

test('the PC page reports needs-click only for a Play that stays loading on a suspended context', () => {
  const input = {playerState: 'loading', contextState: 'suspended', loadingMs: GATE_DELAY_MS};
  assert.equal(audioNeedsClick(input), true);
  assert.equal(audioNeedsClick({...input, loadingMs: GATE_DELAY_MS - 1}), false);
  assert.equal(audioNeedsClick({...input, contextState: 'running'}), false);
  assert.equal(audioNeedsClick({...input, playerState: 'playing'}), false);
});

test('transition recipes are described in plain words', () => {
  assert.equal(plainRecipe('blend', {name: 'bass-swap-classic'}), 'Bass swap');
  assert.equal(plainRecipe('blend', {name: 'bass-drop-handover', gapBars: 2}), 'Bass handover with 2-bar gap');
  assert.equal(plainRecipe('blend', {name: 'tone-dissolve'}), 'Smooth blend');
  assert.equal(plainRecipe('blend'), 'Smooth blend');
  assert.equal(plainRecipe('echo-out'), 'Echo out');
  assert.equal(plainRecipe('filter-sweep'), 'Filter sweep');
  assert.equal(plainRecipe('meet-in-middle'), 'Tempo meet in the middle');
  assert.equal(plainRecipe('fallback-cut'), 'Clean cut (last resort)');
  assert.equal(plainRecipe('something-new'), 'something-new');
});

test('the phone host launcher uses the autoplay flag, a throwaway profile and never the real profile', () => {
  const args = browserArgs('http://127.0.0.1:4173/studio.html?pack=set#relayToken=abc', '/tmp/eutonos-phone-host-x', true);
  assert.ok(args.includes(AUTOPLAY_FLAG));
  assert.equal(AUTOPLAY_FLAG, '--autoplay-policy=no-user-gesture-required');
  assert.ok(args.includes('--user-data-dir=/tmp/eutonos-phone-host-x'));
  assert.ok(args.includes('--app=http://127.0.0.1:4173/studio.html?pack=set#relayToken=abc'));
  assert.ok(args.includes('--start-minimized'));
  assert.ok(!browserArgs('http://x/', '/tmp/p', false).includes('--start-minimized'));
  const win = browserCandidates('win32', {'ProgramFiles(x86)': 'C:\\PF86', ProgramFiles: 'C:\\PF'});
  assert.ok(win[0]!.endsWith('msedge.exe') && win.some(path => path.endsWith('chrome.exe')), 'Edge first, Chrome as fallback');
  assert.equal(findBrowser('win32', {ProgramFiles: 'C:\\PF'}, path => path.endsWith('chrome.exe')), 'C:\\PF\\Google\\Chrome\\Application\\chrome.exe');
  assert.equal(findBrowser('linux', {PATH: '/nowhere'}, () => false), null);
  assert.deepEqual(parseHostArgs([]), {browser: null, open: true, minimized: true, ffmpeg: 'ffmpeg'});
  assert.deepEqual(parseHostArgs(['--no-browser', '--visible']), {browser: null, open: false, minimized: false, ffmpeg: 'ffmpeg'});
  assert.equal(typeof parseHostArgs(['--bogus']), 'string');
});
