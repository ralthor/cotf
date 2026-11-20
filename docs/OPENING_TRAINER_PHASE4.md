# Opening trainer, phase 4: your games and your repertoire

Status: implemented, 20 Nov 2026. Builds on [phase 3](OPENING_TRAINER_PHASE3.md); the overall plan is in
[OPENING_TRAINER.md](OPENING_TRAINER.md).

## Scope

A fourth sub-tab in Openings, **Games**:

1. **Fetch your games** from Chess.com (by months) and Lichess (by number of games), using the same
   usernames as the Analyse tab. Only what the comparison needs is kept: players, result, date, time
   control and the first 40 moves (80 plies). Up to 2,000 games, oldest dropped first.
2. **Compare them with the selected repertoire**, each game on the side you played:
   - where **you** left the repertoire (your move was not in it);
   - where **your opponent** left it (a move your repertoire has no answer to);
   - games that followed the repertoire until it ran out.
3. **Check your deviations with the engine** (the browser's Stockfish, depth 14). A move within the
   `good` threshold of the move classifier is a **playable deviation**, not a mistake (§5 of the
   requirements).
4. **Turn mistakes into exercises**: "Add to review" writes them to the training log, so they appear in
   Train → Mistakes and in Review; "Practise" opens the position right away.
5. **Results per chapter**: games, score, wins/draws/losses, average moves in book.
6. **Start from your games** (discovery): builds a repertoire for White or Black from the moves you
   play most, with the opponents' replies seen in at least two games, and imports it as a new
   repertoire with how often each move was played and how it scored in the comments.

Not in this phase: adding an opponent's move to a chapter from this screen (it needs a chapter editor);
the engine checking discovered lines.

## Rules

- A game is compared on the side you played (your username is White or Black). Games from a position
  other than the standard start are skipped.
- Positions are compared by position key, so transpositions count as in the repertoire.
- The walk stops at the first move that is not in the repertoire, or when the repertoire has no moves
  for the position (the game followed it to the end).
- The same (position, move) found in several games is one row, with the number of games.
- Results by chapter count a game once a single chapter fits it and at least two plies were played in
  the repertoire.
- "Add to review" logs one answer per game (mode `game`, result `wrong`), skipping deviations the
  engine graded as playable and games already added.

## Storage (IndexedDB version 4)

| Store | Key | Content |
| --- | --- | --- |
| `openingGames` | game id | the trimmed game |
| `moveGrades` | `fen|uci` | engine grade of a deviation |

`TrainLogEntry` gains an optional `gameId`; mode `game`.

## Files

- `core/repertoire/games.ts`: trimming a game, comparing it with the repertoire, summaries per
  position and chapter. Pure, tested.
- `core/repertoire/discover.ts`: building a starter repertoire as PGN. Pure, tested.
- `storage/db.ts`: version 4, `openingGameStore`, `moveGradeStore`.
- `features/repertoire/GamesView.tsx`, `features/repertoire/useOpeningGames.ts`.
