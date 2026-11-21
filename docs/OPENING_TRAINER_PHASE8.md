# Opening trainer, phase 8: learn from your own games

Status: implemented, 21 Nov 2026. Builds on [phase 4](OPENING_TRAINER_PHASE4.md) (your games) and
[phase 5](OPENING_TRAINER_PHASE5.md) (explorer); the overall plan is in [OPENING_TRAINER.md](OPENING_TRAINER.md).

## Why

A repertoire built from your own games trains you to repeat your own moves, which teaches nothing new.
What you want from your own games is where they go wrong and what to play instead, with every number
traceable to the games behind it.

## Scope

A fifth sub-tab in Openings, **Improve**, working from the games fetched in **Games** (no repertoire
needed):

1. **Weak spots**: positions where your score drops compared with one move earlier.
2. **Better moves**: at positions where it is your move, your moves compared with the Lichess players
   database (your rating group and the next, at the speeds you play) or the masters database.
3. **Full transparency**: every row opens a detail view with
   - how the numbers are worked out, step by step;
   - every move order that reaches the position, with its games and score; clicking a move shows it on
     the board;
   - what was played next, with results (click to go on);
   - the positions one move earlier (click to go back up);
   - the database answer: every move with games, share, W/D/L, score for you, your own games with it,
     the rule that picks the suggestion, the date it was looked up, and a link to the same position on
     Lichess;
   - the games, filterable by move order and result, with ratings, links to the game on its site and
     **Analyse** (opens it in the Analyse tab).
4. **Browse**: a folded **Your games here** panel under each chapter shows the same numbers, move orders,
   next moves and games for the selected position (as the chapter's side).
5. Both lists are sortable by every column: move number, how often you reach it, how often you lose,
   score change, and the combined number (default).
6. Filters: colour, time control, up to move N (default 15), at least N games (default 3).

## Rules

- Positions are per colour you played; transpositions are the same position (position key).
- A position repeated in a game counts once. Unfinished games are left out.
- **Points lost** = games × (score one move earlier − score here). "One move earlier" is the average of
  the previous position's score over the same games, each game counting the position it came from, so
  transpositions are handled. The score here is shrunk towards it by 5 imaginary games, so a 1-game 0%
  position cannot top the list. Only drops are listed. Move number is a column and a filter, not part
  of the formula (earlier positions already count through their number of games).
- **Points to gain** = your games with the move × gain per game, where gain = the suggested move's
  database score − your move's database score. When your move has fewer database games than the
  minimum, your own results are used instead (shrunk towards the position's database score).
- A move is suggested only if it is a **main move**: at least 200 games (masters: 50) and at least 5% of
  the position's database games, and gains at least 3 points per 100 games. Without the share rule, a
  move played 193 times with a lucky 54% beat one played 650,000 times.
- Lookups: the 300 most played positions at most, one request every 1.1 s, a one-minute pause when
  Lichess answers "too many requests". Answers are kept in IndexedDB (store `explorer`, version 5), per
  request URL, so each position is asked once per database and rating group.

## Storage

- IndexedDB version 5: `explorer` (request URL → answer and date).
- `OpeningGame` gains `userRating`, `opponentRating` and `pgn` (the whole game, for Analyse). Games
  fetched before this version have none; fetching again adds them.

## Speed

Building the positions from 2,000 games up to move 15 takes about 0.6 s in development; up to move 40
(the Browse panel) about 1.2 s, kept between chapters. Games are walked only as far as needed, and the
FEN is made from the position key plus move counters.

## Files

- `core/repertoire/insights.ts`: positions, move orders, weak spots, decision points, improvements.
  Pure, tested.
- `features/repertoire/useInsights.ts`: filters, lookups and scan.
- `features/repertoire/InsightsView.tsx`: lists and the detail view (its parts are reused in Browse).
- `features/repertoire/YourGamesPanel.tsx`: the Browse panel.
- `app/openGame.ts`: opens a game in the Analyse tab from elsewhere.

## Not in this phase

- Adding a suggested move to a repertoire to train it (needs the repertoire editor).
- Engine checks of suggestions (only database statistics are used).
- Opening a game in Analyse at the position (it opens at the start).
