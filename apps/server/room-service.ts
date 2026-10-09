import type { ServerResponse } from 'node:http';
import { RoomError, RoomStore, type Room } from './room-store.ts';
import { RoomSaveStore } from './room-save-store.ts';
import { RoomEvents } from './room-events.ts';
import { roomView } from './room-view.ts';
import type { GameCommand } from '../../packages/rules/src/index.ts';
import type {MatchStatistics} from './match-statistics.ts';
import {randomBytes} from 'node:crypto';
import {RoomAuth} from './room-auth.ts';

/** Per-room serialized transactions: durable write precedes state commit and broadcast. */
export class RoomService {
  store = new RoomStore();
  events = new RoomEvents();
  saves: RoomSaveStore;
  timeoutMs: number;
  private queues = new Map<string, Promise<void>>();
  private seen = new Map<string, number>();
  private statistics?:MatchStatistics;
  auth:RoomAuth;
  constructor(saves: RoomSaveStore, timeoutMs = 20000,statistics?:MatchStatistics) { this.saves = saves; this.timeoutMs = timeoutMs;this.statistics=statistics;this.auth=new RoomAuth(saves.directory); }
  private guard(playerId:string,token?:string){if(token!==undefined&&this.store.identify(token)!==playerId)throw new RoomError('玩家凭证已失效，请在当前设备重新加入',403);}
  private key(id: string, playerId: string): string { return id + ':' + playerId; }
  private queue<T>(id: string, job: () => Promise<T> | T): Promise<T> {
    const task = (this.queues.get(id) ?? Promise.resolve()).then(job);
    const tail = task.then(() => {}, () => {}); this.queues.set(id, tail);
    void tail.then(() => { if (this.queues.get(id) === tail) this.queues.delete(id); });
    return task;
  }
  private async persist(room: Room): Promise<void> {
    await this.auth.synchronize(()=>this.store.allCredentials());
    try { await this.saves.recovery(room, this.store.credentials(room)); }
    catch { throw new RoomError('房间进度写入失败，操作未生效。请检查主机磁盘后重试', 503); }
    await this.statistics?.record(room.game).catch(e=>console.warn('房间已保存，统计稍后重试：'+e.message));
  }
  async initialize(): Promise<void> {
    const credentials=await this.auth.load();
    const recoveries=await this.saves.recoveries();
    if(credentials===null&&recoveries.some(recovery=>recovery.credentialRegistry===1))throw new Error('玩家凭证文件缺失，已停止恢复。请恢复完整备份，不能使用旧房间身份替代');
    for(const recovery of recoveries)this.store.restore(recovery.room,recovery.credentials);
    if(credentials!==null){
      if(recoveries.some(recovery=>recovery.room.members.some(member=>!credentials.some(([,id])=>id===member.playerId))))throw new Error('玩家凭证文件不完整，已停止恢复，请检查备份');
      this.store.replaceCredentials(credentials);
    }
    await this.auth.synchronize(()=>this.store.allCredentials());
    this.store.list().forEach(room=>this.store.remove(room.id));
    for (const recovery of recoveries) {
      const room = recovery.room;
      room.visibility??='private';room.inviteToken??=randomBytes(32).toString('hex');
      if (this.store.list().some((r) => r.code === room.code)) { console.warn('重复房间码，保留恢复文件但不加载：' + room.id); continue; }
      for (const member of room.members) { member.online = false; if (room.status === 'lobby') member.ready = false; }
      if (room.status === 'playing' || room.status === 'paused') { room.status = 'paused'; room.pauseReason = '主机服务已重启，等待全员重新连接'; }
      room.revision++;
      await this.saves.recovery(room, this.store.credentials(room));
      this.store.replace(room);
      await this.statistics?.record(room.game).catch(e=>console.warn('统计读取失败：'+e.message));
    }
  }
  issueTransfer(id:string,playerId:string,token?:string){return this.queue(id,()=>this.auth.issue(id,playerId,()=>this.store.allCredentials(),()=>{this.guard(playerId,token);this.store.member(this.store.get(id),playerId);}));}
  async redeemTransfer(token:unknown){
    const ticket=this.auth.ticket(token);
    return this.queue(ticket.roomId,async()=>{
      const result=await this.auth.redeem(token as string,()=>this.store.allCredentials(),ticket=>{this.store.member(this.store.get(ticket.roomId),ticket.playerId);},credentials=>this.store.replaceCredentials(credentials));
      this.events.revokePlayer(result.playerId);
      for(const room of this.store.list())this.seen.delete(this.key(room.id,result.playerId));
      return {token:result.token,view:roomView(this.store.get(result.roomId),this.store.member(this.store.get(result.roomId),result.playerId))};
    });
  }
  async create(playerId: string, body: Record<string, unknown>) {
    return this.queue('create', async () => {
      const room = this.store.create(playerId, body);
      try { await this.persist(room); } catch (error) { this.store.remove(room.id); throw error; }
      this.seen.set(this.key(room.id, playerId), Date.now());
      return roomView(room, this.store.member(room, playerId));
    });
  }
  publicRooms(){
    return {rooms:this.store.list().filter(room=>room.visibility==='public'&&room.status==='lobby'&&room.members.length<room.capacity).map(room=>({code:room.code,capacity:room.capacity,mode:room.mode,players:room.members.length}))};
  }
  async join(playerId: string, body: Record<string, unknown>,requireInvitation=false) {
    const id = this.store.byCode(body.code).id;
    const result = await this.mutate(id, playerId, (room) => {
      if(requireInvitation)this.store.authorizeInvitation(room,playerId,body.inviteToken);
      this.store.joinMember(room, playerId, body.nickname);
      const member = this.store.member(room, playerId);
      if (!member.online) { member.online = true; room.revision++; }
    }, false);
    this.seen.set(this.key(id, playerId), Date.now());
    return result;
  }
  private mutate(id: string, playerId: string, change: (room: Room) => Promise<void> | void, requireMember = true, reset = false,token?:string) {
    return this.queue(id, async () => {
      this.guard(playerId,token);
      const before = this.store.get(id);
      if (requireMember) this.store.member(before, playerId);
      const room = structuredClone(before);
      await change(room);
      if (room.revision !== before.revision) {
        await this.persist(room); this.store.replace(room); this.events.broadcast(room, reset);
      }
      return roomView(room, this.store.member(room, playerId));
    });
  }
  read(id: string, playerId: string,token?:string) {
    return this.queue(id, () => { this.guard(playerId,token);const room = this.store.get(id); return roomView(room, this.store.member(room, playerId)); });
  }
  async heartbeat(id: string, playerId: string,token?:string): Promise<void> {
    this.guard(playerId,token);
    this.store.member(this.store.get(id), playerId);
    this.seen.set(this.key(id, playerId), Date.now());
    if (!this.store.member(this.store.get(id), playerId).online) {
      await this.mutate(id, playerId, (room) => { const member = this.store.member(room, playerId); if (!member.online) { member.online = true; room.revision++; } },true,false,token);
    }
  }
  async subscribe(id: string, playerId: string, response: ServerResponse,token?:string): Promise<void> {
    await this.heartbeat(id, playerId,token);
    await this.queue(id, () => { this.guard(playerId,token);const room = this.store.get(id); this.store.member(room, playerId); this.events.attach(room, playerId, response); });
  }
  async expire(id?: string, now = Date.now()): Promise<void> {
    const ids = id ? [id] : this.store.list().map((r) => r.id);
    await Promise.all(ids.map((roomId) => this.queue(roomId, async () => {
      let before: Room; try { before = this.store.get(roomId); } catch { return; }
      const missing = before.members.filter((m) => m.online && now - (this.seen.get(this.key(roomId, m.playerId)) ?? 0) > this.timeoutMs);
      if (!missing.length) return;
      const room = structuredClone(before);
      for (const member of room.members) if (missing.some((m) => m.playerId === member.playerId)) { member.online = false; if (room.status === 'lobby') member.ready = false; }
      if (room.status === 'playing') { room.status = 'paused'; room.pauseReason = missing.map((m) => m.nickname).join('、') + '已断线，等待重新连接'; }
      room.revision++;
      await this.persist(room); this.store.replace(room); this.events.broadcast(room);
    })));
  }
  async action(id: string, playerId: string, action: string, body: Record<string, unknown>,token?:string) {
    await this.expire(id);
    if (action === 'close') {
      return this.queue(id, async () => {
        this.guard(playerId,token);
        const room = this.store.get(id), member = this.store.member(room, playerId);
        this.store.host(room, member); this.store.checkRevision(room, body.roomRevision);
        try { await this.saves.close(id); } catch { throw new RoomError('关闭房间写入失败，请重试', 503); }
        this.store.remove(id); this.events.close(id);
        for (const member of room.members) this.seen.delete(this.key(id, member.playerId));
        return { closed: true };
      });
    }
    if (action === 'leave') {
      return this.queue(id, async () => {
        this.guard(playerId,token);
        const before = this.store.get(id), room = structuredClone(before), member = this.store.member(room, playerId);
        this.store.checkRevision(room, body.roomRevision); this.store.leave(room, member);
        await this.persist(room); this.store.replace(room); this.events.broadcast(room);
        this.seen.delete(this.key(id, playerId));
        return { left: true };
      });
    }
    return this.mutate(id, playerId, async (room) => {
      const member = this.store.member(room, playerId);
      if (action !== 'command') this.store.checkRevision(room, body.roomRevision);
      if (action === 'seat') this.store.seat(room, member, body.seat);
      else if (action === 'ready') this.store.ready(room, member, body.ready);
      else if (action === 'start') this.store.start(room, member);
      else if (action === 'pause') this.store.pause(room, member);
      else if (action === 'resume') this.store.resume(room, member);
      else if (action === 'rematch') {
        this.store.host(room, member);
        if (room.status !== 'finished') throw new RoomError('结束后才能再开一局', 409);
        try { await this.saves.save(room, '上局战报', true); }
        catch (error) { if (error instanceof RoomError) throw error; throw new RoomError('战报保存失败，尚未开启新局，请检查主机磁盘', 503); }
        this.store.rematch(room, member);
      }
      else if (action === 'command') {
        if (typeof body.commandId !== 'string') throw new RoomError('请提供操作编号');
        this.store.command(room, member, body as GameCommand & { revision?: unknown; commandId?: unknown });
      } else if (action === 'load') {
        this.store.host(room, member);
        if (room.status !== 'paused') throw new RoomError('请先暂停对局，再读取存档', 409);
        const loaded = await this.saves.load(room, body.id);
        loaded.revision = Math.max(room.game.revision, loaded.revision) + 1;
        room.game = loaded; room.mode = loaded.mode; room.epoch++; room.receipts = []; room.revision++;
        room.status = loaded.phase === 'finished' ? 'finished' : 'paused'; room.pauseReason = '已读取房间存档，等待房主继续';
      } else throw new RoomError('未知房间操作', 404);
    }, true, action === 'load' || action === 'rematch',token);
  }
  listSaves(id: string, playerId: string,token?:string) {
    return this.queue(id, async () => { this.guard(playerId,token);this.store.member(this.store.get(id), playerId); return { saves: await this.saves.list(id) }; });
  }
  save(id: string, playerId: string, body: Record<string, unknown>,token?:string) {
    return this.queue(id, async () => {
      this.guard(playerId,token);
      const room = this.store.get(id), member = this.store.member(room, playerId); this.store.host(room, member);
      if (room.status === 'lobby') throw new RoomError('开始对局后才能保存');
      try { return { save: await this.saves.save(room, body.name, body.overwrite ?? false) }; }
      catch (error) { if (error instanceof RoomError) throw error; throw new RoomError('房间存档写入失败，请检查主机磁盘', 503); }
    });
  }
}
