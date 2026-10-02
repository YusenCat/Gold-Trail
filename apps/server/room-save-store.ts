import { mkdir, readFile, readdir, rename, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { createInitialGame, type GameState } from '../../packages/rules/src/index.ts';
import cards from '../../content/cards.v1.json' with { type: 'json' };
import { RoomError, type Room } from './room-store.ts';

export interface Recovery { schemaVersion: 1; room: Room; credentials: Array<[string, string]> }
export interface SnapshotSummary { id: string; name: string; savedAt: string; round: number; phase: string; mode: string }
const validId = (id: string) => /^[a-f0-9-]{36}$/.test(id);
const cardIds = new Set(cards.cards.map((c) => c.id));
export function validateRoomGame(game: GameState): void {
  const baseline = createInitialGame(1);
  if (!game || game.schemaVersion !== baseline.schemaVersion || game.rulesVersion !== baseline.rulesVersion ||
    game.mapVersion !== baseline.mapVersion || game.cardVersion !== baseline.cardVersion || game.balanceVersion !== baseline.balanceVersion ||
    game.session?.kind !== 'lan' || !['race', 'fixedRounds'].includes(game.mode) || !Number.isSafeInteger(game.revision) || game.revision < 0 ||
    !Number.isSafeInteger(game.round) || game.round < 1 || !['preEvent', 'eventReveal', 'supply', 'characterTurn', 'roundEnd', 'finished'].includes(game.phase) ||
    !Array.isArray(game.characters) || game.characters.length !== 4 || !Array.isArray(game.log)) throw new RoomError('联机存档版本不兼容或结构损坏');
  const ids = game.characters.map((c) => c.id).sort().join(',');
  if (ids !== 'OFFICER_1,OFFICER_2,SMUGGLER_1,SMUGGLER_2') throw new RoomError('存档角色不完整');
  for (const actor of game.characters) {
    if (![actor.gold, actor.silver, actor.food, actor.actionPoints, actor.lockbox?.gold, actor.lockbox?.silver].every((n) => Number.isSafeInteger(n) && n >= 0) ||
      !Array.isArray(actor.hand) || actor.hand.length > 5 || actor.hand.some((id) => !cardIds.has(id))) throw new RoomError('存档角色资源或手牌损坏');
  }
}
export class RoomSaveStore {
  directory: string;
  constructor(directory: string) { this.directory = directory; }
  private folder(id: string): string {
    if (!validId(id)) throw new RoomError('房间编号无效');
    return join(this.directory, id);
  }
  private async atomic(path: string, body: unknown): Promise<void> {
    const temporary = path + '.' + randomUUID() + '.tmp';
    await writeFile(temporary, JSON.stringify(body)); await rename(temporary, path);
  }
  async recovery(room: Room, credentials: Array<[string, string]>): Promise<void> {
    const directory = this.folder(room.id); await mkdir(directory, { recursive: true });
    await this.atomic(join(directory, 'recovery.json'), { schemaVersion: 1, room, credentials });
  }
  async close(id: string): Promise<void> {
    const directory = this.folder(id); await mkdir(directory, { recursive: true });
    await this.atomic(join(directory, 'recovery.json'), { schemaVersion: 1, closed: true, id });
  }
  async recoveries(): Promise<Recovery[]> {
    await mkdir(this.directory, { recursive: true });
    const results: Recovery[] = [];
    for (const file of await readdir(this.directory, { withFileTypes: true })) {
      if (!file.isDirectory() || !validId(file.name)) continue;
      try {
        const payload = JSON.parse(await readFile(join(this.folder(file.name), 'recovery.json'), 'utf8'));
        if (payload.closed === true) continue;
        const room: Room = payload.room;
        if (payload.schemaVersion !== 1 || room.id !== file.name || !/^[A-F0-9]{6}$/.test(room.code) ||
          ![2, 4].includes(room.capacity) || !['lobby', 'playing', 'paused', 'finished'].includes(room.status) ||
          !Number.isSafeInteger(room.revision) || !Number.isSafeInteger(room.epoch) || !Array.isArray(room.receipts) ||
          !Array.isArray(room.members) || !room.members.length || room.members.length > room.capacity ||
          !room.members.some((m) => m.playerId === room.hostId) || !Array.isArray(payload.credentials)) throw new Error('Invalid recovery');
        validateRoomGame(room.game);
        const seats = new Set<string>(), players = new Set<string>();
        for (const member of room.members) {
          const options = room.capacity === 2 ? ['smuggler', 'officer'] : ['SMUGGLER_1', 'SMUGGLER_2', 'OFFICER_1', 'OFFICER_2'];
          if (!validId(member.playerId) || players.has(member.playerId) || typeof member.nickname !== 'string' || typeof member.ready !== 'boolean' ||
            (member.seat !== null && (!options.includes(member.seat) || seats.has(member.seat)))) throw new Error('Invalid members');
          players.add(member.playerId); if (member.seat) seats.add(member.seat);
        }
        if (room.status !== 'lobby' && (room.members.length !== room.capacity || seats.size !== room.capacity)) throw new Error('Incomplete game seats');
        if (!payload.credentials.every((entry: unknown) => Array.isArray(entry) && entry.length === 2 && /^[a-f0-9]{64}$/.test(entry[0]) && players.has(entry[1]))) throw new Error('Invalid credentials');
        if (new Set(payload.credentials.map((entry: string[]) => entry[1])).size !== players.size) throw new Error('Missing credentials');
        results.push(payload);
      } catch (error) { console.warn(`房间恢复文件 ${file.name} 无法读取，原文件保留：${error instanceof Error ? error.message : 'unknown'}`); }
    }
    return results;
  }
  async list(id: string): Promise<SnapshotSummary[]> {
    const directory = this.folder(id); await mkdir(directory, { recursive: true });
    const results: SnapshotSummary[] = [];
    for (const filename of await readdir(directory)) {
      if (!/^s_[a-f0-9-]{36}\.json$/.test(filename)) continue;
      try {
        const payload = JSON.parse(await readFile(join(directory, filename), 'utf8')), summary = payload.summary;
        if (payload.schemaVersion === 1 && summary && validId(summary.id) && filename === 's_' + summary.id + '.json' && typeof summary.name === 'string' && typeof summary.savedAt === 'string' && Number.isSafeInteger(summary.round)) results.push(summary);
      } catch {}
    }
    return results.sort((a, b) => b.savedAt.localeCompare(a.savedAt));
  }
  async save(room: Room, rawName: unknown, overwrite: unknown = false): Promise<SnapshotSummary> {
    if (typeof rawName !== 'string' || !rawName.trim() || [...rawName.trim()].length > 48 || /[\u0000-\u001f\u007f/\\:*?"<>|]/u.test(rawName) || typeof overwrite !== 'boolean') throw new RoomError('请输入一至四十八个字符的存档名，不能包含路径符号');
    const name = rawName.trim().normalize('NFC'), existing = await this.list(room.id);
    const previous = existing.find((s) => s.name === name);
    if (previous && !overwrite) throw new RoomError('同名房间存档已存在，再次确认可覆盖', 409);
    if (!previous && existing.length >= 64) throw new RoomError('房间存档已达六十四个，请覆盖已有存档', 409);
    const summary = { id: previous?.id ?? randomUUID(), name, savedAt: new Date().toISOString(), round: room.game.round, phase: room.game.phase, mode: room.mode };
    await this.atomic(join(this.folder(room.id), 's_' + summary.id + '.json'), {
      schemaVersion: 1, summary, capacity: room.capacity, seats: room.members.map((m) => m.seat).sort(), game: room.game,
    });
    return summary;
  }
  async load(room: Room, id: unknown): Promise<GameState> {
    if (typeof id !== 'string' || !validId(id)) throw new RoomError('存档编号无效');
    let payload;
    try { payload = JSON.parse(await readFile(join(this.folder(room.id), 's_' + id + '.json'), 'utf8')); }
    catch (error) { if ((error as NodeJS.ErrnoException).code === 'ENOENT') throw new RoomError('没有找到这个房间存档', 404); throw new RoomError('房间存档损坏，原文件保留'); }
    if (payload.schemaVersion !== 1 || payload.capacity !== room.capacity || JSON.stringify(payload.seats) !== JSON.stringify(room.members.map((m) => m.seat).sort())) throw new RoomError('存档人数或角色配置与房间不相容');
    validateRoomGame(payload.game);
    return payload.game;
  }
}
