import { CATEGORY_LABELS, type MoveCategory } from '../../core/classification/classify';
import type { GameRecord } from '../../core/chess/types';
import type { EngineScore } from '../../core/engine/types';
import type { GameAnalysis } from './types';

const NAG: Partial<Record<MoveCategory, string>> = {
  brilliant: '$3',
  questionable: '$6',
  mistake: '$2',
  blunder: '$4',
};

/** PGN %eval value: pawns with 2 decimals, or #N / #-N for mates. */
function pgnEval(score: EngineScore): string {
  if (score.kind === 'mate') return score.winner === 'w' ? `#${score.moves}` : `#-${score.moves}`;
  return (score.value / 100).toFixed(2);
}

function escapeTag(v: string): string {
  return v.replace(/\\/g, '\\\\').replace(/"/g, '\\"');
}

function escapeComment(v: string): string {
  return v.replace(/[{}]/g, '');
}

/** Builds an annotated PGN (main line) with our labels as NAGs and evals as [%eval] comments. */
export function annotatedPgn(game: GameRecord, analysis: GameAnalysis): string {
  const headers: Record<string, string> = { ...game.headers };
  headers.Annotator = `Chess Game Analyser (${analysis.engineId}; ${analysis.policyVersion}; ${analysis.accuracyVersion})`;
  if (analysis.summary?.white.accuracy.value !== undefined) headers.WhiteAnalyserAccuracy = String(analysis.summary.white.accuracy.value);
  if (analysis.summary?.black.accuracy.value !== undefined) headers.BlackAnalyserAccuracy = String(analysis.summary.black.accuracy.value);
  const order = ['Event', 'Site', 'Date', 'Round', 'White', 'Black', 'Result'];
  const keys = [...order.filter((k) => k in headers), ...Object.keys(headers).filter((k) => !order.includes(k))];
  const tagLines = keys.map((k) => `[${k} "${escapeTag(headers[k]!)}"]`);

  const tokens: string[] = [];
  game.moves.forEach((mv, i) => {
    if (mv.colour === 'w') tokens.push(`${mv.fullMoveNumber}.`);
    else if (i === 0) tokens.push(`${mv.fullMoveNumber}...`);
    tokens.push(mv.san);
    const a = analysis.moves[i];
    if (a?.category && NAG[a.category]) tokens.push(NAG[a.category]!);
    const parts: string[] = [];
    const after = analysis.positionEvals[i + 1];
    if (after) parts.push(`[%eval ${pgnEval(after)}]`);
    if (a?.category) parts.push(CATEGORY_LABELS[a.category].label + '.');
    if (a?.bestMoveUci && a.bestMoveUci !== mv.uci && a.category && a.category !== 'best') parts.push(`Best was ${a.bestMoveUci}.`);
    if (a?.brilliance && a.brilliance.verdict === 'candidate') parts.push('Brilliant candidate (unconfirmed).');
    if (mv.clockSeconds !== undefined) {
      const s = mv.clockSeconds;
      const h = Math.floor(s / 3600);
      const m = Math.floor((s % 3600) / 60);
      const sec = Math.floor(s % 60);
      parts.push(`[%clk ${h}:${String(m).padStart(2, '0')}:${String(sec).padStart(2, '0')}]`);
    }
    if (parts.length) tokens.push(`{ ${escapeComment(parts.join(' '))} }`);
  });
  tokens.push(game.headers.Result ?? '*');

  // Wrap movetext at ~80 columns.
  const lines: string[] = [];
  let cur = '';
  for (const t of tokens) {
    if (cur.length + t.length + 1 > 80 && cur) {
      lines.push(cur);
      cur = t;
    } else cur = cur ? `${cur} ${t}` : t;
  }
  if (cur) lines.push(cur);
  return `${tagLines.join('\n')}\n\n${lines.join('\n')}\n`;
}

export function analysisJson(game: GameRecord, analysis: GameAnalysis): string {
  return JSON.stringify(
    {
      format: 'chess-analyser/v1',
      exportedAt: new Date().toISOString(),
      disclaimer: 'Estimates from an independent analyser; not Chess.com or Lichess classifications.',
      game,
      analysis,
    },
    null,
    2,
  );
}

export function downloadText(filename: string, text: string, mime: string): void {
  const blob = new Blob([text], { type: mime });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export function safeFilename(s: string): string {
  return s.replace(/[^A-Za-z0-9._-]+/g, '_').slice(0, 80) || 'game';
}
