import { test } from "node:test";
import assert from "node:assert/strict";
import { classifyArchitecture, buildArchitectureReport, findExistingArchitecture } from "./architecture_report.mjs";
const base = {
  noop: false,
  thresholds: { file_lines_blocker: 1000, file_lines_warning: 500, function_lines: 80, max_exports: 10 },
  import_cycles: "",
  files: [{ file: "sample.go", lines: 500, export_count: 10, func_data: "func Example() {}\t80" }],
};
test("strict thresholds and source independent file severities; Go spans only", () => {
  assert.equal(buildArchitectureReport(base, "2026-11-07").noop, true);
  const m = structuredClone(base);
  Object.assign(m.files[0], { lines: 1001, export_count: 11, func_data: "func Example() {}\t81" });
  const f = classifyArchitecture(m);
  assert.equal(f.blockers.length, 1);
  assert.equal(f.warnings.length, 2);
  assert.equal(f.infos.length, 1);
  m.files[0].file = "sample.mjs";
  assert.equal(classifyArchitecture(m).warnings.length, 1);
});
test("import cycles and source no-op; incomplete collector output rejected", () => {
  const m = structuredClone(base);
  m.import_cycles = "import cycle not allowed";
  assert.equal(classifyArchitecture(m).blockers[0].kind, "cycle");
  assert.equal(buildArchitectureReport({ ...base, noop: true, files: [] }, "2026-11-07").noop, true);
  assert.throws(() => buildArchitectureReport({ ...base, files: [] }, "2026-11-07"));
  assert.throws(() => classifyArchitecture({ ...base, files: [{ ...base.files[0], export_count: "0\n0" }] }));
});
test("preactivation gate queries open issues, ignores PRs and matches title marker case-insensitively", async () => {
  const github = {
    rest: { issues: { listForRepo: "issues.list" } },
    paginate: async (method, parameters) => {
      assert.equal(method, "issues.list");
      assert.equal(parameters.state, "open");
      return [
        { number: 1, title: "[architecture-guardian] PR", pull_request: {} },
        { number: 2, title: "Report: [ARCHITECTURE-GUARDIAN] pending" },
      ];
    },
  };
  assert.equal((await findExistingArchitecture({ github, context: { repo: { owner: "mohanad-hafez", repo: "gh-aw-controller" } } })).number, 2);
});
