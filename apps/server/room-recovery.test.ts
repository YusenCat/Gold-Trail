import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {randomUUID} from 'node:crypto';
import {RoomService} from './room-service.ts';
import {RoomSaveStore} from './room-save-store.ts';
import {RoomError} from './room-store.ts';

// Protocol recovery tests use an explicit fixture; they are not visual playtests.
for(const capacity of [2,4] as const)test(`${capacity}-player search survives disconnect and restart at response, split, question and box choice`,async()=>{
 const directory=await mkdtemp(join(tmpdir(),'golden-search-recovery-'));
 try{
  let service=new RoomService(new RoomSaveStore(directory));
  const players=Array.from({length:capacity},()=>service.store.identity());
  const created=await service.create(players[0].playerId,{nickname:'恢复房主',capacity,mode:'fixedRounds'}),id=created.room.id;
  for(let i=1;i<capacity;i++)await service.join(players[i].playerId,{nickname:'恢复玩家'+i,code:created.room.code});
  const seats=capacity===2?['smuggler','officer']:['SMUGGLER_1','OFFICER_1','SMUGGLER_2','OFFICER_2'];
  for(let i=0;i<capacity;i++)await service.action(id,players[i].playerId,'seat',{seat:seats[i],roomRevision:service.store.get(id).revision});
  for(const player of players)await service.action(id,player.playerId,'ready',{ready:true,roomRevision:service.store.get(id).revision});
  await service.action(id,players[0].playerId,'start',{roomRevision:service.store.get(id).revision});
  const game=service.store.get(id).game;
  game.activeCharacterId='OFFICER_1';game.turnIndex=1;game.phase='characterTurn';game.activeEventId=null;
  const officer=game.characters.find(c=>c.id==='OFFICER_1')!,smuggler=game.characters.find(c=>c.id==='SMUGGLER_1')!;
  officer.nodeId=smuggler.nodeId='CP_C';officer.actionPoints=4;smuggler.gold=6;smuggler.hand=['T_RESIST_SEARCH'];
  const send=(owner:number,command:Record<string,unknown>)=>service.action(id,players[owner].playerId,'command',{...command,revision:service.store.get(id).game.revision,commandId:randomUUID()},players[owner].token);
  let previous={owner:1,body:{type:'INSPECT',actorId:'OFFICER_1',targetId:'SMUGGLER_1',distance:0,revision:game.revision,commandId:randomUUID()} as Record<string,unknown>};
  await service.action(id,players[1].playerId,'command',previous.body,players[1].token);
  const stages=[
   {kind:'response',owner:0,command:{type:'PASS_RESPONSE',actorId:'SMUGGLER_1'}},
   {kind:'splitGold',owner:0,command:{type:'SPLIT_GOLD',actorId:'SMUGGLER_1',boxA:2,boxB:4}},
   {kind:'askSearchQuestion',owner:1,command:{type:'ASK_SEARCH_QUESTION',actorId:'OFFICER_1',question:'aMoreThanB'}},
   {kind:'chooseSearchBox',owner:1,command:{type:'CHOOSE_SEARCH_BOX',actorId:'OFFICER_1',box:'A'}},
  ];
  for(const stage of stages){
   const before=structuredClone(service.store.get(id).game);
   assert.equal(before.pendingDecision?.kind,stage.kind);
   await service.expire(id,Date.now()+service.timeoutMs+1);
   assert.equal(service.store.get(id).status,'paused');assert.deepEqual(service.store.get(id).game,before);
   const restored=new RoomService(new RoomSaveStore(directory));await restored.initialize();service=restored;
   assert.equal(service.store.get(id).status,'paused');assert.deepEqual(service.store.get(id).game,before);
   // A retried action whose reply was lost cannot repeat AP or gold changes after reboot.
   await service.action(id,players[previous.owner].playerId,'command',previous.body,players[previous.owner].token);
   assert.deepEqual(service.store.get(id).game,before);
   for(const player of players){
    assert.equal(service.store.identify(player.token),player.playerId);
    const view=await service.read(id,player.playerId,player.token);
    assert.equal(view.canAct,false);assert.deepEqual(view.actions,[]);
    await service.heartbeat(id,player.playerId,player.token);
   }
   await service.action(id,players[0].playerId,'resume',{roomRevision:service.store.get(id).revision},players[0].token);
   for(let i=0;i<capacity;i++){
    const view=await service.read(id,players[i].playerId,players[i].token);
    assert.equal(view.canAct,i===stage.owner);assert.equal(view.decisionPlayerId,players[stage.owner].playerId);
    // The wire representation turns the redacted NaN values into JSON nulls.
    const pending=JSON.parse(JSON.stringify(view.game!.pendingDecision));
    if(pending&&'boxA'in pending){assert.equal(pending.boxA,null);assert.equal(pending.boxB,null);}
    const hand=view.game!.characters.find(c=>c.id==='SMUGGLER_1')!.hand;
    assert.deepEqual(hand,i===0||capacity===4&&i===2?['T_RESIST_SEARCH']:['HIDDEN']);
   }
   const wrong=(stage.owner+1)%capacity;
   await assert.rejects(send(wrong,stage.command),error=>error instanceof RoomError&&error.status===403);
   const body={...stage.command,revision:service.store.get(id).game.revision,commandId:randomUUID()};
   await service.action(id,players[stage.owner].playerId,'command',body,players[stage.owner].token);
   previous={owner:stage.owner,body};
  }
  const result=service.store.get(id).game;
  assert.equal(result.pendingDecision,null);
  assert.equal(result.characters.find(c=>c.id==='OFFICER_1')!.gold,officer.gold+2);
  assert.equal(result.characters.find(c=>c.id==='SMUGGLER_1')!.gold,4);
 }finally{await rm(directory,{recursive:true,force:true});}
});
