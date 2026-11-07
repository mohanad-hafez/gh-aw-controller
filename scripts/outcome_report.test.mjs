import test from "node:test";
import assert from "node:assert/strict";
import { buildOutcomeReport, parseEvaluationLines } from "./outcome_report.mjs";
const summary = { runs_checked: 1, total_outcomes: 4, accepted: 2, rejected: 1, ignored: 0, pending: 1, acceptance_rate: 0.6667, waste_rate: 0.25, date: "2026-11-07" };
test("precomputed JSONL framing accepts multiple records and both line endings", () => {
  assert.deepEqual(parseEvaluationLines('{"n":1}\r\n{"n":2}\n\n'), [{ n: 1 }, { n: 2 }]);
});
test("zero outcomes suppress a report even with minimal source summary", () => {
  assert.equal(buildOutcomeReport({ runs_checked: 0, total_outcomes: 0 }, []).action, "noop");
});
test("reports source rates as percentages and preserves pending outcomes", () => {
  const rows = ["accepted", "accepted", "rejected", "pending"].map(result => ({ workflow: "Example", result }));
  const report = buildOutcomeReport(summary, rows);
  assert.ok(report.body.includes("| Acceptance rate | 66.67% |"));
  assert.ok(report.body.includes("| Waste rate | 25.00% |"));
  assert.ok(report.body.includes("| Example | 2 | 1 | 0 | 1 | 66.67% |"));
  assert.ok(!/^##? /m.test(report.body));
});
test("mismatched precomputed files fail instead of inventing missing counts", () => {
  assert.throws(() => buildOutcomeReport(summary, []), /do not match/);
});
test("all-pending workflows have no invented resolved acceptance rate", () => {
  const s = { ...summary, total_outcomes: 1, accepted: 0, rejected: 0, pending: 1, acceptance_rate: 0, waste_rate: 0 };
  const r = buildOutcomeReport(s, [{ workflow: "Pending", result: "pending" }]);
  assert.ok(r.body.includes("| Pending | 0 | 0 | 0 | 1 | n/a |"));
});
