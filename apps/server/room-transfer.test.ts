import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,rm,readFile,rename,mkdir,writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {randomUUID,createHash} from 'node:crypto';
import {RoomService} from './room-service.ts';
import {RoomSaveStore} from './room-save-store.ts';
import {RoomAuth} from './room-auth.ts';
import {EventEmitter} from 'node:events';
import type {ServerResponse} from 'node:http';
const digest=(value:string)=>createHash('sha256').update(value).digest('hex');
async function temporary(job:(directory:string)=>Promise<void>){const directory=await mkdtemp(join(tmpdir(),'golden-transfer-'));try{await job(directory);}finally{await rm(directory,{recursive:true,force:true});}}
test('one-time device exchange revokes all old credentials and streams, preserving seats and game across restart',async()=>temporary(async directory=>{
  const service=new RoomService(new RoomSaveStore(directory));await service.initialize();
  const host=service.store.identity(),guest=service.store.identity(),other=service.store.identity();
  const first=await service.create(host.playerId,{nickname:'房主',capacity:2,mode:'fixedRounds'});
  await service.join(guest.playerId,{nickname:'朋友',code:first.room.code});const id=first.room.id;
  for(const [playerId,seat] of [[host.playerId,'smuggler'],[guest.playerId,'officer']])await service.action(id,playerId,'seat',{seat,roomRevision:service.store.get(id).revision});
  for(const player of [host,guest])await service.action(id,player.playerId,'ready',{ready:true,roomRevision:service.store.get(id).revision});
  await service.action(id,host.playerId,'start',{roomRevision:service.store.get(id).revision});
  const second=await service.create(other.playerId,{nickname:'另一房主',capacity:4,mode:'race'});await service.join(host.playerId,{nickname:'跨房玩家',code:second.room.code});
  const original=structuredClone(service.store.get(id).game);
  class Stream extends EventEmitter{destroyed=false;writableLength=0;body='';writeHead(){}write(text:string){this.body+=text;return true;}end(){this.emit('close');}destroy(){this.destroyed=true;this.emit('close');}}
  const stream=new Stream();await service.subscribe(id,host.playerId,stream as unknown as ServerResponse,host.token);
  const cancelled=await service.issueTransfer(id,host.playerId,host.token),ticket=await service.issueTransfer(id,host.playerId,host.token);
  await assert.rejects(service.redeemTransfer(cancelled.token),/无效或已过期/);
  const results=await Promise.allSettled([service.redeemTransfer(ticket.token),service.redeemTransfer(ticket.token)]);
  assert.equal(results.filter(result=>result.status==='fulfilled').length,1);
  const migrated=(results.find(result=>result.status==='fulfilled') as PromiseFulfilledResult<Awaited<ReturnType<RoomService['redeemTransfer']>>>).value;
  assert.equal(migrated.view.me.playerId,host.playerId);assert.deepEqual(migrated.view.me.characterIds,['SMUGGLER_1','SMUGGLER_2']);
  assert.equal(service.store.identify(host.token),undefined);assert.equal(service.store.identify(migrated.token),host.playerId);assert.match(stream.body,/device_changed/);
  await assert.rejects(service.read(id,host.playerId,host.token),/凭证已失效/);
  await assert.rejects(service.action(id,host.playerId,'command',{type:'END_TURN',actorId:'SMUGGLER_1',revision:original.revision,commandId:randomUUID()},host.token),/凭证已失效/);
  assert.deepEqual(service.store.get(id).game,original);
  const saved=await readFile(join(directory,'credentials.json'),'utf8');assert.ok(!saved.includes(ticket.token));assert.ok(!saved.includes(migrated.token));assert.ok(!saved.includes(digest(host.token!)));
  // Existing room recovery still contains its earlier token hash: registry must override it.
  assert.ok((await readFile(join(directory,second.room.id,'recovery.json'),'utf8')).includes(digest(host.token!)));
  const restored=new RoomService(new RoomSaveStore(directory));await restored.initialize();
  assert.equal(restored.store.identify(host.token),undefined);assert.equal(restored.store.identify(migrated.token),host.playerId);
  assert.deepEqual(restored.store.get(id).game,original);assert.equal(restored.store.get(id).status,'paused');
  assert.equal((await restored.read(second.room.id,host.playerId,migrated.token)).me.playerId,host.playerId);
  await assert.rejects(restored.redeemTransfer(ticket.token),/无效或已过期/);
  await assert.rejects(restored.issueTransfer(id,other.playerId,other.token),/不属于/);
  await rm(join(directory,'credentials.json'));
  const missing=new RoomService(new RoomSaveStore(directory));await assert.rejects(missing.initialize(),/凭证文件缺失/);assert.equal(missing.store.identify(host.token),undefined);
}));
test('expired transfer links fail and disk failure neither consumes ticket nor revokes the original credential',async()=>temporary(async directory=>{
  const auth=new RoomAuth(directory),playerId=randomUUID(),roomId=randomUUID(),oldToken='a'.repeat(64);let credentials:Array<[string,string]>=[[digest(oldToken),playerId]];
  const expired=await auth.issue(roomId,playerId,()=>credentials,()=>{},1000);
  await assert.rejects(auth.redeem(expired.token,()=>credentials,()=>{},next=>credentials=next,expired.expiresAt),/无效或已过期/);
  const ticket=await auth.issue(roomId,playerId,()=>credentials,()=>{});
  const path=join(directory,'credentials.json'),backup=join(directory,'credentials.backup');await rename(path,backup);await mkdir(path);
  await assert.rejects(auth.redeem(ticket.token,()=>credentials,()=>{},next=>credentials=next),/保存失败/);
  assert.deepEqual(credentials,[[digest(oldToken),playerId]]);assert.equal(auth.ticket(ticket.token).playerId,playerId);
  await rm(path,{recursive:true});await rename(backup,path);
  const next=await auth.redeem(ticket.token,()=>credentials,()=>{},value=>credentials=value);
  assert.equal(credentials[0][0],digest(next.token));assert.equal(credentials.length,1);
}));
test('corrupt authoritative credentials fail closed rather than restoring revoked hashes from room snapshots',async()=>temporary(async directory=>{
  await writeFile(join(directory,'credentials.json'),'{broken');const service=new RoomService(new RoomSaveStore(directory));
  await assert.rejects(service.initialize(),/凭证文件无法读取/);assert.equal(await readFile(join(directory,'credentials.json'),'utf8'),'{broken');assert.deepEqual(service.store.allCredentials(),[]);
}));
