import fs from "node:fs";
import zlib from "node:zlib";
import crypto from "node:crypto";
import { execFileSync } from "node:child_process";
if (process.env.GITHUB_REPOSITORY !== "mohanad-hafez/gh-aw-controller") throw Error("Unexpected repository");
const manifest = JSON.parse(fs.readFileSync(".github/data/outcome-runtime.json", "utf8"));
const source = zlib.gunzipSync(fs.readFileSync(".github/data/evaluate_outcomes.cjs.gz"));
if (crypto.createHash("sha256").update(source).digest("hex") !== manifest.sha256) throw Error("Frozen evaluator checksum mismatch");
fs.mkdirSync("/tmp/gh-aw/frozen-runtime", { recursive: true });
fs.writeFileSync("/tmp/gh-aw/frozen-runtime/evaluate_outcomes.cjs", source);
execFileSync(process.execPath, ["/tmp/gh-aw/frozen-runtime/evaluate_outcomes.cjs"], { stdio: "inherit", timeout: 900000 });
fs.mkdirSync("/tmp/outcome-inputs", { recursive: true });
for (const [input, output] of [
  ["/tmp/gh-aw/outcome-summary.json", "outcome-summary.json"],
  ["/tmp/gh-aw/outcome-evaluations.jsonl", "outcome-evaluations.jsonl"],
  ["/tmp/gh-aw/cache-memory/outcome-collector/seen-runs.json", "seen-runs.json"],
]) {
  if (fs.existsSync(input)) fs.copyFileSync(input, "/tmp/outcome-inputs/" + output);
}
fs.writeFileSync(
  "/tmp/outcome-inputs/runtime.json",
  JSON.stringify(
    {
      evaluator_sha256: manifest.sha256,
      source_commit: manifest.source_commit,
      node: process.version,
      github_cli: execFileSync("gh", ["--version"], { encoding: "utf8" }).split("\n")[0],
      model_calls: 0,
      repository: process.env.GITHUB_REPOSITORY,
      run_id: process.env.GITHUB_RUN_ID,
      external_telemetry: "Not configured in experimental fork; original evaluations retained",
    },
    null,
    2
  )
);
