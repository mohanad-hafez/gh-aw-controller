import fs from 'node:fs';
import crypto from 'node:crypto';
import zlib from 'node:zlib';
import {execFileSync} from 'node:child_process';

export const requiredBenchmarks=['CompileSimpleWorkflow','CompileComplexWorkflow','CompileMCPWorkflow','CompileMemoryUsage','ParseWorkflow','Validation','YAMLGeneration','ExtractWorkflowNameFromFile','FindIncludesInContent'];
export function parseBenchmarks(text){
  const benchmarks={};
  const regex=/^Benchmark(.+)-\d+\s+(\d+)\s+([\d.eE+-]+) ns\/op\s+(\d+) B\/op\s+(\d+) allocs\/op\s*$/;
  for(const line of text.split(/\r?\n/)){
    const m=line.match(regex);if(!m)continue;
    if(benchmarks[m[1]])throw Error('Repeated benchmark '+m[1]);
    const [iterations,ns,bytes,allocs]=m.slice(2).map(Number);
    if(!Number.isFinite(ns)||ns<=0||iterations<=0)throw Error('Invalid measurement');
    benchmarks[m[1]]={iterations,ns_per_op:ns,bytes_per_op:bytes,allocs_per_op:allocs};
  }
  for(const name of requiredBenchmarks)if(!Object.keys(benchmarks).some(k=>k===name||k.startsWith(name+'/')))throw Error('Missing benchmark '+name);
  if((text.match(/^ok\s+github\.com\/github\/gh-aw\/pkg\/(workflow|cli)\s/gm)||[]).length!==2||/^FAIL/m.test(text))throw Error('Incomplete benchmark packages');
  return benchmarks;
}
export function appendHistory(text,current){
  const history=[],dropped=[];
  for(const [index,line] of text.split(/\r?\n/).entries()){
    if(!line.trim())continue;
    try{const entry=JSON.parse(line);if(!entry||typeof entry!=='object'||Array.isArray(entry)||!entry.benchmarks)throw Error('Invalid entry');
      for(const value of Object.values(entry.benchmarks))if(!Number.isFinite(value.ns_per_op)||value.ns_per_op<=0)throw Error('Invalid ns/op');
      history.push(entry);
    }catch{dropped.push(index+1);}
  }
  if(history.some(e=>e.run_id===current.run_id))throw Error('Run already persisted; inspect, do not replay');
  return {history:[...history,current].slice(-14),dropped_lines:dropped};
}
export function processMetrics(raw,historyText,runId,now=new Date()){
  const dir='/tmp/gh-aw/agent/benchmarks',memory='/tmp/gh-aw/repo-memory/default';
  fs.mkdirSync(dir,{recursive:true});fs.mkdirSync(memory,{recursive:true});
  const current={timestamp:now.toISOString(),date:now.toISOString().slice(0,10),run_id:String(runId),benchmarks:parseBenchmarks(raw)};
  const updated=appendHistory(historyText,current);
  const history=updated.history.map(e=>JSON.stringify(e)).join('\n')+'\n';
  if(Buffer.byteLength(history)>131072)throw Error('History exceeds source memory bound');
  fs.writeFileSync(memory+'/benchmark_history.jsonl',history);
  fs.writeFileSync(dir+'/current_metrics.json',JSON.stringify(current,null,2));
  const analyzer=zlib.gunzipSync(fs.readFileSync('.github/data/analyze_trends.py.gz'));
  if(crypto.createHash('sha256').update(analyzer).digest('hex')!=='5a5fdd983c94bef99620f60d39e6bcc9cdcac929db52a2128627416e722ff4f9')throw Error('Analyzer hash mismatch');
  fs.writeFileSync(dir+'/analyze_trends.py',analyzer);
  execFileSync('python3',[dir+'/analyze_trends.py'],{stdio:'inherit'});
  return {current,history,analysis:JSON.parse(fs.readFileSync(dir+'/analysis.json','utf8')),history_audit:{entries:updated.history.length,dropped_lines:updated.dropped_lines,current_in_baseline:true}};
}
