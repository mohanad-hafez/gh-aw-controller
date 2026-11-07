const marker = "<!-- deterministic-pr-sous-chef-report:v1 -->";
const trusted = issue => !issue.pull_request && issue.user?.login === "github-actions[bot]" && issue.body?.includes(marker) && issue.title?.startsWith("[pr-sous-chef] ");

export async function publishReport({ read, write, now, body, runUrl }) {
  const date = new Date(now);
  if (!Number.isFinite(date.getTime())) throw Error("Invalid report date");
  const day = date.toISOString().slice(0, 10);
  const open = await read("issues?state=open&labels=automation&per_page=100", true);
  const previous = open.filter(trusted);
  const today = previous.find(issue => issue.created_at?.slice(0, 10) === day);
  const reportBody = body + "\n\n" + marker + "\n\nRun: " + runUrl + "\n";
  if (today) {
    const comment = await write("POST", `issues/${today.number}/comments`, { body: reportBody });
    const observed = await read(`issues/comments/${comment.id}`);
    if (observed.body !== reportBody) throw Error("Grouped report readback mismatch");
    return { grouped: true, issue: today.number, comment: comment.id, url: comment.html_url, readback_verified: true };
  }
  const expires = new Date(date.getTime() + 72 * 3600000).toISOString();
  const payload = { title: "[pr-sous-chef] " + day, body: reportBody + `\n> - [x] expires <!-- gh-aw-expires: ${expires} --> on ${expires}\n`, labels: ["automation"] };
  const created = await write("POST", "issues", payload);
  const observed = await read(`issues/${created.number}`);
  if (observed.body !== payload.body || observed.title !== payload.title || !observed.labels.some(l => l.name === "automation")) throw Error("Report issue readback mismatch");
  const closed = [];
  for (const old of previous) {
    await write("PATCH", `issues/${old.number}`, { state: "closed" });
    if ((await read(`issues/${old.number}`)).state !== "closed") throw Error("Older report closure readback mismatch");
    closed.push(old.number);
  }
  return { grouped: false, issue: created.number, url: created.html_url, expires_at: expires, closed_older: closed, readback_verified: true };
}
