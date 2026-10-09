import {readFile,mkdir,writeFile,rename} from 'node:fs/promises';
import {join} from 'node:path';
import {randomBytes,randomUUID,createHash} from 'node:crypto';
import {RoomError} from './room-store.ts';
type Credentials=Array<[string,string]>;
type Ticket={roomId:string;playerId:string;expiresAt:number};
type Registry={schemaVersion:1;credentials:Credentials;tickets:Array<[string,Ticket]>};
const hash=(value:string)=>createHash('sha256').update(value).digest('hex');
const tokenValid=(value:unknown):value is string=>typeof value==='string'&&/^[a-f0-9]{64}$/.test(value);
const idValid=(value:unknown):value is string=>typeof value==='string'&&/^[a-f0-9-]{36}$/.test(value);

/** One authoritative credential registry prevents old room snapshots reviving revoked tokens. */
export class RoomAuth {
  private registry:Registry={schemaVersion:1,credentials:[],tickets:[]};
  private tail:Promise<void>=Promise.resolve();
  private directory:string;
  constructor(directory:string){this.directory=directory;}
  private queue<T>(job:()=>Promise<T>):Promise<T>{
    const result=this.tail.then(job);this.tail=result.then(()=>{},()=>{});return result;
  }
  async load():Promise<Credentials|null>{
    let body:Registry;
    try{body=JSON.parse(await readFile(join(this.directory,'credentials.json'),'utf8'));}
    catch(error){if((error as NodeJS.ErrnoException).code==='ENOENT')return null;throw new Error('玩家凭证文件无法读取，已停止加载，原文件保留');}
    if(body.schemaVersion!==1||!Array.isArray(body.credentials)||!Array.isArray(body.tickets)||
      !body.credentials.every(entry=>Array.isArray(entry)&&entry.length===2&&tokenValid(entry[0])&&idValid(entry[1]))||
      new Set(body.credentials.map(entry=>entry[0])).size!==body.credentials.length||
      !body.tickets.every(entry=>Array.isArray(entry)&&entry.length===2&&tokenValid(entry[0])&&idValid(entry[1]?.roomId)&&idValid(entry[1]?.playerId)&&Number.isSafeInteger(entry[1]?.expiresAt)))throw new Error('玩家凭证文件结构损坏，已停止加载，原文件保留');
    this.registry=body;return body.credentials;
  }
  private async commit(next:Registry){
    try{
      await mkdir(this.directory,{recursive:true});const path=join(this.directory,'credentials.json'),temporary=path+'.'+randomUUID()+'.tmp';
      await writeFile(temporary,JSON.stringify(next));await rename(temporary,path);this.registry=next;
    }catch{throw new RoomError('玩家凭证保存失败，操作未生效，请检查磁盘后重试',503);}
  }
  synchronize(credentials:()=>Credentials){return this.queue(async()=>{
    const entries=credentials(),players=new Set(entries.map(([,id])=>id));
    const next={...this.registry,credentials:entries,tickets:this.registry.tickets.filter(([,ticket])=>ticket.expiresAt>Date.now()&&players.has(ticket.playerId))};
    if(JSON.stringify(next)!==JSON.stringify(this.registry))await this.commit(next);
  });}
  issue(roomId:string,playerId:string,credentials:()=>Credentials,authorize:()=>void,now=Date.now()){
    return this.queue(async()=>{
      authorize();const token=randomBytes(32).toString('hex'),expiresAt=now+5*60*1000;
      const tickets=this.registry.tickets.filter(([,ticket])=>ticket.expiresAt>now&&ticket.playerId!==playerId);
      if(tickets.length>=256)throw new RoomError('换机请求较多，请稍后重试',429);
      tickets.push([hash(token),{roomId,playerId,expiresAt}]);
      await this.commit({...this.registry,credentials:credentials(),tickets});return {token,expiresAt};
    });
  }
  ticket(token:unknown,now=Date.now()):Ticket{
    if(!tokenValid(token))throw new RoomError('换机链接无效或已过期',403);
    const ticket=this.registry.tickets.find(([key])=>key===hash(token))?.[1];
    if(!ticket||ticket.expiresAt<=now)throw new RoomError('换机链接无效或已过期',403);return {...ticket};
  }
  redeem(token:string,credentials:()=>Credentials,authorize:(ticket:Ticket)=>void,commitCredentials:(credentials:Credentials)=>void,now=Date.now()){
    return this.queue(async()=>{
      const ticket=this.ticket(token,now);authorize(ticket);
      const nextToken=randomBytes(32).toString('hex');
      const nextCredentials=credentials().filter(([,id])=>id!==ticket.playerId);nextCredentials.push([hash(nextToken),ticket.playerId]);
      await this.commit({schemaVersion:1,credentials:nextCredentials,tickets:this.registry.tickets.filter(([,t])=>t.playerId!==ticket.playerId&&t.expiresAt>now)});
      commitCredentials(nextCredentials);return {...ticket,token:nextToken};
    });
  }
}
