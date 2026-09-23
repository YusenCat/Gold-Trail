import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { once } from 'node:events';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

test('HTTP solo game enforces ownership and revision and hands bot turns back to the player', { timeout: 20000 }, async () => {
  const saveDirectory = await mkdtemp(join(tmpdir(), 'golden-post-road-test-'));
  const child = spawn(process.execPath, ['apps/server/server.ts'], { cwd:fileURLToPath(new URL('../../',import.meta.url)), env:{...process.env,PORT:'0',GAME_SAVE_DIR:saveDirectory}, stdio:['ignore','pipe','pipe'] });
  try {
    const address = await new Promise<string>((resolve,reject) => {
      let output='';
      child.stdout.setEncoding('utf8');
      child.stdout.on('data',(chunk)=>{output+=chunk;const match=output.match(/http:\/\/127\.0\.0\.1:\d+/);if(match)resolve(match[0]);});
      child.once('error',reject);
      child.once('exit',(code)=>reject(new Error('Server exited: '+code)));
    });
    const request = async(path:string,body?:unknown) => {
      const response=await fetch(address+path,body===undefined?{}:{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(body)});
      return { status:response.status, value:await response.json() };
    };
    const invalid=await request('/api/game/new',null);assert.equal(invalid.status,400);
    let result=await request('/api/game/new',{kind:'solo',humanFaction:'officer',mode:'fixedRounds',seed:7,start:true});
    assert.equal(result.status,201);assert.equal(result.value.botPending,true);assert.deepEqual(result.value.actions,[]);
    const revision=result.value.game.revision;
    const reject=await request('/api/game/command',{type:'END_TURN',actorId:'SMUGGLER_1',revision});
    assert.equal(reject.status,400);
    result=await request('/api/game/bot-step',{revision});
    assert.equal(result.status,200);
    assert.equal((await request('/api/game/bot-step',{revision})).status,400);
    for(let i=0;i<30 && result.value.botPending;i++)result=await request('/api/game/bot-step',{revision:result.value.game.revision});
    assert.equal(result.value.botPending,false);
    assert.ok(result.value.actions.length>0);
    assert.equal(result.value.game.characters.find((c:{id:string})=>c.id===result.value.decisionActorId).faction,'officer');
    const action=result.value.actions.find((a:{command:{type:string}})=>a.command.type==='END_TURN');
    assert.ok(action);
    result=await request('/api/game/command',{...action.command,revision:result.value.game.revision});
    assert.equal(result.status,200);
    assert.deepEqual(result.value.game.eventDeck,[]);
    const savedA=await request('/api/saves',{name:'人机 存档（甲）'});
    assert.equal(savedA.status,201);
    assert.equal((await request('/api/saves',{name:'人机 存档（甲）'})).status,409);
    assert.equal((await request('/api/game')).value.game.mode,'fixedRounds');
    assert.equal((await request('/api/game/new',{kind:'hotseat',mode:'race',seed:99,start:true})).status,201);
    const savedB=await request('/api/saves',{name:'双人-存档_乙'});
    assert.equal(savedB.status,201);
    assert.equal((await request('/api/saves/load',{id:'不存在的档'})).status,404);
    assert.equal((await request('/api/game')).value.game.mode,'race');
    const saveList=await request('/api/saves');
    assert.equal(saveList.value.saves.length,2);
    const loaded=await request('/api/saves/load',{id:savedA.value.save.id});
    assert.equal(loaded.status,200);
    assert.equal(loaded.value.game.mode,'fixedRounds');
    assert.equal(loaded.value.game.session.humanFaction,'officer');
    const rules=await request('/api/rules');assert.match(rules.value.text,/本地人机/);
    const html=await (await fetch(address+'/')).text();
    assert.match(html,/screen-home/);assert.match(html,/screen-library/);assert.match(html,/screen-setup/);
  } finally {
    const closed=once(child,'exit');
    if(child.exitCode===null){child.kill();await closed;}
    await rm(saveDirectory,{recursive:true,force:true});
  }
});
