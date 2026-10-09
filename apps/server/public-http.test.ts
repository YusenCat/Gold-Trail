import test from 'node:test';
import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';
import {once} from 'node:events';
import {mkdtemp,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {fileURLToPath} from 'node:url';
import {request as httpRequest} from 'node:http';

test('public HTTP behind a loopback proxy isolates local state and creates secure 2/4-player rooms', {timeout:20000},async()=>{
  const directory=await mkdtemp(join(tmpdir(),'golden-public-http-'));
  const origin='https://game.example';
  const child=spawn(process.execPath,['apps/server/server.ts'],{cwd:fileURLToPath(new URL('../../',import.meta.url)),env:{...process.env,PORT:'0',GAME_MODE:'public',GAME_PUBLIC_ORIGIN:origin,GAME_SAVE_DIR:directory},stdio:['ignore','pipe','pipe']});
  try{
    const address=await new Promise<string>((resolve,reject)=>{
      let output='';child.stdout.setEncoding('utf8');child.stdout.on('data',data=>{output+=data;const match=output.match(/http:\/\/127\.0\.0\.1:\d+/);if(match)resolve(match[0]);});
      child.once('error',reject);child.once('exit',code=>reject(new Error('Server exited: '+code)));
    });
    const request=(path:string,body?:unknown,headers:Record<string,string>={})=>new Promise<{status:number;headers:{get:(key:string)=>string|null};json:()=>Promise<any>}>((resolve,reject)=>{
      const call=httpRequest(address+path,{method:body===undefined?'GET':'POST',headers:{host:'game.example',...(body===undefined?{}:{origin,'content-type':'application/json'}),...headers}},response=>{
        let text='';response.setEncoding('utf8');response.on('data',data=>text+=data);response.on('end',()=>resolve({status:response.statusCode!,headers:{get:key=>{const value=response.headers[key];return Array.isArray(value)?value.join(','):value??null;}},json:async()=>JSON.parse(text)}));
      });
      call.on('error',reject);call.setTimeout(3000,()=>call.destroy(new Error('HTTP test timeout')));call.end(body===undefined?undefined:JSON.stringify(body));
    });
    const session=await (await request('/api/session')).json();
    assert.equal(session.local,false);assert.equal(session.online,true);assert.equal(session.publicOrigin,origin);assert.deepEqual(session.lanAddresses,[]);
    for(const path of ['/api/game','/api/game/statistics','/api/game/tutorial','/api/saves'])assert.equal((await request(path)).status,403,path);
    for(const path of ['/api/game/new','/api/game/tutorial/new','/api/saves'])assert.equal((await request(path,{})).status,403,path);
    assert.equal((await request('/api/session',undefined,{host:'evil.example','x-forwarded-host':'game.example'})).status,403);
    assert.equal((await request('/api/rooms',{},{origin:'https://evil.example'})).status,403);
    assert.equal((await request('/api/rooms',{},{origin:''})).status,403);
    assert.equal((await request('/api/rooms',{},{origin:'http://game.example'})).status,403);
    for(const capacity of [2,4]){
      const response=await request('/api/rooms',{nickname:'公网房主',capacity,mode:'fixedRounds'});
      assert.equal(response.status,201);assert.match(response.headers.get('set-cookie')??'',/HttpOnly; SameSite=Strict.*; Secure/);
      const {room}=await response.json();assert.equal(room.capacity,capacity);assert.equal(room.visibility,'private');
      assert.match(room.inviteToken,/^[a-f0-9]{64}$/);
      assert.equal((await request('/api/rooms/join',{nickname:'无邀请',code:room.code})).status,403);
      assert.equal((await request('/api/rooms/join',{nickname:'错误邀请',code:room.code,inviteToken:'0'.repeat(64)})).status,403);
      assert.equal((await request('/api/rooms/'+room.id,undefined,{cookie:'golden_player='+room.inviteToken})).status,403);
      const joined=await request('/api/rooms/join',{nickname:'邀请朋友',code:room.code,inviteToken:room.inviteToken});assert.equal(joined.status,200,joined.status===200?'':JSON.stringify(await joined.json()));
      const cookie=joined.headers.get('set-cookie')!.split(';')[0];
      assert.equal((await request('/api/rooms/join',{nickname:'重连朋友',code:room.code}, {cookie})).status,200);
      const issued=await (await request('/api/rooms/'+room.id+'/transfer',{}, {cookie})).json();
      const moved=await request('/api/rooms/transfer',{token:issued.token});assert.equal(moved.status,200);assert.match(moved.headers.get('set-cookie')??'',/; Secure/);
      const nextCookie=moved.headers.get('set-cookie')!.split(';')[0],view=await moved.json();
      assert.equal((await request('/api/rooms/'+room.id,undefined,{cookie})).status,403);
      assert.equal((await request('/api/rooms/'+room.id,undefined,{cookie:nextCookie})).status,200);
      assert.equal((await request('/api/rooms/transfer',{token:issued.token})).status,403);
      assert.equal((await request('/api/rooms/'+room.id+'/transfer',{}, {cookie})).status,403);
      assert.equal(view.room.id,room.id);
    }
    assert.deepEqual((await (await request('/api/rooms')).json()).rooms,[]);
    const open=await (await request('/api/rooms',{nickname:'公开房主',capacity:2,mode:'race',visibility:'public'})).json();
    const list=await (await request('/api/rooms')).json();assert.deepEqual(list.rooms,[{code:open.room.code,capacity:2,mode:'race',players:1}]);
    assert.equal((await request('/api/rooms/join',{nickname:'大厅来客',code:open.room.code})).status,200);
    assert.deepEqual((await (await request('/api/rooms')).json()).rooms,[]);
    const health=await request('/api/health',undefined,{host:'internal-probe'});assert.equal(health.status,200);assert.equal((await health.json()).online,true);
    const css=await request('/scene.css');assert.equal(css.status,200);assert.match(css.headers.get('content-type')??'',/text\/css/);assert.equal(css.headers.get('x-content-type-options'),'nosniff');
  }finally{
    if(child.exitCode===null){const closed=once(child,'exit');child.kill();await closed;}
    await rm(directory,{recursive:true,force:true});
  }
});
