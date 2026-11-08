import type { EngineTransport } from '../core/engine/EngineClient';

export type FakeScript = (ctx: {
  fen: string;
  go: string;
  multiPv: number;
  emit: (line: string) => void;
}) => void;

/**
 * Scripted UCI engine for tests. `script` is called on each `go` and should emit
 * info lines followed by a bestmove (or nothing, to simulate a hang).
 */
export function fakeTransport(
  script: FakeScript,
  opts: { name?: string; respondToStop?: boolean; log?: string[] } = {},
): EngineTransport & { sent: string[] } {
  const listeners: ((l: string) => void)[] = [];
  const sent: string[] = opts.log ?? [];
  let fen = '';
  let multiPv = 1;
  let searching = false;
  const emit = (line: string) => queueMicrotask(() => listeners.forEach((l) => l(line)));
  return {
    sent,
    send(cmd: string) {
      sent.push(cmd);
      if (cmd === 'uci') {
        emit(`id name ${opts.name ?? 'FakeFish 19'}`);
        emit('uciok');
      } else if (cmd === 'isready') emit('readyok');
      else if (cmd.startsWith('setoption name MultiPV value ')) multiPv = Number(cmd.split(' ').pop());
      else if (cmd.startsWith('position fen ')) fen = cmd.slice('position fen '.length);
      else if (cmd.startsWith('go')) {
        searching = true;
        script({
          fen,
          go: cmd,
          multiPv,
          emit: (l) => {
            if (l.startsWith('bestmove')) searching = false;
            emit(l);
          },
        });
      } else if (cmd === 'stop' && searching && opts.respondToStop !== false) {
        searching = false;
        emit('bestmove e2e4');
      }
    },
    onLine: (l) => listeners.push(l),
    onError: () => undefined,
    terminate: () => undefined,
  };
}
