import {quartersToFrames} from './pack.js';
import type {AudioPack, VersionRef} from './pack-types.js';
import type {AudioClock, ClockStamp, SourceStart} from './playable-source.js';
import {S01_PERFORMER, type ProceduralPlan, type S01PhraseState} from './phrase-plan.js';
import {checkRoleWindow, type ProceduralSource, type RoleWindow} from './procedural-source.js';
import {checkedRoute, cueFrame, requireAudio, type CheckedRoute, type RecordedSource} from './web-audio.js';

export type HybridBridgeExit = 'phrase' | 'end';

export interface HybridPolicy {
  readonly id: string;
  readonly revision: number;
  readonly route: VersionRef;
  readonly performer: VersionRef;
  readonly recipe: VersionRef;
  readonly leadIn: {readonly quarters: number; readonly roles: readonly ('percussion')[]};
  readonly tail: {readonly quarters: number; readonly roles: readonly ('percussion')[]};
  readonly review: 'engineering-only';
}

/**
 * S05's code-defined hybrid handoff, bound to the S01 fixtures: recording A → the S04 performer → recording B.
 * It realizes the existing directed fixture route and binds every identity it uses.
 * Engineering choices only; nobody has listened to it. A new route, performer, recipe
 * or timing needs a new revision.
 */
export const S05_HYBRID_POLICY: HybridPolicy = Object.freeze({
  id: 's05-hybrid-handoff',
  revision: 1,
  route: Object.freeze({id: 's01-a-to-b', revision: 1}),
  performer: S01_PERFORMER,
  recipe: Object.freeze({id: 's01-recipe', revision: 1}),
  /**
   * The bridge enters on A's exit cue. A's tail fades over this bar. Meanwhile the
   * bridge may play only these roles, so the bass changes owner when A is silent.
   */
  leadIn: Object.freeze({quarters: 4, roles: Object.freeze(['percussion'] as const)}),
  /** B enters at full gain on the bridge exit. Only these roles continue, fading over at most this bar. */
  tail: Object.freeze({quarters: 4, roles: Object.freeze(['percussion'] as const)}),
  review: 'engineering-only' as const,
});

/**
 * S09: the same handoff shape, bound to the real-FL pack that `scripts/fl-producer.ts` imports.
 * It changes only which route and recipe it names; the performer, the role windows and every
 * check in planHybridHandoff are the S05 ones. A policy is identified by its own id. Engineering choices only; nobody has listened to it.
 */
export const S09_HYBRID_POLICY: HybridPolicy = Object.freeze({
  id: 's09-hybrid-handoff',
  revision: 1,
  route: Object.freeze({id: 's09-a-to-b', revision: 1}),
  performer: S01_PERFORMER,
  recipe: Object.freeze({id: 's09-fl-recipe', revision: 1}),
  leadIn: S05_HYBRID_POLICY.leadIn,
  tail: S05_HYBRID_POLICY.tail,
  review: 'engineering-only' as const,
});

/**
 * S09: the same handoff for the S06 MOCK FL pack, so the portable checks exercise an imported
 * pack's DJ handoff without FL Studio. Engineering choices only.
 */
export const S06_MOCK_HYBRID_POLICY: HybridPolicy = Object.freeze({
  id: 's06-mock-hybrid-handoff',
  revision: 1,
  route: Object.freeze({id: 's06-a-to-b', revision: 1}),
  performer: S01_PERFORMER,
  recipe: Object.freeze({id: 's06-mock-recipe', revision: 1}),
  leadIn: S05_HYBRID_POLICY.leadIn,
  tail: S05_HYBRID_POLICY.tail,
  review: 'engineering-only' as const,
});

/** Every code-defined handoff policy. A route with no entry here cannot be handed off through a bridge. */
export const HYBRID_POLICIES: readonly HybridPolicy[] = Object.freeze([S05_HYBRID_POLICY, S06_MOCK_HYBRID_POLICY, S09_HYBRID_POLICY]);

/** The policy for a route's exact id and revision, or null. */
export function hybridPolicyForRoute(route: VersionRef): HybridPolicy | null {
  return HYBRID_POLICIES.find(policy => policy.route.id === route.id && policy.route.revision === route.revision) ?? null;
}

export interface HybridBridge {
  readonly recipe: VersionRef;
  readonly performer: VersionRef;
  readonly seed: number;
  readonly state: S01PhraseState;
  readonly exit: HybridBridgeExit;
}

/** Absolute frames on the one audio clock. Ownership never overlaps except the named roles. */
export interface HybridHandoffPlan extends CheckedRoute {
  readonly policy: VersionRef;
  readonly bridge: HybridBridge;
  /** A's exit cue: the bridge enters, A's tail starts fading. */
  readonly fromExit: ClockStamp;
  readonly fromFadeFrames: number;
  /** A is silent; the bridge's drums, bass and harmony may sound. */
  readonly bridgeFull: ClockStamp;
  /** The bridge exit and B's entry cue. B owns drums, bass and harmony from here. */
  readonly toStart: ClockStamp;
  /** The bridge tail has ended; B sounds alone. */
  readonly end: ClockStamp;
  readonly leadIn: RoleWindow;
  readonly tail: RoleWindow;
}

const sameRef = (left: VersionRef, right: VersionRef): boolean => left.id === right.id && left.revision === right.revision;
const same = (left: unknown, right: unknown): boolean => JSON.stringify(left) === JSON.stringify(right);

/**
 * Check the policy, the route and the bridge, and resolve every boundary to an absolute
 * frame. The player calls this once before decoding. It calls it again just before
 * committing, so a late clock is refused rather than shifted.
 */
export function planHybridHandoff(pack: AudioPack, routeId: string, bridge: ProceduralPlan,
  exit: HybridBridgeExit, fromStart: SourceStart, clock: AudioClock, allowFixtures = false,
  leadFrames = 0): HybridHandoffPlan {
  const pair = checkedRoute(pack, routeId, allowFixtures);
  const {route, from, to} = pair;
  const policy = hybridPolicyForRoute(route);
  requireAudio(policy, `No hybrid handoff policy covers route ${route.id}@${route.revision}.`);
  requireAudio(sameRef(bridge.performer, policy.performer) && sameRef(bridge.recipe, policy.recipe) &&
    sameRef(bridge.pack, pack), 'The bridge plan is not the policy performer and recipe for this pack revision.');
  const recipe = pack.recipes.find(item => sameRef(item, policy.recipe));
  requireAudio(recipe, 'The policy recipe is missing from the pack.');
  requireAudio(from.timing && to.timing, 'Both recordings need musical timing.');
  // One tempo, meter and harmonic region: the bridge never changes global harmony or tempo.
  requireAudio(from.timing.bpm === bridge.bpm && to.timing.bpm === bridge.bpm && recipe.bpm === bridge.bpm,
    'The recordings and the bridge must share one tempo.');
  requireAudio(same(from.timing.meter, bridge.meter) && same(to.timing.meter, bridge.meter), 'The handoff needs one 4/4 meter.');
  requireAudio(from.key !== null && from.key === to.key && from.key === recipe.key &&
    same(from.harmony_pitch_classes, recipe.harmony_pitch_classes) && same(to.harmony_pitch_classes, recipe.harmony_pitch_classes),
  'The recordings and the bridge must share one key and harmony.');
  const exitCue = from.cues.find(cue => cue.id === route.exit_cue && cue.kind === 'exit');
  const entryCue = to.cues.find(cue => cue.id === route.entry_cue && cue.kind === 'entry');
  requireAudio(exitCue && entryCue && exitCue.position_quarters % 4 === 0 && entryCue.position_quarters % 4 === 0,
    'The route cues must sit on bar lines.');
  const leadIn = checkRoleWindow(policy.leadIn, bridge);
  requireAudio(exitCue.position_quarters + leadIn.quarters <= from.timing.bars * 4,
    'A has no complete tail bar after its exit cue.');
  const exitQuarters = exit === 'phrase' ? bridge.exitQuarters[0] : exit === 'end' ? bridge.exitQuarters[1] : NaN;
  requireAudio(Number.isInteger(exitQuarters) && exitQuarters % 4 === 0 && exitQuarters >= leadIn.quarters + 4,
    'The bridge exit must be a declared phrase exit after at least one full bar.');
  const tail = checkRoleWindow({quarters: Math.min(policy.tail.quarters, bridge.durationQuarters - exitQuarters),
    roles: policy.tail.roles}, bridge);

  requireAudio(fromStart.at.engineGeneration === clock.engineGeneration, 'Stale engine generation.');
  requireAudio(Number.isSafeInteger(fromStart.at.frame) && fromStart.at.frame >= 0 &&
    Number.isSafeInteger(leadFrames) && leadFrames >= 0, 'Invalid start or scheduling lead.');
  const rate = clock.sampleRate;
  const entry = cueFrame(from, fromStart.entryCueId, 'entry', rate);
  const exitFrame = cueFrame(from, route.exit_cue, 'exit', rate);
  const fromExit = fromStart.at.frame + exitFrame - entry;
  requireAudio(exitFrame >= entry && fromExit >= clock.currentFrame + leadFrames,
    'The exit cue has passed or is too close. Restart A to schedule this handoff.');
  const fromFadeFrames = quartersToFrames(leadIn.quarters, bridge.bpm, rate);
  const toStart = fromExit + quartersToFrames(exitQuarters, bridge.bpm, rate);
  const end = toStart + quartersToFrames(tail.quarters, bridge.bpm, rate);
  const stamp = (frame: number): ClockStamp => ({engineGeneration: clock.engineGeneration, frame});
  return {...pair, policy: {id: policy.id, revision: policy.revision},
    bridge: {recipe: {...bridge.recipe}, performer: {...bridge.performer}, seed: bridge.seed, state: bridge.state, exit},
    fromExit: stamp(fromExit), fromFadeFrames, bridgeFull: stamp(fromExit + fromFadeFrames),
    toStart: stamp(toStart), end: stamp(end), leadIn, tail};
}

/**
 * Commit the whole handoff in absolute frames on one clock; no callback starts audio.
 * A is changed last, so any refusal leaves it unchanged. The caller then releases the
 * bridge and B, which cancels anything they had scheduled.
 */
export function commitHybridHandoff(plan: HybridHandoffPlan, from: RecordedSource,
  bridge: ProceduralSource, to: RecordedSource): void {
  requireAudio(from.reference.id === plan.from.id && from.reference.revision === plan.from.revision &&
    to.reference.id === plan.to.id && to.reference.revision === plan.to.revision &&
    bridge.plan.seed === plan.bridge.seed && bridge.plan.state === plan.bridge.state &&
    same(bridge.leadIn, plan.leadIn), 'The prepared sources do not match the checked handoff plan.');
  bridge.scheduleStart({at: plan.fromExit, entryCueId: 'entry'});
  bridge.transitionOut(plan.bridge.exit, plan.toStart, plan.tail);
  to.scheduleStart({at: plan.toStart, entryCueId: plan.route.entry_cue});
  from.transitionOut(plan.route.exit_cue, plan.fromExit, plan.fromFadeFrames);
}

/** FNV-1a over UTF-16 code units: the DJ derives a replayable bridge seed from a command ID. */
export function bridgeSeed(commandId: string): number {
  let hash = 0x811c9dc5;
  for (let index = 0; index < commandId.length; index++) {
    hash ^= commandId.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return hash >>> 0;
}
