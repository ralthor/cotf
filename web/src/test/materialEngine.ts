import { Chess } from 'chess.js';
import { materialBalance } from '../core/brilliancy/sacrifice';
import { fakeTransport } from './fakeEngine';

/**
 * A tiny deterministic "engine" for orchestration tests: 2-ply material minimax.
 * Emits proper UCI info lines (side-to-move relative cp) for depths 1..2 and MultiPV.
 */
export function materialEngineTransport() {
  return fakeTransport(({ fen, go, multiPv, emit }) => {
    const chess = new Chess(fen);
    const me = chess.turn();
    const restrict = go.includes('searchmoves') ? go.split('searchmoves ')[1]!.split(' ') : null;
    const scored = chess
      .moves({ verbose: true })
      .filter((m) => !restrict || restrict.includes(m.lan))
      .map((m) => {
        chess.move(m);
        let worst = Infinity;
        let reply = '';
        const replies = chess.moves({ verbose: true });
        if (replies.length === 0) worst = chess.isCheckmate() ? 10_000 : 0;
        for (const r of replies) {
          chess.move(r);
          const v = materialBalance(chess.fen(), me) * 100;
          chess.undo();
          if (v < worst) {
            worst = v;
            reply = r.lan;
          }
        }
        chess.undo();
        return { uci: m.lan, cp: worst, pv: reply ? [m.lan, reply] : [m.lan] };
      })
      .sort((a, b) => b.cp - a.cp || a.uci.localeCompare(b.uci));
    for (const depth of [1, 2]) {
      scored.slice(0, multiPv).forEach((s, i) => {
        const score = s.cp >= 10_000 ? 'mate 1' : `cp ${s.cp}`;
        emit(`info depth ${depth} multipv ${i + 1} score ${score} nodes 100 pv ${s.pv.join(' ')}`);
      });
    }
    emit(`bestmove ${scored[0]?.uci ?? '(none)'}`);
  });
}
