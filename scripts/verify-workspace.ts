import {Store} from '../server/store.ts';
import {createApp} from '../server/app.ts';
import {setAccessCode} from '../server/workspace.ts';
import {readFileSync,writeFileSync,mkdirSync} from 'node:fs';
import type {AddressInfo} from 'node:net';
const store=new Store(':memory:');setAccessCode(store,'owner','synthetic-owner-code');setAccessCode(store,'maya','synthetic-member-code');
const app=createApp(store,{aiToken:readFileSync('.local/n8n-token.bin','utf8').trim()}).listen(0,'127.0.0.1');await new Promise<void>(r=>app.on('listening',r));const base=`http://127.0.0.1:${(app.address() as AddressInfo).port}/api`;const headers={'content-type':'application/json','x-allowance-client':'local-prototype'};
async function post(path:string,body:any,cookie=''){const response=await fetch(base+path,{method:'POST',headers:{...headers,cookie},body:JSON.stringify(body)});return {response,value:await response.json()};}
const results:any[]=[];
try{
 for(const item of [{person:'owner',code:'synthetic-owner-code',message:'Help me define Maya’s profile. She creates the assigned visual identity, buys licensed creative assets only, and has a total allowance of 60 XLM. Propose her description and budget for my review.'},{person:'maya',code:'synthetic-member-code',message:'I need a commercial font license from Type Foundry for 25 XLM for my assigned launch identity. The quote link is https://typefoundry.example/quote/font25. Prepare the purchase request for me to review.'},{person:'owner',code:'synthetic-owner-code',message:'Give me an update on pending requests, spending so far, and who needs my attention. Do not propose changes.'}]){
  const login=await post('/session',{personId:item.person,code:item.code});const cookie=login.response.headers.get('set-cookie')!.split(';')[0];const result=await post('/assistant',{message:item.message},cookie);const ok=result.response.ok&&!!result.value.model;results.push({case:item.person==='maya'?'member purchase draft':results.length?'owner status update':'owner profile proposal',passed:ok,result:result.value});console.log(JSON.stringify({case:results.at(-1).case,passed:ok,model:result.value.model,error:result.value.error}));
 }
 const login=await post('/session',{personId:'owner',code:'synthetic-owner-code'});const cookie=login.response.headers.get('set-cookie')!.split(';')[0];const inspect=await post('/testnet/inspect',{},cookie);results.push({case:'Current event Noir contract inspection',status:inspect.response.status,result:inspect.value});console.log(JSON.stringify(inspect.value));
 mkdirSync('.local/verification',{recursive:true});writeFileSync('.local/verification/workspace-2026-11-05.json',JSON.stringify({recordedAt:new Date().toISOString(),scope:'Synthetic in-memory workspace; real Relmio AI; read-only Testnet inspection. No blockchain write.',results},null,2));
 if(results.slice(0,3).some(r=>!r.passed))process.exitCode=1;
}finally{await new Promise<void>(r=>app.close(()=>r()));store.close();}
