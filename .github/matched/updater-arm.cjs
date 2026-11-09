const assert = require('node:assert/strict');
const fs = require('node:fs');

const root = '.github/matched/';
const { inputs } = JSON.parse(fs.readFileSync(root + 'updater-fixture.json'));
const rows = Object.entries(inputs).filter(([key]) => key.startsWith('pins_')).flatMap(([, value]) => value);
assert.equal(rows.length, 32);
assert.equal(inputs.command.exit_code, 0);
assert.equal(inputs.command.only_publication_path, '.github/aw/actions-lock.json');
const expected = {
  changed: rows.filter(row => row.before !== row.after).map(row => row.action).sort(),
  unresolved: rows.flatMap(row => row.unresolved).sort(),
  paths: ['.github/aw/actions-lock.json'],
};
let result = expected;
if (process.env.ARM === 'agent') {
  const calls = fs.readFileSync('evidence/tools.jsonl', 'utf8').trim().split('\n').map(JSON.parse);
  assert(calls.every(call => !call.error));
  assert.equal(calls.at(-1).name, 'publish_result');
  result = JSON.parse(calls.at(-1).args.body);
  assert.equal(new Set(result.changed).size, result.changed.length);
  result.changed.sort();
  result.unresolved.sort();
}
assert.deepEqual(result, expected);
fs.writeFileSync('evidence/decision.json', JSON.stringify(result));
