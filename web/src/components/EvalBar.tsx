import type { EngineScore } from '../core/engine/types';
import { expectedScore, formatScore } from '../core/scoring/score';

/** Vertical bar showing White's expected score; White's side sits at the bottom of the board orientation. */
export function EvalBar({ score, orientation, height }: { score?: EngineScore; orientation: 'white' | 'black'; height: number }) {
  const white = score ? expectedScore(score, 'w') : 0.5;
  const label = formatScore(score);
  const whiteAtBottom = orientation === 'white';
  const whiteLeads = white >= 0.5;
  return (
    <div className="eval-bar" style={{ height }} role="img" aria-label={`Evaluation ${label} from White's perspective`}>
      <div
        className="white"
        style={whiteAtBottom ? { height: `${white * 100}%` } : { height: `${white * 100}%`, top: 0, bottom: 'auto' }}
      />
      <div
        className="label"
        style={{
          [whiteLeads === whiteAtBottom ? 'bottom' : 'top']: 2,
          color: whiteLeads ? '#222' : '#eee',
        }}
      >
        {label}
      </div>
    </div>
  );
}
