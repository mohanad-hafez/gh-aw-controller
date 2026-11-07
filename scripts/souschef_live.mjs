import fs from "node:fs";
import { fetchQueue, formatNudge, gh } from "./pr-sous-chef.mjs";
import { runController } from "./souschef_controller.mjs";
import { createTransport } from "./souschef_transport.mjs";
import { publishReport } from "./souschef_report.mjs";
import { repositoryRunAdapter } from "./souschef_prefilter_adapter.mjs";

const checkpoint = (file, value) => {
  fs.writeFileSync(file + ".tmp", JSON.stringify(value, null, 2) + "\n");
  fs.renameSync(file + ".tmp", file);
};
const repository = process.env.GITHUB_REPOSITORY;
const transport = createTransport({ repository, checkpoint: value => checkpoint("souschef-operations.json", value) });
const context = { repository, now: new Date().toISOString(), runUrl: `https://github.com/${repository}/actions/runs/${process.env.GITHUB_RUN_ID}` };
try {
  if (process.env.SOUSCHEF_COMMENT_ID) {
    const id = Number(process.env.SOUSCHEF_COMMENT_ID);
    if (!Number.isSafeInteger(id) || id < 1) throw Error("Invalid triggering comment");
    const comment = await transport.read(`issues/comments/${id}`);
    if (!/^\/souschef\s*$/.test(comment.body)) throw Error("Trigger is not a souschef command");
    const prNumber = Number(comment.issue_url.split("/").pop());
    const issue = await transport.read(`issues/${prNumber}`);
    Object.assign(context, { slash: true, commentId: id, prNumber, isPullRequest: !!issue.pull_request, authorAssociation: comment.author_association });
  }
  const adaptedApi = repositoryRunAdapter(gh);
  const result = await runController(context, { ...transport, fetchQueue: (repo, number) => fetchQueue(repo, number, adaptedApi), formatNudge, publishReport, checkpoint: value => checkpoint("souschef-result.json", value) });
  result.active_finisher_lookup = "Paginated repository runs filtered by original finisher path; all statuses and branches retained, unknown paths fail closed";
  if (context.slash) {
    const comments = await transport.read(`issues/${context.prNumber}/comments?per_page=100`, true);
    const marker = `<!-- souschef-ack:${context.commentId} -->`;
    if (!comments.some(c => c.user?.login === "github-actions[bot]" && c.body?.includes(marker))) throw Error("Acknowledgement readback failed");
  }
  result.acknowledgement_readback = context.slash ? true : null;
  result.scope = "Deterministic parent controller; downstream implementation agent unchanged. Expiration metadata retained; fork scheduler is not enabled on default branch.";
  checkpoint("souschef-result.json", result);
  if (result.status === "failed") process.exitCode = 1;
} catch (error) {
  checkpoint("souschef-failure.json", { error: error.message, delivery_uncertain: !!error.deliveryUncertain, model_calls: 0 });
  process.exitCode = 1;
}
