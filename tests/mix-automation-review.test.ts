/** Independent review reproductions for failed opt-in graph commits. */
import assert from 'node:assert/strict';
import test from 'node:test';
import {bassSwapAutomation, createMixAutomationGraph} from '../src/mix-automation.js';
import {RecordedSource, WebAudioClock} from '../src/web-audio.js';
import {bufferDouble, ContextDouble, fixturePack, NodeDouble, ParameterDouble} from './audio-double.js';

class ReviewFilter extends NodeDouble {
  type: BiquadFilterType = 'lowpass';
  frequency = new ParameterDouble();
  Q = new ParameterDouble();
  gain = new ParameterDouble();
}
class ReviewContext extends ContextDouble {
  readonly filters: ReviewFilter[] = [];
  createBiquadFilter(): BiquadFilterNode {
    const filter = new ReviewFilter(this.audio);
    this.filters.push(filter);
    return filter as unknown as BiquadFilterNode;
  }
}
const {pack} = await fixturePack(), asset = pack.assets.find(a => a.source_kind === 'recording')!;
const rate = 48000;
async function prepared() {
  const context = new ReviewContext(), clock = new WebAudioClock(context.audio);
  const source = new RecordedSource(context.audio, {asset, buffer: bufferDouble(rate,
    Math.round(asset.file.frames * rate / asset.file.sample_rate), asset.file.channels)},
  context.destination, {allowFixtures: true});
  await source.prepare(clock);
  return {context, clock, source, node: context.sources[0]!};
}
function disconnected(context: ReviewContext): void {
  assert.ok(context.filters.every(n => n.connections.length === 0), 'all failed filter nodes disconnected');
  assert.ok(context.gains.slice(1).every(n => n.connections.length === 0), 'all failed dry/wet gains disconnected');
}

test('review: incoming native start failure releases graph and leaves no scheduled voice', async () => {
  const {context, clock, source, node} = await prepared();
  const original = [...node.connections], originalStart = node.start.bind(node);
  node.start = () => { throw new Error('injected native start failure'); };
  assert.throws(() => source.scheduleMixStart(clock.stamp(rate), 0,
    bassSwapAutomation(rate, rate).incoming), /injected native start failure/);
  assert.deepEqual(node.connections, original);
  assert.deepEqual(node.starts, []);
  assert.equal(source.endFrame, 0);
  disconnected(context);
  assert.ok(context.gains[0]!.gain.calls.some(c => c.kind === 'cancel' && c.time === 1),
    'future source gain/EOF events were cancelled');
  node.start = originalStart;
  source.scheduleMixStart(clock.stamp(rate), 0, bassSwapAutomation(rate, rate).incoming);
  assert.equal(node.starts.length, 1, 'the prepared source can be retried once');
  source.release();
});

test('review: outgoing native stop failure restores A graph and original end', async () => {
  const {context, clock, source, node} = await prepared();
  source.scheduleStart({at: clock.stamp(rate), entryCueId: 'entry'});
  const original = [...node.connections], end = source.endFrame, originalStop = node.stop.bind(node);
  node.stop = () => { throw new Error('injected native stop failure'); };
  assert.throws(() => source.transitionMixOut(clock.stamp(rate * 3), rate * 2,
    bassSwapAutomation(rate, rate).outgoing), /injected native stop failure/);
  assert.deepEqual(node.connections, original);
  assert.deepEqual(node.stops, []);
  assert.equal(source.endFrame, end);
  disconnected(context);
  node.stop = originalStop;
  source.transitionMixOut(clock.stamp(rate * 3), rate * 2, bassSwapAutomation(rate, rate).outgoing);
  assert.equal(source.endFrame, rate * 4);
  assert.equal(source.cancelTransition(), true);
  assert.deepEqual(node.connections, original);
  assert.equal(source.endFrame, end);
  source.release();
});

test('review: a partial source reconnection failure restores the sole original path', () => {
  const context = new ReviewContext(), input = context.createBufferSource(), output = context.createGain();
  input.connect(output);
  const node = context.sources[0]!, originalConnect = node.connect.bind(node);
  let calls = 0;
  node.connect = destination => {
    if (++calls === 2) throw new Error('injected second graph connection failure');
    return originalConnect(destination);
  };
  assert.throws(() => createMixAutomationGraph(context.audio, input, output, rate,
    bassSwapAutomation(rate, rate).outgoing), /injected second graph connection failure/);
  assert.deepEqual(node.connections, [output]);
  disconnected(context);
  const retry = createMixAutomationGraph(context.audio, input, output, rate,
    bassSwapAutomation(rate, rate).outgoing);
  retry.restore();
  assert.deepEqual(node.connections, [output]);
});
