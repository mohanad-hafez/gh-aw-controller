import test from "node:test";
import assert from "node:assert/strict";
import { runController, approvalIsAllowed } from "./souschef_controller.mjs";
const context = { repository: "mohanad-hafez/gh-aw-controller", now: "2026-11-07T16:00:00Z" };
const queue = prs => ({ prs, rate_limit: { low: false } });
const pr = { number: 1, headRefName: "branch", headRefOid: "abc", approve_runs: [], dismiss_reviews: [], nudge_needed: false };
function harness(queues, { read = async () => [], formatNudge = () => null } = {}) {
  const calls = [];
  return {
    calls,
    fetchQueue: async () => {
      assert.ok(queues.length, "Unexpected refresh");
      return queues.shift();
    },
    read,
    formatNudge,
    write: async (method, path, body) => {
      calls.push({ method, path, body });
      return { number: 10 };
    },
  };
}
test("empty live queue produces no write", async () => {
  const h = harness([queue([])]);
  const r = await runController(context, h);
  assert.equal(r.status, "verified_noop");
  assert.equal(h.calls.length, 0);
});
test("low budgets suppress even slash acknowledgement", async () => {
  const h = harness([{ prs: [], rate_limit: { low: true } }]);
  const r = await runController({ ...context, slash: true }, h);
  assert.equal(r.status, "verified_noop_low_budget");
  assert.equal(h.calls.length, 0);
});
test("eligibility disappearing at refresh prevents action", async () => {
  const h = harness([queue([pr]), queue([])]);
  await runController(context, h);
  assert.equal(h.calls.length, 0);
});
test("slash acknowledgement never nudges an ineligible PR", async () => {
  const h = harness([queue([])]);
  await runController({ ...context, slash: true, prNumber: 2, isPullRequest: true, authorAssociation: "OWNER", commentId: 44 }, h);
  assert.equal(h.calls.length, 1);
  assert.equal(h.calls[0].path, "issues/2/comments");
  assert.ok(!h.calls[0].body.body.includes("@copilot"));
});
test("slash command never dismisses a review", async () => {
  const h = harness([queue([{ ...pr, dismiss_reviews: [4] }]), queue([{ ...pr, dismiss_reviews: [4] }]), queue([pr])]);
  await runController({ ...context, slash: true, prNumber: 1, isPullRequest: true, authorAssociation: "OWNER", commentId: 4 }, h);
  assert.equal(h.calls.length, 1);
  assert.ok(h.calls.every(c => !c.path.includes("dismissals")));
});
test("nudge uses latest formatter body without posting a nudge comment", async () => {
  const h = harness([queue([pr]), queue([pr]), queue([{ ...pr, nudge_needed: true }])], { formatNudge: () => "exact source work summary" });
  await runController(context, h);
  assert.equal(h.calls[0].path, "actions/workflows/pr-finisher.lock.yml/dispatches");
  assert.deepEqual(h.calls[0].body.inputs, { pr_number: "1", work_summary: "exact source work summary" });
  assert.ok(h.calls.every(c => !c.path.includes("/comments")));
});
test("approval checks bind allowed workflow and exact PR head", () => {
  const r = { id: 2, workflow_id: 3, event: "pull_request", status: "waiting", head_branch: "branch", head_sha: "abc", pull_requests: [{ number: 1 }] };
  const w = { id: 3, path: ".github/workflows/cjs.yml" };
  assert.equal(approvalIsAllowed(r, w, pr), true);
  assert.equal(approvalIsAllowed({ ...r, head_sha: "other" }, w, pr), false);
  assert.equal(approvalIsAllowed(r, { ...w, path: ".github/workflows/other.yml" }, pr), false);
  assert.equal(approvalIsAllowed({ ...r, pull_requests: [{ number: 5 }] }, w, pr), false);
});
test("uncertain dispatch delivery is never retried", async () => {
  const h = harness([queue([pr]), queue([pr]), queue([{ ...pr, nudge_needed: true }])], { formatNudge: () => "work" });
  let calls = 0;
  h.write = async () => {
    calls++;
    const e = Error("timeout");
    e.deliveryUncertain = true;
    throw e;
  };
  await assert.rejects(runController(context, h), /timeout/);
  assert.equal(calls, 1);
});
