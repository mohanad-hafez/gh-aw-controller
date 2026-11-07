import test from "node:test";
import assert from "node:assert/strict";
import { repositoryRunAdapter } from "./souschef_prefilter_adapter.mjs";
test("paginated repository reads retain active finisher runs from every branch", async () => {
  let actual;
  const api = repositoryRunAdapter(async args => {
    actual = args;
    return [
      { workflow_runs: [{ id: 1, path: ".github/workflows/maintenance.yml" }] },
      {
        workflow_runs: [
          { id: 2, path: ".github/workflows/pr-finisher.lock.yml", head_branch: "main" },
          { id: 3, path: ".github/workflows/pr-finisher.lock.yml@other", head_branch: "other" },
        ],
      },
    ];
  });
  const result = await api(["api", "repos/owner/repo/actions/workflows/pr-finisher.lock.yml/runs?status=queued&per_page=100", "--paginate", "--slurp"]);
  assert.equal(actual[1], "repos/owner/repo/actions/runs?status=queued&per_page=100");
  assert.deepEqual(
    result.flatMap(p => p.workflow_runs.map(r => r.id)),
    [2, 3]
  );
});
test("unknown workflow paths cannot silently become no active finishers", async () => {
  const api = repositoryRunAdapter(async () => [{ workflow_runs: [{ id: 1 }] }]);
  await assert.rejects(api(["api", "repos/owner/repo/actions/workflows/pr-finisher.lock.yml/runs?status=queued"]), /Missing active workflow path/);
});
test("non-finisher endpoints pass through unchanged and errors propagate", async () => {
  const original = ["pr", "list", "--repo", "owner/repo"];
  const api = repositoryRunAdapter(async args => {
    assert.equal(args, original);
    throw Error("read failed");
  });
  await assert.rejects(api(original), /read failed/);
});
