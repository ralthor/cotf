# Opening trainer, phase 2: the trainer

Status: implemented, 20 Nov 2026. Builds on [phase 1](OPENING_TRAINER_PHASE1.md); the overall plan is in
[OPENING_TRAINER.md](OPENING_TRAINER.md).

## Scope

- Train a repertoire (or one chapter of it) as White or Black.
- The app plays the opponent's moves; you answer on the board by dragging pieces.
- Three modes: **Learn** (new positions), **Memorise** (due positions), **Review** (positions you got wrong).
- Spaced repetition with FSRS, one card per (repertoire, side, position).
- Progressive hints and "show move"; a "no hints" switch.
- A mistake log: every answer is recorded; positions you got wrong are listed with what you played.

Not in this phase: engine grading of moves outside the repertoire ("playable deviation"), statistics pages,
backup files (phase 3), games (phase 4).

## Constraint: still one tab

The trainer lives inside the Openings tab: the right column gets two sub-tabs, **Browse** (the phase 1
chapter viewer) and **Train**. The left column (repertoire picker, chapters, import) does not change.
Opening a chapter from the list switches back to Browse.

## Decisions on the open questions

The proposed defaults in OPENING_TRAINER.md are used:

1. Two repertoire moves for you in one position: either is accepted, and the line continues after the
   move you played.
2. Opponent replies: chosen at random, weighted by how many positions that still need training lie
   behind each reply. Replies with nothing to train behind them are not played.
3. `backend/` is left as it is.

## Training model

The graph is the `RepMove` list from phase 1 (built in memory from the chapters in scope). A **card** is a
position where it is your move and the repertoire has at least one move for you.

A **line** starts at a chapter's start position and walks the graph:

- your move: you are asked (every move on the line, so the whole sequence is recalled), unless nothing
  that needs training lies ahead, in which case the line ends;
- the opponent's move: picked as in decision 2, played after a short pause.

What "needs training" depends on the mode:

| Mode | Cards that need training | How a line runs |
| --- | --- | --- |
| Learn | never trained | New moves are **shown** first (arrow and the chapter's comments), you play them. After at most 6 new moves the line stops and you replay it from the start from memory; that replay is graded. |
| Memorise | due now (FSRS) | Full line, no explanations until you have answered. |
| Review | answered wrong before (FSRS lapses), most recent first | Single positions: the board is set up at the position, you answer. |

Grades for FSRS:

- right on the first try with no hint: **Good**;
- right after a hint: **Hard**;
- a wrong move, or "show move": **Again**.

A card is rescheduled when it needs training in the current mode, and always on **Again** (a mistake
on a card that was not due still counts). Correct answers on cards that are not due do not move them.
"Easy" is not given automatically; answering fast in a familiar opening is normal, and it would make
intervals grow too quickly.

A move that is legal but not in the repertoire is a wrong answer; the piece goes back and you try again.
Another repertoire move is not wrong when the line needs a particular one (a Learn replay, or when only
some of your moves lead to positions that need training): the piece goes back with "this line goes on
with another move".

Moves are played by dragging, or by tapping the piece and then its square.

Hints, each step showing more: the piece to move (its square highlighted), then the target square, then
an arrow. "Show move" draws the arrow and counts as Again.

## Storage (IndexedDB version 3)

| Store | Key | Content |
| --- | --- | --- |
| `trainCards` | `[repertoireId, side, posKey]` | ts-fsrs card state |
| `trainLog` | auto-increment | one row per question: position, mode, result (`good`, `hinted`, `wrong`, `shown`), wrong moves tried, expected moves, time taken |

Deleting a repertoire deletes its cards and log. Cards of positions that left the repertoire (a chapter
was deleted) are ignored, and come back if the position returns.

## Libraries

ts-fsrs 6.0.0 (MIT), `DefaultScheduler` (FSRS-7 defaults, fuzzing on). It loads with the Openings tab only.

## Files

- `core/repertoire/trainer.ts`: training graph, what lies ahead, opponent choice, grading, hint squares,
  line labels. Pure, tested.
- `core/repertoire/srs.ts`: the FSRS scheduler wrapper.
- `storage/db.ts`: version 3, `trainStore`.
- `features/repertoire/useTrainer.ts`: session state.
- `features/repertoire/TrainerView.tsx`: mode choice, counts, mistake list, the training board.
- `features/repertoire/OpeningsView.tsx`: Browse / Train sub-tabs.
