import { test } from 'node:test';
import assert from 'node:assert/strict';
import { aggregateScore, DEFAULT_WEIGHTS, qualityFactor, scoreTask, scoringWeights } from '../lib/score.mjs';

test('the quality factor applies each penalty and stops at the floor', () => {
  assert.equal(qualityFactor({ firstPass: true }), 1);
  assert.equal(qualityFactor({ firstPass: false }), 0.9);
  assert.equal(qualityFactor({ firstPass: true, escalations: 2 }), 0.8);
  assert.equal(qualityFactor({ firstPass: true, escalations: 9 }), 0.7); // capped at 0.3
  assert.equal(qualityFactor({ firstPass: true, escapedDefects: 2 }), 0.7); // once, however many
  assert.equal(qualityFactor({ firstPass: false, escalations: 5, escapedDefects: 1 }), 0.5); // floor
  assert.equal(qualityFactor({ firstPass: null }), 1); // unknown is not a penalty; the row says Partial instead
});

test('a task score: raw, quality and adjusted; unscoreable tasks stay empty', () => {
  assert.deepEqual(scoreTask({ outcome: 'accepted', estimate_h: 6, human_h: 1.5, first_pass: false, escalations: 1, escaped_defects: 0 }), {
    efficiency_raw: 4,
    quality: 0.8,
    efficiency: 3.2,
  });
  assert.deepEqual(scoreTask({ outcome: 'rejected', estimate_h: 6, human_h: 2, first_pass: true }), { efficiency_raw: 0, quality: 1, efficiency: 0 });
  for (const row of [
    { outcome: 'accepted', estimate_h: null, human_h: 1 },
    { outcome: 'accepted', estimate_h: 6, human_h: 0 },
    { outcome: 'deferred', estimate_h: 6, human_h: 1 },
    { outcome: null, estimate_h: 6, human_h: 1 },
  ]) {
    assert.deepEqual(scoreTask(row), { efficiency_raw: null, quality: null, efficiency: null }, JSON.stringify(row));
  }
});

test('the headline counts only Complete rows and charges rejected work', () => {
  const row = (outcome, estimate_h, human_h, quality, data_quality = 'Complete') => ({ outcome, estimate_h, human_h, quality, efficiency: outcome === 'accepted' ? 1 : 0, data_quality });
  const agg = aggregateScore([
    row('accepted', 6, 1, 1),
    row('accepted', 4, 1, 0.5),
    row('rejected', 3, 2, 1),
    row('accepted', 100, 1, 1, 'Partial'),
    { ...row('accepted', 5, 1, 1), efficiency: null },
  ]);
  assert.deepEqual(agg, { tasks: 3, accepted: 2, estimate_h: 8, human_h: 4, efficiency: 2 });
  assert.equal(aggregateScore([]).efficiency, null);
});

test('weights can be tuned in config, within bounds', () => {
  assert.deepEqual(scoringWeights({}), DEFAULT_WEIGHTS);
  assert.equal(scoringWeights({ scoring: { escaped_defect: 0.5 } }).escaped_defect, 0.5);
  assert.throws(() => scoringWeights({ scoring: { escaped_defect: 2 } }), /from 0 to 1/);
  assert.throws(() => scoringWeights({ scoring: { bonus: 0.1 } }), /unknown scoring weight/);
  assert.throws(() => scoringWeights({ scoring: [] }), /must be an object/);
});
