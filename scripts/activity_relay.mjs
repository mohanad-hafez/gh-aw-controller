export async function applySignals(outputs, { github, context, checkpoint = () => {} }) {
  const { owner, repo } = context.repo;
  if (`${owner}/${repo}` !== "mohanad-hafez/gh-aw-controller") throw Error("Unexpected target repository");
  const result = { task: "activity_signals", model_calls: 0, decision: outputs.action, status: "started" };
  if (outputs.action === "none") {
    result.status = "verified_noop";
    checkpoint(result);
    return result;
  }
  if (!["create", "update"].includes(outputs.action) || outputs.issue_title !== "🔎 Activity Signals: Review Queue" || !outputs.issue_body) throw Error("Malformed precomputed decision");
  let issueNumber;
  if (outputs.action === "update") {
    issueNumber = Number(outputs.issue_number);
    if (!Number.isSafeInteger(issueNumber) || issueNumber < 1) throw Error("Invalid update target");
    const { data: current } = await github.rest.issues.get({ owner, repo, issue_number: issueNumber });
    if (current.pull_request || current.state !== "open" || current.title !== outputs.issue_title) throw Error("Precomputed update target changed");
  } else {
    const issues = await github.paginate(github.rest.issues.listForRepo, { owner, repo, state: "open", per_page: 100 });
    if (issues.some(i => !i.pull_request && i.title === outputs.issue_title)) {
      result.status = "deferred_existing_issue_requires_refresh";
      checkpoint(result);
      return result;
    }
  }
  // Retarget only the source's fixed notification recipient to the experimental owner.
  const body = outputs.issue_body.replace(/^@pelikhan\n/, "@mohanad-hafez\n").replace(/@([a-zA-Z0-9][a-zA-Z0-9-]*)/g, (mention, login) => (login.toLowerCase() === "mohanad-hafez" ? mention : "@\u200b" + login));
  result.status = "request_started";
  result.target = issueNumber ?? null;
  checkpoint(result);
  let response;
  try {
    response =
      outputs.action === "create"
        ? await github.rest.issues.create({ owner, repo, title: outputs.issue_title, body, labels: ["security", "bot-detection"] })
        : await github.rest.issues.update({ owner, repo, issue_number: issueNumber, body });
  } catch (error) {
    result.status = "delivery_uncertain_requires_inspection";
    checkpoint(result);
    throw error;
  }
  result.status = "response_received";
  result.issue = response.data.number;
  checkpoint(result);
  const { data: observed } = await github.rest.issues.get({ owner, repo, issue_number: result.issue });
  if (observed.body !== body || observed.title !== outputs.issue_title || observed.state !== "open") throw Error("Activity report readback mismatch");
  if (outputs.action === "create" && !["security", "bot-detection"].every(name => observed.labels?.some(l => l.name === name))) throw Error("Activity labels readback mismatch");
  result.status = outputs.action === "create" ? "verified_created" : "verified_updated";
  result.url = observed.html_url;
  checkpoint(result);
  return result;
}
