import { randomBytes, randomUUID, createHash } from 'node:crypto';
import { applyCommand, createInitialGame, startGame, type GameCommand, type GameState, type Faction, type Mode } from '../../packages/rules/src/index.ts';

export class RoomError extends Error {
  status: number;
  constructor(message: string, status = 400) { super(message); this.status = status; }
}
export interface RoomMember {
  playerId: string;
  nickname: string;
  seat: string | null;
  ready: boolean;
  online: boolean;
}
export interface Room {
  id: string;
  code: string;
  capacity: 2 | 4;
  mode: Mode;
  hostId: string;
  revision: number;
  status: 'lobby' | 'playing' | 'paused' | 'finished';
  pauseReason: string | null;
  epoch: number;
  receipts: Array<{ id: string; playerId: string; fingerprint: string }>;
  members: RoomMember[];
  game: GameState;
}
const characterIds = ['SMUGGLER_1', 'OFFICER_1', 'SMUGGLER_2', 'OFFICER_2'];
const digest = (token: string) => createHash('sha256').update(token).digest('hex');
export function ownedCharacters(room: Room, member: RoomMember): string[] {
  if (!member.seat) return [];
  return room.capacity === 2
    ? characterIds.filter((id) => id.startsWith(member.seat!.toUpperCase() + '_'))
    : [member.seat];
}
export function memberFaction(room: Room, member: RoomMember): Faction | undefined {
  const id = ownedCharacters(room, member)[0];
  return id ? (id.startsWith('SMUGGLER') ? 'smuggler' : 'officer') : undefined;
}
function nickname(value: unknown): string {
  if (typeof value !== 'string') throw new RoomError('请输入昵称');
  const name = value.trim().normalize('NFC');
  if (!name || [...name].length > 24 || /[\u0000-\u001f\u007f]/u.test(name)) throw new RoomError('昵称需为一至二十四个字符');
  return name;
}

/** Room mutations are synchronous: seat claims and revision checks commit together. */
export class RoomStore {
  private rooms = new Map<string, Room>();
  private identities = new Map<string, string>();
  list(): Room[] { return [...this.rooms.values()]; }
  replace(room: Room): void { this.rooms.set(room.id, room); }
  remove(id: string): void { this.rooms.delete(id); }
  credentials(room: Room): Array<[string, string]> {
    return [...this.identities.entries()].filter(([, playerId]) => room.members.some((m) => m.playerId === playerId));
  }
  restore(room: Room, credentials: Array<[string, string]>): void {
    this.replace(room);
    for (const [hash, id] of credentials) this.identities.set(hash, id);
  }
  byCode(code: unknown): Room {
    if (typeof code !== 'string') throw new RoomError('请输入房间码');
    const room = this.list().find((r) => r.code === code.trim().toUpperCase());
    if (!room) throw new RoomError('房间不存在，请检查房间码', 404);
    return room;
  }

  identify(token?: string): string | undefined {
    return token && /^[a-f0-9]{64}$/.test(token) ? this.identities.get(digest(token)) : undefined;
  }
  identity(token?: string): { playerId: string; token?: string } {
    const existing = this.identify(token);
    if (existing) return { playerId: existing };
    if (this.identities.size >= 256) throw new RoomError('本次服务的玩家数已达上限，请重启服务后重试', 429);
    const next = randomBytes(32).toString('hex'), playerId = randomUUID();
    this.identities.set(digest(next), playerId);
    return { playerId, token: next };
  }
  create(playerId: string, body: { nickname?: unknown; capacity?: unknown; mode?: unknown }): Room {
    const name = nickname(body.nickname);
    if (body.capacity !== 2 && body.capacity !== 4) throw new RoomError('请选择二人或四人房间');
    if (body.mode !== 'race' && body.mode !== 'fixedRounds') throw new RoomError('胜负方式无效');
    if (this.rooms.size >= 32) throw new RoomError('房间数量已达上限，请先关闭不用的房间', 429);
    if ([...this.rooms.values()].some((r) => r.hostId === playerId && r.status !== 'finished')) throw new RoomError('你已有房间，请先返回或关闭它', 409);
    let code: string;
    do { code = randomBytes(4).toString('hex').slice(0, 6).toUpperCase(); }
    while ([...this.rooms.values()].some((r) => r.code === code));
    const game = createInitialGame(randomBytes(4).readUInt32LE(), body.mode);
    game.session.kind = 'lan';
    const room: Room = {
      id: randomUUID(), code, capacity: body.capacity, mode: body.mode, hostId: playerId,
      revision: 1, status: 'lobby', game,
      pauseReason: null, epoch: 1, receipts: [],
      members: [{ playerId, nickname: name, seat: null, ready: false, online: true }],
    };
    this.rooms.set(room.id, room);
    return room;
  }
  join(playerId: string, body: { nickname?: unknown; code?: unknown }): Room {
    const room = this.byCode(body.code);
    return this.joinMember(room, playerId, body.nickname);
  }
  joinMember(room: Room, playerId: string, rawName: unknown): Room {
    const name = nickname(rawName);
    if (room.members.some((m) => m.playerId === playerId)) return room;
    if (room.status !== 'lobby') throw new RoomError('对局已经开始，不能中途加入', 409);
    if (room.members.length >= room.capacity) throw new RoomError('房间已满', 409);
    room.members.push({ playerId, nickname: name, seat: null, ready: false, online: true });
    this.changed(room);
    return room;
  }
  get(id: string): Room {
    const room = this.rooms.get(id);
    if (!room) throw new RoomError('房间不存在或已关闭', 404);
    return room;
  }
  member(room: Room, playerId?: string): RoomMember {
    const member = room.members.find((m) => m.playerId === playerId);
    if (!member) throw new RoomError('你不属于这个房间，请先加入', 403);
    return member;
  }
  checkRevision(room: Room, revision: unknown): void {
    if (revision !== room.revision) throw new RoomError('房间已更新，请刷新后重试', 409);
  }
  private lobby(room: Room): void {
    if (room.status !== 'lobby') throw new RoomError('开始后不能更换角色或准备状态', 409);
  }
  private changed(room: Room): void {
    room.revision++;
    for (const member of room.members) member.ready = false;
  }
  seat(room: Room, member: RoomMember, seat: unknown): void {
    this.lobby(room);
    const seats = room.capacity === 2 ? ['smuggler', 'officer'] : characterIds;
    if (seat !== null && (typeof seat !== 'string' || !seats.includes(seat))) throw new RoomError('席位无效');
    if (seat !== null && room.members.some((m) => m !== member && m.seat === seat)) throw new RoomError('这个席位已被选择', 409);
    if (member.seat !== seat) { member.seat = seat as string | null; this.changed(room); }
  }
  ready(room: Room, member: RoomMember, ready: unknown): void {
    this.lobby(room);
    if (typeof ready !== 'boolean') throw new RoomError('准备状态无效');
    if (!member.seat) throw new RoomError('请先选择阵营或角色');
    if (member.ready !== ready) { member.ready = ready; room.revision++; }
  }
  host(room: Room, member: RoomMember): void {
    if (member.playerId !== room.hostId) throw new RoomError('只有房主可以执行这个操作', 403);
  }
  start(room: Room, member: RoomMember): void {
    this.host(room, member); this.lobby(room);
    if (room.members.length !== room.capacity || !room.members.every((m) => m.seat && m.ready && m.online)) throw new RoomError('需要满员在线、选位并且全员准备');
    room.game = startGame(room.game);
    room.status = 'playing'; room.revision++;
  }
  command(room: Room, member: RoomMember, command: GameCommand & { revision?: unknown; commandId?: unknown }): void {
    if (!ownedCharacters(room, member).includes(command.actorId)) throw new RoomError('只能操控分配给你的角色', 403);
    const id = command.commandId;
    if (id !== undefined && (typeof id !== 'string' || !/^[a-zA-Z0-9_-]{8,100}$/.test(id))) throw new RoomError('操作编号无效');
    const fingerprint = createHash('sha256').update(JSON.stringify(Object.keys(command).sort().map((key) => [key, command[key]]))).digest('hex');
    const receipt = id && room.receipts.find((r) => r.id === id && r.playerId === member.playerId);
    if (receipt) {
      if (receipt.fingerprint !== fingerprint) throw new RoomError('同一操作编号不能用于不同操作', 409);
      return;
    }
    if (room.status !== 'playing') throw new RoomError('当前没有进行中的对局', 409);
    if (!room.members.every((m) => m.online)) throw new RoomError('请等待所有成员重新连接', 409);
    if (command.revision !== room.game.revision) throw new RoomError('局面已更新，请刷新后重试', 409);
    const next = applyCommand(room.game, command);
    room.game = next; room.revision++;
    if (next.phase === 'finished') room.status = 'finished';
    if (typeof id === 'string') {
      room.receipts.push({ id, playerId: member.playerId, fingerprint });
      room.receipts = room.receipts.slice(-1024);
    }
  }
  pause(room: Room, member: RoomMember): void {
    this.host(room, member);
    if (room.status !== 'playing') throw new RoomError('当前不能暂停', 409);
    room.status = 'paused'; room.pauseReason = '房主暂停'; room.revision++;
  }
  resume(room: Room, member: RoomMember): void {
    this.host(room, member);
    if (room.status !== 'paused') throw new RoomError('当前没有暂停的对局', 409);
    if (room.members.length !== room.capacity || !room.members.every((m) => m.online)) throw new RoomError('需要全员重新连接才能继续', 409);
    room.status = 'playing'; room.pauseReason = null; room.revision++;
  }
  rematch(room: Room, member: RoomMember): void {
    this.host(room, member);
    if (room.status !== 'finished') throw new RoomError('结束后才能再开一局', 409);
    const game = createInitialGame(randomBytes(4).readUInt32LE(), room.mode);
    game.session.kind = 'lan'; game.revision = room.game.revision + 1;
    room.game = game; room.status = 'lobby'; room.pauseReason = null;
    room.epoch++; room.receipts = []; this.changed(room);
  }
  leave(room: Room, member: RoomMember): void {
    if (member.playerId === room.hostId) throw new RoomError('房主请使用关闭房间');
    if (room.status !== 'lobby') {
      member.online = false; room.revision++;
      if (room.status === 'playing') { room.status = 'paused'; room.pauseReason = member.nickname + '离开了对局'; }
      return;
    }
    room.members = room.members.filter((m) => m !== member);
    this.changed(room);
  }
  close(room: Room, member: RoomMember): void {
    this.host(room, member); this.rooms.delete(room.id);
  }
}
