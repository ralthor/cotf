# Opening trainer, phase 5: opening names and explorer statistics

Status: implemented, 20 Nov 2026. Builds on [phase 4](OPENING_TRAINER_PHASE4.md); the overall plan is in
[OPENING_TRAINER.md](OPENING_TRAINER.md).

## Opening names and ECO codes

- Data: [lichess-org/chess-openings](https://github.com/lichess-org/chess-openings) (CC0), the five TSV
  files copied to `web/data/chess-openings/`. `npm run build:openings` turns them into
  `src/core/openings/openings.json`: position key → `ECO|Name` (3,865 positions, about 60 kB
  compressed). It loads as its own chunk the first time a name is needed and works offline.
- A position is named by the **last named position along the line** that leads to it, so moves past
  the dataset keep their opening's name, and transpositions are named like the main order.
- Shown:
  - **Browse**: the ECO code and name of the current position, under the chapter title;
  - **Train**: next to the line's name, from the moves already played (never the next move), when the
    chapter has no `[Opening]` header of its own;
  - **Games**: on each "where you left" / "where your opponent left" row, and a new **Your openings**
    table: your games grouped by opening family and side, with score and wins/draws/losses.

## Explorer statistics (optional, online)

- A folded **Explorer statistics** panel in Browse shows the moves played in the current position, how
  often, and how they scored (White / draw / Black), marking the moves in your repertoire; clicking one
  goes to it in the chapter.
- **Masters** works without an account. **Lichess players** needs a personal Lichess API token with no
  permissions; the panel links to the page that creates one. The token is kept in this browser
  (localStorage) and sent only to `explorer.lichess.ovh`. Verified 20 Nov 2026: masters answers 200
  without a token, lichess 401.
- Requests wait 250 ms after the position changes and are cached for the session, so stepping through
  moves does not flood the service.

## Files

- `web/data/chess-openings/`, `web/scripts/build-openings.mjs`, `src/core/openings/` (`names.ts`,
  `openings.json`).
- `features/repertoire/explorer.ts` (client), `ExplorerPanel.tsx`, `useOpenings.ts`.
- `core/repertoire/games.ts`: `gameKeys`, `openingResults`; `trainer.ts`: `pathTo`.
