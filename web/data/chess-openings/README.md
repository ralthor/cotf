# Opening names

`a.tsv` … `e.tsv` are copied unchanged from [lichess-org/chess-openings](https://github.com/lichess-org/chess-openings)
(CC0-1.0, public domain dedication), downloaded 20 Nov 2026.

`npm run build:openings` turns them into `src/core/openings/openings.json`: the position after each
line (position key: FEN without move counters, en-passant square only when a capture is legal) mapped
to its ECO code and name. Run it again after updating the files.
