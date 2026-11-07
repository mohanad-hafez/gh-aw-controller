"""Run the existing updater and prepare a single-file change for publication."""
import hashlib
import json
import os
from pathlib import Path
import subprocess
import sys
from datetime import datetime, timezone

LOCK = ".github/aw/actions-lock.json"


def changes(before, after):
    """Keep multiple version pins per action visible instead of guessing pairs."""
    groups = []
    for content in (before, after):
        group = {}
        entries = json.loads(content)["entries"]
        if not isinstance(entries, dict):
            raise ValueError("actions-lock entries must be an object")
        for key, entry in entries.items():
            if not all(isinstance(entry.get(field), str) for field in ("repo", "version", "sha")):
                raise ValueError("action entries require repository, version and SHA strings")
            group.setdefault(entry["repo"], []).append(
                {"key": key, "version": entry["version"], "sha": entry["sha"]}
            )
        groups.append({repo: sorted(rows, key=lambda row: row["key"]) for repo, rows in group.items()})
    old, new = groups
    return [
        {"repository": repo, "before": old.get(repo, []), "after": new.get(repo, [])}
        for repo in sorted(old.keys() | new.keys())
        if old.get(repo, []) != new.get(repo, [])
    ]


def collect(binary):
    output = Path(".action-update")
    if output.exists():
        raise RuntimeError("existing update evidence requires inspection before another attempt")
    if subprocess.check_output(["git", "status", "--porcelain", "--untracked-files=no"]).strip():
        raise RuntimeError("tracked working tree must be clean before the updater")
    output.mkdir()
    before = Path(LOCK).read_bytes()
    (output / "before.json").write_bytes(before)
    receipt = {"source_git": subprocess.check_output(["git", "rev-parse", "HEAD"], text=True).strip(),
               "model_calls": 0, "status": "command_pending", "command": [binary, "update", "--verbose"]}

    def save():
        (output / "result.json").write_text(json.dumps(receipt, indent=2) + "\n", encoding="utf-8")

    save()
    with (output / "command-local.log").open("wb") as log:
        try:
            result = subprocess.run(receipt["command"], stdout=log, stderr=subprocess.STDOUT,
                                    timeout=850, check=False)
            receipt["exit_code"] = result.returncode
        except subprocess.TimeoutExpired:
            receipt["status"] = "command_timeout"
            save()
            return 1
    receipt["command_log_sha256"] = hashlib.sha256((output / "command-local.log").read_bytes()).hexdigest()
    if result.returncode:
        receipt["status"] = "command_failed_no_publish"
        save()
        return 1
    after = Path(LOCK).read_bytes()
    (output / "after.json").write_bytes(after)
    receipt["before_sha256"] = hashlib.sha256(before).hexdigest()
    receipt["after_sha256"] = hashlib.sha256(after).hexdigest()
    receipt["actions"] = changes(before, after)
    changed = subprocess.check_output(["git", "diff", "--name-only", "-z"], text=True).split("\0")
    reset = [p for p in changed if p.startswith(".github/workflows/") and p.endswith(".lock.yml")]
    if reset:
        subprocess.run(["git", "restore", "--source=HEAD", "--", *reset], check=True)
    receipt["reset_compiled_paths"] = reset
    receipt["excluded_paths"] = [p for p in changed if p and p != LOCK]
    receipt["status"] = "ready" if before != after else "noop_unchanged_lock"
    date = datetime.now(timezone.utc).strftime("%Y-%m-%d")
    receipt["title"] = "[actions] Update GitHub Actions versions - " + date
    lines = []
    for action in receipt["actions"]:
        show = lambda entries: ", ".join(f"{e['version']} ({e['sha'][:12]})" for e in entries) or "none"
        lines.append(f"- `{action['repository']}`: {show(action['before'])} → {show(action['after'])}")
    receipt["body"] = (f"### GitHub Actions Updates - {date}\n\n"
                       "Updates `.github/aw/actions-lock.json` using the repository updater.\n\n"
                       "<details>\n<summary>📦 Actions Updated (full list)</summary>\n\n"
                       + ("\n".join(lines) or "Only cached metadata changed; no version or SHA change.")
                       + "\n\n</details>\n\n### Summary\n\n"
                       + f"- **Total actions updated**: {len(receipt['actions'])}\n"
                       + "- **Update command**: `gh aw update --verbose`\n"
                       + "- **Workflow lock files**: Not included\n\n"
                       + "### Notes\n\nVersion and SHA changes are listed above. "
                       + "Major-version bumps are permitted by this updater; compatibility is not independently established.\n")
    save()
    return 0


if __name__ == "__main__":
    if os.environ.get("GITHUB_REPOSITORY") != "mohanad-hafez/gh-aw-controller":
        raise SystemExit("run the updater only in the owned experimental fork")
    raise SystemExit(collect(str(Path(sys.argv[1]).resolve())))
