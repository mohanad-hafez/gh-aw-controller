import { test } from "node:test";
import assert from "node:assert/strict";
import { parseBenchmarks, requiredBenchmarks, appendHistory } from "./performance_metrics.mjs";
import { buildReport } from "./performance_report.mjs";
const raw = requiredBenchmarks.map(n => `Benchmark${n}/sample-4 100 2.5e+2 ns/op 20 B/op 1 allocs/op`).join("\n") + "\nok github.com/github/gh-aw/pkg/workflow 1s\nok github.com/github/gh-aw/pkg/cli 1s\n";
test("decimal/exponent and subcases are retained; complete packages required", () => {
  assert.equal(parseBenchmarks(raw)["CompileSimpleWorkflow/sample"].ns_per_op, 250);
  assert.throws(() => parseBenchmarks(raw.replace("ok github.com/github/gh-aw/pkg/cli", "FAIL")));
  assert.throws(() => parseBenchmarks(raw.replace("BenchmarkValidation", "OtherValidation")));
});
test("history drops malformed entries, caps fourteen after append and blocks same-run replay", () => {
  const current = { run_id: "20", benchmarks: { a: { ns_per_op: 100 } } };
  const old = Array.from({ length: 16 }, (_, i) => JSON.stringify({ ...current, run_id: String(i) })).join("\n");
  const updated = appendHistory(old + "\nbad\n", current);
  assert.equal(updated.history.length, 14);
  assert.equal(updated.dropped_lines.length, 1);
  assert.throws(() => appendHistory(updated.history.map(JSON.stringify).join("\n"), current));
});
test("noise suppresses issues and baseline is not called stable", () => {
  const analysis = { date: "2026-11-07", summary: { total: 1, stable: 0, regressions: 0, warnings: 0, improvements: 0 }, benchmarks: { a: { status: "baseline", current_ns: 100, change_percent: 0 } } },
    current = { benchmarks: { a: { bytes_per_op: 0, allocs_per_op: 0 } } };
  assert.match(buildReport(analysis, current, "https://example.com", "1").body, /Initial baseline/);
  analysis.summary = { ...analysis.summary, regressions: 1, likely_environment_noise: true };
  analysis.benchmarks.a.status = "regression";
  assert.equal(buildReport(analysis, current, "https://example.com", "1").issues.length, 0);
});
