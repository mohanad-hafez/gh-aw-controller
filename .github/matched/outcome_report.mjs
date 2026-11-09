const count=(value,name)=>{if(!Number.isSafeInteger(value)||value<0)throw Error('Invalid precomputed '+name);return value;};
const cell=value=>String(value).replace(/[|\r\n]/g,' ').replace(/@/g,'@\u200b');
const percent=value=>(value*100).toFixed(2)+'%';
export function parseEvaluationLines(text){return String(text).split(/\r?\n/).filter(line=>line.trim()).map(line=>JSON.parse(line));}

export function buildOutcomeReport(summary,evaluations){
  count(summary.runs_checked,'runs_checked');count(summary.total_outcomes,'total_outcomes');
  if(summary.total_outcomes===0)return{action:'noop',reason:'No new safe output outcomes to report'};
  for(const field of ['accepted','rejected','ignored','pending'])count(summary[field],field);
  if(summary.accepted+summary.rejected+summary.ignored+summary.pending!==summary.total_outcomes)throw Error('Inconsistent precomputed total');
  for(const field of ['acceptance_rate','waste_rate'])if(!Number.isFinite(summary[field])||summary[field]<0||summary[field]>1)throw Error('Invalid precomputed '+field);
  if(!/^\d{4}-\d{2}-\d{2}$/.test(summary.date))throw Error('Missing precomputed summary date');
  const workflows=new Map();
  for(const item of evaluations){
    if(!['accepted','rejected','ignored','pending','noop'].includes(item.result))throw Error('Unknown precomputed outcome');
    const name=String(item.workflow||'Unknown workflow');
    if(!workflows.has(name))workflows.set(name,{name,accepted:0,rejected:0,ignored:0,pending:0,noop:0});
    workflows.get(name)[item.result]++;
  }
  const totals=[...workflows.values()].reduce((t,r)=>{for(const field of ['accepted','rejected','ignored','pending'])t[field]+=r[field];return t;},{accepted:0,rejected:0,ignored:0,pending:0});
  for(const field of Object.keys(totals))if(totals[field]!==summary[field])throw Error('Precomputed per-workflow totals do not match summary');
  const groups=[...workflows.values()].sort((a,b)=>a.name.localeCompare(b.name));
  const rates=groups.map(r=>({...r,resolved:r.accepted+r.rejected,total:r.accepted+r.rejected+r.ignored+r.pending}));
  const highestAcceptance=rates.filter(r=>r.resolved).sort((a,b)=>b.accepted/b.resolved-a.accepted/a.resolved||a.name.localeCompare(b.name));
  const highestWaste=rates.filter(r=>r.total).sort((a,b)=>b.rejected/b.total-a.rejected/a.total||a.name.localeCompare(b.name));
  const observations=[];
  if(highestAcceptance.length){const top=highestAcceptance[0];const tied=highestAcceptance.filter(r=>r.accepted/r.resolved===top.accepted/top.resolved);observations.push(`Highest resolved acceptance rate: ${tied.map(r=>cell(r.name)).join(', ')} (${percent(top.accepted/top.resolved)}).`);}
  if(highestWaste.length){const top=highestWaste[0];const tied=highestWaste.filter(r=>r.rejected/r.total===top.rejected/top.total);observations.push(`Highest waste rate: ${tied.map(r=>cell(r.name)).join(', ')} (${percent(top.rejected/top.total)}).`);}
  const allIgnored=rates.filter(r=>r.total>0&&r.ignored===r.total);observations.push(`Workflows with all actionable outcomes ignored: ${allIgnored.length?allIgnored.map(r=>cell(r.name)).join(', '):'0'}.`);
  const metrics=[['Runs checked',summary.runs_checked],['Total outcomes',summary.total_outcomes],['Accepted',summary.accepted],['Rejected',summary.rejected],['Ignored',summary.ignored],['Pending',summary.pending],['Acceptance rate',percent(summary.acceptance_rate)],['Waste rate',percent(summary.waste_rate)]];
  const body=`### Safe Output Outcomes — ${summary.date}\n\n### Fleet Summary\n\n| Metric | Value |\n| --- | ---: |\n${metrics.map(([k,v])=>`| ${k} | ${v} |`).join('\n')}\n\n<details><summary><b>Per-Workflow Breakdown</b></summary>\n\n| Workflow | Accepted | Rejected | Ignored | Pending | Acceptance rate |\n| --- | ---: | ---: | ---: | ---: | ---: |\n${rates.map(r=>`| ${cell(r.name)} | ${r.accepted} | ${r.rejected} | ${r.ignored} | ${r.pending} | ${r.resolved?percent(r.accepted/r.resolved):'n/a'} |`).join('\n')}\n\n</details>\n\n### Key Observations\n\n${observations.map(t=>'- '+t).join('\n')}\n`;
  return{action:'report',title:'[Outcome Report] Safe Output Outcomes — '+summary.date,body,source_summary:summary};
}

const marker='<!-- deterministic-outcome-report:v1 -->';
export async function publishOutcomeReport(plan,{github,context,checkpoint=()=>{}}){
  const {owner,repo}=context.repo;if(`${owner}/${repo}`!=='mohanad-hafez/gh-aw-controller')throw Error('Unexpected repository');
  const result={task:'outcome_collector',model_calls:0,plan,status:'planned',operations:[]};checkpoint(result);
  if(plan.action==='noop'){result.status='verified_noop';checkpoint(result);return result;}
  const open=await github.paginate(github.rest.issues.listForRepo,{owner,repo,state:'open',labels:'automation,observability,outcomes',per_page:100});
  const previous=open.filter(i=>!i.pull_request&&i.user?.login==='github-actions[bot]'&&i.body?.includes(marker));
  const today=previous.find(i=>i.created_at?.slice(0,10)===plan.source_summary.date);
  const expires=new Date(Date.now()+7*86400000).toISOString();
  const runUrl=`https://github.com/${owner}/${repo}/actions/runs/${context.runId}`;
  const body=plan.body+'\n'+marker+`\n\n> 📊 *Measured by [Outcome Collector](${runUrl})*\n\n> - [x] expires <!-- gh-aw-expires: ${expires} --> on ${expires}\n`;
  const mutate=async(kind,args)=>{const operation={kind,status:'request_started'};result.operations.push(operation);checkpoint(result);try{const response=await github.rest.issues[kind](args);operation.status='response_received';checkpoint(result);return response.data;}catch(error){const rejected=error.status>=400&&error.status<500&&![408,409,429].includes(error.status);operation.status=rejected?'rejected':'delivery_uncertain_requires_inspection';result.status='failed';result.error=error.message;result.delivery_uncertain=!rejected;checkpoint(result);throw error;}};
  if(today){
    const comment=await mutate('createComment',{owner,repo,issue_number:today.number,body});
    const {data:observed}=await github.rest.issues.getComment({owner,repo,comment_id:comment.id});
    if(observed.body!==body)throw Error('Grouped report readback mismatch');
    result.issue=today.number;result.comment=comment.id;result.url=comment.html_url;result.status='verified_grouped_report';
  }else{
    const created=await mutate('create',{owner,repo,title:plan.title,body,labels:['automation','observability','outcomes']});
    const {data:observed}=await github.rest.issues.get({owner,repo,issue_number:created.number});
    if(observed.body!==body||observed.title!==plan.title||!['automation','observability','outcomes'].every(name=>observed.labels.some(l=>l.name===name)))throw Error('Outcome report readback mismatch');
    result.issue=created.number;result.url=created.html_url;result.status='verified_report_created';
    for(const old of previous){await mutate('update',{owner,repo,issue_number:old.number,state:'closed'});if((await github.rest.issues.get({owner,repo,issue_number:old.number})).data.state!=='closed')throw Error('Older report closure not confirmed');}
  }
  checkpoint(result);return result;
}
