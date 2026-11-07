import fs from "node:fs";
import crypto from "node:crypto";
export async function captureReference({ github, context }) {
  if (`${context.repo.owner}/${context.repo.repo}` !== "mohanad-hafez/gh-aw-controller") throw Error("Unexpected repository");
  const plan = JSON.parse(fs.readFileSync(".github/data/outcome-reference.json", "utf8"));
  const { data: comment } = await github.rest.issues.getComment({ ...context.repo, comment_id: plan.comment_id });
  if (crypto.createHash("sha256").update(comment.body).digest("hex") !== plan.body_sha256 || comment.user.login !== "github-actions[bot]" || comment.html_url !== plan.url) throw Error("Recorded output reference changed");
  const { data: issue } = await github.rest.issues.get({ ...context.repo, issue_number: plan.issue_number });
  if (issue.state !== "open") throw Error("Reference issue no longer matches frozen input");
  fs.mkdirSync("/tmp/outcome-reference", { recursive: true });
  fs.writeFileSync(
    "/tmp/outcome-reference/safe-output-items.jsonl",
    JSON.stringify({
      type: "add_comment",
      url: comment.html_url,
      repo: context.repo.owner + "/" + context.repo.repo,
      timestamp: comment.created_at,
      original_run_id: plan.original_run_id,
      producer_kind: "recorded-live-effect-compatibility-manifest",
    }) + "\n"
  );
  fs.writeFileSync(
    "/tmp/outcome-reference/reference-provenance.json",
    JSON.stringify(
      {
        original_run_id: plan.original_run_id,
        packaging_run_id: context.runId,
        comment_id: comment.id,
        body_sha256: plan.body_sha256,
        source: "Previously verified actual GitHub output; original operation and model request are not replayed",
      },
      null,
      2
    )
  );
}
