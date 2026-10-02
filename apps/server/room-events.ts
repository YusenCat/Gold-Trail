import type { ServerResponse } from 'node:http';
import { roomView } from './room-view.ts';
import type { Room } from './room-store.ts';
interface Listener { playerId: string; response: ServerResponse }
export class RoomEvents {
  private listeners = new Map<string, Set<Listener>>();
  attach(room: Room, playerId: string, response: ServerResponse): void {
    const listeners = this.listeners.get(room.id) ?? new Set<Listener>();
    if (listeners.size >= 32) throw new Error('房间连接过多，请关闭多余标签页');
    response.writeHead(200, { 'content-type': 'text/event-stream; charset=utf-8', 'cache-control': 'no-store', connection: 'keep-alive', 'x-accel-buffering': 'no' });
    response.write('retry: 1500\n\n');
    const listener = { playerId, response }; listeners.add(listener); this.listeners.set(room.id, listeners);
    const timer = setInterval(() => { if (!response.destroyed) response.write(': heartbeat\n\n'); }, 10000);
    response.once('close', () => { clearInterval(timer); listeners.delete(listener); if (!listeners.size) this.listeners.delete(room.id); });
    response.on('error', () => response.destroy());
    this.send(listener, room, 'reset');
  }
  private send(listener: Listener, room: Room, event: 'view' | 'reset'): void {
    const member = room.members.find((m) => m.playerId === listener.playerId);
    if (!member) { this.finish(listener, 'removed'); return; }
    if (listener.response.destroyed || listener.response.writableLength > 1024 * 1024) { listener.response.destroy(); return; }
    listener.response.write(`id: ${room.epoch}:${room.revision}\nevent: ${event}\ndata: ${JSON.stringify(roomView(room, member))}\n\n`);
  }
  broadcast(room: Room, reset = false): void {
    for (const listener of this.listeners.get(room.id) ?? []) this.send(listener, room, reset ? 'reset' : 'view');
  }
  private finish(listener: Listener, reason: string): void {
    if (!listener.response.destroyed) { listener.response.write(`event: closed\ndata: ${JSON.stringify({ reason })}\n\n`); listener.response.end(); }
  }
  close(id: string): void { for (const listener of this.listeners.get(id) ?? []) this.finish(listener, 'closed'); }
}
