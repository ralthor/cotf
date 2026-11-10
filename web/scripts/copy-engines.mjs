// Copies the Stockfish.js WASM engine (GPL-3.0) from node_modules into public/engines
// so it is served as a static asset next to its .wasm file.
// Copies the lite (~1.7 MB) and full (~95 MB) single-threaded builds. The full build is only
// downloaded by a browser when the user picks it.
import { copyFileSync, existsSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const src = join(root, 'node_modules', 'stockfish', 'bin');
const dest = join(root, 'public', 'engines');

if (!existsSync(src)) {
  console.warn('[copy-engines] stockfish package not found; skipping');
  process.exit(0);
}
mkdirSync(dest, { recursive: true });

const flavours = ['stockfish-19-lite-single', 'stockfish-19-single'];

for (const name of flavours) {
  for (const ext of ['.js', '.wasm']) {
    copyFileSync(join(src, name + ext), join(dest, name + ext));
  }
  console.log(`[copy-engines] copied ${name}`);
}
copyFileSync(join(root, 'node_modules', 'stockfish', 'Copying.txt'), join(dest, 'STOCKFISH-COPYING.txt'));
