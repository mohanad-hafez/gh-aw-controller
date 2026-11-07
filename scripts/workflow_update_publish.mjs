import fs from "node:fs";
import crypto from "node:crypto";

export async function publish({ github, context }) {
  const target = "mohanad-hafez/gh-aw-controller";
  const base = "replacement-workflow-updater-01";
  if (`${context.repo.owner}/${context.repo.repo}` !== target || context.ref !== `refs/heads/${base}`) {
    throw new Error("Publish only from the owned experimental branch");
  }
  const root = ".action-update/";
  const receiptFile = root + "publish.json";
  if (fs.existsSync(receiptFile)) throw new Error("Existing publish receipt requires inspection");
  const plan = JSON.parse(fs.readFileSync(root + "result.json", "utf8"));
  const receipt = { status: "checking", model_calls: 0, base, head: `actions-update-${context.runId}` };
  const checkpoint = () => {
    fs.writeFileSync(receiptFile + ".tmp", JSON.stringify(receipt, null, 2) + "\n");
    fs.renameSync(receiptFile + ".tmp", receiptFile);
  };
  if (plan.status === "noop_unchanged_lock") {
    receipt.status = "verified_noop";
    checkpoint();
    return receipt;
  }
  if (plan.status !== "ready" || plan.source_git !== context.sha) throw new Error("Update is not a source-matching completed plan");
  const after = fs.readFileSync(root + "after.json");
  if (crypto.createHash("sha256").update(after).digest("hex") !== plan.after_sha256) throw new Error("Prepared lock bytes changed");
  const repo = context.repo;
  const call = async (operation, fn) => {
    receipt.status = `${operation}_pending`;
    checkpoint();
    try {
      const result = await fn();
      return result.data;
    } catch (error) {
      receipt.status = `${operation}_requires_inspection`;
      receipt.http_status = error.status ?? null;
      checkpoint();
      throw new Error(`${operation} failed; inspect the saved receipt before another attempt (HTTP ${error.status ?? "unknown"})`);
    }
  };
  const branch = (await github.rest.repos.getBranch({ ...repo, branch: base })).data;
  if (branch.commit.sha !== context.sha) throw new Error("Experimental base moved; review before publishing");
  const before = (await github.rest.repos.getContent({ ...repo, path: ".github/aw/actions-lock.json", ref: context.sha })).data;
  if (Array.isArray(before) || before.type !== "file") throw new Error("Expected a single source lock file");
  if (crypto.createHash("sha256").update(Buffer.from(before.content, "base64")).digest("hex") !== plan.before_sha256) throw new Error("Source lock differs from the frozen input");
  receipt.base_sha = context.sha;
  receipt.after_sha256 = plan.after_sha256;
  const blob = await call("blob", () => github.rest.git.createBlob({ ...repo, content: after.toString("base64"), encoding: "base64" }));
  const parent = (await github.rest.git.getCommit({ ...repo, commit_sha: context.sha })).data;
  const tree = await call("tree", () => github.rest.git.createTree({ ...repo, base_tree: parent.tree.sha, tree: [{ path: ".github/aw/actions-lock.json", mode: "100644", type: "blob", sha: blob.sha }] }));
  const commit = await call("commit", () => github.rest.git.createCommit({ ...repo, message: "chore: update action versions", tree: tree.sha, parents: [context.sha] }));
  receipt.commit = commit.sha;
  await call("branch", () => github.rest.git.createRef({ ...repo, ref: `refs/heads/${receipt.head}`, sha: commit.sha }));
  const diff = (await github.rest.repos.compareCommits({ ...repo, base: context.sha, head: commit.sha })).data;
  if (diff.files?.length !== 1 || diff.files[0].filename !== ".github/aw/actions-lock.json") throw new Error("Prepared commit contains unexpected paths");
  const pr = await call("pull_request", () => github.rest.pulls.create({ ...repo, base, head: receipt.head, title: plan.title, body: plan.body, draft: false }));
  receipt.pull_request = { number: pr.number, url: pr.html_url };
  await call("labels", () => github.rest.issues.addLabels({ ...repo, issue_number: pr.number, labels: ["dependencies", "automation"] }));
  const readback = (await github.rest.pulls.get({ ...repo, pull_number: pr.number })).data;
  const files = (await github.rest.pulls.listFiles({ ...repo, pull_number: pr.number, per_page: 100 })).data;
  if (readback.head.sha !== commit.sha || readback.base.ref !== base || readback.title !== plan.title || files.length !== 1 || files[0].filename !== ".github/aw/actions-lock.json") throw new Error("Pull request readback differs from the requested update");
  receipt.status = "created_verified";
  checkpoint();
  return receipt;
}
