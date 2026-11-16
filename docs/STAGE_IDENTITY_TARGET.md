# Stage identity: target end state

Status: **target description, not yet applied** (owner decision 2026-11-16: do not migrate yet, work around it and keep this document). Owner of this document: the campaign owner. Campaign: [EMF initial infrastructure](campaigns/EMF_INITIAL_INFRASTRUCTURE.md).

## Why

On 2026-11-16 the owner renumbered stage display numbers to follow execution order. Stage IDs (`EMF-Sxx`) are referenced by the board ([WORK_ITEMS](WORK_ITEMS.md)), RAM and NAV records, code, tests and handoffs, so the IDs could not change. The renumber was therefore a **display-only** change with an old→new mapping table in the campaign document. The owner wants to be able to reorder stages later and keep every record linked.

## Target

1. **IDs never change.** `EMF-S14` stays `EMF-S14` forever, wherever it sits in the order.
2. **Order and display labels live on the campaign item**, not in the ID. Each stage has a current label (`S10`) and a list of former labels, kept as history only.
3. **Lookups use an exact ID or `campaign-emf-001:<current label>`.** A bare label such as `S14` is refused, so old text cannot silently point at a different stage.
4. **Records link by ID** (RAM, NAV, code, tests, handoffs). No record text is rewritten when the order changes.
5. **Documents show current labels.** The old→new mapping table in the campaign document and the "(new Sxx)" suffixes are deleted once the migration is applied; the generated stage-order block replaces them.

The EUTONOS source checkout already implements this (stage-order profile `eutonos.stage-order.v1`, merged to its local main, not pushed). Music's installed runtime does not have it yet.

## Intended end result for EMF-Music

| Stage ID | Current label (target) | Former label |
| --- | --- | --- |
| EMF-S01 to EMF-S09 | S01 to S09 | none |
| EMF-S14 | S10 | S14 |
| EMF-S15 | S11 | S15 |
| EMF-S16 | S12 | S16 |
| EMF-S17 | S13 | S17 |
| EMF-S18 | S14 | S18 |
| EMF-S19 | S15 | S19 |
| EMF-S20 | S16 | S20 |
| EMF-S21 | S17 | S21 |
| EMF-S10 | S18 | S10 |
| EMF-S22 | S19 | S22 |
| EMF-S24 | S20 | S24 |
| EMF-S23 | S21 | S23 |
| EMF-S11 | S22 | S11 |
| EMF-S12 | S23 | S12 |
| EMF-S13 | S24 | S13 |

This matches the mapping table in the campaign document, which stays authoritative until the migration. (The EUTONOS chat's tested dry-run request predates EMF-S24 and has 23 rows; it needs an EMF-S24 row.)

## Migration steps (all on hold)

0. EUTONOS push and release, then update Music's installed runtime.
1. Give EMF-S11, EMF-S13 and EMF-S20 an `extensions.campaign_id = campaign-emf-001` link (board update batch).
2. Add the stages missing from the board (EMF-S17 to EMF-S19, EMF-S21 to EMF-S24) with real titles from the campaign table.
3. Write and submit the stage-order request with former labels for every changed row, then run the stage-order check.
4. Hand edits: delete the mapping table, update [CURRENT_TASKS](CURRENT_TASKS.md) to current labels.

All board changes go only through the boards CLI. Each step needs owner approval.

## Rules until then

- Write both when naming a stage in new text: the ID first, the display label in parentheses, e.g. `EMF-S24 (new S20)`.
- Never edit IDs. Never rewrite old records to new labels.
- Do not hand-edit the board.
