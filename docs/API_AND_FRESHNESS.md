# External APIs and data freshness

## Chess.com PubAPI (public, read-only, no auth)

| Purpose | URL |
| --- | --- |
| Archive index | `https://api.chess.com/pub/player/{user}/games/archives` |
| Month (JSON) | `https://api.chess.com/pub/player/{user}/games/{YYYY}/{MM}` |
| Month (PGN) | `…/{YYYY}/{MM}/pgn` (whole month; not used) |

- Archives are keyed by **UTC** month (`utcYearMonth`). The current month is partial.
- Responses refresh **at most every 12 hours**. That is a refresh frequency, not a visibility SLA: a just-finished game may be missing. The UI shows the time of the latest published game and a freshness note.
- Requests are serialised (minimum gap 250 ms). On 429 the client backs off 5 s × attempt, up to 2 retries.
- CORS: `Access-Control-Allow-Origin: *` (verified 8 Nov 2026).
- Game URLs (`chess.com/game/live/…`) have **no documented PGN endpoint**. They are refused with guidance to paste the PGN.

## Lichess API (public games, no auth)

| Purpose | URL |
| --- | --- |
| User games (NDJSON stream) | `https://lichess.org/api/games/user/{user}?max=N&pgnInJson=true&clocks=true&opening=true&finished=true[&since=ms]` |
| Single game | `https://lichess.org/game/export/{id8}?pgnInJson=true&clocks=true&opening=true` (Accept: application/json) |

- Single games are available **immediately** after they end, so a game URL is the instant-analysis path.
- One request at a time. On 429, wait **at least 60 s**.
- CORS: origin echoed in `Access-Control-Allow-Origin` (verified). `If-None-Match` is **not** in the preflight allow-list, so the browser client does not send it.
- Only finished games in `standard`/`fromPosition` are imported. `created`/`started` (in progress) and `aborted` are refused.

## Server-side sync (Phase 2)

- Celery beat runs `sync_all_accounts` every 6 hours (minute 17). Users can also press **Sync now**.
- Chess.com: on the first sync, the latest `SYNC_MAX_MONTHS_INITIAL` months are fetched. Past months are then marked complete and skipped. The current month is revalidated with `If-None-Match`/`If-Modified-Since`.
- Lichess: the cursor is `lichess_since_ms` (max `lastMoveAt` seen), and the next sync requests `since = cursor + 1`.
- Server requests send `PROVIDER_USER_AGENT`. Set a real contact address in production.

## Backend REST API (all under `/api/`, token auth)

| Method | Path | Notes |
| --- | --- | --- |
| POST | `auth/register/`, `auth/login/` | → `{token, user}` (throttle scope `auth`) |
| POST | `auth/logout/` | revokes token |
| GET | `auth/me/` | user + linked accounts |
| GET/POST | `accounts/external/` | link a public username (one per provider) |
| DELETE | `accounts/external/{id}/` | unlink |
| POST | `accounts/external/{id}/sync/` | queue sync |
| POST | `imports/pgn/` | `{pgn}` → `{created, existing, errors}` (dedupes) |
| POST | `imports/chesscom/` | `{username?}` → queue sync |
| POST | `imports/lichess/` | `{username?}` → queue sync, or `{game_url_or_id}` → import now |
| GET | `games/` | filters: `colour`, `time_class`, `provider`, `result`, `opponent`, `opening`, `date_from`, `date_to`, `min_rating`, `max_rating`, `page` |
| GET/DELETE | `games/{id}/` | detail includes moves and PGN |
| GET/POST | `games/{id}/analysis/` | list runs / upload a browser analysis (re-classified server-side) |
| GET | `stats/` | same filters as `games/` |
| GET | `engine-profiles/` | cloud profiles + remaining quota |
| POST | `games/{id}/analyse/` | `{profile}` → cloud job (deduped, quota-checked) |
| GET | `analysis-jobs/`, `analysis-jobs/{id}/` | status; includes `analysis` when done |
| POST | `analysis-jobs/{id}/cancel/` | cooperative cancel |
