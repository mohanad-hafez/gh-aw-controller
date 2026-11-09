import {spawn} from 'node:child_process';

const execute = (executable,args,options) => new Promise((resolve,reject) => {
  const child = spawn(executable,args,{shell:false,windowsHide:true,stdio:['pipe','pipe','pipe'],timeout:options.timeout});
  let stdout='',stderr='',size=0;
  child.stdout.on('data',chunk=>{size+=chunk.length;if(size>options.maxBuffer)child.kill();else stdout+=chunk;});
  child.stderr.on('data',chunk=>{size+=chunk.length;if(size>options.maxBuffer)child.kill();else stderr+=chunk;});
  child.on('error',reject);
  child.stdin.on('error',()=>{});
  child.on('close',(code,signal)=>{if(code===0&&!signal&&size<=options.maxBuffer)resolve({stdout,stderr});else reject(Object.assign(Error('GitHub CLI request failed'),{code,signal,stderr}));});
  child.stdin.end(options.input);
});
const target = 'mohanad-hafez/gh-aw-controller';

export function createTransport({repository, executable = 'gh', runner = execute, checkpoint = () => {}}) {
  if (repository !== target) throw Error('Unexpected target repository');
  const observations = [];
  const endpoint = path => {
    if (!/^(issues|pulls|actions|labels)(\/|\?|$)/.test(path) || path.includes('..') || /[\r\n#]/.test(path)) throw Error('Invalid repository endpoint');
    return `repos/${repository}/${path}`;
  };
  async function read(path, paginate = false) {
    const args = ['api', endpoint(path), '--method', 'GET'];
    if (paginate) args.push('--paginate', '--slurp');
    const response = await runner(executable, args, {encoding:'utf8', maxBuffer:20*1024*1024, timeout:120000});
    const parsed = JSON.parse(response.stdout);
    return paginate ? parsed.flat() : parsed;
  }
  async function write(method, path, body) {
    if (!['POST','PATCH','PUT'].includes(method)) throw Error('Unsupported mutation');
    const args = ['api', endpoint(path), '--method', method];
    // No shell, command interpolation, token arguments, or automatic mutation retries.
    if (body !== undefined) args.push('--input','-');
    return mutate(args, method, path, body === undefined ? undefined : JSON.stringify(body));
  }
  async function mutate(args, method, path, input) {
    const row = {method,path,status:'request_started'};
    observations.push(row); checkpoint(observations);
    try {
      const response = await runner(executable,args,{encoding:'utf8',maxBuffer:20*1024*1024,timeout:120000,input});
      row.status = 'response_received'; checkpoint(observations);
      return response.stdout.trim() ? JSON.parse(response.stdout) : null;
    } catch (cause) {
      // Even HTTP server failures may follow committed side effects. Preserve ambiguity.
      const status = String(cause.stderr || '').match(/HTTP (\d{3})/);
      const rejected = status && /^4\d\d$/.test(status[1]) && !['408','409'].includes(status[1]);
      row.status = rejected ? 'rejected' : 'delivery_uncertain'; checkpoint(observations);
      const error = new Error(`GitHub mutation ${row.status}: ${method} ${path}`, {cause});
      error.deliveryUncertain = !rejected;
      throw error;
    }
  }
  return {read,write,observations};
}
