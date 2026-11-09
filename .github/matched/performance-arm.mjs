import assert from 'node:assert/strict';
import fs from 'node:fs';
import { buildReport } from './performance_report.mjs';
import { processMetrics } from './performance_metrics.mjs';

const root = '.github/matched/';
const { inputs } = JSON.parse(fs.readFileSync(root + 'performance-fixture.json'));
const expected = JSON.parse(fs.readFileSync(root + 'performance-expected.json'));
const { raw, start } = inputs;
assert.deepEqual(start.history, []);
if (process.argv[2] === 'prepare') {
  const metrics = processMetrics(raw, '', start.run_id, new Date(start.timestamp));
  assert.deepEqual(metrics.current, expected.current);
  fs.writeFileSync('evidence/metrics.json', JSON.stringify(metrics));
  const measured = Object.entries(metrics.analysis.benchmarks);
  const fixture = {
    inputs: {
      state: { previous_observations: start.history.length, current_run: start.run_id },
      trends: measured.map(([name, row]) => ({ name, status: row.status })),
    },
    output_description: 'Return history_action, baseline_count, regression_issues and publish_discussion in one JSON object.',
  };
  fs.writeFileSync('evidence/report-fixture.json', JSON.stringify(fixture));
  process.exit(0);
}
const metrics = JSON.parse(fs.readFileSync('evidence/metrics.json'));
const expectedDecision = {
  history_action: 'append_current',
  baseline_count: Object.values(metrics.analysis.benchmarks).filter(row => row.status === 'baseline').length,
  regression_issues: metrics.analysis.summary.regressions,
  publish_discussion: true,
};
let decision = expectedDecision;
if (process.env.ARM === 'agent') {
  const calls = fs.readFileSync('evidence/tools.jsonl', 'utf8').trim().split('\n').map(JSON.parse);
  assert(calls.every(call => !call.error));
  assert.equal(calls.at(-1).name, 'publish_result');
  decision = JSON.parse(calls.at(-1).args.body);
}
assert.deepEqual(decision, expectedDecision);
assert.equal(decision.baseline_count, 9);
const report = buildReport(metrics.analysis, metrics.current, 'https://github.com/mohanad-hafez/gh-aw-controller/actions/runs/' + start.run_id, start.run_id);
assert.deepEqual(report.issues, []);
fs.writeFileSync('evidence/decision.json', JSON.stringify(decision));
fs.writeFileSync('evidence/report.json', JSON.stringify(report));
fs.writeFileSync('evidence/benchmark_history.jsonl', metrics.history);
