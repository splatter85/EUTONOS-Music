# EMF-S20 — Post-merge source review (2026-11-16)

**Decision:** CHANGE (two reproduced P2-level failure-path defects); corrected on `work/emf-s20-postmerge-review`. This review is engineering/source evidence, not a listening or physical-device acceptance.

**Integration baseline:** Owner-authorized fast-forward of `work/emf-s20-live-precheck` onto local `main`, from `124b000ee2a0ed0a70dccede4c307b044cdce55e` to `9ad6aef28e64bc9be2399394323e4eb4762d05a9`. No merge conflicts. Owner's pre-existing untracked `.claude/` retained. Review fixes are isolated outside the main checkout pending both required gates.

## Scope and method

Reviewed S20 decks, measured song display/waveform persistence, and live pre-check boundaries, against `AGENTS.md`, `docs/S20_DECKS.md` and `docs/handoffs/EMF-S20-HANDOFF.md`. Inspected `src/player.ts`, `src/web-audio.ts`, `src/mix-automation.ts`, `web/deck-mixer.ts`, `web/deck-controls.ts`, `web/deck-readout.ts`, `web/set-waveform*.ts`, `web/analysis-storage.ts`, `web/set-analysis-cache.ts`, `web/set-song-list.ts`, and the live pre-check worker/adapter/data files. Compared protected paths to baseline and kept existing fixture/worker evidence in view.

Used deterministic Web Audio scheduling doubles with injected **one-shot native parameter failures**. These reveal an inconsistency that ordinary happy-path audio automation and browser tests did not cover. Tests are synthetic and cannot establish how music sounds.

## Reproduced findings and corrections

**P2 — Filter gesture can leave a half-manual filter after a native AudioParam refusal.** A filter take or Return to DJ changes *two* parameters (high-pass and low-pass). If the low-pass call fails after the high-pass succeeds, the pre-fix code left mismatched manual ownership/cutoffs. New regression injects failure on the second parameter during both take and handback, checks the owner's previous state and both settled native values. Fix snapshots the two lanes' prior manual values, attempts both changes, and on partial failure restores both lanes (best effort) before propagating the original exception.

**P2 — Crossfader take/handback can leave one deck on the new setting after a partial failure.** The prior code updated the displayed crossfader ownership before updating A and B. A failed B parameter left A changed and the UI claiming the new ownership; Return to DJ had the same non-atomic behavior. New regression injects a B-fader failure during takeover and during release, checking both settled gains and ownership. Fix applies both channels first, commits ownership only on success, and restores the prior crossfader position/automatic lanes if one call fails.

In both cases, if a native AudioParam consistently refuses even rollback calls, recovery is necessarily best-effort and the original error remains visible; no false success is reported.

## Verification

- Pre-fix focused test: **19 passed / 2 failed** (both new fault-injection tests).
- Post-fix focused test: **21/21 passed**.
- Windows TypeScript build: passed.
- Full Windows `npm.cmd run check`: **579/579 Node tests passed**, 0 failed, 0 cancelled, 0 skipped; completed successfully.
- Full Windows `npm.cmd run check:browser` on implementation commit `57d0c996ab775998132e2f53350c5c8f3ed4f952`: **PASS**, exit 0, 245.46 s. Includes 16 set, 8 phone, 7 deck, 7 analysis/cache, and 7 pre-check groups plus previous browser, Studio, native and mix checks.
- No changes to transition selection, source entry choices, S20 live pre-check thresholds, playback ownership, phone stream path or protected server.
- Real owner songs, physical output, touch/phone devices, human listening, macOS and Linux: **NOT TESTED** in this review.

The fixes preserve the existing 20 ms manual-control slew and native clock scheduling. No new clock, music timer, route, stems, persistent audio or external effect was added.

## Delivery

Source fix commit: `57d0c996ab775998132e2f53350c5c8f3ed4f952`. First full Node run used exactly these changes before commit (579/579, 43.77 s); the committed-source rerun is recorded separately in the S20 handoff. Browser run used the committed source. Native boards/RAM change only through their CLI; final local main readback is recorded separately. No GitHub push or deployment is requested.

**Next PC step:** After both full gates pass, fast-forward the reviewed fix branch to local main, run readback/target qualification, and retain S10 real-song/phone listening as a separate owner acceptance task.
