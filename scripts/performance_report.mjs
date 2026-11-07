import fs from "node:fs";
import { processMetrics } from "./performance_metrics.mjs";
const workflow = "daily-cli-performance",
  memoryBranch = "memory/cli-performance";
export function buildReport(analysis, current, runUrl, runId) {
  const s = analysis.summary,
    baseline = Object.values(analysis.benchmarks).filter(b => b.status === "baseline").length;
  const details = Object.entries(analysis.benchmarks)
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([name, r]) => `| ${name} | ${r.current_ns} | ${r.avg_historical_ns ?? "—"} | ${r.change_percent}% | ${r.status} | ${current.benchmarks[name].bytes_per_op} | ${current.benchmarks[name].allocs_per_op} |`)
    .join("\n");
  const issues = s.likely_environment_noise
    ? []
    : Object.entries(analysis.benchmarks)
        .filter(([, r]) => r.status === "regression")
        .slice(0, 3)
        .map(([name, r]) => ({
          title: `[performance] Regression in ${name}: ${r.change_percent}% slower`,
          body: `### Performance regression detected\n\n**Benchmark:** ${name}\n\n**Current:** ${r.current_ns} ns/op; **historical median:** ${r.avg_historical_ns} ns/op; **change:** +${r.change_percent}%.\n\n<details><summary><b>Measurement details</b></summary>\n\nHistorical data points: ${r.data_points}. Review compilation changes; use make bench-memory, go tool pprof and benchstat for investigation.\n\n</details>\n\n**References:** [§${runId}](${runUrl})`,
        }));
  return {
    issues,
    title: `[daily-cli-performance] ${analysis.date}`,
    body: `### Performance summary\n\n${s.total} benchmarks: ${baseline} baseline, ${s.stable} stable, ${s.warnings} warnings, ${s.regressions} regressions, ${s.improvements} improvements.\n\n${s.likely_environment_noise ? "Likely environment noise: no regression issues will be opened. Recommend a rerun." : baseline === s.total ? "Initial baseline established; no historical comparison yet." : "Comparison uses the source median of up to seven recent values, including the current observation."}\n\n<details><summary><b>Benchmark measurements</b></summary>\n\n| Benchmark | Current ns/op | Historical median ns/op | Change | Status | B/op | allocs/op |\n| --- | ---: | ---: | ---: | --- | ---: | ---: |\n${details}\n\n</details>\n\n### Next actions\n\n${s.regressions ? "Review the flagged measurements before attributing a change to code." : "Continue collecting comparable measurements."}\n\n**References:** [§${runId}](${runUrl})`,
  };
}

export async function runPerformanceReport({ github, context }) {
  if (context.repo.owner !== "mohanad-hafez" || context.repo.repo !== "gh-aw-controller") throw Error("Owned target only");
  const { owner, repo } = context.repo,
    runId = String(context.runId),
    runUrl = `https://github.com/${owner}/${repo}/actions/runs/${runId}`;
  const result = { run_id: runId, status: "reading", writes: [], input_kind: "Fresh actual benchmark measurements at pinned source commit" };
  const checkpoint = () => fs.writeFileSync("performance-result.json", JSON.stringify(result, null, 2));
  checkpoint();
  async function write(kind, fn) {
    result.status = "delivery_pending";
    result.pending = kind;
    checkpoint();
    try {
      const r = await fn();
      result.writes.push({ kind, status: "confirmed" });
      delete result.pending;
      checkpoint();
      return r;
    } catch (e) {
      result.status = "delivery_uncertain";
      result.error = { kind, status: e.status, message: e.message };
      checkpoint();
      throw e;
    }
  }
  let previous = "",
    sha,
    branchExists = true;
  try {
    const r = await github.rest.repos.getContent({ owner, repo, path: "benchmark_history.jsonl", ref: memoryBranch });
    sha = r.data.sha;
    previous = Buffer.from(r.data.content, "base64").toString("utf8");
  } catch (e) {
    if (e.status !== 404) throw e;
    try {
      await github.rest.git.getRef({ owner, repo, ref: "heads/" + memoryBranch });
    } catch (e2) {
      if (e2.status !== 404) throw e2;
      branchExists = false;
    }
  }
  const metrics = processMetrics(fs.readFileSync("/tmp/performance-input/bench_performance.txt", "utf8"), previous, runId);
  result.history_audit = metrics.history_audit;
  checkpoint();
  if (!branchExists) {
    const tree = await write("memory_tree", () => github.rest.git.createTree({ owner, repo, tree: [{ path: "benchmark_history.jsonl", mode: "100644", type: "blob", content: metrics.history }] }));
    const commit = await write("memory_seed_commit", () => github.rest.git.createCommit({ owner, repo, message: "Record CLI performance baseline", tree: tree.data.sha, parents: [] }));
    await write("memory_branch", () => github.rest.git.createRef({ owner, repo, ref: "refs/heads/" + memoryBranch, sha: commit.data.sha }));
    result.memory_commit = commit.data.sha;
  } else {
    const r = await write("memory_update", () =>
      github.rest.repos.createOrUpdateFileContents({
        owner,
        repo,
        path: "benchmark_history.jsonl",
        branch: memoryBranch,
        message: "Record CLI performance measurements",
        content: Buffer.from(metrics.history).toString("base64"),
        ...(sha ? { sha } : {}),
      })
    );
    result.memory_commit = r.data.commit.sha;
  }
  const readback = await github.rest.repos.getContent({ owner, repo, path: "benchmark_history.jsonl", ref: memoryBranch });
  if (Buffer.from(readback.data.content, "base64").toString("utf8") !== metrics.history) throw Error("Memory readback mismatch");
  const graph = await github.graphql(`query($owner:String!,$repo:String!){repository(owner:$owner,name:$repo){id discussionCategories(first:100){nodes{id name}}}}`, { owner, repo });
  const category = graph.repository.discussionCategories.nodes.find(c => c.name === "audits");
  if (!category) throw Error("audits category absent");
  const plan = buildReport(metrics.analysis, metrics.current, runUrl, runId),
    marker = `<!-- gh-aw-workflow-id: ${workflow} -->`,
    expires = new Date(Date.now() + 3 * 86400000).toISOString();
  const body = plan.body + `\n\n${marker}\n<!-- expires: ${expires} -->\n<!-- run: ${runId} -->`;
  const discussion = await write("create_discussion", () =>
    github.graphql(`mutation($repo:ID!,$category:ID!,$title:String!,$body:String!){createDiscussion(input:{repositoryId:$repo,categoryId:$category,title:$title,body:$body}){discussion{id number url title body category{name}}}}`, {
      repo: graph.repository.id,
      category: category.id,
      title: plan.title,
      body,
    })
  );
  result.discussion = discussion.createDiscussion.discussion;
  checkpoint();
  let cursor = null;
  do {
    const page = await github.graphql(
      `query($owner:String!,$repo:String!,$after:String){repository(owner:$owner,name:$repo){discussions(first:50,after:$after){nodes{id number body closed category{name}} pageInfo{hasNextPage endCursor}}}}`,
      { owner, repo, after: cursor }
    );
    for (const older of page.repository.discussions.nodes)
      if (older.id !== result.discussion.id && !older.closed && older.category.name === "audits" && older.body.includes(marker))
        await write("close_older_discussion_" + older.number, () => github.graphql(`mutation($id:ID!){closeDiscussion(input:{discussionId:$id,reason:RESOLVED}){discussion{id closed}}}`, { id: older.id }));
    cursor = page.repository.discussions.pageInfo.hasNextPage ? page.repository.discussions.pageInfo.endCursor : null;
  } while (cursor);
  result.regression_issues = [];
  if (plan.issues.length) {
    const all = await github.paginate(github.rest.issues.listForRepo, { owner, repo, state: "all", per_page: 100 });
    const groupMarker = `<!-- gh-aw-group: ${workflow} -->`;
    let parent = all.find(i => !i.pull_request && i.state === "open" && i.body?.includes(groupMarker));
    if (!parent) {
      const r = await write("regression_group", () =>
        github.rest.issues.create({
          owner,
          repo,
          title: `[performance] ${workflow} - Issue Group`,
          body: `### CLI performance regressions\n\n${groupMarker}\n\nRelated regression observations are linked as sub-issues.`,
          labels: ["performance", "automation", "cookie"],
        })
      );
      parent = r.data;
    }
    for (const issue of plan.issues) {
      const issueBody = issue.body + `\n\n${marker}\n<!-- expires: ${new Date(Date.now() + 2 * 86400000).toISOString()} -->\n<!-- run: ${runId} -->`;
      const r = await write("regression_issue", () => github.rest.issues.create({ owner, repo, ...issue, body: issueBody, labels: ["performance", "automation", "cookie"] }));
      result.regression_issues.push({ number: r.data.number, url: r.data.html_url });
      checkpoint();
      await write("link_regression_subissue", () => github.request("POST /repos/{owner}/{repo}/issues/{issue_number}/sub_issues", { owner, repo, issue_number: parent.number, sub_issue_id: r.data.id }));
      const verified = await github.rest.issues.get({ owner, repo, issue_number: r.data.number });
      if (verified.data.body !== issueBody) throw Error("Issue readback mismatch");
    }
  }
  const verifiedDiscussion = await github.graphql(`query($id:ID!){node(id:$id){... on Discussion{id title body category{name}}}}`, { id: result.discussion.id });
  if (verifiedDiscussion.node.body !== body || verifiedDiscussion.node.category.name !== "audits") throw Error("Discussion readback mismatch");
  result.status = "completed";
  result.analysis = metrics.analysis;
  checkpoint();
}
