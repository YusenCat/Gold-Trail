import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,rm,readFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {RoomService} from './room-service.ts';
import {RoomSaveStore} from './room-save-store.ts';
const day=24*60*60*1000;
async function temporary(job:(directory:string)=>Promise<void>){const directory=await mkdtemp(join(tmpdir(),'golden-lifecycle-'));try{await job(directory);}finally{await rm(directory,{recursive:true,force:true});}}
test('idle lobbies and finished rooms archive without deleting records; unfinished games survive maintenance and restart',async()=>temporary(async directory=>{
  const service=new RoomService(new RoomSaveStore(directory));await service.initialize();
  const lobbyHost=service.store.identity(),host=service.store.identity(),guest=service.store.identity(),finishedHost=service.store.identity();
  const lobby=await service.create(lobbyHost.playerId,{nickname:'候场',capacity:2,mode:'race'});
  const active=await service.create(host.playerId,{nickname:'待恢复',capacity:2,mode:'race'});await service.join(guest.playerId,{nickname:'同伴',code:active.room.code});
  const id=active.room.id;
  for(const [playerId,seat] of [[host.playerId,'smuggler'],[guest.playerId,'officer']])await service.action(id,playerId,'seat',{seat,roomRevision:service.store.get(id).revision});
  for(const player of [host,guest])await service.action(id,player.playerId,'ready',{ready:true,roomRevision:service.store.get(id).revision});
  await service.action(id,host.playerId,'start',{roomRevision:service.store.get(id).revision});const game=structuredClone(service.store.get(id).game);
  const finished=await service.create(finishedHost.playerId,{nickname:'完局',capacity:2,mode:'fixedRounds'});
  // Lifecycle fixture: rule adjudication is independently tested; exercise a finished record here.
  const ended=service.store.get(finished.room.id);ended.status='finished';ended.game.phase='finished';ended.game.winner='draw';
  const now=Date.now();await service.maintain(now+2*day);
  assert.throws(()=>service.store.get(lobby.room.id),/不存在/);
  assert.equal(service.store.get(finished.room.id).status,'finished');assert.equal(service.store.get(id).status,'paused');assert.deepEqual(service.store.get(id).game,game);
  const archived=JSON.parse(await readFile(join(directory,lobby.room.id,'recovery.json'),'utf8'));
  assert.equal(archived.closed,true);assert.equal(archived.room.id,lobby.room.id);assert.ok(archived.credentials.length);assert.ok(archived.archivedAt);
  assert.equal(service.store.identify(lobbyHost.token),undefined);
  await service.maintain(now+8*day);assert.throws(()=>service.store.get(finished.room.id),/不存在/);assert.deepEqual(service.store.get(id).game,game);
  const restored=new RoomService(new RoomSaveStore(directory));await restored.initialize();assert.deepEqual(restored.store.list().map(room=>room.id),[id]);assert.deepEqual(restored.store.get(id).game,game);
  assert.equal(restored.store.identify(host.token),host.playerId);assert.equal(restored.store.identify(finishedHost.token),undefined);
}));
test('archive write failure leaves the room and credentials available for retry',async()=>temporary(async directory=>{
  class FailingArchive extends RoomSaveStore{fail=false;async close(id:string,...rest:Parameters<RoomSaveStore['close']> extends [string,...infer R]?R:never){if(this.fail)throw new Error('disk failure');return super.close(id,...rest);}}
  const saves=new FailingArchive(directory),service=new RoomService(saves);const player=service.store.identity();
  const view=await service.create(player.playerId,{nickname:'候场',capacity:2,mode:'race'});await service.expire(view.room.id,Date.now()+2*day);saves.fail=true;
  await assert.rejects(service.maintain(Date.now()+2*day),/归档失败/);assert.equal(service.store.get(view.room.id).members.length,1);assert.equal(service.store.identify(player.token),player.playerId);
  saves.fail=false;await service.maintain(Date.now()+2*day);assert.throws(()=>service.store.get(view.room.id),/不存在/);
}));
test('failed-entry identities are reclaimed while in-flight identities and live room members remain valid',async()=>temporary(async directory=>{
  const service=new RoomService(new RoomSaveStore(directory));await service.initialize();
  const pending=service.store.identity();service.store.retainIdentity(pending.playerId);
  for(let count=0;count<300;count++){
    const rejected=service.store.identity();service.store.retainIdentity(rejected.playerId);
    await assert.rejects(service.create(rejected.playerId,{nickname:'',capacity:2,mode:'race'}));service.store.releaseIdentity(rejected.playerId);await service.cleanupIdentities();assert.equal(service.store.identify(rejected.token),undefined);
  }
  assert.equal(service.store.identify(pending.token),pending.playerId);
  const view=await service.create(pending.playerId,{nickname:'有效玩家',capacity:2,mode:'race'},pending.token);service.store.releaseIdentity(pending.playerId);await service.cleanupIdentities();
  assert.equal((await service.read(view.room.id,pending.playerId,pending.token)).me.playerId,pending.playerId);assert.equal(service.store.allCredentials().length,1);
}));
