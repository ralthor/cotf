import type { BrillianceEvidence } from '../../core/brilliancy/detector';
import type { GreatEvidence } from '../../core/brilliancy/great';
import type { MoveCategory } from '../../core/classification/classify';
import type { Colour } from '../../core/chess/types';
import type { EngineLine, EngineScore } from '../../core/engine/types';
import type { AccuracyResult } from '../../core/scoring/accuracy';
import type { MoveLoss } from '../../core/scoring/score';

export type PresetId = 'fast' | 'standard' | 'deep';

export type AnalysisPreset = {
  id: PresetId;
  label: string;
  firstPassDepth: number;
  deepPassDepth: number;
  /** Shallow horizon in plies for the brilliancy detector (what a 1–3 ply calculator sees). */
  brilliancyShallowDepth: number;
  brilliancyDeepDepth: number;
  recheckDepth: number;
  /** Per-search wall-clock cap so a single complex position cannot stall the review. */
  movetimeCapMs: number;
  maxDeepPositions: number;
  maxBrilliancyCandidates: number;
  /** Extra moves checked only for "great" (great moves are more common than brilliant ones). */
  maxGreatCandidates: number;
};

export const PRESETS: Record<PresetId, AnalysisPreset> = {
  fast: {
    id: 'fast',
    label: 'Fast (depth 12 → 16)',
    firstPassDepth: 12,
    deepPassDepth: 16,
    brilliancyShallowDepth: 3,
    brilliancyDeepDepth: 16,
    recheckDepth: 18,
    movetimeCapMs: 4_000,
    maxDeepPositions: 20,
    maxBrilliancyCandidates: 3,
    maxGreatCandidates: 6,
  },
  standard: {
    id: 'standard',
    label: 'Standard (depth 14 → 18)',
    firstPassDepth: 14,
    deepPassDepth: 18,
    brilliancyShallowDepth: 3,
    brilliancyDeepDepth: 18,
    recheckDepth: 20,
    movetimeCapMs: 8_000,
    maxDeepPositions: 40,
    maxBrilliancyCandidates: 6,
    maxGreatCandidates: 12,
  },
  deep: {
    id: 'deep',
    label: 'Deep (depth 16 → 22)',
    firstPassDepth: 16,
    deepPassDepth: 22,
    brilliancyShallowDepth: 3,
    brilliancyDeepDepth: 22,
    recheckDepth: 24,
    movetimeCapMs: 20_000,
    maxDeepPositions: 60,
    maxBrilliancyCandidates: 8,
    maxGreatCandidates: 20,
  },
};

export type MoveAnalysis = {
  ply: number;
  colour: Colour;
  san: string;
  uci: string;
  depth: number;
  bestMoveUci?: string;
  bestScore?: EngineScore;
  playedScore?: EngineScore;
  /** Engine continuation after the played move (starts with the played move). */
  playedPv?: string[];
  secondScore?: EngineScore;
  /** Top lines from the pre-move position (white-relative scores). */
  lines: EngineLine[];
  /** How the played move's score was obtained (documented in docs/ALGORITHM_AND_TEST_CASES.md). */
  playedScoreMethod?: 'root-multipv' | 'searchmoves';
  loss?: MoveLoss;
  category?: MoveCategory;
  reasons: string[];
  forced: boolean;
  provisional: boolean;
  passes: ('first' | 'deep' | 'brilliancy' | 'cloud')[];
  brilliance?: BrillianceEvidence;
  great?: GreatEvidence;
};

export type ColourSummary = {
  accuracy: AccuracyResult;
  averageCpLoss?: number;
  counts: Record<MoveCategory, number>;
  providerAccuracy?: number;
};

export type AnalysisPhase = 'idle' | 'loading-engine' | 'first-pass' | 'deep-pass' | 'brilliancy' | 'done' | 'cancelled' | 'error';

export type GameAnalysis = {
  gameId: string;
  presetId: PresetId | 'cloud';
  engineId: string;
  policyVersion: string;
  accuracyVersion: string;
  brilliancyVersion: string;
  /** Missing on analyses made before great moves existed. */
  greatVersion?: string;
  /** moves[i] analyses ply i+1. */
  moves: (MoveAnalysis | undefined)[];
  /** Best-line evaluation for each of the N+1 positions (white-relative). */
  positionEvals: (EngineScore | undefined)[];
  phase: AnalysisPhase;
  progress: { done: number; total: number; label: string };
  summary?: { white: ColourSummary; black: ColourSummary };
  error?: string;
  startedAt: string;
  updatedAt: string;
};
