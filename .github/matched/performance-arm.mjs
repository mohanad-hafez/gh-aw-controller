import assert from 'node:assert/strict';
import fs from 'node:fs';
import { buildReport } from './performance_report.mjs';
import { processMetrics } from './performance_metrics.mjs';

const root = '.github/matched/';
const { inputs } = JSON.parse(fs.readFileSync(root + 'performance-fixture.json'));
const expected = JSON.parse(fs.readFileSync(root + 'performance-expected.json'));
const { start } = inputs;
const raw = inputs.raw ?? [inputs.raw_1, inputs.raw_2, inputs.raw_3].join('');
assert.deepEqual(start.history, []);
let decision;
let analysis;
if (process.env.ARM === 'agent') {
  const calls = fs.readFileSync('evidence/tools.jsonl', 'utf8').trim().split('\n').map(JSON.parse);
  assert(calls.every(call => !call.error));
  assert.equal(calls.at(-1).name, 'publish_result');
  decision = JSON.parse(calls.at(-1).args.body);
  analysis = {
    date: decision.current.date,
    summary: { total: Object.keys(decision.statuses).length, stable: 0, warnings: 0, improvements: 0, regressions: decision.regression_issues },
    benchmarks: Object.fromEntries(Object.entries(decision.statuses).map(([name, status]) =>
      [name, { status, current_ns: decision.current.benchmarks[name].ns_per_op, avg_historical_ns: null, change_percent: 0 }])),
  };
} else {
  const metrics = processMetrics(raw, '', start.run_id, new Date(start.timestamp));
  analysis = metrics.analysis;
  decision = {
    current: metrics.current,
    statuses: Object.fromEntries(Object.entries(analysis.benchmarks).map(([name, row]) => [name, row.status])),
    regression_issues: analysis.summary.regressions,
  };
  assert.equal(metrics.history, JSON.stringify(metrics.current) + '\n');
}
assert.deepEqual(decision, expected);
const report = buildReport(analysis, decision.current, 'https://github.com/mohanad-hafez/gh-aw-controller/actions/runs/' + start.run_id, start.run_id);
assert.deepEqual(report.issues, []);
// Canonical field order keeps the persisted JSONL equal between implementations.
const current = {
  timestamp: decision.current.timestamp, date: decision.current.date, run_id: decision.current.run_id,
  benchmarks: Object.fromEntries(Object.keys(expected.current.benchmarks).map(name => {
    const row = decision.current.benchmarks[name];
    return [name, { iterations: row.iterations, ns_per_op: row.ns_per_op, bytes_per_op: row.bytes_per_op, allocs_per_op: row.allocs_per_op }];
  })),
};
fs.writeFileSync('evidence/decision.json', JSON.stringify(decision));
fs.writeFileSync('evidence/report.json', JSON.stringify(report));
fs.writeFileSync('evidence/benchmark_history.jsonl', JSON.stringify(current) + '\n');

