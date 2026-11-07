import importlib.util
from pathlib import Path
import json
import unittest

spec = importlib.util.spec_from_file_location("updater", Path(__file__).with_name("workflow_update.py"))
updater = importlib.util.module_from_spec(spec)
spec.loader.exec_module(updater)


def lock(rows):
    return json.dumps({"entries": rows}).encode()


class ChangeChecks(unittest.TestCase):
    def test_multiple_old_pins_are_preserved(self):
        old = {f"action@{v}": {"repo": "actions/check", "version": v, "sha": v} for v in ["v4", "v6"]}
        new = {"action@v7": {"repo": "actions/check", "version": "v7", "sha": "new"}}
        rows = updater.changes(lock(old), lock(new))
        self.assertEqual(len(rows), 1)
        self.assertEqual([r["version"] for r in rows[0]["before"]], ["v4", "v6"])

    def test_metadata_only_change_is_not_version_update(self):
        entry = {"repo": "a/b", "version": "v1", "sha": "sha"}
        self.assertEqual(updater.changes(lock({"a": entry}), lock({"a": {**entry, "inputs": {"changed": True}}})), [])

    def test_moving_tag_sha_change_is_reported(self):
        entry = {"repo": "a/b", "version": "v1", "sha": "old"}
        self.assertEqual(len(updater.changes(lock({"a": entry}), lock({"a": {**entry, "sha": "new"}}))), 1)

    def test_invalid_entry_fails_before_publication(self):
        with self.assertRaises(ValueError):
            updater.changes(lock({"a": {"repo": "a/b"}}), lock({}))


if __name__ == "__main__":
    unittest.main()
