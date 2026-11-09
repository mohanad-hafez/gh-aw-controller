const fs = require('node:fs');
const assert = require('node:assert/strict');

module.exports = async function publish({ github, context }) {
  assert.deepEqual(context.repo, { owner: 'mohanad-hafez', repo: 'gh-aw-controller' });
  const arm = process.env.ARM;
  assert(['agent', 'script'].includes(arm));
  const history = fs.readFileSync('evidence/benchmark_history.jsonl', 'utf8');
  const report = JSON.parse(fs.readFileSync('evidence/report.json'));
  assert.deepEqual(report.issues, []);
  assert.equal(history.trim().split('\n').length, 1);
  const graph = await github.graphql(
    'query($owner:String!,$repo:String!){repository(owner:$owner,name:$repo){id discussionCategories(first:100){nodes{id name}}}}',
    context.repo,
  );
  const repository = graph.repository;
  const category = repository.discussionCategories.nodes.find(row => row.name === 'audits');
  assert(category, 'The audits category must exist');
  const branch = 'matched-performance-memory-' + context.runId + '-' + arm;
  const receipt = { branch, arm, state: 'creating_memory' };
  const checkpoint = () => fs.writeFileSync('publication.json', JSON.stringify(receipt));
  checkpoint();
  const tree = await github.rest.git.createTree({ ...context.repo,
    tree: [{ path: 'benchmark_history.jsonl', mode: '100644', type: 'blob', content: history }],
  });
  const commit = await github.rest.git.createCommit({ ...context.repo,
    tree: tree.data.sha, parents: [], message: 'Record benchmark baseline',
  });
  receipt.commit = commit.data.sha;
  checkpoint();
  await github.rest.git.createRef({ ...context.repo, ref: 'refs/heads/' + branch, sha: receipt.commit });
  const persisted = await github.rest.repos.getContent({ ...context.repo, path: 'benchmark_history.jsonl', ref: branch });
  assert.equal(Buffer.from(persisted.data.content, 'base64').toString('utf8'), history);
  const title = 'Test benchmark report ' + context.runId + ' ' + arm + ' - ' + report.title;
  receipt.state = 'creating_discussion';
  receipt.title = title;
  checkpoint();
  const posted = await github.graphql(
    'mutation($repo:ID!,$category:ID!,$title:String!,$body:String!){createDiscussion(input:{repositoryId:$repo,categoryId:$category,title:$title,body:$body}){discussion{id number url}}}',
    { repo: repository.id, category: category.id, title, body: report.body },
  );
  receipt.discussion = posted.createDiscussion.discussion;
  checkpoint();
  const result = await github.graphql('query($id:ID!){node(id:$id){... on Discussion{title body category{name}}}}',
    { id: receipt.discussion.id });
  assert.equal(result.node.title, title);
  assert.equal(result.node.body.trimEnd(), report.body);
  assert.equal(result.node.category.name, 'audits');
  receipt.state = 'verified';
  checkpoint();
};
