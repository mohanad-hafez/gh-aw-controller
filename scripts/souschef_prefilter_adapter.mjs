// Preserve the source's active-finisher check when a fork has no workflow registration.
// A paginated repository-run query exposes the same active instances by workflow path.
export function repositoryRunAdapter(api) {
  return async args => {
    const endpoint = args[1];
    if (args[0] !== "api" || typeof endpoint !== "string" || !endpoint.includes("/actions/workflows/pr-finisher.lock.yml/runs?")) return api(args);
    const replacement = [...args];
    replacement[1] = endpoint.replace("/actions/workflows/pr-finisher.lock.yml/runs?", "/actions/runs?");
    const pages = await api(replacement);
    if (!Array.isArray(pages)) throw Error("Malformed active workflow run pages");
    return pages.map(page => {
      if (!Array.isArray(page.workflow_runs) || page.workflow_runs.some(run => typeof run.path !== "string")) throw Error("Missing active workflow path; cannot exclude a finisher");
      const workflow_runs = page.workflow_runs.filter(run => run.path.split("@")[0] === ".github/workflows/pr-finisher.lock.yml");
      return { ...page, workflow_runs, total_count: workflow_runs.length };
    });
  };
}
