import test from "node:test";
import assert from "node:assert/strict";
import { applySignals } from "./activity_relay.mjs";
const context = { repo: { owner: "mohanad-hafez", repo: "gh-aw-controller" } };
const title = "🔎 Activity Signals: Review Queue";
test("none never calls a mutation or additional read", async () => {
  const result = await applySignals({ action: "none" }, { context, github: {} });
  assert.equal(result.status, "verified_noop");
});
test("create sends exact source output with only recipient retargeting and verifies readback", async () => {
  let payload;
  const github = {
    paginate: async () => [],
    rest: {
      issues: {
        listForRepo: () => {},
        create: async p => {
          payload = p;
          return { data: { number: 3 } };
        },
        get: async () => ({ data: { number: 3, title, body: payload.body, state: "open", labels: payload.labels.map(name => ({ name })) } }),
      },
    },
  };
  const result = await applySignals({ action: "create", issue_title: title, issue_body: "@pelikhan\n\nComputed report" }, { context, github });
  assert.equal(payload.body, "@mohanad-hafez\n\nComputed report");
  assert.equal(result.status, "verified_created");
});
test("an existing title prevents a second creation after stale precompute", async () => {
  const github = { paginate: async () => [{ title }], rest: { issues: { listForRepo: () => {} } } };
  const result = await applySignals({ action: "create", issue_title: title, issue_body: "computed" }, { context, github });
  assert.equal(result.status, "deferred_existing_issue_requires_refresh");
});
test("update rejects a changed issue identity before writing", async () => {
  const github = { rest: { issues: { get: async () => ({ data: { number: 3, title: "Different", state: "open" } }) } } };
  await assert.rejects(applySignals({ action: "update", issue_number: "3", issue_title: title, issue_body: "computed" }, { context, github }), /target changed/);
});
