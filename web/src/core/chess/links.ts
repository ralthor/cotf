/**
 * Link to the Lichess analysis board for a position. Spaces in the FEN become underscores,
 * which Lichess accepts in the URL path. Only the FEN and orientation are sent.
 */
export function lichessAnalysisUrl(fen: string, orientation: 'white' | 'black' = 'white'): string {
  const path = fen.trim().split(/\s+/).map(encodeURIComponent).join('_').replace(/%2F/g, '/');
  return `https://lichess.org/analysis/standard/${path}?color=${orientation}`;
}
