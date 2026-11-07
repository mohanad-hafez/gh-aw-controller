import fs from "node:fs";
export const prefix = "[architecture-guardian] ";
export async function findExistingArchitecture({ github, context }) {
  if (context.repo.owner !== "mohanad-hafez" || context.repo.repo !== "gh-aw-controller") throw Error("Owned target only");
  const issues = await github.paginate(github.rest.issues.listForRepo, { ...context.repo, state: "open", per_page: 100 });
  return issues.find(i => !i.pull_request && i.title.toLowerCase().includes(prefix.trim().toLowerCase()));
}
export function classifyArchitecture(metrics) {
  if (!metrics || !Array.isArray(metrics.files) || typeof metrics.import_cycles !== "string" || typeof metrics.noop !== "boolean") throw Error("Invalid metrics");
  const thresholds = metrics.thresholds;
  for (const key of ["file_lines_blocker", "file_lines_warning", "function_lines", "max_exports"]) if (!Number.isSafeInteger(thresholds?.[key]) || thresholds[key] < 0) throw Error("Invalid threshold " + key);
  if (metrics.noop && metrics.files.length) throw Error("Contradictory no-op");
  if (!metrics.noop && !metrics.files.length) throw Error("Collector returned incomplete empty metrics");
  const findings = { blockers: [], warnings: [], infos: [] };
  if (metrics.import_cycles.trim()) findings.blockers.push({ kind: "cycle", detail: metrics.import_cycles.trim(), fix: "Introduce an interface or move shared types to a lower-level package." });
  const names = new Set();
  for (const file of metrics.files) {
    if (typeof file.file !== "string" || names.has(file.file) || !Number.isSafeInteger(file.lines) || file.lines < 0 || !Number.isSafeInteger(file.export_count) || file.export_count < 0 || typeof file.func_data !== "string")
      throw Error("Invalid file metrics");
    names.add(file.file);
    if (file.lines > thresholds.file_lines_blocker) findings.blockers.push({ kind: "file", file: file.file, value: file.lines, limit: thresholds.file_lines_blocker, fix: "Split into focused sub-files, one responsibility per file." });
    if (file.lines > thresholds.file_lines_warning) findings.warnings.push({ kind: "file", file: file.file, value: file.lines, limit: thresholds.file_lines_warning, fix: "Extract related functions into a new file." });
    if (file.file.endsWith(".go"))
      for (const line of file.func_data.split("\n").filter(Boolean)) {
        const m = line.match(/^(.*)\t(\d+)$/);
        if (!m) throw Error("Malformed Go function metric");
        const size = Number(m[2]);
        if (size > thresholds.function_lines) findings.warnings.push({ kind: "function", file: file.file, declaration: m[1], value: size, limit: thresholds.function_lines, fix: "Decompose into smaller helper functions." });
      }
    if (file.export_count > thresholds.max_exports) findings.infos.push({ kind: "exports", file: file.file, value: file.export_count, limit: thresholds.max_exports, fix: "Consider splitting into focused packages." });
  }
  return findings;
}
export function buildArchitectureReport(metrics, date) {
  const findings = classifyArchitecture(metrics),
    total = Object.values(findings).reduce((sum, x) => sum + x.length, 0);
  if (metrics.noop || !total)
    return {
      noop: true,
      reason: metrics.noop ? "No Go or JavaScript source files changed in the last 24 hours. Architecture scan skipped." : "No architecture violations found in the last 24 hours. All changed files are within configured thresholds.",
      findings,
    };
  const render = f =>
    f.kind === "cycle"
      ? `- Import cycle detected: ${f.detail.replace(/\n/g, "; ")} · **Fix:** ${f.fix}`
      : `- \`${f.file}${f.declaration ? "::" + f.declaration : ""}\` — ${f.value} ${f.kind === "exports" ? "exported identifiers" : "lines"} (limit: ${f.limit}) · **Fix:** ${f.fix}`;
  const section = (name, rows) => `### ${name}\n\n${rows.length ? rows.map(render).join("\n") : "None."}\n\n`;
  const t = metrics.thresholds;
  return {
    noop: false,
    findings,
    title: prefix + "Architecture Violations Detected — " + date,
    body: `### Summary\n\n- **Analysis Period:** Last 24 hours\n- **Files Analyzed:** ${metrics.files.length}\n- **Total Violations:** ${total}\n- **Date:** ${date}\n\n| Severity | Count |\n|---|---:|\n| 🚨 BLOCKER | ${findings.blockers.length} |\n| ⚠️ WARNING | ${findings.warnings.length} |\n| ℹ️ INFO | ${findings.infos.length} |\n\n${section("🚨 BLOCKER Violations", findings.blockers)}${section("⚠️ WARNING Violations", findings.warnings)}${section("ℹ️ INFO Violations", findings.infos)}### Configuration\n\n- File size BLOCKER: ${t.file_lines_blocker} lines\n- File size WARNING: ${t.file_lines_warning} lines\n- Function size: ${t.function_lines} lines\n- Max public exports: ${t.max_exports}\n\n### Action Checklist\n\n- [ ] Review BLOCKER violations and plan refactoring\n- [ ] Address WARNING violations in upcoming PRs\n- [ ] Consider splitting INFO modules if they grow further\n- [ ] Close this issue once all violations are resolved\n\n> To configure thresholds, add a .architecture.yml file to the repository root.`,
  };
}
export async function publishArchitecture({ github, context, metrics }) {
  if (context.repo.owner !== "mohanad-hafez" || context.repo.repo !== "gh-aw-controller") throw Error("Owned target only");
  const { owner, repo } = context.repo,
    result = { run_id: context.runId, status: "reading", writes: [] },
    checkpoint = () => fs.writeFileSync("architecture-result.json", JSON.stringify(result, null, 2));
  checkpoint();
  const existing = await findExistingArchitecture({ github, context });
  if (existing) {
    result.status = "noop";
    result.reason = "Open architecture report already exists";
    result.existing_issue = existing.number;
    checkpoint();
    return;
  }
  const report = buildArchitectureReport(metrics, new Date().toISOString().slice(0, 10));
  result.report = report;
  if (report.noop) {
    result.status = "noop";
    result.reason = report.reason;
    checkpoint();
    return;
  }
  const runUrl = `https://github.com/${owner}/${repo}/actions/runs/${context.runId}`,
    expires = new Date(Date.now() + 48 * 3600000).toISOString();
  const body = report.body + `\n\n**References:** [§${context.runId}](${runUrl})\n\n<!-- gh-aw-workflow-id: architecture-guardian -->\n<!-- expires: ${expires} -->`;
  const write = async (kind, fn) => {
    result.status = "delivery_pending";
    result.pending = kind;
    checkpoint();
    try {
      const r = await fn();
      result.writes.push({ kind, status: "confirmed" });
      delete result.pending;
      result.status = "working";
      checkpoint();
      return r;
    } catch (e) {
      result.status = "delivery_uncertain";
      result.error = { kind, status: e.status, message: e.message };
      checkpoint();
      throw e;
    }
  };
  const issue = await write("create_architecture_report", () => github.rest.issues.create({ owner, repo, title: report.title, body, labels: ["architecture", "automated-analysis", "cookie"] }));
  result.issue = { number: issue.data.number, url: issue.data.html_url };
  checkpoint();
  result.agent_assignment = { status: "checking", attempts: [] };
  const aliases = ["copilot-swe-agent[bot]", "github-copilot-enterprise[bot]", "github-copilot[bot]", "copilot-swe-agent", "github-copilot-enterprise", "github-copilot"];
  let login;
  for (const alias of aliases) {
    try {
      await github.request("GET /repos/{owner}/{repo}/issues/{issue_number}/assignees/{assignee}", { owner, repo, issue_number: issue.data.number, assignee: alias });
      login = alias;
      result.agent_assignment.attempts.push({ alias, assignable: true });
      break;
    } catch (e) {
      result.agent_assignment.attempts.push({ alias, assignable: false, status: e.status, message: e.message });
      if (e.status !== 404) {
        result.agent_assignment.status = "capability_error";
        break;
      }
    }
  }
  if (login) {
    try {
      const assignment = await write("assign_original_downstream_agent", () =>
        github.request("POST /repos/{owner}/{repo}/issues/{issue_number}/assignees", {
          owner,
          repo,
          issue_number: issue.data.number,
          assignees: [login],
          agent_assignment: { target_repo: `${owner}/${repo}`, base_branch: context.ref.replace("refs/heads/", "") },
        })
      );
      result.agent_assignment.status = "requested";
      result.agent_assignment.login = login;
      result.agent_assignment.returned_assignees = assignment.data.assignees?.map(a => a.login);
      checkpoint();
    } catch (e) {
      result.agent_assignment.status = "request_requires_inspection";
      checkpoint();
      throw e;
    }
  } else if (result.agent_assignment.status === "checking") result.agent_assignment.status = "unavailable";
  const after = (await github.rest.issues.get({ owner, repo, issue_number: issue.data.number })).data;
  if (after.body !== body || after.title !== report.title) throw Error("Report readback mismatch");
  result.readback = { title: after.title, body: after.body, labels: after.labels.map(l => l.name), assignees: after.assignees.map(a => a.login) };
  result.status = "completed";
  checkpoint();
}
