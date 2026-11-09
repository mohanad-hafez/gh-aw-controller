const assert = require('node:assert/strict');
const fs = require('node:fs');

module.exports = async function publish({ github, context }) {
  assert.deepEqual(context.repo, { owner: 'mohanad-hafez', repo: 'gh-aw-controller' });
  const arm = process.env.ARM;
  assert(['agent', 'script'].includes(arm));
  const root = '.github/matched/';
  const decision = JSON.parse(fs.readFileSync('evidence/decision.json'));
  const details = JSON.parse(fs.readFileSync(root + 'updater-publication.json'));
  const after = fs.readFileSync(root + 'updater-after.json');
  const path = '.github/aw/actions-lock.json';
  assert.deepEqual(decision.paths, [path]);
  assert.deepEqual(decision.changed, details.changes.map(row => row.repository).sort());
  assert.deepEqual(decision.unresolved, details.unresolved);
  const base = context.ref.replace('refs/heads/', '');
  assert.match(base, /^matched-action-updater-\d+$/);
  const head = base + '-proposal-' + context.runId + '-' + arm;
  const checkpoint = { state: 'preparing', base, head };
  const save = () => fs.writeFileSync('publication.json', JSON.stringify(checkpoint));
  save();
  const original = await github.rest.git.getCommit({ ...context.repo, commit_sha: context.sha });
  const tree = await github.rest.git.createTree({ ...context.repo, base_tree: original.data.tree.sha,
    tree: [{ path, mode: '100644', type: 'blob', content: after.toString('utf8') }],
  });
  const commit = await github.rest.git.createCommit({ ...context.repo, tree: tree.data.sha,
    parents: [context.sha], message: 'Apply recorded action updates',
  });
  checkpoint.commit = commit.data.sha;
  checkpoint.state = 'creating_ref';
  save();
  await github.rest.git.createRef({ ...context.repo, ref: 'refs/heads/' + head, sha: checkpoint.commit });

  const display = rows => rows.map(row => row.version + ' (' + (row.sha.slice(0, 12) || 'SHA unresolved') + ')').join(', ') || 'none';
  const lines = details.changes.map(row => '- ' + row.repository + ': ' + display(row.before) + ' -> ' + display(row.after));
  const title = 'Test action updates ' + context.runId + ' ' + arm;
  const body = 'Recorded updater result for ' + decision.changed.length + ' action identifiers. Only the action pin manifest changes.\n\n' +
    lines.join('\n') + '\n\nUnresolved pins: ' + decision.unresolved.join(', ') +
    '. Compatibility was not assessed. This draft is for comparison only.';
  checkpoint.state = 'creating_pr';
  save();
  const response = await github.rest.pulls.create({ ...context.repo, title, body, head, base, draft: true, maintainer_can_modify: false });
  checkpoint.number = response.data.number;
  checkpoint.url = response.data.html_url;
  save();
  const prFiles = await github.rest.pulls.listFiles({ ...context.repo, pull_number: checkpoint.number, per_page: 100 });
  assert.deepEqual(prFiles.data.map(row => row.filename), [path]);
  const pr = await github.rest.pulls.get({ ...context.repo, pull_number: checkpoint.number });
  assert(pr.data.draft);
  assert.equal(pr.data.base.sha, context.sha);
  assert.equal(pr.data.head.sha, checkpoint.commit);
  assert.equal(pr.data.body, body);
  const pin = await github.rest.repos.getContent({ ...context.repo, path, ref: checkpoint.commit });
  assert(Buffer.from(pin.data.content, 'base64').equals(after));
  checkpoint.state = 'verified';
  save();
};
