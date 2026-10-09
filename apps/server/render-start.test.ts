import test from 'node:test';
import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';
import {once} from 'node:events';
import {mkdtemp,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {request} from 'node:http';
import {fileURLToPath} from 'node:url';

test('Render startup uses a fixed HTTPS service URL, respects custom origin and never falls back to LAN', {timeout:20000},async()=>{
 const root=fileURLToPath(new URL('../../',import.meta.url));
 const directory=await mkdtemp(join(tmpdir(),'golden-render-'));
 const launch=(extra:Record<string,string>)=>spawn(process.execPath,['deploy/render-start.mjs'],{cwd:root,env:{...process.env,PORT:'0',GAME_MODE:'lan',GAME_SAVE_DIR:directory,GAME_PUBLIC_ORIGIN:'',RENDER_EXTERNAL_URL:'',...extra},stdio:['ignore','pipe','pipe']});
 const get=(address:string,path:string,host:string)=>new Promise<{status:number;body:any}>((resolve,reject)=>{
  const call=request(address+path,{headers:{host}},response=>{
   let body='';response.setEncoding('utf8');response.on('data',part=>body+=part);
   response.on('end',()=>resolve({status:response.statusCode!,body:JSON.parse(body)}));
  });
  call.on('error',reject);call.setTimeout(2000,()=>call.destroy(new Error('Render startup request timeout')));call.end();
 });
 try{
  for(const extra of [{RENDER_EXTERNAL_URL:'https://gold-trail.onrender.com'}, {RENDER_EXTERNAL_URL:'https://gold-trail.onrender.com',GAME_PUBLIC_ORIGIN:'https://play.example'}]){
   const child=launch(extra);
   try{
    const address=await new Promise<string>((resolve,reject)=>{
     let output='';child.stdout.setEncoding('utf8');child.stdout.on('data',part=>{output+=part;const match=output.match(/http:\/\/127\.0\.0\.1:\d+/);if(match)resolve(match[0]);});
     child.once('error',reject);child.once('exit',code=>reject(new Error('Render startup exited: '+code)));
    });
    const origin=extra.GAME_PUBLIC_ORIGIN||extra.RENDER_EXTERNAL_URL,host=new URL(origin).host;
    const session=await get(address,'/api/session',host);
    assert.equal(session.status,200);assert.equal(session.body.online,true);assert.equal(session.body.local,false);assert.equal(session.body.publicOrigin,origin);
    assert.equal((await get(address,'/api/game',host)).status,403);
    assert.equal((await get(address,'/api/session','evil.example')).status,403);
    assert.equal((await get(address,'/api/health','internal-probe')).status,200);
    if(extra.GAME_PUBLIC_ORIGIN)assert.equal((await get(address,'/api/session','gold-trail.onrender.com')).status,403);
   }finally{if(child.exitCode===null&&child.signalCode===null){const exited=once(child,'exit');child.kill();await exited;}}
  }
  for(const origin of ['', 'http://gold-trail.onrender.com','https://gold-trail.onrender.com/path']){
   const child=launch({RENDER_EXTERNAL_URL:origin});let output='';child.stderr.setEncoding('utf8');child.stderr.on('data',part=>output+=part);
   const [code]=await once(child,'exit');assert.notEqual(code,0);assert.match(output,/GAME_PUBLIC_ORIGIN/);
  }
 }finally{await rm(directory,{recursive:true,force:true});}
});
