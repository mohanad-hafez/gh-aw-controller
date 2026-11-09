const allowedPaths=new Set(['.github/workflows/cjs.yml','.github/workflows/cgo.yml','.github/workflows/CWI.yml']);
const validId=value=>Number.isSafeInteger(value)&&value>0;

export function approvalIsAllowed(run,workflow,pr){
  return validId(run.id)&&validId(run.workflow_id)&&run.event==='pull_request'&&
    (['waiting','action_required'].includes(run.status)||run.conclusion==='action_required')&&
    run.head_branch===pr.headRefName&&run.head_sha===pr.headRefOid&&
    Array.isArray(run.pull_requests)&&run.pull_requests.length>0&&run.pull_requests.every(p=>p.number===pr.number)&&
    allowedPaths.has(workflow.path)&&workflow.id===run.workflow_id;
}

export async function runController(context,dependencies){
  const {fetchQueue,formatNudge,read,write,checkpoint=()=>{}}=dependencies;
  if(context.repository!=='mohanad-hafez/gh-aw-controller')throw Error('Unexpected target repository');
  const result={phase:'deterministic_parent_controller',model_calls:0,actions:[],prs:[],status:'started'};
  const save=()=>checkpoint(result);
  const fresh=async number=>{const q=await fetchQueue(context.repository,number);if(!Array.isArray(q.prs)||!q.rate_limit)throw Error('Malformed prefilter queue');if(q.rate_limit.low)result.rate_limit_low=true;return q;};
  const initial=await fresh(context.slash?String(context.prNumber):undefined);result.initial_queue=initial;save();
  if(result.rate_limit_low){result.status='verified_noop_low_budget';save();return result;}
  if(initial.prs.length>4||initial.prs.some(p=>!validId(p.number)))throw Error('Invalid initial allowlist');
  const permitted=new Set(initial.prs.map(p=>p.number));
  const apply=async(method,path,body)=>{const operation={method,path,status:'request_started'};result.actions.push(operation);save();try{const response=await write(method,path,body);operation.status='response_received';save();return response;}catch(error){operation.status=error.deliveryUncertain?'delivery_uncertain':'failed';operation.error=error.message;save();throw error;}};
  if(context.slash){
    if(!validId(context.prNumber)||!context.isPullRequest||!['OWNER','MEMBER','COLLABORATOR'].includes(context.authorAssociation))throw Error('Slash context not authorized');
    const marker=`<!-- souschef-ack:${context.commentId} -->`;
    const comments=await read(`issues/${context.prNumber}/comments?per_page=100`,true);
    if(!comments.some(c=>c.user?.login==='github-actions[bot]'&&c.body?.includes(marker))){await apply('POST',`issues/${context.prNumber}/comments`,{body:`Acknowledged. I will check this pull request against the repository maintenance rules.\n\n${marker}`});}
  }
  let approved=0,dismissed=0,dispatched=0;
  for(const candidate of initial.prs){
    const row={number:candidate.number,status:'checking'};result.prs.push(row);save();
    try{
      const queue=await fresh(String(candidate.number));if(result.rate_limit_low)break;
      const pr=queue.prs.find(p=>p.number===candidate.number);if(!pr){row.status='skipped_after_refresh';save();continue;}
      if(!permitted.has(pr.number))throw Error('PR outside initial allowlist');
      row.approved=[];row.dismissed=[];
      for(const approval of pr.approve_runs||[]){
        if(approved>=8)break;if(!validId(approval.run_id))throw Error('Invalid approval ID');
        const run=await read(`actions/runs/${approval.run_id}`);
        const workflow=await read(`actions/workflows/${run.workflow_id}`);
        if(!approvalIsAllowed(run,workflow,pr)){row.approval_rejected=true;continue;}
        await apply('POST',`actions/runs/${run.id}/approve`);approved++;row.approved.push(run.id);
      }
      if(!context.slash)for(const id of pr.dismiss_reviews||[]){
        if(dismissed>=20)break;if(!validId(id))throw Error('Invalid review ID');
        await apply('PUT',`pulls/${pr.number}/reviews/${id}/dismissals`,{message:'All PR review threads are resolved.'});dismissed++;row.dismissed.push(id);
      }
      // Recompute after any progress, and obtain work_summary from the original formatter.
      const latest=await fresh(String(pr.number));if(result.rate_limit_low)break;
      const current=latest.prs.find(p=>p.number===pr.number);
      if(current?.nudge_needed!==false&&current&&dispatched<4){
        const body=formatNudge(current);
        if(body){await apply('POST','actions/workflows/pr-finisher.lock.yml/dispatches',{ref:'main',inputs:{pr_number:String(current.number),work_summary:body}});dispatched++;row.dispatched=true;}
      }
      row.status='processed';save();
    }catch(error){row.status='failed';row.error=error.message;save();if(error.deliveryUncertain)throw error;}
  }
  const progress=result.prs.some(r=>r.dispatched||r.approved?.length||r.dismissed?.length);
  const failed=result.prs.some(r=>r.status==='failed');
  if(!result.rate_limit_low&&(progress||failed)){
    const prefix='<!-- gh-aw-pr-sous-chef-report -->\n> ⚠️ **This is an automated status report. Do not assign this issue to a Copilot agent.**\n\n';
    const body=prefix+'### PR maintenance\n\n| PR | Dispatched | Approved runs | Dismissed reviews | Status |\n| --- | --- | --- | --- | --- |\n'+result.prs.map(r=>`| #${r.number} | ${!!r.dispatched} | ${(r.approved||[]).join(', ')} | ${(r.dismissed||[]).join(', ')} | ${r.error||r.status} |`).join('\n');
    result.report=dependencies.publishReport
      ?await dependencies.publishReport({read,write:apply,now:context.now,body,runUrl:context.runUrl})
      :await apply('POST','issues',{title:'[pr-sous-chef] '+new Date(context.now).toISOString().slice(0,10),body,labels:['automation']});
  }
  result.status=failed?'failed':result.rate_limit_low?'stopped_low_budget':progress?'progress_performed':context.slash?'acknowledged_no_progress':'verified_noop';save();return result;
}
