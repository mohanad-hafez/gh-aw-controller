import fs from "node:fs";
import crypto from "node:crypto";
import zlib from "node:zlib";
import { execFileSync } from "node:child_process";
const directory = "/tmp/architecture-input";
fs.mkdirSync(directory, { recursive: true });
const manifest = JSON.parse(fs.readFileSync(".github/data/architecture-runtime.json", "utf8"));
const bytes = zlib.gunzipSync(fs.readFileSync(".github/data/architecture-collector.sh.gz"));
if (crypto.createHash("sha256").update(bytes).digest("hex") !== manifest.collector_sha256) throw Error("Collector hash mismatch");
const script = directory + "/collector.sh";
fs.writeFileSync(script, bytes);
execFileSync("bash", [script], { stdio: "inherit" });
const metrics = JSON.parse(fs.readFileSync("/tmp/gh-aw/agent/arch-metrics.json", "utf8"));
const changed = execFileSync("git", ["log", "--since=24 hours ago", "--name-only", "--pretty=format:"], { encoding: "utf8" })
  .split(/\r?\n/)
  .filter(f => /\.(go|js|cjs|mjs)$/.test(f) && !/(node_modules\/|vendor\/|\.git\/|_test\.go$)/.test(f) && fs.existsSync(f) && fs.statSync(f).isFile());
const expected = [...new Set(changed)].sort(),
  actual = metrics.files.map(f => f.file).sort();
if (JSON.stringify(expected) !== JSON.stringify(actual)) throw Error("Collector changed-file coverage mismatch");
for (const f of metrics.files) {
  const raw = fs.readFileSync(f.file, "utf8");
  if ((raw.match(/\n/g) || []).length !== f.lines) throw Error("Line count mismatch " + f.file);
}
fs.copyFileSync("/tmp/gh-aw/agent/arch-metrics.json", directory + "/metrics.json");
fs.writeFileSync(
  directory + "/capture.json",
  JSON.stringify(
    {
      captured_at: new Date().toISOString(),
      source_commit: execFileSync("git", ["rev-parse", "HEAD"], { encoding: "utf8" }).trim(),
      changed_files: expected,
      collector_sha256: manifest.collector_sha256,
      scope: "Source24h changed-file rule; not candidate selection window",
    },
    null,
    2
  )
);
