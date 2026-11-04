import assert from 'node:assert/strict';
import test from 'node:test';
import { CONTROL_LIMITS, CONTROL_VERSION, ControlContract } from '../src/control.js';
import type { CommandReceipt, ControlRequest, PreparedPlan } from '../src/control.js';

const catalog = {
  tracks: [{ id: 'a', available: true }, { id: 'b', available: true }, { id: 'offline', available: false }],
  genres: [{ id: 'ambient', available: true }, { id: 'offline', available: false }],
};
const base = (commandId: string, expectedRevision: number, source: 'manual' | 'automation' = 'manual') =>
  ({ schemaVersion: CONTROL_VERSION, commandId, expectedRevision, source });
const accepted = (receipt: CommandReceipt): void => { assert.equal(receipt.status, 'accepted'); };
const rejected = (receipt: CommandReceipt, code: string): void => {
  assert.equal(receipt.status, 'rejected');
  if (receipt.status === 'rejected') assert.equal(receipt.code, code);
};

test('exact canonical replay precedes stale checks; conflicts never enqueue twice', () => {
  const control = new ControlContract(catalog, 7);
  const first: ControlRequest = { ...base('one', 0), type: 'queueTrack', trackId: 'a' };
  const receipt = control.accept(first);
  accepted(receipt);
  accepted(control.accept({ ...base('two', 1), type: 'setState', state: 'drive' }));
  assert.deepEqual(control.accept({ trackId: 'a', type: 'queueTrack', ...base('one', 0) }), receipt);
  assert.equal(control.snapshot().revision, 2);
  assert.equal(control.snapshot().queue.length, 1);
  rejected(control.accept({ ...first, trackId: 'b' }), 'id-conflict');
  rejected(control.accept({ ...base('new-stale', 0), type: 'nextSong' }), 'stale-revision');
  const bad: ControlRequest = { ...base('missing', 2), type: 'queueTrack', trackId: 'missing' };
  const badReceipt = control.accept(bad);
  accepted(control.accept({ ...base('three', 2), type: 'nextSong' }));
  assert.deepEqual(control.accept(bad), badReceipt, 'rejected receipt also replays unchanged');
});

test('manual queue has FIFO precedence over a supplied automated candidate', () => {
  const control = new ControlContract(catalog, 7);
  accepted(control.accept({ ...base('a1', 0), type: 'queueTrack', trackId: 'a' }));
  accepted(control.accept({ ...base('b1', 1), type: 'queueTrack', trackId: 'b' }));
  assert.equal(control.peekNext('b'), 'a');
  assert.equal(control.snapshot().queue.length, 2, 'peek does not consume');
  assert.throws(() => control.acknowledgeQueueHead('b1', 2), /not-queue-head/);
  assert.throws(() => control.acknowledgeQueueHead('a1', 1), /stale-revision/);
  control.acknowledgeQueueHead('a1', 2);
  assert.equal(control.peekNext('a'), 'b');
  control.acknowledgeQueueHead('b1', 3);
  assert.equal(control.peekNext('a'), 'a');
  assert.equal(control.peekNext('offline'), null);
  assert.equal(control.peekNext('missing'), null);
  assert.equal(control.peekNext(), null);
});

test('missing and unavailable track/genre errors are distinct and leave intent unchanged', () => {
  const control = new ControlContract(catalog, 7);
  const before = control.snapshot();
  rejected(control.accept({ ...base('t1', 0), type: 'queueTrack', trackId: 'missing' }), 'missing-track');
  rejected(control.accept({ ...base('t2', 0), type: 'queueTrack', trackId: 'offline' }), 'unavailable-track');
  rejected(control.accept({ ...base('g1', 0), type: 'requestGenre', genreId: 'missing' }), 'missing-genre');
  rejected(control.accept({ ...base('g2', 0), type: 'requestGenre', genreId: 'offline' }), 'unavailable-genre');
  assert.deepEqual(control.snapshot(), before);
  accepted(control.accept({ ...base('g3', 0), type: 'requestGenre', genreId: 'ambient' }));
  assert.equal(control.snapshot().requested.genreId, 'ambient');
});

test('Hold freezes target changes, preserves manual queue/next, and release does not restore rejected intent', () => {
  const control = new ControlContract(catalog, 7);
  accepted(control.accept({ ...base('hold', 0), type: 'hold', enabled: true }));
  assert.equal(control.peekNext('b'), 'b', 'Hold does not freeze selection within the held target');
  rejected(control.accept({ ...base('auto', 1, 'automation'), type: 'setState', state: 'surge' }), 'held');
  rejected(control.accept({ ...base('manual-state', 1), type: 'setState', state: 'drive' }), 'held');
  rejected(control.accept({ ...base('genre', 1), type: 'requestGenre', genreId: 'ambient' }), 'held');
  accepted(control.accept({ ...base('queue', 1), type: 'queueTrack', trackId: 'a' }));
  accepted(control.accept({ ...base('next', 2), type: 'nextSong' }));
  rejected(control.accept({ ...base('auto-release', 3, 'automation'), type: 'hold', enabled: false }), 'manual-only');
  accepted(control.accept({ ...base('release', 3), type: 'hold', enabled: false }));
  assert.equal(control.snapshot().requested.state, 'browse');
  assert.equal(control.snapshot().requested.nextRequests, 1);
  assert.equal(control.peekNext('b'), 'a');
  accepted(control.accept({ ...base('fresh-auto', 4, 'automation'), type: 'setState', state: 'drive' }));
  assert.equal(control.snapshot().requested.state, 'drive');
});

test('accepted transport is immediate intent; requested, prepared and audible state remain distinct', () => {
  const control = new ControlContract(catalog, 7);
  accepted(control.accept({ ...base('state', 0), type: 'setState', state: 'drive' }));
  assert.equal(control.snapshot().audible, null);
  assert.equal(control.snapshot().planned, null);
  const plan: PreparedPlan = { forRevision: 1, source: { id: 'a', revision: 1 }, at: { engineGeneration: 7, frame: 1000 } };
  control.reportPrepared(plan);
  assert.deepEqual(control.snapshot().planned, plan);
  assert.equal(control.snapshot().audible, null, 'prepared is not audible');
  const audible = { source: { id: 'a', revision: 1 }, state: 'browse' as const,
    transport: 'playing' as const, muted: false, at: { engineGeneration: 7, frame: 1000 } };
  control.reportAudible(audible);
  assert.deepEqual(control.accept({ ...base('mute', 1), type: 'transport', action: 'mute' }), {
    commandId: 'mute', status: 'accepted', revision: 2, execution: 'pending', urgency: 'immediate',
  });
  assert.equal(control.snapshot().requested.muted, true);
  assert.equal(control.snapshot().planned, null, 'unstarted plan invalidated by new intent');
  assert.deepEqual(control.snapshot().audible, audible, 'acceptance cannot claim an audible effect');
  rejected(control.accept({ ...base('auto-stop', 2, 'automation'), type: 'transport', action: 'stop' }), 'manual-only');
  accepted(control.accept({ ...base('stop', 2), type: 'transport', action: 'stop' }));
  assert.equal(control.snapshot().requested.transport, 'stopped');
  assert.equal(control.snapshot().audible?.transport, 'playing');
  assert.throws(() => control.reportPrepared(plan), /stale-revision/);
  assert.throws(() => control.reportPrepared({ ...plan, forRevision: 3, at: { engineGeneration: 6, frame: 2000 } }), /stale-generation/);
  assert.throws(() => control.reportAudible({ ...audible, at: { engineGeneration: 6, frame: 2000 } }), /stale-generation/);
  assert.throws(() => control.reportAudible({ ...audible, at: { engineGeneration: 7, frame: 999 } }), /stale-audible-frame/);
  assert.throws(() => control.reportAudible({ ...audible, at: { engineGeneration: 7, frame: NaN } }), /invalid-frame/);
  audible.source.id = 'mutated';
  assert.equal(control.snapshot().audible?.source?.id, 'a', 'reports are copied');
});

test('queue is bounded; session replay history never blocks fresh manual Stop or Mute', () => {
  const control = new ControlContract(catalog, 7);
  for (let i = 0; i < CONTROL_LIMITS.queue; i += 1) {
    accepted(control.accept({ ...base(`q${i}`, i), type: 'queueTrack', trackId: 'a' }));
  }
  rejected(control.accept({ ...base('overflow', CONTROL_LIMITS.queue), type: 'queueTrack', trackId: 'a' }), 'queue-full');
  const bounded = new ControlContract(catalog, 7);
  const first: ControlRequest = { ...base('0', 0), type: 'nextSong' };
  const receipt = bounded.accept(first);
  for (let i = 1; i < 300; i += 1) {
    accepted(bounded.accept({ ...base(String(i), i), type: 'nextSong' }));
  }
  accepted(bounded.accept({ ...base('stop', 300), type: 'transport', action: 'stop' }));
  accepted(bounded.accept({ ...base('mute', 301), type: 'transport', action: 'mute' }));
  assert.deepEqual(bounded.accept(first), receipt);
  assert.equal(bounded.snapshot().requested.nextRequests, 300);
  assert.equal(bounded.snapshot().requested.transport, 'stopped');
  assert.equal(bounded.snapshot().requested.muted, true);
});

test('invalid control values and duplicate catalog IDs fail clearly', () => {
  assert.throws(() => new ControlContract({ ...catalog, tracks: [...catalog.tracks, catalog.tracks[0]!] }, 7), /unique/);
  assert.throws(() => new ControlContract(catalog, -1), /generation/);
  const control = new ControlContract(catalog, 7);
  rejected(control.accept({ ...base('invalid', 0), type: 'setState', state: 'unknown' } as unknown as ControlRequest), 'invalid-request');
  rejected(control.accept({ ...base('invalid-rev', 0.5), type: 'nextSong' }), 'invalid-request');
  rejected(control.accept({ ...base('', 0), type: 'nextSong' }), 'invalid-request');
  const snapshot = control.snapshot();
  Object.assign(snapshot.requested, { state: 'surge' });
  assert.equal(control.snapshot().requested.state, 'browse', 'snapshot mutations cannot change the session');
});

test('cancellation is revisioned, manual-only and replayable; genre can be cleared explicitly', () => {
  const control = new ControlContract(catalog, 7, 'explore');
  accepted(control.accept({...base('q', 0), type: 'queueTrack', trackId: 'a'}));
  rejected(control.accept({...base('auto-cancel', 1, 'automation'), type: 'cancelQueue', queueCommandId: 'q'}), 'manual-only');
  const cancel: ControlRequest = {...base('cancel', 1), type: 'cancelQueue', queueCommandId: 'q'};
  const receipt = control.accept(cancel);
  accepted(receipt);
  assert.equal(control.snapshot().queue.length, 0);
  assert.deepEqual(control.accept(cancel), receipt);
  rejected(control.accept({...base('missing-cancel', 2), type: 'cancelQueue', queueCommandId: 'q'}), 'missing-queue-entry');
  accepted(control.accept({...base('genre', 2), type: 'requestGenre', genreId: 'ambient'}));
  accepted(control.accept({...base('clear-genre', 3), type: 'requestGenre', genreId: null}));
  assert.equal(control.snapshot().requested.genreId, null);
  accepted(control.accept({...base('cancel-next', 4), type: 'cancelNext'}));
  rejected(control.accept({...base('auto-cancel-next', 5, 'automation'), type: 'cancelNext'}), 'manual-only');
});

test('renderer generation changes clear evidence without losing queue or receipt identity', () => {
  const control = new ControlContract(catalog, 7);
  const request: ControlRequest = {...base('q', 0), type: 'queueTrack', trackId: 'a'};
  const receipt = control.accept(request);
  control.reportPrepared({forRevision: 1, source: {id: 'a', revision: 1}, at: {engineGeneration: 7, frame: 1000}});
  control.reportAudible({source: null, state: null, transport: 'stopped', muted: false, at: {engineGeneration: 7, frame: 500}});
  control.adoptEngineGeneration(9);
  assert.equal(control.snapshot().planned, null);
  assert.equal(control.snapshot().audible, null);
  assert.equal(control.snapshot().queue.length, 1);
  assert.deepEqual(control.accept(request), receipt);
  assert.throws(() => control.adoptEngineGeneration(8), /stale-generation/);
  assert.throws(() => control.reportAudible({source: null, state: null, transport: 'stopped', muted: false, at: {engineGeneration: 7, frame: 600}}), /stale-generation/);
});
