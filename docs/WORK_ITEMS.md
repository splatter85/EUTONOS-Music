# EUTONOS Music work items

Document ID: `EM-D021`.

Native EUTONOS board for the EMF campaign, its stages and slices. Edit its fence only through the EUTONOS boards CLI (form, batch form, batch submit); never by hand. Item IDs match the [EMF campaign](campaigns/EMF_INITIAL_INFRASTRUCTURE.md), which keeps definitions, dependencies and acceptance. There is no native work order here, so [Current Tasks](CURRENT_TASKS.md) stays a hand-written owner. When this board and the campaign disagree, the campaign wins and the board is corrected.

```tokenslang-board
{
  "items": [
    {
      "evidence_refs": [
        {
          "path": "docs/campaigns/EMF_INITIAL_INFRASTRUCTURE.md"
        }
      ],
      "extensions": {
        "attribution": {
          "creator": {
            "context": {
              "app": "claude-desktop",
              "model": "claude-opus-5-5",
              "session": "5e690a32-667b-4f44-9d15-e6d5ebfb8fa3"
            },
            "event_id": "30abd057-3f33-5b4c-b59b-7ff537587965",
            "human": null,
            "kind": "created",
            "recorded_at": "2026-11-04T22:42:48.198579+00:00"
          },
          "events": [],
          "profile": "eutonos.work-attribution.v1"
        }
      },
      "id": "campaign-emf-001",
      "status": "active",
      "summary": "Build the first EUTONOS Music proof: portable audio packs, one player and clock, a deterministic DJ, a procedural source, FL Studio authoring through one MCP facade, owner listening, then Mission Control. The campaign document owns definitions, dependencies and acceptance.",
      "title": "EMF — Initial infrastructure",
      "type": "campaign"
    },
    {
      "evidence_refs": [
        {
          "path": "docs/campaigns/EMF_INITIAL_INFRASTRUCTURE.md"
        }
      ],
      "extensions": {
        "attribution": {
          "creator": {
            "context": {
              "app": "claude-desktop",
              "model": "claude-opus-5-5",
              "session": "5e690a32-667b-4f44-9d15-e6d5ebfb8fa3"
            },
            "event_id": "fae17565-75e0-5195-b48f-b532a169c31a",
            "human": null,
            "kind": "created",
            "recorded_at": "2026-11-04T22:42:48.198579+00:00"
          },
          "events": [
            {
              "completed_revision": "a7e21b9c18d2d794a84067abaa73c0cc44509bc886f9a98678563bff2a9b8439",
              "context": {
                "app": "claude-desktop",
                "model": "claude-opus-5-5",
                "session": "5e690a32-667b-4f44-9d15-e6d5ebfb8fa3"
              },
              "event_id": "f548323d-06e4-5b42-8f52-a321bbcdacc1",
              "human": null,
              "kind": "completed",
              "recorded_at": "2026-11-04T22:42:48.198579+00:00"
            }
          ],
          "profile": "eutonos.work-attribution.v1"
        }
      },
      "id": "EMF00",
      "parent_id": "campaign-emf-001",
      "status": "completed",
      "summary": "Original documentation and research baseline (ee7125e).",
      "title": "Documentation and research baseline",
      "type": "stage"
    },
    {
      "evidence_refs": [
        {
          "path": "docs/campaigns/EMF_INITIAL_INFRASTRUCTURE.md"
        }
      ],
      "extensions": {
        "attribution": {
          "creator": {
            "context": {
              "app": "claude-desktop",
              "model": "claude-opus-5-5",
              "session": "5e690a32-667b-4f44-9d15-e6d5ebfb8fa3"
            },
            "event_id": "a837b610-0993-55ba-aabf-0f53057f9a05",
            "human": null,
            "kind": "created",
            "recorded_at": "2026-11-04T22:42:48.198579+00:00"
          },
          "events": [],
          "profile": "eutonos.work-attribution.v1"
        }
      },
      "id": "EMF01",
      "parent_id": "campaign-emf-001",
      "status": "active",
      "summary": "Bounded S01 and S02 reviews cover their implemented cloud boundaries; later slices extend them.",
      "title": "Contract and adequacy review",
      "type": "stage"
    },
    {
      "evidence_refs": [
        {
          "path": "docs/campaigns/EMF_INITIAL_INFRASTRUCTURE.md"
        }
      ],
      "extensions": {
        "attribution": {
          "creator": {
            "context": {
              "app": "claude-desktop",
              "model": "claude-opus-5-5",
              "session": "5e690a32-667b-4f44-9d15-e6d5ebfb8fa3"
            },
            "event_id": "29aeb462-43ce-5343-9bb0-77d5ee2cf69c",
            "human": null,
            "kind": "created",
            "recorded_at": "2026-11-04T22:42:48.198579+00:00"
          },
          "events": [],
          "profile": "eutonos.work-attribution.v1"
        }
      },
      "id": "EMF02",
      "parent_id": "campaign-emf-001",
      "status": "active",
      "summary": "Original fixtures validated; S09 must verify eligible FL exports through the same pack schema.",
      "title": "Portable fixtures, then FL production sources",
      "type": "stage"
    },
    {
      "evidence_refs": [
        {
          "path": "docs/campaigns/EMF_INITIAL_INFRASTRUCTURE.md"
        }
      ],
      "extensions": {
        "attribution": {
          "creator": {
            "context": {
              "app": "claude-desktop",
              "model": "claude-opus-5-5",
              "session": "5e690a32-667b-4f44-9d15-e6d5ebfb8fa3"
            },
            "event_id": "519a04db-51b3-59f3-8e98-1c0b63c6f888",
            "human": null,
            "kind": "created",
            "recorded_at": "2026-11-04T22:42:48.198579+00:00"
          },
          "events": [],
          "profile": "eutonos.work-attribution.v1"
        }
      },
      "id": "EMF03",
      "parent_id": "campaign-emf-001",
      "status": "active",
      "summary": "Native Web Audio backend selected and checked on Windows, macOS and Linux; real audio-device and listening qualification remain.",
      "title": "Initial renderer",
      "type": "stage"
    },
    {
      "evidence_refs": [
        {
          "path": "docs/campaigns/EMF_INITIAL_INFRASTRUCTURE.md"
        }
      ],
      "extensions": {
        "attribution": {
          "creator": {
            "context": {
              "app": "claude-desktop",
              "model": "claude-opus-5-5",
              "session": "5e690a32-667b-4f44-9d15-e6d5ebfb8fa3"
            },
            "event_id": "5fee1ace-a1d3-541c-9c90-d93ceb88e86c",
            "human": null,
            "kind": "created",
            "recorded_at": "2026-11-04T22:42:48.198579+00:00"
          },
          "events": [],
          "profile": "eutonos.work-attribution.v1"
        }
      },
      "id": "EMF04",
      "parent_id": "campaign-emf-001",
      "status": "active",
      "summary": "Small S02 player only; S03 to S05 supply the DJ, procedural source, requests and hybrid transitions.",
      "title": "Working standalone cloud scaffold",
      "type": "stage"
    },
    {
      "evidence_refs": [
        {
          "path": "docs/campaigns/EMF_INITIAL_INFRASTRUCTURE.md"
        }
      ],
      "extensions": {
        "attribution": {
          "creator": {
            "context": {
              "app": "claude-desktop",
              "model": "claude-opus-5-5",
              "session": "5e690a32-667b-4f44-9d15-e6d5ebfb8fa3"
            },
            "event_id": "32e38e42-39f8-598d-b703-8244ba119824",
            "human": null,
            "kind": "created",
            "recorded_at": "2026-11-04T22:42:48.198579+00:00"
          },
          "events": [],
          "profile": "eutonos.work-attribution.v1"
        }
      },
      "id": "EMF05",
      "parent_id": "campaign-emf-001",
      "status": "planned",
      "summary": "S07 reviews the running scaffold; S10 adds FL-backed PC listening and owner acceptance.",
      "title": "Scaffold review and owner listening",
      "type": "stage"
    },
    {
      "evidence_refs": [
        {
          "path": "docs/campaigns/EMF_INITIAL_INFRASTRUCTURE.md"
        }
      ],
      "extensions": {
        "attribution": {
          "creator": {
            "context": {
              "app": "claude-desktop",
              "model": "claude-opus-5-5",
              "session": "5e690a32-667b-4f44-9d15-e6d5ebfb8fa3"
            },
            "event_id": "95855951-634b-518f-92b8-df3494840ef1",
            "human": null,
            "kind": "created",
            "recorded_at": "2026-11-04T22:42:48.198579+00:00"
          },
          "events": [],
          "profile": "eutonos.work-attribution.v1"
        }
      },
      "id": "EMF06",
      "parent_id": "campaign-emf-001",
      "status": "planned",
      "summary": "Metadata, hashes, eligibility, cues and useful errors without a mandatory annotation wall.",
      "title": "Versioned library and importer",
      "type": "stage"
    },
    {
      "evidence_refs": [
        {
          "path": "docs/campaigns/EMF_INITIAL_INFRASTRUCTURE.md"
        }
      ],
      "extensions": {
        "attribution": {
          "creator": {
            "context": {
              "app": "claude-desktop",
              "model": "claude-opus-5-5",
              "session": "5e690a32-667b-4f44-9d15-e6d5ebfb8fa3"
            },
            "event_id": "8677dd48-9629-59b8-9df5-fc24d904d9d2",
            "human": null,
            "kind": "created",
            "recorded_at": "2026-11-04T22:42:48.198579+00:00"
          },
          "events": [],
          "profile": "eutonos.work-attribution.v1"
        }
      },
      "id": "EMF07",
      "parent_id": "campaign-emf-001",
      "status": "planned",
      "summary": "Requested, planned and audible state, dwell, waits, hold, duplicates, expiry and restart behaviour.",
      "title": "Transport and state lifecycle",
      "type": "stage"
    },
    {
      "evidence_refs": [
        {
          "path": "docs/campaigns/EMF_INITIAL_INFRASTRUCTURE.md"
        }
      ],
      "extensions": {
        "attribution": {
          "creator": {
            "context": {
              "app": "claude-desktop",
              "model": "claude-opus-5-5",
              "session": "5e690a32-667b-4f44-9d15-e6d5ebfb8fa3"
            },
            "event_id": "d245a1fe-402d-5e6a-8e58-c84154966500",
            "human": null,
            "kind": "created",
            "recorded_at": "2026-11-04T22:42:48.198579+00:00"
          },
          "events": [],
          "profile": "eutonos.work-attribution.v1"
        }
      },
      "id": "EMF08",
      "parent_id": "campaign-emf-001",
      "status": "planned",
      "summary": "Simple MC-facing panel plus an advanced lab with pending display and accessible controls.",
      "title": "Manual listening app",
      "type": "stage"
    },
    {
      "evidence_refs": [
        {
          "path": "docs/campaigns/EMF_INITIAL_INFRASTRUCTURE.md"
        }
      ],
      "extensions": {
        "attribution": {
          "creator": {
            "context": {
              "app": "claude-desktop",
              "model": "claude-opus-5-5",
              "session": "5e690a32-667b-4f44-9d15-e6d5ebfb8fa3"
            },
            "event_id": "520f03e0-f95e-51b7-9f1e-38eba93273e8",
            "human": null,
            "kind": "created",
            "recorded_at": "2026-11-04T22:42:48.198579+00:00"
          },
          "events": [],
          "profile": "eutonos.work-attribution.v1"
        }
      },
      "id": "EMF09",
      "parent_id": "campaign-emf-001",
      "status": "planned",
      "summary": "Reviewed phrase mix, role substitution and safe fallback beyond the thin proof.",
      "title": "Recorded transition path",
      "type": "stage"
    },
    {
      "evidence_refs": [
        {
          "path": "docs/campaigns/EMF_INITIAL_INFRASTRUCTURE.md"
        }
      ],
      "extensions": {
        "attribution": {
          "creator": {
            "context": {
              "app": "claude-desktop",
              "model": "claude-opus-5-5",
              "session": "5e690a32-667b-4f44-9d15-e6d5ebfb8fa3"
            },
            "event_id": "bcf113b1-af73-5902-b785-49833b601625",
            "human": null,
            "kind": "created",
            "recorded_at": "2026-11-04T22:42:48.198579+00:00"
          },
          "events": [],
          "profile": "eutonos.work-attribution.v1"
        }
      },
      "id": "EMF10",
      "parent_id": "campaign-emf-001",
      "status": "planned",
      "summary": "At least three distinct families and palettes with bounded development across supported states.",
      "title": "Procedural recipe performer",
      "type": "stage"
    },
    {
      "evidence_refs": [
        {
          "path": "docs/campaigns/EMF_INITIAL_INFRASTRUCTURE.md"
        }
      ],
      "extensions": {
        "attribution": {
          "creator": {
            "context": {
              "app": "claude-desktop",
              "model": "claude-opus-5-5",
              "session": "5e690a32-667b-4f44-9d15-e6d5ebfb8fa3"
            },
            "event_id": "4df3d407-3add-5888-b84f-4d6de9225ce2",
            "human": null,
            "kind": "created",
            "recorded_at": "2026-11-04T22:42:48.198579+00:00"
          },
          "events": [],
          "profile": "eutonos.work-attribution.v1"
        }
      },
      "id": "EMF11",
      "parent_id": "campaign-emf-001",
      "status": "planned",
      "summary": "Generalize the small proof; shared context, bass, vocal and tail ownership and latency alignment.",
      "title": "Hybrid musical handoffs",
      "type": "stage"
    },
    {
      "evidence_refs": [
        {
          "path": "docs/campaigns/EMF_INITIAL_INFRASTRUCTURE.md"
        }
      ],
      "extensions": {
        "attribution": {
          "creator": {
            "context": {
              "app": "claude-desktop",
              "model": "claude-opus-5-5",
              "session": "5e690a32-667b-4f44-9d15-e6d5ebfb8fa3"
            },
            "event_id": "c7f9bf97-9215-5499-891a-08a27f7e17ea",
            "human": null,
            "kind": "created",
            "recorded_at": "2026-11-04T22:42:48.198579+00:00"
          },
          "events": [],
          "profile": "eutonos.work-attribution.v1"
        }
      },
      "id": "EMF12",
      "parent_id": "campaign-emf-001",
      "status": "planned",
      "summary": "Deterministic eligibility, recency and preference rules with replayable versions and bounded logs.",
      "title": "DJ selection and persistent history",
      "type": "stage"
    },
    {
      "evidence_refs": [
        {
          "path": "docs/campaigns/EMF_INITIAL_INFRASTRUCTURE.md"
        }
      ],
      "extensions": {
        "attribution": {
          "creator": {
            "context": {
              "app": "claude-desktop",
              "model": "claude-opus-5-5",
              "session": "5e690a32-667b-4f44-9d15-e6d5ebfb8fa3"
            },
            "event_id": "14814f1a-491d-5fa6-a679-1277fd327f96",
            "human": null,
            "kind": "created",
            "recorded_at": "2026-11-04T22:42:48.198579+00:00"
          },
          "events": [],
          "profile": "eutonos.work-attribution.v1"
        }
      },
      "id": "EMF13",
      "parent_id": "campaign-emf-001",
      "status": "planned",
      "summary": "Directed continuation and bridge routes with dead-end and coverage diagnosis.",
      "title": "Transition graph and coverage",
      "type": "stage"
    },
    {
      "evidence_refs": [
        {
          "path": "docs/campaigns/EMF_INITIAL_INFRASTRUCTURE.md"
        }
      ],
      "extensions": {
        "attribution": {
          "creator": {
            "context": {
              "app": "claude-desktop",
              "model": "claude-opus-5-5",
              "session": "5e690a32-667b-4f44-9d15-e6d5ebfb8fa3"
            },
            "event_id": "b4718acd-2100-51ef-834f-9db481ea504b",
            "human": null,
            "kind": "created",
            "recorded_at": "2026-11-04T22:42:48.198579+00:00"
          },
          "events": [],
          "profile": "eutonos.work-attribution.v1"
        }
      },
      "id": "EMF14",
      "parent_id": "campaign-emf-001",
      "status": "planned",
      "summary": "Real Mission Control integration (S12) only after standalone listening acceptance (S10).",
      "title": "Mission Control request adapter",
      "type": "stage"
    },
    {
      "evidence_refs": [
        {
          "path": "docs/campaigns/EMF_INITIAL_INFRASTRUCTURE.md"
        }
      ],
      "extensions": {
        "attribution": {
          "creator": {
            "context": {
              "app": "claude-desktop",
              "model": "claude-opus-5-5",
              "session": "5e690a32-667b-4f44-9d15-e6d5ebfb8fa3"
            },
            "event_id": "1de1887d-8886-5d7d-af6b-f2c3665c3edf",
            "human": null,
            "kind": "created",
            "recorded_at": "2026-11-04T22:42:48.198579+00:00"
          },
          "events": [],
          "profile": "eutonos.work-attribution.v1"
        }
      },
      "id": "EMF15",
      "parent_id": "campaign-emf-001",
      "status": "active",
      "summary": "S08 verified a bounded authoring path on Windows; live GUI control, mixer/plugins, render settings and non-Windows FL remain open.",
      "title": "Unified FL Studio MCP authoring control",
      "type": "stage"
    },
    {
      "evidence_refs": [
        {
          "path": "docs/campaigns/EMF_INITIAL_INFRASTRUCTURE.md"
        }
      ],
      "extensions": {
        "attribution": {
          "creator": {
            "context": {
              "app": "claude-desktop",
              "model": "claude-opus-5-5",
              "session": "5e690a32-667b-4f44-9d15-e6d5ebfb8fa3"
            },
            "event_id": "5bf75fa1-f269-5cb3-a9f7-e72b071c43d7",
            "human": null,
            "kind": "created",
            "recorded_at": "2026-11-04T22:42:48.198579+00:00"
          },
          "events": [],
          "profile": "eutonos.work-attribution.v1"
        }
      },
      "id": "EMF16",
      "parent_id": "campaign-emf-001",
      "status": "planned",
      "summary": "Optional background production jobs; basic agent-assisted FL creation does not need them.",
      "title": "Optional production-job boundary",
      "type": "stage"
    },
    {
      "evidence_refs": [
        {
          "path": "docs/campaigns/EMF_INITIAL_INFRASTRUCTURE.md"
        }
      ],
      "extensions": {
        "attribution": {
          "creator": {
            "context": {
              "app": "claude-desktop",
              "model": "claude-opus-5-5",
              "session": "5e690a32-667b-4f44-9d15-e6d5ebfb8fa3"
            },
            "event_id": "505bbab9-66fc-5911-822f-de5edb5899de",
            "human": null,
            "kind": "created",
            "recorded_at": "2026-11-04T22:42:48.198579+00:00"
          },
          "events": [],
          "profile": "eutonos.work-attribution.v1"
        }
      },
      "id": "EMF17",
      "parent_id": "campaign-emf-001",
      "status": "planned",
      "summary": "Review the actual combined paths, including authoring and Mission Control integration.",
      "title": "Final assembled implementation review",
      "type": "stage"
    },
    {
      "evidence_refs": [
        {
          "path": "docs/campaigns/EMF_INITIAL_INFRASTRUCTURE.md"
        }
      ],
      "extensions": {
        "attribution": {
          "creator": {
            "context": {
              "app": "claude-desktop",
              "model": "claude-opus-5-5",
              "session": "5e690a32-667b-4f44-9d15-e6d5ebfb8fa3"
            },
            "event_id": "ede2564c-9958-5187-af0d-2d291cd4e68b",
            "human": null,
            "kind": "created",
            "recorded_at": "2026-11-04T22:42:48.198579+00:00"
          },
          "events": [],
          "profile": "eutonos.work-attribution.v1"
        }
      },
      "id": "EMF18",
      "parent_id": "campaign-emf-001",
      "status": "planned",
      "summary": "Named Windows reference environment plus macOS and Linux playback qualification and operational evidence.",
      "title": "Windows-first and cross-platform qualification",
      "type": "stage"
    },
    {
      "evidence_refs": [
        {
          "path": "docs/campaigns/EMF_INITIAL_INFRASTRUCTURE.md"
        }
      ],
      "extensions": {
        "attribution": {
          "creator": {
            "context": {
              "app": "claude-desktop",
              "model": "claude-opus-5-5",
              "session": "5e690a32-667b-4f44-9d15-e6d5ebfb8fa3"
            },
            "event_id": "21b9deeb-61e6-5062-a627-ad05b434aa4a",
            "human": null,
            "kind": "created",
            "recorded_at": "2026-11-04T22:42:48.198579+00:00"
          },
          "events": [],
          "profile": "eutonos.work-attribution.v1"
        }
      },
      "id": "EMF19",
      "parent_id": "campaign-emf-001",
      "status": "planned",
      "summary": "Explicit listening decision, accepted limits, verified target state and selected next work.",
      "title": "Owner acceptance and release handoff",
      "type": "stage"
    },
    {
      "evidence_refs": [
        {
          "path": "docs/handoffs/EMF-S01-HANDOFF.md"
        }
      ],
      "extensions": {
        "attribution": {
          "creator": {
            "context": {
              "app": "claude-desktop",
              "model": "claude-opus-5-5",
              "session": "5e690a32-667b-4f44-9d15-e6d5ebfb8fa3"
            },
            "event_id": "27568c86-5a33-5189-9534-0f5167cc4245",
            "human": null,
            "kind": "created",
            "recorded_at": "2026-11-04T22:42:48.198579+00:00"
          },
          "events": [
            {
              "completed_revision": "28378850ad6221eb0a1fcd9caf61370d4de8a79579b24d816d0ec9f50f9bb5f8",
              "context": {
                "app": "claude-desktop",
                "model": "claude-opus-5-5",
                "session": "5e690a32-667b-4f44-9d15-e6d5ebfb8fa3"
              },
              "event_id": "a355204d-5e1e-5eaf-8bdc-a47eaba7b45f",
              "human": null,
              "kind": "completed",
              "recorded_at": "2026-11-04T22:42:48.198579+00:00"
            }
          ],
          "profile": "eutonos.work-attribution.v1"
        },
        "stage_id": "EMF01"
      },
      "id": "EMF-S01",
      "status": "completed",
      "summary": "Portable pack/asset schema, playable-source lifecycle, control contract and two original fixtures.",
      "title": "S01 foundation (cloud)",
      "type": "slice"
    },
    {
      "evidence_refs": [
        {
          "path": "docs/handoffs/EMF-S02-HANDOFF.md"
        }
      ],
      "extensions": {
        "attribution": {
          "creator": {
            "context": {
              "app": "claude-desktop",
              "model": "claude-opus-5-5",
              "session": "5e690a32-667b-4f44-9d15-e6d5ebfb8fa3"
            },
            "event_id": "b670574f-136c-5a79-8627-27bc057fd73b",
            "human": null,
            "kind": "created",
            "recorded_at": "2026-11-04T22:42:48.198579+00:00"
          },
          "events": [
            {
              "completed_revision": "5a29ee6f5566e316ad92d5300758277e89661ad39aee1da9d20d24056c10dd95",
              "context": {
                "app": "claude-desktop",
                "model": "claude-opus-5-5",
                "session": "5e690a32-667b-4f44-9d15-e6d5ebfb8fa3"
              },
              "event_id": "d2c2d769-c565-549f-8df3-35d6e301adf0",
              "human": null,
              "kind": "completed",
              "recorded_at": "2026-11-04T22:42:48.198579+00:00"
            }
          ],
          "profile": "eutonos.work-attribution.v1"
        },
        "stage_id": "EMF03"
      },
      "id": "EMF-S02",
      "status": "completed",
      "summary": "Web Audio renderer, small app with play/pause A/B, Now/Next and a cue-checked scheduled transition.",
      "title": "S02 thin player (cloud)",
      "type": "slice"
    },
    {
      "evidence_refs": [
        {
          "path": "docs/campaigns/EMF_INITIAL_INFRASTRUCTURE.md"
        }
      ],
      "extensions": {
        "attribution": {
          "creator": {
            "context": {
              "app": "claude-desktop",
              "model": "claude-opus-5-5",
              "session": "5e690a32-667b-4f44-9d15-e6d5ebfb8fa3"
            },
            "event_id": "9d427b4f-4dd0-5310-b866-93e29f91ab33",
            "human": null,
            "kind": "created",
            "recorded_at": "2026-11-04T22:42:48.198579+00:00"
          },
          "events": [],
          "profile": "eutonos.work-attribution.v1"
        },
        "stage_id": "EMF04"
      },
      "id": "EMF-S03",
      "status": "planned",
      "summary": "DJ state/genre/next/queue/Hold requests with queue priority, cancellation, idempotent retries, no-match fallback and deterministic tests. Next cloud slice.",
      "title": "S03 thin DJ and requests (cloud)",
      "type": "slice"
    },
    {
      "evidence_refs": [
        {
          "path": "docs/campaigns/EMF_INITIAL_INFRASTRUCTURE.md"
        }
      ],
      "extensions": {
        "attribution": {
          "creator": {
            "context": {
              "app": "claude-desktop",
              "model": "claude-opus-5-5",
              "session": "5e690a32-667b-4f44-9d15-e6d5ebfb8fa3"
            },
            "event_id": "3aa32f22-a1a5-5ba7-bbdb-1ad7ee0d2ed4",
            "human": null,
            "kind": "created",
            "recorded_at": "2026-11-04T22:42:48.198579+00:00"
          },
          "events": [],
          "profile": "eutonos.work-attribution.v1"
        },
        "stage_id": "EMF10"
      },
      "id": "EMF-S04",
      "status": "planned",
      "summary": "Procedural sampler/phrase source on the shared clock with an original palette, seeded variations and replay tests.",
      "title": "S04 first procedural recipe (cloud)",
      "type": "slice"
    },
    {
      "evidence_refs": [
        {
          "path": "docs/campaigns/EMF_INITIAL_INFRASTRUCTURE.md"
        }
      ],
      "extensions": {
        "attribution": {
          "creator": {
            "context": {
              "app": "claude-desktop",
              "model": "claude-opus-5-5",
              "session": "5e690a32-667b-4f44-9d15-e6d5ebfb8fa3"
            },
            "event_id": "f988c9d9-1122-5cc2-a02c-0798fd3b3c63",
            "human": null,
            "kind": "created",
            "recorded_at": "2026-11-04T22:42:48.198579+00:00"
          },
          "events": [],
          "profile": "eutonos.work-attribution.v1"
        },
        "stage_id": "EMF11"
      },
      "id": "EMF-S05",
      "status": "planned",
      "summary": "DJ drives recording A to procedural to recording B with checked cues and a safe bridge.",
      "title": "S05 recorded/procedural handoffs (cloud)",
      "type": "slice"
    },
    {
      "evidence_refs": [
        {
          "path": "docs/campaigns/EMF_INITIAL_INFRASTRUCTURE.md"
        }
      ],
      "extensions": {
        "attribution": {
          "creator": {
            "context": {
              "app": "claude-desktop",
              "model": "claude-opus-5-5",
              "session": "5e690a32-667b-4f44-9d15-e6d5ebfb8fa3"
            },
            "event_id": "814e5799-1f72-52fd-9d87-b5fdf81de8b5",
            "human": null,
            "kind": "created",
            "recorded_at": "2026-11-04T22:42:48.198579+00:00"
          },
          "events": [],
          "profile": "eutonos.work-attribution.v1"
        },
        "stage_id": "EMF06"
      },
      "id": "EMF-S06",
      "status": "planned",
      "summary": "Portable import/manifest validation and mock FL-producer/MCP contract tests; no claim of real FL control.",
      "title": "S06 importer and mock FL producer (cloud)",
      "type": "slice"
    },
    {
      "evidence_refs": [
        {
          "path": "docs/campaigns/EMF_INITIAL_INFRASTRUCTURE.md"
        }
      ],
      "extensions": {
        "attribution": {
          "creator": {
            "context": {
              "app": "claude-desktop",
              "model": "claude-opus-5-5",
              "session": "5e690a32-667b-4f44-9d15-e6d5ebfb8fa3"
            },
            "event_id": "c6c70214-2a60-5191-82be-265e4a471877",
            "human": null,
            "kind": "created",
            "recorded_at": "2026-11-04T22:42:48.198579+00:00"
          },
          "events": [],
          "profile": "eutonos.work-attribution.v1"
        },
        "stage_id": "EMF05"
      },
      "id": "EMF-S07",
      "status": "planned",
      "summary": "Integrated app/demo, repeatable tests, offline/browser audio checks and review; cloud playable proof only.",
      "title": "S07 integrated cloud scaffold review",
      "type": "slice"
    },
    {
      "evidence_refs": [
        {
          "path": "docs/handoffs/EMF-S08-HANDOFF.md"
        }
      ],
      "extensions": {
        "attribution": {
          "creator": {
            "context": {
              "app": "claude-desktop",
              "model": "claude-opus-5-5",
              "session": "5e690a32-667b-4f44-9d15-e6d5ebfb8fa3"
            },
            "event_id": "e59560c5-06fd-5d89-90f6-b241a8195b63",
            "human": null,
            "kind": "created",
            "recorded_at": "2026-11-04T22:42:48.198579+00:00"
          },
          "events": [
            {
              "completed_revision": "98f60a6a8fd79a8941e562bdd4959c04b81f200b8ec88ca6e9fd31ed5fea3dfc",
              "context": {
                "app": "claude-desktop",
                "model": "claude-opus-5-5",
                "session": "5e690a32-667b-4f44-9d15-e6d5ebfb8fa3"
              },
              "event_id": "2ac4ccff-369b-590b-839f-ba47fa68f8b5",
              "human": null,
              "kind": "completed",
              "recorded_at": "2026-11-04T22:42:48.198579+00:00"
            }
          ],
          "profile": "eutonos.work-attribution.v1"
        },
        "stage_id": "EMF15"
      },
      "id": "EMF-S08",
      "status": "completed",
      "summary": "One MCP facade for Claude Code and Codex edited, verified, saved, rendered and packaged a disposable FL project on Windows.",
      "title": "S08 FL Studio authoring through one MCP facade (PC)",
      "type": "slice"
    },
    {
      "evidence_refs": [
        {
          "path": "docs/campaigns/EMF_INITIAL_INFRASTRUCTURE.md"
        }
      ],
      "extensions": {
        "attribution": {
          "creator": {
            "context": {
              "app": "claude-desktop",
              "model": "claude-opus-5-5",
              "session": "5e690a32-667b-4f44-9d15-e6d5ebfb8fa3"
            },
            "event_id": "1de4809b-8628-5a4c-aa2f-6e63c257e8aa",
            "human": null,
            "kind": "created",
            "recorded_at": "2026-11-04T22:42:48.198579+00:00"
          },
          "events": [],
          "profile": "eutonos.work-attribution.v1"
        },
        "stage_id": "EMF02"
      },
      "id": "EMF-S09",
      "status": "planned",
      "summary": "Import real FL-produced material with the unchanged pack contract and test A to procedural to B on a Windows audio device.",
      "title": "S09 real FL audio in the cloud build (PC)",
      "type": "slice"
    },
    {
      "evidence_refs": [
        {
          "path": "docs/campaigns/EMF_INITIAL_INFRASTRUCTURE.md"
        }
      ],
      "extensions": {
        "attribution": {
          "creator": {
            "context": {
              "app": "claude-desktop",
              "model": "claude-opus-5-5",
              "session": "5e690a32-667b-4f44-9d15-e6d5ebfb8fa3"
            },
            "event_id": "8683ebd1-ff5f-54e5-a78c-16b68db50547",
            "human": null,
            "kind": "created",
            "recorded_at": "2026-11-04T22:42:48.198579+00:00"
          },
          "events": [],
          "profile": "eutonos.work-attribution.v1"
        },
        "stage_id": "EMF05"
      },
      "id": "EMF-S10",
      "status": "planned",
      "summary": "Owner listens and accepts or revises the full creation to generator to DJ to app flow.",
      "title": "S10 owner listening gate (PC)",
      "type": "slice"
    },
    {
      "evidence_refs": [
        {
          "path": "docs/campaigns/EMF_INITIAL_INFRASTRUCTURE.md"
        }
      ],
      "extensions": {
        "attribution": {
          "creator": {
            "context": {
              "app": "claude-desktop",
              "model": "claude-opus-5-5",
              "session": "5e690a32-667b-4f44-9d15-e6d5ebfb8fa3"
            },
            "event_id": "8875a7d4-f291-52d5-88a8-d8be7fa2fb1b",
            "human": null,
            "kind": "created",
            "recorded_at": "2026-11-04T22:42:48.198579+00:00"
          },
          "events": [],
          "profile": "eutonos.work-attribution.v1"
        }
      },
      "id": "EMF-S11",
      "status": "planned",
      "summary": "Optional persistence, genres, recipe/history and wider transition coverage after S07.",
      "title": "S11 optional cloud breadth",
      "type": "slice"
    },
    {
      "evidence_refs": [
        {
          "path": "docs/campaigns/EMF_INITIAL_INFRASTRUCTURE.md"
        }
      ],
      "extensions": {
        "attribution": {
          "creator": {
            "context": {
              "app": "claude-desktop",
              "model": "claude-opus-5-5",
              "session": "5e690a32-667b-4f44-9d15-e6d5ebfb8fa3"
            },
            "event_id": "52d9a754-b1de-58f5-9018-647cafc5030b",
            "human": null,
            "kind": "created",
            "recorded_at": "2026-11-04T22:42:48.198579+00:00"
          },
          "events": [],
          "profile": "eutonos.work-attribution.v1"
        },
        "stage_id": "EMF14"
      },
      "id": "EMF-S12",
      "status": "planned",
      "summary": "Connect Mission Control to the same state/genre/next interface after S10.",
      "title": "S12 Mission Control connection",
      "type": "slice"
    },
    {
      "evidence_refs": [
        {
          "path": "docs/campaigns/EMF_INITIAL_INFRASTRUCTURE.md"
        }
      ],
      "extensions": {
        "attribution": {
          "creator": {
            "context": {
              "app": "claude-desktop",
              "model": "claude-opus-5-5",
              "session": "5e690a32-667b-4f44-9d15-e6d5ebfb8fa3"
            },
            "event_id": "37d37ea6-e24a-5b1b-9dd1-1c881adecb5d",
            "human": null,
            "kind": "created",
            "recorded_at": "2026-11-04T22:42:48.198579+00:00"
          },
          "events": [],
          "profile": "eutonos.work-attribution.v1"
        }
      },
      "id": "EMF-S13",
      "status": "planned",
      "summary": "Optional producer jobs, assembled review, broader Windows qualification and the full-campaign release decision.",
      "title": "S13 wider campaign qualification",
      "type": "slice"
    }
  ],
  "profile": "eutonos.tokenslang.board.v1"
}
```
