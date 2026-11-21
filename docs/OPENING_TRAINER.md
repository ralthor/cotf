# Opening trainer: requirements review and approach

Status: all seven phases implemented, 20 Nov 2026, and phase 8 on 21 Nov 2026: [phase 1](OPENING_TRAINER_PHASE1.md),
[phase 2](OPENING_TRAINER_PHASE2.md), [phase 3](OPENING_TRAINER_PHASE3.md), [phase 4](OPENING_TRAINER_PHASE4.md),
[phase 5](OPENING_TRAINER_PHASE5.md), [phase 6](OPENING_TRAINER_PHASE6.md), [phase 7](OPENING_TRAINER_PHASE7.md),
[phase 8](OPENING_TRAINER_PHASE8.md).
The original requirements are copied at the end of this file.

## Summary

Build the opening memoriser as a new **Openings** tab in Chess on the Fly's header, next to Analyse and
About. It is not a separate app, and the rest of the site's design does not change: the new screens
reuse the existing layout, components and styles. Later phases may add sub-tabs inside Openings (for
example Repertoires, Train, Progress), but nothing outside it. Most of the groundwork already exists in
`web/`:

| Already in the app | Used for |
| --- | --- |
| Board (`react-chessboard`), arrows and square styles in `GameView` | Repertoire viewer and trainer board |
| Stockfish WASM, `EnginePool`, `EngineClient` | §8 analysis, grading deviations |
| `features/explore/grade.ts` (`gradeMove`, `GOOD_ENOUGH`) and the `cls-v1` thresholds | "Playable deviation" vs "mistake" |
| `features/explore/practice.ts` (practise your mistakes) | Pattern for hint, solution and result tracking |
| Chess.com and Lichess importers, `ProviderHttpClient` (rate limits, 429 back-off) | §7 game import, Lichess study import |
| IndexedDB (`storage/db.ts`) and `localStorage` prefs | §11 local storage |
| English and Persian i18n, right-to-left layout | All new screens |
| GitHub Pages deploy, browser-only build | §12 hosting |

`backend/` is not needed for any of these requirements. Proposal: nothing new depends on it (see open
questions).

## Technical choices

### 1. PGN: chessops instead of chess.js

`chess.js` keeps only the main line (see DECISIONS.md), so it cannot meet §1 "preserve all variations".
**chessops** (0.15.1, GPL-3.0-or-later, the same licence as this app; it is the library Lichess uses) gives:

- `parsePgn`: every game in a file, with the full variation tree (`Node` / `ChildNode`), NAGs, and
  comments before and after moves;
- `parseComment`: comment text, arrows and circles (`[%cal]`, `[%csl]`, as `CommentShape` with
  green/red/yellow/blue), `[%eval]`, clocks;
- `startingPosition(headers)` for `[FEN]`/`[SetUp]`, `makePgn` for exporting.

chess.js stays for the existing analyser. New repertoire code uses chessops.

### 2. Lichess studies

Public and unlisted studies export as PGN, with no login:

- whole study: `https://lichess.org/api/study/{studyId}.pgn`
- one chapter: `https://lichess.org/api/study/{studyId}/{chapterId}.pgn`

The query flags `comments`, `variations` and `orientation` keep everything §1 asks for, and each
chapter carries `[StudyName]`, `[ChapterName]`, `[ChapterURL]` and `[Orientation]` headers.
**Verified 20 Nov 2026:** the endpoint answers with `Access-Control-Allow-Origin: *`, so the browser
can fetch it directly. Private studies return 404 without a token. The app explains that the study must
be public or unlisted.

### 3. Positions, not lines

The repertoire is stored as a graph of positions. The key is the FEN without the move counters, with
the en-passant square only when a capture is legal (chessops `makeFen(pos.toSetup(), { epd: true })`).
So:

- transpositions merge: a position reached through two move orders is trained once;
- the same position in two chapters or two studies is one position;
- a "card" for spaced repetition is a position where it is your move, with the set of repertoire moves
  that are accepted there.

Chapters keep their own move tree as well, so comments and arrows are shown in the context they were
written in.

### 4. Spaced repetition: FSRS

Use **ts-fsrs** (6.0.0, MIT). One FSRS card per (repertoire, side, position). The three learning modes
map onto card state:

- **Learn**: new cards. Moves and explanations are shown first, then asked.
- **Memorise**: cards that are due. You answer before any explanation is shown.
- **Review**: cards failed recently (lapses), as short exercises.

Full-line training walks a path from the start position and grades every card on it. Position training
asks single cards. FSRS grades come from the result: first try without hints = Good, after a hint =
Hard, wrong or shown = Again (Easy is not given automatically; see phase 2).

### 5. Deviation vs mistake

When a move is not in the repertoire, grade it with the engine (`gradeMove`). If the loss compared with
the repertoire move is within the `good` threshold of `cls-v1`, it is a **playable deviation**: not
counted as a mistake, and the app offers to add it. Otherwise it is a **mistake**. The same rule is used
for training answers (§5) and real games (§7, §8).

### 6. Real games and discovery

Walk each imported game through the position graph and stop where it leaves the repertoire:

- **you** left it: a mistake (or a playable deviation, rule above); a mistake becomes an exercise;
- **your opponent** left it: a gap in your repertoire; the app suggests adding the line.

Discovery (§9) is the same walk with no repertoire: build a tree of the moves you play most often in your
games, check each with the engine, and offer it as a starter repertoire. Training can then start without
building a repertoire by hand.

### 7. Hints

Progressive, each step costing grade: the piece to move, then its square, then an arrow, then the move.
"No hints" turns the button off.

## Where the requirements need adjusting

- **§2 Opening database.**
  - Names and ECO codes: easy. Lichess's `chess-openings` dataset (CC0, about 3,500 entries, a few
    hundred KB) can be bundled and works offline.
  - Popularity and win/draw/loss: the Lichess opening explorer. **Verified 20 Nov 2026:** it returns 401
    without a token. So it needs a personal Lichess token (optional, online only) or is left out. Optional
    feature, never required.
  - Explanations, plans, traps: no good free structured dataset exists. Wikibooks *Chess Opening Theory*
    (CC BY-SA) is the closest but needs editing. Study comments are the main source of explanations;
    curated text comes last.
- **§4 "Ask questions about the reasoning".** With no paid AI service, questions are built from content:
  fill-in-the-blank from comments, "which square is the plan aimed at?" from arrows, and questions written
  by the author in the PGN. Free-form reasoning checks are out of scope.
- **§11 Moving progress between devices.** With no server this is export and import of a versioned JSON
  file. Safari deletes stored data for sites not visited for about 7 days unless the site is installed, so
  the app calls `navigator.storage.persist()` and reminds the user to back up. This must be visible, not
  only in settings.
- **§12 Offline (PWA).** `vite-plugin-pwa` (2.0.0, MIT). Cache the app, the opening names and the lite
  engine. The 95 MB full engine stays an optional download and is not precached.

## Phases

1. **Repertoire core**: import (file, paste, Lichess study or chapter), position graph, viewer with
   comments, arrows and highlighted squares, several repertoires. → [phase 1 plan](OPENING_TRAINER_PHASE1.md)
2. **Trainer**: pick a side, opponent moves played automatically, Learn / Memorise / Review, FSRS, hints,
   mistake log. → [phase 2 plan](OPENING_TRAINER_PHASE2.md)
3. **Progress and statistics** per repertoire, opening and position; JSON export and import.
   → [phase 3 plan](OPENING_TRAINER_PHASE3.md)
4. **Games and repertoire**: deviations, exercises from real games, discovery.
   → [phase 4 plan](OPENING_TRAINER_PHASE4.md)
5. **Opening names and ECO codes**; optional explorer statistics with a Lichess token.
   → [phase 5 plan](OPENING_TRAINER_PHASE5.md)
6. **PWA and offline use.** → [phase 6 plan](OPENING_TRAINER_PHASE6.md)
7. **Curated explanations, traps and reasoning questions.** → [phase 7 plan](OPENING_TRAINER_PHASE7.md)
8. **Learn from your own games**: weak spots, better moves from the opening database, and the games and
   move orders behind every number. → [phase 8 plan](OPENING_TRAINER_PHASE8.md)

## Open questions

Proposed defaults are in italics. Phase 2 uses all three defaults.

1. If the repertoire has two moves for you in one position, does either count as correct?
   *Yes, either is accepted. The lines after each are trained as separate paths.*
2. In full-line training, how is the opponent's reply chosen?
   *Weighted toward the replies whose following positions are due or weak; otherwise at random.*
3. What happens to `backend/`?
   *Leave it as it is. Nothing new depends on it, and the docs say the opening trainer is browser-only.*

## Appendix: original requirements

1. **Opening import.** Import PGN files; paste PGN; import public Lichess studies by URL; whole studies or
   single chapters; keep all variations; keep annotations, comments, evaluations, arrows and highlighted
   squares; several repertoires.
2. **Opening database.** A free, open-source database of openings; identify openings by name and ECO;
   show variations and move sequences; popularity and win/draw/loss statistics; explanations, plans and
   common traps where available.
3. **Opening training.** Interactive board; train White or Black; practise lines from studies or
   repertoires; opponent moves played automatically; prioritise lines the user struggles with; full-line
   training; single-position training; short exercises on failed positions; training without hints.
4. **Annotations and explanations.** Show study comments and annotations; keep explanations of plans; show
   annotations after moves during training; progressive hints; questions about the reasoning behind moves;
   three modes: Learn, Memorise, Review.
5. **Mistake tracking.** Record wrong moves; remember positions with mistakes; track repeated mistakes;
   separate repertoire deviations from objectively poor moves; find often-forgotten lines; track
   improvement; keep mistake history between sessions.
6. **Personalised training.** Spaced repetition; prioritise difficult positions; adapt to past mistakes;
   revisit weak lines more often; skip mastered positions; test recall of complete sequences; separate
   progress per repertoire.
7. **Chess.com and Lichess.** Fetch games from both; import history; analyse the user's games; find the
   openings played most; detect repertoire deviations; find recurring opening mistakes; performance per
   opening; generate exercises from mistakes in real games.
8. **Chess analysis.** Evaluate opening moves with an engine; find weak moves; separate playable
   alternatives from mistakes; compare played moves with repertoires; analyse problem positions; find
   opening weaknesses from past games.
9. **Opening discovery.** Discover existing preferences from past games; most-played openings; suggest
   lines to train; recommend training from real games; train without building a repertoire first.
10. **Progress and statistics.** Training history; correct and wrong answers; progress per opening and per
    position; recurring weaknesses; improvement over time; per-opening statistics; personal records.
11. **Data management.** Save studies, repertoires, progress, mistake history, games and analyses; export
    and import user data; move progress between devices.
12. **Application.** Free; open source; runs in the browser; no required backend; all analysis on the
    device; data stored locally; offline training after import; no required account; optional external
    chess APIs; installable as a PWA; minimal hosting cost.
