import { Chess, validateFen } from 'chess.js';
import {
  buildGoCommand,
  parseBestMove,
  parseIdName,
  parseInfoLine,
  sideToMove,
  toWhiteScore,
  toWhiteWdl,
} from './uci';
import {
  EngineError,
  type DepthSnapshot,
  type EngineInfo,
  type EngineLine,
  type PositionAnalysis,
  type SearchRequest,
} from './types';

/** Minimal line-based transport so the client can run against a Web Worker or a fake engine. */
export interface EngineTransport {
  send(command: string): void;
  onLine(listener: (line: string) => void): void;
  onError(listener: (error: Error) => void): void;
  terminate(): void;
}

export type TransportFactory = () => EngineTransport;

export type SearchProgress = { depth: number; lines: EngineLine[]; nodes?: number };

export type AnalyseOptions = {
  signal?: AbortSignal;
  onProgress?: (p: SearchProgress) => void;
  /** Minimum milliseconds between progress callbacks. */
  progressIntervalMs?: number;
};

type Waiter = { match: (line: string) => boolean; resolve: () => void; reject: (e: Error) => void };

const HANDSHAKE_TIMEOUT_MS = 30_000;
const STOP_GRACE_MS = 2_000;

/**
 * Serialises UCI searches through a single engine instance.
 * Each search gets a generation number; lines from other generations are ignored.
 */
export class EngineClient {
  private transport: EngineTransport | null = null;
  private ready: Promise<void> | null = null;
  private queue: Promise<unknown> = Promise.resolve();
  private waiters: Waiter[] = [];
  private lineListener: ((line: string) => void) | null = null;
  private currentMultiPv = 1;
  private generation = 0;
  private engineName = 'unknown';
  private disposed = false;

  constructor(
    private readonly factory: TransportFactory,
    private readonly flavour: string = 'custom',
  ) {}

  get info(): EngineInfo {
    const version = /(\d+(?:\.\d+)?)/.exec(this.engineName)?.[1] ?? 'unknown';
    return { id: `${this.engineName} [${this.flavour}]`, name: this.engineName, version, flavour: this.flavour };
  }

  /** Starts the engine and performs the uci/isready handshake. Idempotent. */
  init(): Promise<void> {
    if (this.disposed) return Promise.reject(new EngineError('not-ready', 'Engine has been disposed.'));
    if (!this.ready) {
      this.ready = this.start().catch((e) => {
        this.ready = null;
        throw e;
      });
    }
    return this.ready;
  }

  private async start(): Promise<void> {
    const transport = this.factory();
    this.transport = transport;
    transport.onLine((line) => this.handleLine(line));
    transport.onError((err) => this.failAll(new EngineError('crashed', err.message || 'Engine crashed.')));
    const uciok = this.waitFor((l) => l === 'uciok', HANDSHAKE_TIMEOUT_MS);
    transport.send('uci');
    await uciok;
    this.currentMultiPv = 1;
    await this.isReady();
  }

  private handleLine(raw: string): void {
    const line = raw.trim();
    const name = parseIdName(line);
    if (name) this.engineName = name;
    this.lineListener?.(line);
    for (const w of [...this.waiters]) {
      if (w.match(line)) {
        this.waiters = this.waiters.filter((x) => x !== w);
        w.resolve();
      }
    }
  }

  private failAll(err: Error): void {
    const waiters = this.waiters;
    this.waiters = [];
    for (const w of waiters) w.reject(err);
  }

  private waitFor(match: (line: string) => boolean, timeoutMs: number): Promise<void> {
    return new Promise<void>((resolve, reject) => {
      const timer = setTimeout(() => {
        this.waiters = this.waiters.filter((w) => w !== waiter);
        reject(new EngineError('timeout', 'Engine did not respond in time.'));
      }, timeoutMs);
      const waiter: Waiter = {
        match,
        resolve: () => {
          clearTimeout(timer);
          resolve();
        },
        reject: (e) => {
          clearTimeout(timer);
          reject(e);
        },
      };
      this.waiters.push(waiter);
    });
  }

  private async isReady(): Promise<void> {
    const p = this.waitFor((l) => l === 'readyok', HANDSHAKE_TIMEOUT_MS);
    this.transport!.send('isready');
    await p;
  }

  /** Kills and restarts the engine (used after crashes, timeouts or unacknowledged stops). */
  async restart(): Promise<void> {
    this.transport?.terminate();
    this.transport = null;
    this.failAll(new EngineError('crashed', 'Engine restarted.'));
    this.ready = null;
    await this.init();
  }

  dispose(): void {
    this.disposed = true;
    this.transport?.terminate();
    this.transport = null;
    this.failAll(new EngineError('cancelled', 'Engine disposed.'));
  }

  /** Queues a search. Searches never overlap. */
  analyse(req: SearchRequest, opts: AnalyseOptions = {}): Promise<PositionAnalysis> {
    const run = this.queue.then(
      () => this.runSearch(req, opts),
      () => this.runSearch(req, opts),
    );
    this.queue = run.catch(() => undefined);
    return run;
  }

  private async runSearch(req: SearchRequest, opts: AnalyseOptions): Promise<PositionAnalysis> {
    if (opts.signal?.aborted) throw new EngineError('cancelled', 'Search cancelled.');
    const validation = validateFen(req.fen);
    if (!validation.ok) throw new EngineError('invalid-fen', validation.error ?? 'Invalid FEN.');

    const terminal = terminalAnalysis(req, this.info.id, this.info.version);
    if (terminal) return terminal;

    await this.init();
    const transport = this.transport!;
    const multiPv = Math.max(1, Math.min(req.multiPv ?? 1, 256));
    if (multiPv !== this.currentMultiPv) {
      transport.send(`setoption name MultiPV value ${multiPv}`);
      this.currentMultiPv = multiPv;
    }
    if (req.clearHash) transport.send('ucinewgame');
    await this.isReady();

    const gen = ++this.generation;
    const stm = sideToMove(req.fen);
    const snapshots = new Map<number, Map<number, EngineLine>>();
    let bestMove: string | null | undefined;
    let lastProgress = 0;
    const interval = opts.progressIntervalMs ?? 150;

    const expectedLines = Math.min(multiPv, req.searchMoves?.length ?? Number.POSITIVE_INFINITY, legalMoveCount(req.fen));

    const done = new Promise<void>((resolve, reject) => {
      this.lineListener = (line) => {
        if (gen !== this.generation) return;
        const info = parseInfoLine(line);
        if (info) {
          if (info.pv.length === 0 && info.score.kind === 'mate' && info.score.value === 0) return;
          const entry: EngineLine = {
            rank: info.multipv,
            score: toWhiteScore(info.score, stm),
            pvUci: info.pv,
            depth: info.depth,
            seldepth: info.seldepth,
            nodes: info.nodes,
            timeMs: info.timeMs,
            isBound: info.bound !== undefined,
            wdl: toWhiteWdl(info.wdl, stm),
          };
          let atDepth = snapshots.get(info.depth);
          if (!atDepth) snapshots.set(info.depth, (atDepth = new Map()));
          atDepth.set(info.multipv, entry);
          const now = Date.now();
          if (opts.onProgress && now - lastProgress >= interval) {
            lastProgress = now;
            const best = pickFinal(snapshots, expectedLines);
            if (best) opts.onProgress({ depth: best.depth, lines: best.lines, nodes: entry.nodes });
          }
          return;
        }
        const bm = parseBestMove(line);
        if (bm) {
          bestMove = bm.best;
          resolve();
        }
      };
      const timeout = req.timeoutMs;
      if (timeout) {
        setTimeout(() => reject(new EngineError('timeout', `Search exceeded ${timeout} ms.`)), timeout);
      }
      opts.signal?.addEventListener('abort', () => reject(new EngineError('cancelled', 'Search cancelled.')), {
        once: true,
      });
    });

    transport.send(`position fen ${req.fen}`);
    transport.send(
      buildGoCommand({ depth: req.depth, nodes: req.nodes, movetimeMs: req.movetimeMs, searchMoves: req.searchMoves }),
    );

    try {
      await done;
    } catch (err) {
      // `stop` is asynchronous: wait for the matching bestmove, or restart the engine.
      const ack = this.waitFor((l) => l.startsWith('bestmove'), STOP_GRACE_MS);
      transport.send('stop');
      try {
        await ack;
      } catch {
        await this.restart().catch(() => undefined);
      }
      this.lineListener = null;
      this.generation++;
      throw err;
    }
    this.lineListener = null;

    const final = pickFinal(snapshots, expectedLines);
    const byDepth: DepthSnapshot[] = [...snapshots.entries()]
      .sort((a, b) => a[0] - b[0])
      .map(([depth, m]) => ({ depth, lines: [...m.values()].sort((a, b) => a.rank - b.rank) }));

    return {
      fen: req.fen,
      engineId: this.info.id,
      engineVersion: this.info.version,
      options: {
        multiPv,
        searchMoves: req.searchMoves,
        hashCleared: !!req.clearHash,
        limits: { depth: req.depth, nodes: req.nodes, movetimeMs: req.movetimeMs },
      },
      requestedDepth: req.depth,
      completedDepth: final?.depth ?? 0,
      lines: final?.lines ?? [],
      byDepth,
      bestMoveUci: bestMove ?? undefined,
      stopped: false,
      completedAt: new Date().toISOString(),
    };
  }
}

function legalMoveCount(fen: string): number {
  try {
    return new Chess(fen).moves().length;
  } catch {
    return 1;
  }
}

/**
 * Picks the deepest depth whose MultiPV set is complete (all expected ranks present),
 * falling back to the deepest depth that has rank 1. Never mixes lines from different depths.
 */
export function pickFinal(
  snapshots: Map<number, Map<number, EngineLine>>,
  expected: number,
): { depth: number; lines: EngineLine[] } | null {
  const depths = [...snapshots.keys()].sort((a, b) => b - a);
  for (const d of depths) {
    const m = snapshots.get(d)!;
    if (m.size >= expected && m.has(1)) return { depth: d, lines: [...m.values()].sort((a, b) => a.rank - b.rank) };
  }
  for (const d of depths) {
    const m = snapshots.get(d)!;
    if (m.has(1)) return { depth: d, lines: [...m.values()].sort((a, b) => a.rank - b.rank) };
  }
  return null;
}

function terminalAnalysis(req: SearchRequest, engineId: string, engineVersion: string): PositionAnalysis | null {
  const chess = new Chess(req.fen);
  let terminal: PositionAnalysis['terminal'];
  let line: EngineLine | null = null;
  if (chess.isCheckmate()) {
    terminal = 'checkmate';
    const loser = chess.turn();
    line = {
      rank: 1,
      depth: 0,
      pvUci: [],
      score: { kind: 'mate', moves: 0, winner: loser === 'w' ? 'b' : 'w', perspective: 'white' },
    };
  } else if (chess.isStalemate()) terminal = 'stalemate';
  else if (chess.isInsufficientMaterial()) terminal = 'insufficient';
  else if (chess.isDraw() && chess.moves().length === 0) terminal = 'draw';
  if (!terminal) return null;
  line ??= { rank: 1, depth: 0, pvUci: [], score: { kind: 'cp', value: 0, perspective: 'white' } };
  return {
    fen: req.fen,
    engineId,
    engineVersion,
    options: { multiPv: 1, hashCleared: false, limits: { depth: req.depth } },
    requestedDepth: req.depth,
    completedDepth: 0,
    lines: [line],
    byDepth: [],
    stopped: false,
    terminal,
    completedAt: new Date().toISOString(),
  };
}
