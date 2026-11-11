import { Chess } from 'chess.js';
import { materialBalance } from '../brilliancy/sacrifice';
import { GREAT_POLICY } from '../brilliancy/great';
import type { Colour } from '../chess/types';
import { uciLineToSan } from '../chess/lines';
import type { EngineScore } from '../engine/types';
import { expectedScore, formatScore, opponent } from '../scoring/score';

/**
 * EXPERIMENTAL "why was this move bad?" explainer (version why-v1). It runs on demand for one
 * move and never changes the game analysis.
 *
 * Main tool: a threat search. Hand the move to the opponent as if the mover had passed (a "null
 * move") and search; the opponent's best move there is their threat. Then the loss of the played
 * move is put down to one or more causes:
 *  - ignored-threat: a real threat existed and the move did not deal with it;
 *  - only-move: the best move was far better than every other move (a missed great move);
 *  - missed-opportunity: the best move won material or forced mate, and there was no threat;
 *  - allowed-tactic: the move created a problem that did not exist before (e.g. left a piece
 *    hanging or moved a defender away);
 *  - positional: none of the above; no material changes hands in the next few moves.
 */
export const WHY_BAD_VERSION = 'why-v1';

export const WHY_BAD_POLICY = {
  /** A pass must cost at least this much (expected-score pts) for the opponent to have a real threat. */
  minThreatPct: 8,
  /** The move "did nothing" against the threat if it ends up within this much of passing. */
  noDefenceTolerancePct: 3,
  /** Material swings (pawns) that count as winning or losing material. */
  minMaterial: 2,
  /** How far along a line material is counted (plies, rounded down to an even number). */
  materialPlies: 6,
  /** Best minus second-best at least this much ⇒ the best move was the only good move. */
  onlyMoveGapPct: GREAT_POLICY.minDeepGapPct,
  /** With this many or fewer pieces (not pawns or kings), passing can be wrongly harmful (zugzwang). */
  zugzwangPieces: 2,
};

export type ExplainLine = { uci: string[]; score: EngineScore };

export type ThreatReport = {
  /** Opponent's best move if the side to move could pass. */
  uci: string;
  san: string;
  /** FEN with the opponent to move (the null-move position), to play the threat on the board. */
  fen: string;
  line: string[];
  /** How much passing would cost the side to move (expected-score pts; internal, not shown). */
  sizePct: number;
  /** Evaluation with the side to move playing its best move, and if it ignores the threat. */
  evalNow: EngineScore;
  evalIfIgnored: EngineScore;
  real: boolean;
  /** Few pieces left: passing can look bad only because every move is bad (zugzwang). */
  lowConfidence: boolean;
  /** Plain description of what the threat does, e.g. "wins 3 pawns of material" or "mates in 2". */
  effect: string;
};

/** Threats in a position: the opponent's best move after a pass (real or not) and the real ones. */
export type PositionThreats = { main: ThreatReport; real: ThreatReport[] };

export type WhyBadCause =
  | {
      kind: 'ignored-threat';
      sizePct: number;
      text: string;
      match: 'same-move' | 'same-square' | 'mate' | 'no-defence';
      threat: ThreatReport;
    }
  | { kind: 'only-move'; sizePct: number; text: string }
  | { kind: 'missed-opportunity'; sizePct: number; text: string }
  | { kind: 'allowed-tactic'; sizePct: number; text: string }
  | { kind: 'positional'; sizePct: number; text: string };

export type WhyBadReport = {
  version: string;
  lossPct: number;
  bestUci: string;
  bestSan: string;
  bestLine: string[];
  playedSan: string;
  playedLine: string[];
  /** The opponent's reply to the played move (second move of the played line). */
  refutationUci?: string;
  refutationSan?: string;
  /** Evaluations (white-relative, like the eval bar). */
  bestScore: EngineScore;
  playedScore: EngineScore;
  /** Main threat before the move (real or not); undefined when the mover was in check. */
  threat?: ThreatReport;
  /** Up to 3 real threats before the move, strongest first (for red arrows). */
  threats: ThreatReport[];
  /** A real threat existed and the played move dealt with it (so it is not the reason). */
  threatHandled: boolean;
  inCheck: boolean;
  causes: WhyBadCause[];
};

export type WhyBadInput = {
  fenBefore: string;
  mover: Colour;
  playedUci: string;
  /** Root MultiPV (≥ 2) lines from the position before the move, best first. */
  lines: ExplainLine[];
  /** The played move's line (starts with the played move). */
  played: ExplainLine;
  /** Opponent's best lines (MultiPV) from the null-move position; undefined if a pass is not possible. */
  threats?: ExplainLine[];
};

const pct = (s: EngineScore, c: Colour) => expectedScore(s, c) * 100;
const colourName = (c: Colour) => (c === 'w' ? 'White' : 'Black');
const pawns = (n: number) => `${n} pawn${n === 1 ? '' : 's'}`;

/** The same position with the other side to move, or undefined when that is not legal (check). */
export function nullMoveFen(fen: string): string | undefined {
  try {
    if (new Chess(fen).inCheck()) return undefined;
    const f = fen.split(' ');
    f[1] = f[1] === 'w' ? 'b' : 'w';
    f[3] = '-';
    const out = f.join(' ');
    new Chess(out); // validates
    return out;
  } catch {
    return undefined;
  }
}

function piecesLeft(fen: string): number {
  return [...fen.split(' ')[0]!].filter((ch) => 'nbrqNBRQ'.includes(ch)).length;
}

/** Material change for `colour` along a line, counted after the opponent's reply (even ply). */
/**
 * Material change for `colour` along a line, counted after the opponent's reply (an even ply,
 * at most `maxPlies`). The count never stops in the middle of an exchange: while the next move
 * of the line is a capture, it is included too.
 */
export function materialSwing(fen: string, uci: string[], colour: Colour, maxPlies = WHY_BAD_POLICY.materialPlies): number {
  const chess = new Chess(fen);
  const captures: boolean[] = [];
  const fens: string[] = [fen];
  for (const u of uci) {
    try {
      const m = chess.move({ from: u.slice(0, 2), to: u.slice(2, 4), promotion: u[4] });
      captures.push(!!m.captured);
      fens.push(chess.fen());
    } catch {
      break;
    }
  }
  const played = fens.length - 1;
  let cut = Math.min(played, maxPlies) & ~1;
  if (cut === 0) cut = Math.min(played, 1);
  while (cut < played && captures[cut]) cut++;
  return materialBalance(fens[cut]!, colour) - materialBalance(fen, colour);
}

/** What a line does for `colour`: "forces mate in 3", "wins 3 pawns of material", or "". */
function lineEffect(fen: string, line: ExplainLine, colour: Colour, minMaterial = WHY_BAD_POLICY.minMaterial): string {
  if (line.score.kind === 'mate' && line.score.winner === colour) return `forces mate in ${line.score.moves}`;
  const swing = materialSwing(fen, line.uci, colour);
  if (swing >= minMaterial) return `wins ${pawns(swing)} of material`;
  return '';
}

/**
 * The threat in a position: the opponent's best move if the side to move could pass.
 * `current` is the evaluation of the position with the side to move playing its best move.
 */
export function describeThreat(fen: string, current: EngineScore, threat: ExplainLine, policy = WHY_BAD_POLICY): ThreatReport | undefined {
  const nf = nullMoveFen(fen);
  if (!nf || !threat.uci[0]) return undefined;
  const side = fen.split(' ')[1] as Colour;
  const sizePct = Math.max(0, pct(current, side) - pct(threat.score, side));
  const line = uciLineToSan(nf, threat.uci, 6);
  // A threat must be concrete: a capture, a check, or a line that mates or wins material.
  // Otherwise a quiet improving move (e.g. castling) would count whenever passing costs a lot.
  const effect = lineEffect(nf, threat, opponent(side), 1);
  const san = line[0] ?? threat.uci[0];
  const concrete = !!effect || san.includes('x') || san.includes('+') || san.includes('#');
  return {
    uci: threat.uci[0],
    san,
    fen: nf,
    line: threat.uci,
    sizePct,
    evalNow: current,
    evalIfIgnored: threat.score,
    real: sizePct >= policy.minThreatPct && concrete,
    lowConfidence: piecesLeft(fen) <= policy.zugzwangPieces,
    effect,
  };
}

/** All described threats from MultiPV lines of the null-move search; `real` ones first, at most `max`. */
export function describeThreats(fen: string, current: EngineScore, lines: ExplainLine[], max = 3, policy = WHY_BAD_POLICY): ThreatReport[] {
  return lines
    .map((l) => describeThreat(fen, current, l, policy))
    .filter((t): t is ThreatReport => !!t?.real)
    .slice(0, max);
}

export function explainBadMove(input: WhyBadInput, policy = WHY_BAD_POLICY): WhyBadReport {
  const { fenBefore, mover, playedUci } = input;
  const opp = opponent(mover);
  const best = input.lines[0]!;
  const bestUci = best.uci[0] ?? '';
  const second = input.lines.find((l) => l.uci[0] !== bestUci);
  const ePlayed = pct(input.played.score, mover);
  const eBest = Math.max(pct(best.score, mover), ePlayed);
  const lossPct = eBest - ePlayed;
  const bestSan = uciLineToSan(fenBefore, [bestUci])[0] ?? bestUci;
  const playedSan = uciLineToSan(fenBefore, [playedUci])[0] ?? playedUci;
  const refutationUci = input.played.uci[1];
  const refutationSan = refutationUci ? uciLineToSan(fenBefore, input.played.uci.slice(0, 2))[1] : undefined;
  const inCheck = new Chess(fenBefore).inCheck();
  const threatLines = !inCheck ? (input.threats ?? []) : [];
  const threat = threatLines[0] ? describeThreat(fenBefore, best.score, threatLines[0], policy) : undefined;
  const threats = describeThreats(fenBefore, best.score, threatLines, 3, policy);

  const causes: WhyBadCause[] = [];
  const onlyMoveGap = second ? eBest - pct(second.score, mover) : null;
  const onlyMove = onlyMoveGap !== null && onlyMoveGap >= policy.onlyMoveGapPct && bestUci !== playedUci;

  // --- 1. Ignored threat ---------------------------------------------------------------------
  let ignored = false;
  for (const threat of threats) {
    if (ignored || !refutationUci) break;
    const ePass = pct(threat.evalIfIgnored, mover);
    const playedMated = input.played.score.kind === 'mate' && input.played.score.winner === opp;
    const threatMates = threat.evalIfIgnored.kind === 'mate' && threat.evalIfIgnored.winner === opp;
    const match: Extract<WhyBadCause, { kind: 'ignored-threat' }>['match'] | null =
      refutationUci === threat.uci
        ? 'same-move'
        : refutationUci.slice(2, 4) === threat.uci.slice(2, 4)
          ? 'same-square'
          : playedMated && threatMates
            ? 'mate'
            : Math.abs(ePlayed - ePass) <= policy.noDefenceTolerancePct
              ? 'no-defence' // about as bad as passing; much worse means the move made a new problem
              : null;
    if (match) {
      ignored = true;
      const what = threat.effect ? `, which ${threat.effect}` : '';
      const follow =
        match === 'same-move' || match === 'same-square'
          ? ` ${playedSan} did not stop it: ${refutationSan ?? refutationUci} follows.`
          : match === 'mate'
            ? ` ${playedSan} did not stop the mate.`
            : ` ${playedSan} did nothing against it.`;
      const fix = onlyMove ? ` Only ${bestSan} dealt with it.` : ` ${bestSan} dealt with it.`;
      causes.push({
        kind: 'ignored-threat',
        sizePct: Math.min(lossPct, threat.sizePct),
        match,
        threat,
        text: `Before ${playedSan}, ${colourName(opp)} threatened ${threat.san}${what}.${follow}${fix}${
          threat.lowConfidence ? ' (Few pieces are left, so the threat may be overstated: passing is not allowed in chess.)' : ''
        }`,
      });
    }
  }

  // --- 2. Missed great move (only move) ------------------------------------------------------
  if (onlyMove && !ignored) {
    causes.push({
      kind: 'only-move',
      sizePct: lossPct,
      text: `${bestSan} was the only good move (eval ${formatScore(best.score)}). The next best, ${
        uciLineToSan(fenBefore, [second!.uci[0] ?? ''])[0] ?? second!.uci[0]
      }, only reaches ${formatScore(second!.score)}.`,
    });
  }

  // --- 3. Missed opportunity -------------------------------------------------------------------
  // Compared with the played line, so a capture both moves make does not count.
  const bestSwing = materialSwing(fenBefore, best.uci, mover);
  const playedSwing = materialSwing(fenBefore, input.played.uci, mover);
  const bestMates = best.score.kind === 'mate' && best.score.winner === mover;
  const playedMates = input.played.score.kind === 'mate' && input.played.score.winner === mover;
  const extra = bestSwing - playedSwing;
  // The best line must gain material itself; losing material with the played move is cause 4.
  const gains = bestSwing >= policy.minMaterial && extra >= policy.minMaterial;
  if (!ignored && ((bestMates && !playedMates) || gains)) {
    const what = bestMates && best.score.kind === 'mate' ? `forces mate in ${best.score.moves}` : `wins ${pawns(bestSwing)} of material`;
    causes.push({
      kind: 'missed-opportunity',
      sizePct: lossPct,
      text: `${bestSan} ${what}. ${playedSan} misses it.`,
    });
  }

  // --- 4. Allowed a new tactic ----------------------------------------------------------------
  if (!ignored && refutationUci) {
    // Material lost both absolutely and compared with the best line (a fair trade is not a loss).
    const lost = Math.min(-playedSwing, bestSwing - playedSwing);
    const playedMated = input.played.score.kind === 'mate' && input.played.score.winner === opp;
    if (playedMated || lost >= policy.minMaterial) {
      const reply = refutationSan ?? refutationUci;
      // The material is won over the engine's whole line, not necessarily by the reply alone.
      const effect =
        playedMated && input.played.score.kind === 'mate'
          ? `, which mates in ${input.played.score.moves}`
          : `; in the engine's line ${colourName(opp)} wins ${pawns(lost)} of material`;
      const before = threat && !threat.real ? ' There was no such threat before your move.' : '';
      causes.push({
        kind: 'allowed-tactic',
        sizePct: lossPct,
        text: `${playedSan} allows ${reply}${effect}.${before}`,
      });
    }
  }

  // --- 5. Nothing concrete -------------------------------------------------------------------
  if (causes.length === 0) {
    causes.push({
      kind: 'positional',
      sizePct: lossPct,
      text:
        `${playedSan} does not lose material in the next few moves, but the engine prefers ${bestSan} ` +
        `(eval ${formatScore(best.score)} instead of ${formatScore(input.played.score)}): ` +
        `the difference is in the position (king safety, piece activity, structure).` +
        (refutationSan ? ` After ${playedSan} it expects ${refutationSan}.` : ''),
    });
  }

  return {
    version: WHY_BAD_VERSION,
    lossPct,
    bestUci,
    bestSan,
    bestLine: best.uci,
    playedSan,
    playedLine: input.played.uci,
    refutationUci,
    refutationSan,
    bestScore: best.score,
    playedScore: input.played.score,
    threat,
    threats,
    threatHandled: !!threat?.real && !ignored,
    inCheck,
    causes,
  };
}
