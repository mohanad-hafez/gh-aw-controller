const assert = require('node:assert/strict');
const fs = require('node:fs');

module.exports = async function setup({ github, context }) {
  assert.deepEqual(context.repo, { owner:'mohanad-hafez', repo:'gh-aw-controller' });
  const targets = JSON.parse(fs.readFileSync('.github/matched/controller-targets.json'));
  const receipts = {};
  const persist = () => fs.writeFileSync('reviews.json', JSON.stringify(receipts));
  for (const [arm, target] of Object.entries(targets)) {
    const params = { ...context.repo, pull_number:target.pr };
    const pr = (await github.rest.pulls.get(params)).data;
    assert.equal(pr.state, 'open');
    assert.equal(pr.draft, false);
    assert.equal(pr.base.ref, 'matched-controller-fixtures-01');
    assert.equal(pr.head.ref, target.branch);
    assert.equal(pr.head.sha, target.sha);
    const existing = await github.paginate(github.rest.pulls.listReviews, { ...params, per_page:100 });
    assert.deepEqual(existing, []);
    const receipt = receipts[arm] = { pr:target.pr, head:target.sha, status:'request_started' };
    persist();
    const review = (await github.rest.pulls.createReview({
      ...params, commit_id:target.sha, event:'REQUEST_CHANGES', body:'Maintenance state check.',
    })).data;
    receipt.id = review.id;
    receipt.submittedAt = review.submitted_at;
    persist();
    const observed = (await github.rest.pulls.getReview({ ...params, review_id:review.id })).data;
    assert.equal(observed.user.login, 'github-actions[bot]');
    assert.equal(observed.state, 'CHANGES_REQUESTED');
    assert.equal(observed.body, 'Maintenance state check.');
    receipt.status = 'verified';
    persist();
  }
};
