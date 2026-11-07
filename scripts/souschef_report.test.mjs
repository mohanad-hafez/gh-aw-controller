import test from "node:test";
import assert from "node:assert/strict";
import { publishReport } from "./souschef_report.mjs";
const marker = "<!-- deterministic-pr-sous-chef-report:v1 -->";
const now = "2026-11-07T16:30:00Z";
const issue = (number, date, login = "github-actions[bot]") => ({ number, created_at: date, user: { login }, body: marker, title: "[pr-sous-chef] status" });
test("same-day report is grouped into a verified comment", async () => {
  const calls = [];
  let body;
  const read = async p => (p.startsWith("issues?") ? [issue(4, now)] : { body });
  const write = async (m, p, b) => {
    calls.push([m, p]);
    body = b.body;
    return { id: 8, html_url: "url" };
  };
  const result = await publishReport({ read, write, now, body: "status", runUrl: "run" });
  assert.equal(result.grouped, true);
  assert.deepEqual(calls, [["POST", "issues/4/comments"]]);
});
test("new daily issue retains expiry and only closes trusted older reports", async () => {
  let payload;
  const calls = [];
  const read = async p => (p.startsWith("issues?") ? [issue(4, "2026-11-06T00:00:00Z"), issue(5, now, "someone")] : p === "issues/9" ? { ...payload, labels: [{ name: "automation" }] } : { state: "closed" });
  const write = async (m, p, b) => {
    calls.push([m, p]);
    if (p === "issues") {
      payload = b;
      return { number: 9 };
    }
    return {};
  };
  const r = await publishReport({ read, write, now, body: "status", runUrl: "run" });
  assert.deepEqual(r.closed_older, [4]);
  assert.ok(payload.body.includes("2026-11-10T16:30:00.000Z"));
  assert.deepEqual(calls, [
    ["POST", "issues"],
    ["PATCH", "issues/4"],
  ]);
});
test("failed creation readback prevents closure of any older reports", async () => {
  let calls = 0;
  const read = async p => (p.startsWith("issues?") ? [issue(4, "2026-11-06T00:00:00Z")] : { body: "mismatch" });
  const write = async () => {
    calls++;
    return { number: 9 };
  };
  await assert.rejects(publishReport({ read, write, now, body: "status", runUrl: "run" }), /readback mismatch/);
  assert.equal(calls, 1);
});
