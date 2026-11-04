/**
 * Deterministic Web Audio call recorder for transport/lifecycle tests only.
 * It neither renders samples nor establishes browser/device playback behavior.
 */
import {readFile} from 'node:fs/promises';
import {readPcm16Wav} from '../src/audio.js';
import type {LoadedBrowserPack} from '../src/browser-pack.js';
import {validatePackManifest} from '../src/pack.js';

export function deferred() {
  let release!: () => void;
  let reject!: (reason: unknown) => void;
  const promise = new Promise<void>((resolve, fail) => { release = resolve; reject = fail; });
  return {promise, release, reject};
}

export type AutomationCall =
  | {kind: 'set' | 'ramp'; value: number; time: number}
  | {kind: 'cancel'; time: number};

export class ParameterDouble {
  value = 1;
  readonly calls: AutomationCall[] = [];
  setValueAtTime(value: number, time: number): this {
    this.calls.push({kind: 'set', value, time});
    return this;
  }
  linearRampToValueAtTime(value: number, time: number): this {
    this.calls.push({kind: 'ramp', value, time});
    return this;
  }
  cancelScheduledValues(time: number): this {
    this.calls.push({kind: 'cancel', time});
    return this;
  }
}

export class NodeDouble {
  readonly connections: AudioNode[] = [];
  disconnectCalls = 0;
  constructor(readonly context: BaseAudioContext) {}
  connect(target: AudioNode): AudioNode { this.connections.push(target); return target; }
  disconnect(): void { this.disconnectCalls++; this.connections.length = 0; }
}

export class GainDouble extends NodeDouble {
  readonly gain = new ParameterDouble();
}

export class SourceDouble extends NodeDouble {
  buffer: AudioBuffer | null = null;
  onended: ((event: Event) => void) | null = null;
  readonly starts: {when: number; offset: number}[] = [];
  readonly stops: number[] = [];
  start(when = 0, offset = 0): void {
    if (this.starts.length) throw new Error('A buffer source starts only once.');
    this.starts.push({when, offset});
  }
  stop(when = 0): void {
    if (!this.starts.length) throw new Error('A buffer source must start before stop.');
    this.stops.push(when);
  }
  finish(): void { this.onended?.(new Event('ended')); }
}

export function bufferDouble(sampleRate: number, length: number, channels = 1): AudioBuffer {
  return {sampleRate, length, numberOfChannels: channels, duration: length / sampleRate} as AudioBuffer;
}

export class ContextDouble extends EventTarget {
  currentTime = 0;
  state: AudioContextState = 'suspended';
  readonly destination: AudioDestinationNode;
  readonly sources: SourceDouble[] = [];
  readonly gains: GainDouble[] = [];
  readonly decodedInputBytes: number[] = [];
  resumeCalls = 0;
  suspendCalls = 0;
  closeCalls = 0;
  resumeGate: ReturnType<typeof deferred> | null = null;
  decodeGate: ReturnType<typeof deferred> | null = null;

  constructor(readonly sampleRate = 48_000) {
    super();
    this.destination = new NodeDouble(this.audio) as unknown as AudioDestinationNode;
  }
  get audio(): AudioContext { return this as unknown as AudioContext; }
  createGain(): GainNode {
    const node = new GainDouble(this.audio);
    this.gains.push(node);
    return node as unknown as GainNode;
  }
  createBufferSource(): AudioBufferSourceNode {
    const node = new SourceDouble(this.audio);
    this.sources.push(node);
    return node as unknown as AudioBufferSourceNode;
  }
  async decodeAudioData(input: ArrayBuffer): Promise<AudioBuffer> {
    this.decodedInputBytes.push(input.byteLength);
    // Real decodeAudioData may detach its input. Exercise that ownership boundary.
    const transferred = structuredClone(input, {transfer: [input]});
    const info = readPcm16Wav(new Uint8Array(transferred));
    if (this.decodeGate) await this.decodeGate.promise;
    return bufferDouble(this.sampleRate,
      Math.round(info.frames * this.sampleRate / info.sample_rate), info.channels);
  }
  async resume(): Promise<void> {
    this.resumeCalls++;
    if (this.resumeGate) await this.resumeGate.promise;
    if (this.state === 'closed') throw new Error('Context is closed.');
    this.setState('running');
  }
  async suspend(): Promise<void> {
    this.suspendCalls++;
    if (this.state === 'closed') throw new Error('Context is closed.');
    this.setState('suspended');
  }
  async close(): Promise<void> { this.closeCalls++; this.setState('closed'); }
  setState(state: AudioContextState): void {
    if (this.state === state) return;
    this.state = state;
    this.dispatchEvent(new Event('statechange'));
  }
  /** Test-controlled audio time advances only while the delegated context runs. */
  advance(seconds: number): void {
    if (seconds < 0) throw new Error('Audio time cannot go backwards.');
    if (this.state === 'running') this.currentTime += seconds;
  }
}

export async function fixturePack(): Promise<LoadedBrowserPack> {
  const root = new URL('../../fixtures/s01/', import.meta.url);
  const pack = validatePackManifest(JSON.parse(await readFile(new URL('manifest.json', root), 'utf8')));
  const files = new Map(await Promise.all(pack.assets.map(async asset =>
    [asset.file.path, new Uint8Array(await readFile(new URL(asset.file.path, root)))] as const)));
  return {pack, files, allowFixtures: true};
}

export function outputValue(context: ContextDouble): number {
  const call = context.gains[0]!.gain.calls.at(-1);
  if (!call || call.kind !== 'set') throw new Error('Expected an immediate master gain update.');
  return call.value;
}
