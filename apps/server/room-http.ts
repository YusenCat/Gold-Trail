import type {IncomingMessage,ServerResponse} from 'node:http';
import type {RoomService} from './room-service.ts';
import {RoomError} from './room-store.ts';
import {json,requestBody} from './http-utils.ts';
export function createRoomHttp(rooms:RoomService,options:{secure?:boolean;clientAddress?:(request:IncomingMessage)=>string}={}) {
const joinAttempts=new Map<string,{count:number;until:number}>();
function playerToken(request: IncomingMessage): string | undefined {
  return request.headers.cookie?.split(';').map((part) => part.trim()).find((part) => part.startsWith('golden_player='))?.slice('golden_player='.length);
}
function identity(request: IncomingMessage, response: ServerResponse) {
  const result = rooms.store.identity(playerToken(request));
  if (result.token) cookie(response,result.token);
  return {playerId:result.playerId,token:result.token??playerToken(request)};
}
function cookie(response:ServerResponse,token:string){response.setHeader('set-cookie',`golden_player=${token}; HttpOnly; SameSite=Strict; Path=/; Max-Age=2592000${options.secure?'; Secure':''}`);}
function limitJoins(request: IncomingMessage): void {
  const now = Date.now(), key = options.clientAddress?.(request)??request.socket.remoteAddress ?? 'unknown';
  for (const [ip, entry] of joinAttempts) if (entry.until <= now) joinAttempts.delete(ip);
  const entry = joinAttempts.get(key) ?? { count: 0, until: now + 60000 };
  if (entry.count >= 30 || (!joinAttempts.has(key) && joinAttempts.size >= 1000)) throw new RoomError('创建或加入过于频繁，请稍后重试', 429);
  entry.count++; joinAttempts.set(key, entry);
}


return async (request:IncomingMessage,response:ServerResponse,url:URL) => {
const method=request.method??'GET';
    if(method==='GET'&&url.pathname==='/api/rooms')return send(response,200,rooms.publicRooms());
    if(method==='POST'&&url.pathname==='/api/rooms/transfer'){
      limitJoins(request);const body=await requestBody(request),result=await rooms.redeemTransfer(body.token);
      cookie(response,result.token);return send(response,200,result.view);
    }
    if (method === 'POST' && (url.pathname === '/api/rooms' || url.pathname === '/api/rooms/join')) {
      limitJoins(request);
      const body = await requestBody(request) as { nickname?: unknown; capacity?: unknown; mode?: unknown; code?: unknown };
      const {playerId:id,token} = identity(request, response);
      rooms.store.retainIdentity(id);
      try{
        const result = await (url.pathname === '/api/rooms' ? rooms.create(id, body,token) : rooms.join(id, body,!!options.secure,token));
        return send(response, url.pathname === '/api/rooms' ? 201 : 200, result);
      }finally{
        rooms.store.releaseIdentity(id);
        await rooms.cleanupIdentities().catch(()=>console.warn('临时身份清理稍后重试'));
      }
    }
    const roomRoute = url.pathname.match(/^\/api\/rooms\/([a-f0-9-]{36})(?:\/(seat|ready|start|command|leave|close|events|heartbeat|pause|resume|rematch|transfer|saves(?:\/load)?))?$/);
    if (roomRoute) {
      const id = roomRoute[1], token=playerToken(request),playerId = rooms.store.identify(token);
      if (!playerId) throw new RoomError('玩家凭证无效，请重新加入房间', 403);
      if (method === 'GET' && !roomRoute[2]) return send(response, 200, await rooms.read(id, playerId,token));
      if (method === 'GET' && roomRoute[2] === 'events') { await rooms.subscribe(id, playerId, response,token); return true; }
      if (method === 'GET' && roomRoute[2] === 'saves') return send(response, 200, await rooms.listSaves(id, playerId,token));
      if (method !== 'POST' || !roomRoute[2]) throw new RoomError('请求方法无效', 405);
      const body = await requestBody(request) as Record<string, unknown>;
      const action = roomRoute[2];
      if(action==='transfer'){limitJoins(request);return send(response,201,await rooms.issueTransfer(id,playerId,token));}
      if (action === 'heartbeat') { await rooms.heartbeat(id, playerId,token); return send(response, 200, { ok: true }); }
      if (action === 'saves') return send(response, 201, await rooms.save(id, playerId, body,token));
      return send(response, 200, await rooms.action(id, playerId, action === 'saves/load' ? 'load' : action, body,token));
    }

return false;
};
function send(response:ServerResponse,status:number,body:unknown){json(response,status,body);return true;}
}
