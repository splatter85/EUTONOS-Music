# Preliminary capabilities

Document ID: `EM-D003`  
Status: intended outcomes, revised 2026-11-03. No listed runtime capability is available yet.

The **standalone three-layer player + test app is first**; Mission Control becomes its first later external consumer. MCP authoring is an MVP source-production requirement; broader automation can grow later. Feature dependencies do not force optional automation to precede manual authoring.

| Stable ID | Capability | Features | Acceptance and sequencing |
| --- | --- | --- | --- |
| EM-C001 | Listen to music that develops with a chosen state | EM-F001–F003 | Standalone MVP: select/hold a vibe in test app and hear it change. Later MC sends the same requests. |
| EM-C002 | Hear different musical identities within one mood | EM-F004–F007, F015 | Pilot: remain moderate while distinct eligible material appears. |
| EM-C003 | Move between recorded and generated music | EM-F002, F006–F008 | Proof: recording A → procedural passage → different recording B. |
| EM-C004 | Control music from another application | EM-F001, F009; F010 for agent tools | Standalone request contract first; then verified actual MC connection through that interface. |
| EM-C005 | Produce library material with FL Studio | EM-F004, F011, F014 | MVP: Codex/Claude use one MCP to produce a real editable FL change and verified audio export, optionally with a shown manual UI step. |
| EM-C006 | Direct an assistant in ordinary musical language | EM-F011–F014 | MVP: prompt → supported FL edit → readback → render; later deeper arrangement/mixing automation and audition revisions. |
| EM-C007 | Use local model production where appropriate | EM-F012–F013 | Optional versioned job returns review candidates without touching playback deadlines. |
| EM-C008 | Add deliberate vocal performances | EM-F013–F014 | Later selected route demonstrates diction, pitch, expression and usable boundaries. |
| EM-C009 | Revisit a musical moment | EM-F004, F015 | Pilot restores versions/seed/settings; distinguishes setup from exact recorded audio. |
| EM-C010 | Evaluate a long listening experience | EM-F005, F015–F016 | Pilot work sessions first; later endurance and three-day breadth qualified separately. |
| EM-C011 | Add a new style without rewriting the engine | EM-F004, F007, F014 | Versioned recipe/palette within supported operations; not arbitrary executable packs. |
| EM-C012 | Learn to improve the music | EM-F014, F016 | Guidebook plus controlled listening revisions; no theory expertise required to listen. |

## Available now and evidence

The repository has design documents, detailed guides, illustrative contracts, a 40-question review and an implementation campaign. It has no executable player, generator or bridge. [First playable](FIRST_PLAYABLE.md) owns pilot scope and [EMF](campaigns/EMF_INITIAL_INFRASTRUCTURE.md) owns work status.

Name exact content and environment in demonstrations. Separate what was heard, measured, inferred or unverified. A new seed is not automatically a new musical identity. A route graph is not proof of a pleasant journey. State fit is not proof of improved productivity. Preserve capability IDs and describe accepted subsets honestly.
