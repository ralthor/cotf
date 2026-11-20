# Opening trainer, phase 6: installable app and offline use

Status: implemented, 20 Nov 2026. Builds on [phase 5](OPENING_TRAINER_PHASE5.md); the overall plan is in
[OPENING_TRAINER.md](OPENING_TRAINER.md).

## What works offline

Once the site has been opened online, everything that does not need another service works without a
connection, in the browser or as an installed app:

- the whole app (Analyse, Openings, About), both languages;
- repertoires, training, progress, backups, imported games (all in IndexedDB);
- PGN import from a file or pasted text, opening names (bundled);
- the lite Stockfish engine (1.8 MB). The full engine (95 MB) is not downloaded in advance; once the
  user has chosen and loaded it, it is cached too.

Needs a connection: fetching games from Chess.com or Lichess, importing a Lichess study, the opening
explorer.

## How

- **vite-plugin-pwa 2.0.0** (MIT, Workbox 7) generates the service worker and the web app manifest.
- Precached: every built asset, the icons, the lite engine. Ignored: the full engine, which has a
  runtime cache-first rule instead.
- `registerType: 'prompt'`: a new version waits until the user clicks **Reload** in a small banner, so an
  update never interrupts a training session. Open apps check for a new version every hour.
- A short "Ready to work offline" banner after the first visit.
- **Install** appears in the header where the browser offers installing (Chrome, Edge, Android).
  Safari: Share → Add to Home Screen.
- Icons: `npm run build:icons` draws them from the favicon's shapes (no image tools needed):
  192 and 512 px, a maskable 512 px with the piece in the safe zone, and a 180 px Apple touch icon.
- Works under a sub-path (GitHub Pages, `BASE_PATH=/chess-analyser/`): the manifest's `start_url` and
  `scope` are relative.
- `nginx.conf`: `sw.js` and the manifest are served with `Cache-Control: no-cache` so updates are found.

## Checked (20 Nov 2026)

With a production build served under `/chess-analyser/`: the service worker registered for that scope
and precached 24 files (about 3 MB). With the server stopped, a reload still opened the app; pasting a
PGN imported it, the opening name (B12 Caro-Kann Defense: Advance Variation) showed, and the cached
engine answered `uciok`.

Not checked: the update banner (needs two deployed versions) and installing on a phone.
