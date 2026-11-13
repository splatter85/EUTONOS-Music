import assert from 'node:assert/strict';
import test from 'node:test';
import {analyzeMixAudio} from '../src/mix-analysis.js';
import {DeterministicDj} from '../src/dj.js';
import {CONTROL_VERSION, type ControlRequest} from '../src/control.js';
import {SmallPlayer} from '../src/player.js';
import {prepareMixTransition, type MixPreparationRuntime} from '../src/mix-transition.js';
import {outputFrameAtSource, renderTimePitch, type PreparedTimePitch} from '../src/time-pitch.js';
import {ContextDouble, NodeDouble, ParameterDouble, deferred, fixturePack} from './audio-double.js';
import {makeMixFixture} from './helpers/mix-fixtures.js';

function audioBuffer(rate: number, frames: number, count = 1): AudioBuffer {
  const channels = Array.from({length: count}, () => new Float32Array(frames));
  return {sampleRate: rate, length: frames, duration: frames / rate, numberOfChannels: count,
    getChannelData: (i: number) => channels[i]!,
    copyToChannel: (source: Float32Array, i: number) => { channels[i]!.set(source); },
  } as AudioBuffer;
}
class FilterDouble extends NodeDouble {
  type: BiquadFilterType = 'lowpass';
  readonly frequency = new ParameterDouble();
  readonly gain = new ParameterDouble();
  readonly Q = new ParameterDouble();
}
class MixContext extends ContextDouble {
  constructor() { super(16000); }
  createBiquadFilter(): BiquadFilterNode { return new FilterDouble(this.audio) as unknown as BiquadFilterNode; }
  createBuffer(channels: number, frames: number, rate: number): AudioBuffer { return audioBuffer(rate, frames, channels); }
  override async decodeAudioData(input: ArrayBuffer): Promise<AudioBuffer> {
    const shape = await super.decodeAudioData(input), buffer = audioBuffer(this.sampleRate, shape.length, shape.numberOfChannels);
    const signal = makeMixFixture({sampleRate: this.sampleRate, bpm: 120}).channels[0]!;
    for (let c = 0; c < shape.numberOfChannels; c++) buffer.getChannelData(c).set(signal.subarray(0, shape.length));
    return buffer;
  }
}
const inline: MixPreparationRuntime = {
  analyze: async (from, to) => ({from: analyzeMixAudio(from), to: analyzeMixAudio(to)}),
  render: async (audio, options) => renderTimePitch(audio, options),
};

import {RecordedSource} from '../src/web-audio.js';
import {bassSwapAutomation} from '../src/mix-automation.js';

async function preparedPrelude() {
 const loaded=await fixturePack(),context=new MixContext();
 const player=new SmallPlayer(context.audio,loaded,loaded.pack.routes[0]!.id,inline);
 const dj=new DeterministicDj(player,loaded,'explore',{handoff:'mix'});
 let s=0,t=0,e=0;
 player.scheduleMix=async()=>{
  const state=player as unknown as {
   voices:{source:RecordedSource;start:{at:{frame:number;engineGeneration:number};entryCueId:string}}[];
   decoded:Promise<import('../src/web-audio.js').DecodedRecording[]>;output:GainNode;
   plan:{at:ReturnType<typeof player.clock.stamp>;end:ReturnType<typeof player.clock.stamp>}|null;
   mix:import('../src/player.js').MixSnapshot|null;
  };
  const a=state.voices[0]!,decoded=await state.decoded,b=decoded.find(x=>x.asset.id===player.pair.to.id)!;
  s=a.start.at.frame+2*context.sampleRate;t=s+context.sampleRate;e=t+4*context.sampleRate;
  const incoming=new RecordedSource(context.audio,b,state.output,{allowFixtures:true});await incoming.prepare(player.clock);
  incoming.scheduleMixStart(player.clock.stamp(t),0,bassSwapAutomation(e-t,context.sampleRate).incoming);
  a.source.transitionMixOut(player.clock.stamp(s),2*context.sampleRate,bassSwapAutomation(e-s,context.sampleRate).outgoing);
  state.voices.push({source:incoming,start:{at:player.clock.stamp(t),entryCueId:'mix-entry'}});
  state.plan={at:player.clock.stamp(t),end:player.clock.stamp(e)};
  state.mix={phase:'scheduled',reason:'test prepared prelude',summary:null,earliestEffect:player.clock.stamp(s)};
 };
 const command=(id:string,body:object,source:'manual'|'automation'='manual'):ControlRequest=>({...body,
  commandId:id,schemaVersion:CONTROL_VERSION,expectedRevision:dj.snapshot().control.revision,source}) as ControlRequest;
 await dj.request(command('hold',{type:'hold',enabled:true}));
 await dj.request(command('play',{type:'transport',action:'play'}));context.advance(0.2);
 const originalA=player.snapshot().voices[0]!;
 await dj.request(command('head-b',{type:'queueTrack',trackId:player.pair.to.id}));
 await dj.request(command('tail-a',{type:'queueTrack',trackId:player.pair.from.id}));
 return {dj,player,context,command,s,t,e,originalA};
}

for(const when of ['before-S','S-to-T','after-T'] as const) for(const action of ['cancelNext','cancelQueue'] as const) {
 test('echo prelude '+action+' at '+when+' preserves lifecycle and Hold',async()=>{
  const {dj,player,context,command,s,t,originalA}=await preparedPrelude();
  const position=when==='before-S'?s-1600:when==='S-to-T'?s+1600:t+1600;
  context.advance(position/context.sampleRate-context.currentTime);
  const before=dj.snapshot();
  assert.equal(before.control.requested.hold,true);
  const held=await dj.request(command('held-state',{type:'setState',state:'drive'},'automation'));
  assert.equal(held.execution.reason,'held');
  assert.equal(dj.snapshot().control.requested.state,'explore');
  if(when!=='after-T')assert.ok(!before.player.now.includes(player.pair.to.id),'B is not audible before T');
  const body=action==='cancelQueue'?{type:'cancelQueue',queueCommandId:'head-b'}:{type:'cancelNext'};
  const request=command('cancel',body),result=await dj.request(request),after=dj.snapshot();
  assert.equal(result.execution.status,when==='before-S'?'applied':
   when==='after-T'&&action==='cancelQueue'?'rejected':'blocked');
  assert.equal((await dj.request(request)).execution.status,result.execution.status,'retry does not repeat effects');
  if(when==='before-S') {
   assert.equal(after.pending,null);assert.equal(after.player.voices.length,1);
   assert.equal(after.player.voices[0]!.endFrame,originalA.endFrame);
   assert.deepEqual(after.control.queue.map(q=>q.commandId),action==='cancelQueue'?['tail-a']:['head-b','tail-a']);
  }else{
   assert.ok(after.pending);assert.equal(after.player.voices.length,2);
   assert.notEqual(dj.operation('head-b')?.execution.status,'cancelled','committed B must never be falsely cancelled');
   assert.equal(after.player.transitionAt!.frame,t,'request/queue entry remains B time, not prelude time');
   // ControlContract removes explicit cancelQueue entries at acceptance, as for an entered hybrid.
   // The execution is blocked, B reservation remains, and tail order is preserved.
   assert.deepEqual(after.control.queue.map(q=>q.commandId),action==='cancelQueue'||when==='after-T'?['tail-a']:['head-b','tail-a']);
   if(when==='S-to-T') {
    assert.equal(dj.operation('head-b')?.execution.status,'scheduled');
    context.advance((t+1600)/context.sampleRate-context.currentTime);dj.snapshot();
    assert.equal(dj.operation('head-b')?.execution.status,'started');
    assert.deepEqual(dj.snapshot().control.queue.map(q=>q.commandId),['tail-a']);
   }
  }
  await dj.request(command('stop',{type:'transport',action:'stop'}));
  assert.equal(player.snapshot().state,'idle');assert.deepEqual(player.snapshot().voices,[]);
  assert.equal(player.snapshot().mix,null);assert.equal(dj.snapshot().control.requested.hold,true);
  await dj.dispose();
 });
}
