import {isIP} from 'node:net';
import type {IncomingMessage} from 'node:http';
import {isLoopback} from './http-utils.ts';
import {RoomError} from './room-store.ts';

/** Public origin is configuration, never inferred from forwarding headers. */
export function deployment(env:Record<string,string|undefined>) {
  const mode=env.GAME_MODE??'lan';
  if(!['lan','public'].includes(mode))throw new Error('GAME_MODE必须为lan或public');
  const online=mode==='public';
  let origin:URL|undefined;
  if(online){
    try{origin=new URL(env.GAME_PUBLIC_ORIGIN??'');}catch{throw new Error('公网模式需要GAME_PUBLIC_ORIGIN，例如https://game.example.com');}
    if(origin.protocol!=='https:'||origin.username||origin.password||origin.pathname!=='/'||origin.search||origin.hash)throw new Error('GAME_PUBLIC_ORIGIN必须是无路径和凭证的HTTPS站点地址');
  }
  const proxies=new Set((env.GAME_TRUSTED_PROXIES??'').split(',').map(s=>s.trim()).filter(Boolean));
  if([...proxies].some(address=>!isIP(address)))throw new Error('GAME_TRUSTED_PROXIES只接受明确的代理IP地址');
  function requestBase(request:IncomingMessage):URL {
    const host=request.headers.host;
    if(!host||/[\s/@\\?#]/.test(host))throw new RoomError('访问地址无效',403);
    let supplied:URL;
    try{supplied=new URL((online?'https:':'http:')+'//'+host);}catch{throw new RoomError('访问地址无效',403);}
    if(online){if(supplied.host!==origin!.host)throw new RoomError('请通过游戏的公网地址访问',403);return origin!;}
    const hostname=supplied.hostname.replace(/^\[|\]$/g,'');
    if(hostname!=='localhost'&&!isIP(hostname))throw new RoomError('请使用服务器显示的IP地址访问',403);
    return supplied;
  }
  return {
    online,origin:origin?.origin,
    local(request:IncomingMessage){return !online&&isLoopback(request.socket.remoteAddress);},
    requestBase,
    clientAddress(request:IncomingMessage){
      const peer=request.socket.remoteAddress??'unknown';
      if(!proxies.has(peer))return peer;
      const forwarded=request.headers['x-forwarded-for'];
      if(typeof forwarded!=='string'||forwarded.length>1000)return peer;
      // A trusted proxy appends its verified peer; the left side can be supplied by a client.
      const last=forwarded.split(',').at(-1)?.trim();
      return last&&isIP(last)?last:peer;
    },
  };
}
