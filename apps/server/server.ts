import {createServer,type IncomingMessage,type ServerResponse} from 'node:http';
import {join} from 'node:path';
import {fileURLToPath} from 'node:url';
import {isIP} from 'node:net';
import {RuleError,type GameCommand} from '../../packages/rules/src/index.ts';
import {RoomError} from './room-store.ts';
import {RoomService} from './room-service.ts';
import {RoomSaveStore} from './room-save-store.ts';
import {SaveStore,SaveConflictError,SaveNotFoundError} from './save-store.ts';
import {LocalGameService} from './local-game-service.ts';
import {handleLocalHttp} from './local-http.ts';
import {createRoomHttp} from './room-http.ts';
import {createStaticHttp} from './static-http.ts';
import {json,isLoopback,requestBody} from './http-utils.ts';
import {lanAddresses,sessionCapabilities} from './network-info.ts';
import {TutorialService} from './tutorial-service.ts';
import {MatchStatistics} from './match-statistics.ts';
import packageInfo from '../../package.json' with {type:'json'};
export {isLoopback} from './http-utils.ts';

const root=fileURLToPath(new URL('../../',import.meta.url));
const port=Number(process.env.PORT??4173),lan=process.env.GAME_LAN!=='0';
const heartbeatMs=Math.max(250,Number(process.env.GAME_HEARTBEAT_MS??5000));
const timeoutMs=Math.max(heartbeatMs*3,Number(process.env.GAME_TIMEOUT_MS??20000));
const saveDirectory=process.env.GAME_SAVE_DIR??join(root,'data','saves');
const statistics=new MatchStatistics(join(saveDirectory,'statistics'));
const tutorial=new TutorialService(join(saveDirectory,'tutorial'));
const local=new LocalGameService(new SaveStore(saveDirectory),statistics);
const rooms=new RoomService(new RoomSaveStore(process.env.GAME_ROOM_DIR??(process.env.GAME_SAVE_DIR?join(process.env.GAME_SAVE_DIR,'rooms'):join(root,'data','rooms'))),timeoutMs,statistics);
await Promise.all([local.initialize(),rooms.initialize(),tutorial.initialize()]);
const roomHttp=createRoomHttp(rooms),staticHttp=createStaticHttp(root);
const presenceTimer=setInterval(()=>{void rooms.expire().catch(error=>console.error(error.message));},Math.min(5000,Math.max(250,timeoutMs/4)));
presenceTimer.unref();

async function handleRequest(request:IncomingMessage,response:ServerResponse){
 try{
  const base=new URL('http://'+(request.headers.host??'localhost'));
  const hostname=base.hostname.replace(/^\[|\]$/g,'');
  if(hostname!=='localhost'&&!isIP(hostname))throw new RoomError('请使用服务器显示的 IP 地址访问',403);
  const url=new URL(request.url??'/',base),method=request.method??'GET';
  if(method==='POST'){
   if(request.headers.origin&&request.headers.origin!==base.origin)throw new RoomError('请求来源不受允许',403);
   if(!/^application\/json(?:;|$)/i.test(request.headers['content-type']??''))throw new RoomError('请使用 JSON 提交操作',415);
  }
  const localRoute=/^\/api\/(?:game(?:\/|$)|saves(?:\/|$))/.test(url.pathname);
  if(localRoute&&!isLoopback(request.socket.remoteAddress))throw new RoomError('本地对局与存档仅可在主机本地访问，请使用局域网房间',403);
  if(method==='GET'&&url.pathname==='/api/session'){
   const address=server.address(),actualPort=typeof address==='object'&&address?address.port:port;
   return json(response,200,sessionCapabilities(isLoopback(request.socket.remoteAddress),lan,actualPort,heartbeatMs,timeoutMs));
  }
  if(method==='GET'&&url.pathname==='/api/health')return json(response,200,{ok:true,version:packageInfo.version,state:local.phase,entry:'unified'});
  if(method==='GET'&&url.pathname==='/api/game/statistics')return json(response,200,await statistics.view());
  if(method==='GET'&&url.pathname==='/api/game/tutorial')return json(response,200,tutorial.view());
  if(method==='POST'&&url.pathname.startsWith('/api/game/tutorial/')){
   const body=await requestBody(request);
   if(url.pathname==='/api/game/tutorial/new')return json(response,201,await tutorial.create(body));
   if(url.pathname==='/api/game/tutorial/next')return json(response,200,await tutorial.next(body));
   if(url.pathname==='/api/game/tutorial/command')return json(response,200,await tutorial.command(body as GameCommand));
  }
  if(localRoute&&await handleLocalHttp(request,response,url.pathname,local))return;
  if(await roomHttp(request,response,url))return;
  if(await staticHttp(request,response,url))return;
  json(response,404,{error:'not_found'});
 }catch(error){
  if(response.headersSent){response.destroy();return;}
  const status=error instanceof RoomError?error.status:error instanceof SaveConflictError?409:error instanceof SaveNotFoundError?404:error instanceof RuleError?400:500;
  json(response,status,error instanceof SaveConflictError?{error:error.message,conflict:error.existing}:{error:error instanceof Error?error.message:'unknown_error'});
 }
}
// Local match mutations are serialized; RoomService has independent per-room queues.
let requestQueue=Promise.resolve();
const server=createServer((request,response)=>{
 const handle=()=>handleRequest(request,response);
 const failed=()=>{if(!response.headersSent)json(response,500,{error:'服务处理失败，请重试'});};
 if(/^\/api\/(?:game|saves)(?:\/|\?|$)/.test(request.url??''))requestQueue=requestQueue.then(handle).catch(failed);
 else void handle().catch(failed);
});
server.listen(port,lan?'0.0.0.0':'127.0.0.1',()=>{
 const address=server.address(),actualPort=typeof address==='object'&&address?address.port:port;
 console.log('黄金邮道开发服务器已启动：http://127.0.0.1:'+actualPort);
 console.log('统一大厅：本地人机、同屏对局、局域网对战。');
 if(lan)for(const entry of lanAddresses())console.log('局域网房间地址：http://'+entry.address+':'+actualPort);
 console.log('每步自动保留；联机操作自动同步。请保持本窗口运行。');
});
