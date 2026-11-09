import fs from 'node:fs';
import assert from 'node:assert/strict';
import {buildArchitectureReport} from './architecture_report.mjs';
const {inputs}=JSON.parse(fs.readFileSync('architecture.json','utf8'));
assert.deepEqual(inputs.open_reports,[]);
const report=buildArchitectureReport(inputs.metrics,inputs.date);
assert.equal(report.noop,false);
const normalize=findings=>Object.fromEntries(Object.entries(findings).map(([key,rows])=>
  [key,rows.map(({kind,file,value,limit,detail,declaration})=>JSON.parse(JSON.stringify({kind,file,value,limit,detail,declaration})))]));
const expected=normalize(report.findings);
assert.deepEqual(Object.values(expected).map(rows=>rows.length),[0,1,0]);
if(process.env.ARM==='agent'){
  const calls=fs.readFileSync('evidence/tools.jsonl','utf8').trim().split('\n').map(JSON.parse);
  assert(calls.every(row=>!row.error));
  assert.deepEqual([...new Set(calls.slice(0,-1).map(row=>row.args.name))].sort(),Object.keys(inputs).sort());
  assert.equal(calls.at(-1).name,'publish_result');
  assert.deepEqual(normalize(JSON.parse(calls.at(-1).args.body)),expected);
}
fs.writeFileSync('evidence/result.json',JSON.stringify({title:report.title,body:report.body,labels:['architecture','automated-analysis','cookie'].sort()}));
fs.writeFileSync('evidence/findings.json',JSON.stringify(expected));
