// Builds src/core/openings/openings.json from data/chess-openings/*.tsv (lichess-org/chess-openings, CC0).
// Key: position key after the line (EPD, en-passant only when a capture is legal), value: "ECO|Name".
import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Chess } from 'chessops/chess';
import { makeFen } from 'chessops/fen';
import { parseSan } from 'chessops/san';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const out = {};
let lines = 0;
for (const f of ['a', 'b', 'c', 'd', 'e']) {
  const rows = readFileSync(join(root, 'data/chess-openings', `${f}.tsv`), 'utf8').trim().split('\n').slice(1);
  for (const row of rows) {
    const [eco, name, pgn] = row.split('\t');
    const pos = Chess.default();
    for (const tok of pgn.split(/\s+/)) {
      if (/^\d+\.+$/.test(tok) || !tok) continue;
      const move = parseSan(pos, tok);
      if (!move) throw new Error(`Illegal ${tok} in ${eco} ${name}`);
      pos.play(move);
    }
    const key = makeFen(pos.toSetup(), { epd: true });
    // Several lines can reach one position; the first (most general) name wins.
    out[key] ??= `${eco}|${name}`;
    lines++;
  }
}
writeFileSync(join(root, 'src/core/openings/openings.json'), JSON.stringify(out));
console.log(`${lines} lines, ${Object.keys(out).length} positions`);
