# Opening trainer, phase 1: repertoire core

Status: implemented, 20 Nov 2026 (see "Changes from the plan" at the end). Background and later phases: [OPENING_TRAINER.md](OPENING_TRAINER.md).

## Goal

Get opening content into the app without losing anything, store it locally, and show it. At the end of
phase 1 a user can:

- create several repertoires and rename or delete them;
- import into a repertoire from a PGN file, pasted PGN, a Lichess study URL or a Lichess chapter URL;
- browse each chapter with every variation, comment, NAG, evaluation, arrow and highlighted square;
- export a chapter or a whole repertoire back to PGN;
- close the browser, come back, and find everything still there.

No training yet. But the data model already holds what phase 2 needs (positions keyed for FSRS cards,
the side each chapter is for), so phase 2 adds tables and does not migrate content.

Out of scope: training, FSRS, statistics, opening names and ECO, games compared with the repertoire,
JSON backup, PWA.

## Constraint: a new tab, not a redesign

Everything in this phase lives behind one new **Openings** tab in the existing header nav. The rest of the
site (header, Analyse tab, About, styles, layout) does not change. The new screens reuse the existing
layout classes (`layout`, `games-col`, `game-col`, `panel`, `tabs`), components (`Icon`, the board setup
from `GameView`) and CSS tokens, so they look like the Analyse tab. The only changes outside the new
feature folder are:

- `useHashRoute.ts`: add the `openings` route;
- `App.tsx`: one nav entry and one `route === 'openings'` branch;
- `storage/db.ts`: the new stores (invisible to users; existing data kept);
- `styles.css`: a few additions for the variation tree and shape colours, no changes to existing rules;
- `en.json` / `fa.json`: new keys only.

## Decisions for this phase

- **chessops** for all repertoire PGN work. chess.js stays in the analyser.
- **Side per chapter**, not per repertoire. Lichess studies often mix White and Black chapters. Default
  from `[Orientation]`, otherwise asked at import; can be changed later. The position graph is kept per
  (repertoire, side).
- **Position key** = `makeFen(pos.toSetup(), { epd: true })`: placement, side to move, castling, and an
  en-passant square only when a capture is legal. Move counters are dropped, so transpositions merge.
- **Chapter trees are kept as parsed.** The graph is derived from them and rebuilt on any change, so it
  can never drift from the content.
- **Re-importing a study** replaces chapters that have the same Lichess chapter ID and adds new ones.
  Chapter IDs stay stable, and later progress is keyed by position, so updating a study never loses
  progress.
- **Only standard chess.** A `[Variant]` other than Standard (or From Position) is rejected with a clear
  message. Chess960 can come later.

## Data model

New file `web/src/core/repertoire/types.ts`:

```ts
type Side = 'w' | 'b';
type PosKey = string; // EPD-style FEN, see above

type Repertoire = {
  id: string;
  name: string;
  createdAt: string;
  updatedAt: string;
};

type ChapterSource =
  | { kind: 'pgn-file'; fileName: string }
  | { kind: 'pgn-paste' }
  | { kind: 'lichess-study'; studyId: string; chapterId: string; studyName?: string; url: string };

type Chapter = {
  id: string;            // lichess:<studyId>:<chapterId>, or a random id
  repertoireId: string;
  title: string;         // ChapterName, else Event/Opening/White–Black, else "Chapter n"
  side: Side;
  source: ChapterSource;
  importedAt: string;
  headers: Record<string, string>;
  startFen: string;
  root: RepNode;         // the tree, see below
  order: number;         // position in the repertoire's chapter list
};

type Shape = { color: 'green' | 'red' | 'yellow' | 'blue'; from: string; to: string }; // from === to: circle
type Eval = { pawns: number } | { mate: number };

type RepNode = {
  // On the root: comments before the first move, and shapes for the start position.
  san?: string;
  uci?: string;
  posKey: PosKey;        // position after this move (on the root: the start position)
  nags?: number[];
  commentsBefore?: string[];
  comments?: string[];   // text only; shapes and evals are parsed out
  shapes?: Shape[];
  eval?: Eval;
  children: RepNode[];   // children[0] is the main line
};

// Derived, one per (repertoire, side, from, uci). Rebuilt when chapters change.
type RepMove = {
  repertoireId: string;
  side: Side;
  from: PosKey;
  uci: string;
  san: string;
  to: PosKey;
  mine: boolean;          // the mover is `side`: in phase 2 this position is a card
  main: boolean;          // main move in at least one chapter
  refs: { chapterId: string; path: number[] }[]; // child-index path to the node
};
```

Clocks (`[%clk]`, `[%emt]`) are dropped. Unknown `[%…]` commands stay in the comment text.

## Storage

`storage/db.ts`, `DB_VERSION` 1 → 2.

- New stores:
  - `repertoires` (key `id`);
  - `chapters` (key `id`, index `repertoireId`);
  - `repMoves` (key `[repertoireId, side, from, uci]`, index `[repertoireId, side, from]`).
- **The `upgrade` callback must branch on `oldVersion`.** Today it creates every store unconditionally,
  which throws on an existing v1 database. Create the v1 stores only when `oldVersion < 1`, the new ones
  when `oldVersion < 2`. A test opens a v1 database with games in it, upgrades, and checks the games are
  still there.
- `repertoireStore`: `list`, `get`, `put`, `remove` (removes its chapters and moves in one transaction),
  `chapters(repertoireId)`, `putChapters(repertoireId, chapters)` (writes the chapters and rebuilds that
  repertoire's `repMoves` in one transaction), `movesFrom(repertoireId, side, posKey)`.
- After the first import, call `navigator.storage.persist()` once (guarded). Show the result in the
  repertoire panel ("Stored on this device" / "May be cleared by the browser, export a backup").

## Code

### Core (no React), `web/src/core/repertoire/`

| File | Contents |
| --- | --- |
| `types.ts` | The types above |
| `posKey.ts` | `posKey(pos)`, `posKeyFromFen(fen)` |
| `parse.ts` | `parseRepertoirePgn(text, opts) → { chapters, warnings }`. Splits multi-game PGN with chessops `parsePgn`, gets the start with `startingPosition`, walks the tree playing each SAN, and turns `parseComment` output into `comments`, `shapes`, `eval`. An illegal SAN cuts that branch and adds a warning with the move number. Empty games are skipped with a warning. |
| `graph.ts` | `buildMoves(repertoireId, chapters) → RepMove[]`: walks every chapter tree and merges by (side, from, uci) |
| `export.ts` | `chapterToPgn(chapter)`, `repertoireToPgn(chapters)` with chessops `makePgn` and `makeComment`, putting shapes and evals back as `[%cal]`, `[%csl]`, `[%eval]` |
| `nags.ts` | NAG number → glyph and i18n key (`!`, `?`, `!!`, `??`, `!?`, `?!`, `□`, `=`, `+=`, `±`, `+-` and their mirror images) |

### Lichess studies, `web/src/features/import/lichessStudy.ts`

- `parseStudyUrl(input)` accepts `lichess.org/study/{id}`, `…/study/{id}/{chapterId}`, with or without
  `https://`, `www.`, a trailing `#ply` or a query string, and a bare 8-character study ID. Returns
  `{ studyId, chapterId? }` or null.
- `fetchStudyPgn({ studyId, chapterId })` with
  `?comments=true&variations=true&clocks=false&orientation=true`, through a `ProviderHttpClient`
  configured like `LichessClient` (one request at a time, 60 s back-off on 429).
- 404 → `ImportError('not-found')` with the message "This study is private or does not exist. Make it
  public or unlisted on Lichess and try again."
- Chapter IDs come from each chapter's `[ChapterURL]` header.

### UI, `web/src/features/repertoire/`

| Component | Contents |
| --- | --- |
| `OpeningsView.tsx` | New route `#/openings`, "Openings" in the header nav. Same two-column layout as Analyse, with the same phone fold-out panel. |
| `RepertoireList.tsx` | Repertoires with chapter counts; create, rename, delete (with confirmation); select. Chapters of the selected repertoire, with side badge, source, re-import (for studies), export, delete. |
| `RepertoireImport.tsx` | Tabs: File, Paste, Lichess study (same tab pattern and remembered tab as `ImportPanel`). Target: an existing repertoire or "New repertoire" (named after the study or file). Side: from `[Orientation]` when present, else a White/Black choice. Shows warnings after import. |
| `ChapterView.tsx` | Board (orientation = chapter side) with the current node's arrows and circles; comment panel with NAG glyph, comment text and eval; move tree; previous / next / first / last buttons, arrow keys (left/right through the line, up/down between sibling variations), swipe on phones like `GameView`. |
| `VariationTree.tsx` | Main line as move pairs; variations inline in brackets and indented, deeper levels collapsible; the current move highlighted; click to jump. `MoveList` is linear and cannot be reused. Moves inside `<bdi dir="ltr">`, as in the Persian fix in commit 4117265. |

Shape colours become CSS tokens in `styles.css` (`--shape-green` etc., also for dark mode), passed to
react-chessboard `arrows` and `squareStyles`.

### i18n

All new strings in `en.json` and `fa.json`; `i18n.test.ts` already checks both have the same keys.
Exported PGN stays in English.

## Steps

1. **Dependency and keys.** Add `chessops@0.15.1`. `posKey.ts` with tests: transpositions give the same
   key, an en-passant square without a legal capture is dropped.
2. **Parser.** `parse.ts` and `nags.ts` with tests (fixtures in `src/test/fixtures/repertoire.ts`):
   - nested variations three levels deep;
   - comments before and after moves, and before the first move;
   - `[%cal Ge2e4,Rd7d5]`, `[%csl Gd4]`, `[%eval 0.3]`, `[%eval #-2]`, `[%clk …]` dropped;
   - NAGs as `$1` and as `!?` in the move text;
   - `[SetUp "1"][FEN …]` start position;
   - several games in one file; an empty game; an illegal move inside a variation;
   - a non-standard `[Variant]` rejected;
   - a real Lichess study export saved as a fixture (checked by hand once, then frozen).
3. **Graph and export.** `graph.ts` (merging, transpositions, `mine`, `main`, refs) and `export.ts`.
   Round trip: parse → export → parse gives the same tree, shapes and evals.
4. **Storage.** DB v2, upgrade test from v1 with games, repertoire store tests on `fake-indexeddb`.
5. **Lichess study import.** `lichessStudy.ts` with URL parsing tests and fetch tests using the fake
   fetch already used by `import.test.ts` (study, single chapter, 404, 429).
6. **Openings route and repertoire list.** Route, nav item, list, create, rename, delete, import panel.
7. **Chapter viewer.** `ChapterView` and `VariationTree`, keyboard and swipe navigation, shapes,
   comments, evals; Persian right-to-left check.
8. **Export buttons, re-import, storage-persistence notice.**
9. **Check.** `npm test`, `npm run lint`, `npm run typecheck`, `npm run build`. Then in the browser pane:
   import a real public study and one chapter of it, a PGN file with variations, pasted PGN; reload and
   confirm everything is kept; check phone width, dark mode and Persian.
10. **Docs.** README section for Openings; DECISIONS.md entries (chessops, position key, side per
    chapter, verified study CORS and explorer 401).

## Done when

- Every PGN feature in the step 2 list is shown in the viewer and survives export and re-import.
- A Lichess study and a single chapter import from their URLs, with arrows, circles and comments shown as
  on Lichess.
- Two repertoires can hold different content; deleting one leaves the other and the analyser's games
  untouched.
- Data survives a reload; upgrading from today's v1 database keeps imported games and analyses.
- Tests, lint, typecheck and build pass; the screens work at phone width, in dark mode and in Persian.

## Risks

- **Large studies.** Lichess allows 64 chapters per study, some with hundreds of variations. Parsing is
  fast, but rendering a whole tree at once may not be: collapse deep variations by default and measure on
  a big study in step 7.
- **Malformed PGN** from other tools. chessops is tolerant; anything it cannot read becomes a warning, not
  a failed import.
- **IndexedDB upgrade.** The v1 → v2 change is the first schema upgrade in this app. It is covered by a
  test before any UI work.

## Changes from the plan

- **Arrow colours** are constants (Lichess' colours) rather than CSS tokens, because react-chessboard
  draws arrows as SVG attributes.
- **`wholeStudy`** was added to the Lichess chapter source. Without it, *Update from Lichess* on a
  repertoire holding one imported chapter would have pulled in the whole study.
- **`RepNode.fen`** (the full FEN) is stored next to `posKey`, so the viewer never replays moves.
- **Unknown `[%…]` commands** are hidden on screen (kept in storage and export).
- **The Openings tab is lazy-loaded**, so the analyser's download does not grow by chessops.
- **`movesFrom`** is in the store for phase 2 but nothing in the UI uses it yet.
