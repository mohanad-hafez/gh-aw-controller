import assert from 'node:assert/strict';
import fs from 'node:fs';
import { fetchQueue, formatNudge, gh } from '../../scripts/pr-sous-chef.mjs';
import { repositoryRunAdapter } from './souschef_prefilter_adapter.mjs';
import { runController } from './souschef_controller.mjs';
import { createTransport } from './souschef_transport.mjs';

const repository = process.env.GITHUB_REPOSITORY;
assert.equal(repository, 'mohanad-hafez/gh-aw-controller');
const arm = process.env.ARM;
assert(['agent','script'].includes(arm));
const target = JSON.parse(fs.readFileSync('.github/matched/controller-targets.json'))[arm];
const adapter = repositoryRunAdapter(gh);
const query = () => fetchQueue(repository, String(target.pr), adapter);
const expected = { pr:1, dismiss:[1], approve:[], dispatch:false, report:true };
function exact(queue) {
  assert.equal(queue.rate_limit.low, false);
  assert.equal(queue.prs.length, 1, JSON.stringify(queue.skipped));
  const pr = queue.prs[0];
  assert.equal(pr.number, target.pr);
  assert.equal(pr.headRefOid, target.sha);
  assert.deepEqual(pr.dismiss_reviews, [target.review]);
  assert.deepEqual(pr.approve_runs, []);
  assert.equal(pr.nudge_needed, false);
  assert.equal(formatNudge(pr), null);
}
const readJson = file => JSON.parse(fs.readFileSync(file, 'utf8'));
const save = (file, value) => fs.writeFileSync(file, JSON.stringify(value));
if (process.argv[2] === 'prepare') {
  const queue = await query();
  save('evidence/queue.json', queue);
  exact(queue);
  save('evidence/fixture.json', {
    inputs: {
      mode:{ manual:true, rate_limit_low:false },
      queue:[{ pr:1, dismiss_reviews:[1], approve_runs:[], nudge_needed:false }],
    },
    output_description:'Return pr, dismiss, approve, dispatch, and report as JSON.',
  });
  if (arm === 'script') save('evidence/decision.json', expected);
  process.exit(0);
}
if (process.argv[2] === 'decide') {
  if (arm === 'agent') {
    const calls = fs.readFileSync('evidence/tools.jsonl', 'utf8').trim().split('\n').map(JSON.parse);
    assert(calls.every(call => !call.error));
    assert.equal(calls.at(-1).name, 'publish_result');
    const decision = JSON.parse(calls.at(-1).args.body);
    assert.deepEqual(decision, expected);
    save('evidence/decision.json', decision);
  }
  assert.deepEqual(readJson('evidence/decision.json'), expected);
  process.exit(0);
}
assert.equal(process.argv[2], 'publish');
const decision = readJson('evidence/decision.json');
assert.deepEqual(decision, expected);
const initial = readJson('evidence/queue.json');
exact(initial);
const transport = createTransport({ repository, checkpoint:value => save('operations.json', value) });
const dismissPath = 'pulls/' + target.pr + '/reviews/' + target.review + '/dismissals';
const dismissReason = { message:'All PR review threads are resolved.' };
let dismissed = false;
let report;
async function dismiss(method, path, payload) {
  assert.equal(method, 'PUT');
  assert.equal(path, dismissPath);
  assert.deepEqual(payload, dismissReason);
  assert.equal(dismissed, false);
  const review = await transport.read('pulls/' + target.pr + '/reviews/' + target.review);
  assert.equal(review.user.login, 'github-actions[bot]');
  assert.equal(review.state, 'CHANGES_REQUESTED');
  assert.equal(review.commit_id, target.sha);
  await transport.write(method, path, payload);
  const observed = await transport.read('pulls/' + target.pr + '/reviews/' + target.review);
  assert.equal(observed.state, 'DISMISSED');
  dismissed = true;
}
async function publishReport() {
  assert(dismissed);
  assert.equal(report, undefined);
  const title = 'Test maintenance report ' + process.env.GITHUB_RUN_ID + ' ' + arm;
  const body = '### PR maintenance\n\nProcessed 1 pull request. Dismissed 1 resolved bot review. Approved 0 runs and dispatched 0 workflows.\n\n' +
    'The review dismissal was read back from GitHub.';
  const issue = await transport.write('POST', 'issues', { title, body, labels:['automation'] });
  const observed = await transport.read('issues/' + issue.number);
  assert.equal(observed.title, title);
  assert.equal(observed.body.trimEnd(), body);
  report = { number:issue.number, url:issue.html_url, body, title };
  return report;
}

if (arm === 'script') {
  let calls = 0;
  const result = await runController({ repository, now:new Date().toISOString() }, {
    fetchQueue:async (_repo, number) => {
      if (++calls === 1) return initial;
      assert.equal(String(number), String(target.pr));
      const fresh = await query();
      if (!dismissed) exact(fresh);
      else {
        assert.equal(fresh.rate_limit.low, false);
        for (const pr of fresh.prs) {
          assert.equal(pr.number, target.pr);
          assert.equal(pr.nudge_needed, false);
          assert.deepEqual(pr.approve_runs, []);
        }
      }
      return fresh;
    },
    formatNudge, read:transport.read, write:dismiss, publishReport,
    checkpoint:value => save('controller.json', value),
  });
  assert.equal(result.status, 'progress_performed');
  assert.deepEqual(result.prs[0].dismissed, [target.review]);
} else {
  const refresh = await query();
  exact(refresh);
  await dismiss('PUT', dismissPath, dismissReason);
  await publishReport();
}
assert(report);
save('publication.json', { report, target, decision, dismissed });

