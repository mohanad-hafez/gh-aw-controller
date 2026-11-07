import test from "node:test";
import assert from "node:assert/strict";
import { createTransport } from "./souschef_transport.mjs";
const repository = "mohanad-hafez/gh-aw-controller";
test("repository endpoint and body stay separate from executable arguments", async () => {
  let captured;
  const t = createTransport({
    repository,
    runner: async (...args) => {
      captured = args;
      return { stdout: '{"id":1}' };
    },
  });
  await t.write("POST", "issues", { body: "`$(secret)`\ntext" });
  assert.deepEqual(captured[1], ["api", `repos/${repository}/issues`, "--method", "POST", "--input", "-"]);
  assert.deepEqual(JSON.parse(captured[2].input), { body: "`$(secret)`\ntext" });
  assert.equal(t.observations[0].status, "response_received");
});
test("ambiguous server and transport failures are preserved with one request", async () => {
  for (const stderr of ["HTTP 502", "timeout"]) {
    let count = 0;
    const t = createTransport({
      repository,
      runner: async () => {
        count++;
        throw Object.assign(Error("failed"), { stderr });
      },
    });
    await assert.rejects(t.write("POST", "issues", {}), e => e.deliveryUncertain === true);
    assert.equal(count, 1);
    assert.equal(t.observations[0].status, "delivery_uncertain");
  }
});
test("permission rejection is distinct from uncertain delivery", async () => {
  const t = createTransport({
    repository,
    runner: async () => {
      throw Object.assign(Error("failed"), { stderr: "HTTP 403" });
    },
  });
  await assert.rejects(t.write("POST", "issues", {}), e => e.deliveryUncertain === false);
});
test("external paths and unsupported methods cannot reach runner", async () => {
  const t = createTransport({ repository, runner: async () => assert.fail("Unexpected request") });
  await assert.rejects(t.read("../repos/upstream/issues"), /Invalid/);
  await assert.rejects(t.write("DELETE", "issues/1"), /Unsupported/);
  assert.throws(() => createTransport({ repository: "github/gh-aw" }), /Unexpected/);
});
