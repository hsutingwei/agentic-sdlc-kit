// Efficiency score (ADR-0006).
//
//   raw       = estimate without AI (hours) / human hours actually spent
//   quality   = 1 - penalties, never below `floor`
//               not first-pass  -not_first_pass
//               each escalation -per_escalation, at most -escalation_cap
//               escaped defect  -escaped_defect (a later task links back with --fixes)
//   adjusted  = raw * quality
//
// The headline number divides the quality-weighted estimate of accepted tasks by
// the human hours of ALL scored tasks, so rejected and abandoned work costs time
// and earns nothing. Only Complete rows are scored.

import { usageError } from '../../core/errors.mjs';

export const DEFAULT_WEIGHTS = Object.freeze({ not_first_pass: 0.1, per_escalation: 0.1, escalation_cap: 0.3, escaped_defect: 0.3, floor: 0.5 });

/** Weights from config.json `scoring`, each a number from 0 to 1; unknown keys are refused. */
export function scoringWeights(config = {}) {
  const custom = config.scoring ?? {};
  if (typeof custom !== 'object' || Array.isArray(custom)) throw usageError('config.json: "scoring" must be an object');
  for (const [k, v] of Object.entries(custom)) {
    if (!(k in DEFAULT_WEIGHTS)) throw usageError(`config.json: unknown scoring weight "${k}" (known: ${Object.keys(DEFAULT_WEIGHTS).join(', ')})`);
    if (typeof v !== 'number' || v < 0 || v > 1) throw usageError(`config.json: scoring.${k} must be a number from 0 to 1`);
  }
  return { ...DEFAULT_WEIGHTS, ...custom };
}

const round2 = (n) => Math.round(n * 100) / 100;

export function qualityFactor({ firstPass, escalations = 0, escapedDefects = 0 }, w = DEFAULT_WEIGHTS) {
  let q = 1;
  if (firstPass === false) q -= w.not_first_pass;
  q -= Math.min(escalations * w.per_escalation, w.escalation_cap);
  if (escapedDefects > 0) q -= w.escaped_defect;
  return round2(Math.max(q, w.floor));
}

/**
 * Score of one task, or nulls when it cannot be scored.
 * @returns {{ efficiency_raw: number|null, quality: number|null, efficiency: number|null }}
 */
export function scoreTask({ outcome, estimate_h, human_h, first_pass, escalations, escaped_defects }, w = DEFAULT_WEIGHTS) {
  const none = { efficiency_raw: null, quality: null, efficiency: null };
  if (!(human_h > 0) || !(estimate_h > 0) || !['accepted', 'rejected', 'abandoned'].includes(outcome)) return none;
  const quality = qualityFactor({ firstPass: first_pass, escalations, escapedDefects: escaped_defects }, w);
  if (outcome !== 'accepted') return { efficiency_raw: 0, quality, efficiency: 0 };
  const raw = estimate_h / human_h;
  return { efficiency_raw: round2(raw), quality, efficiency: round2(raw * quality) };
}

/** Headline over Complete rows: quality-weighted estimate of accepted tasks / human hours of all scored tasks. */
export function aggregateScore(rows) {
  const scored = rows.filter((r) => r.data_quality === 'Complete' && r.efficiency !== null);
  const human = scored.reduce((n, r) => n + r.human_h, 0);
  const value = scored.filter((r) => r.outcome === 'accepted').reduce((n, r) => n + r.estimate_h * r.quality, 0);
  return {
    tasks: scored.length,
    accepted: scored.filter((r) => r.outcome === 'accepted').length,
    estimate_h: round2(value),
    human_h: round2(human),
    efficiency: human > 0 ? round2(value / human) : null,
  };
}
