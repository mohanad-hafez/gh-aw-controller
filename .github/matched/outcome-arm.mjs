import fs from 'node:fs';
import assert from 'node:assert/strict';
import {buildOutcomeReport} from './outcome_report.mjs';
const {inputs}=JSON.parse(fs.readFileSync('outcome.json','utf8'));
const report=buildOutcomeReport(inputs.summary,inputs.evaluations);
assert.equal(report.action,'report');
const fields=['runs_checked','total_outcomes','accepted','rejected','ignored','pending','acceptance_rate','waste_rate'];
const expected={metrics:Object.fromEntries(fields.map(key=>[key,inputs.summary[key]])),
  workflow:inputs.evaluations[0].workflow,accepted:1,rejected:0,ignored:0,pending:0};
assert.equal(inputs.evaluations.length,1);
assert.equal(inputs.evaluations[0].result,'accepted');
if(process.env.ARM==='agent'){
  const calls=fs.readFileSync('evidence/tools.jsonl','utf8').trim().split('\n').map(JSON.parse);
  assert(calls.every(row=>!row.error));
  assert.deepEqual([...new Set(calls.slice(0,-1).map(row=>row.args.name))].sort(),['evaluations','summary']);
  assert.equal(calls.at(-1).name,'publish_result');
  assert.deepEqual(JSON.parse(calls.at(-1).args.body),expected);
}
fs.writeFileSync('evidence/result.json',JSON.stringify({title:report.title,body:report.body,labels:['automation','observability','outcomes']}));
fs.writeFileSync('evidence/metrics.json',JSON.stringify(expected));
