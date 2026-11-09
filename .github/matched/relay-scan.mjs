import assert from 'node:assert/strict';
import fs from 'node:fs';
import precompute from './activity_precompute.mjs';
const captured=JSON.parse(fs.readFileSync('.github/matched/relay-fixture.json','utf8'));
const arm=process.argv[2];
assert(['agent','script'].includes(arm));
const calls=[];
const outputs={};
const request=(name,response)=>(params)=>{
  calls.push({name,params});
  return Promise.resolve({data:response});
};
const allowlist={
  listCollaborators:()=>{},
  listContributors:()=>{},
  listMembers:()=>{},
};
const github={
  paginate:async(method,params)=>{
    const name=Object.keys(allowlist).find(key=>allowlist[key]===method);
    assert(name,'Unexpected paginated endpoint');
    calls.push({name,params});
    return captured.allowlists[name];
  },
  rest:{
    repos:allowlist,
    orgs:{listMembers:allowlist.listMembers},
    actions:{getWorkflowRun:request('getWorkflowRun',{created_at:captured.clock})},
    search:{issuesAndPullRequests:request('search',{items:captured.items})},
    issues:{listForRepo:request('openIssues',captured.issues)},
  },
};
await precompute({
  github,context:{repo:{owner:'mohanad-hafez',repo:'gh-aw-controller'},runId:captured.historicalRun},
  core:{info:message=>console.log(message),setOutput:(name,value)=>{outputs[name]=value;}},
});
assert.equal(calls.filter(row=>row.name==='search').length,2);
assert.deepEqual(outputs,{action:'none',issue_number:'',issue_title:'🔎 Activity Signals: Review Queue',issue_body:''});
fs.writeFileSync('relay-result.json',JSON.stringify({outputs,calls,writes:0,model_calls:0}));
fs.appendFileSync(process.env.GITHUB_OUTPUT,'action='+outputs.action+'\n');
