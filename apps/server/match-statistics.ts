import {randomUUID} from 'node:crypto';
import {mkdir, readFile, writeFile, rename} from 'node:fs/promises';
import {join} from 'node:path';
import cards from '../../content/cards.v1.json' with {type:'json'};
import type {GameState, GameCommand} from '../../packages/rules/src/index.ts';

export function beginMetrics(game:GameState,seed:number){
 game.metrics={id:randomUUID(),seed,startedAt:Date.now(),actions:0,equipmentPurchases:0,equipmentBuyers:[]};
}
export function trackCommand(before:GameState,next:GameState,command:GameCommand){
 if(!next.metrics || next.tutorial)return;
 next.metrics.actions++;
 if(command.type==='BUY_MARKET' && cards.cards.some(c=>c.id===before.marketSlots[command.slot]&&c.kind==='equipment')){
  next.metrics.equipmentPurchases++;
  if(!next.metrics.equipmentBuyers.includes(command.actorId))next.metrics.equipmentBuyers.push(command.actorId);
 }
}
type MatchRecord={id:string;seed:number;kind:string;difficulty:string;humanFaction:string;mode:string;winner:string;rounds:number;durationSeconds:number;actions:number;equipmentPurchases:number;equipmentBuyers:number;rulesVersion:string;balanceVersion:string};
export class MatchStatistics {
 private directory:string;private queue=Promise.resolve();
 constructor(directory:string){this.directory=directory;}
 private async read():Promise<MatchRecord[]>{
  try{const value=JSON.parse(await readFile(join(this.directory,'matches.json'),'utf8'));if(!Array.isArray(value))throw new Error('统计文件格式无效，原文件保留');return value;}
  catch(e){if((e as NodeJS.ErrnoException).code==='ENOENT')return [];throw e;}
 }
 async record(game:GameState){
  if(game.tutorial || game.phase!=='finished' || !game.metrics)return;
  const m=game.metrics;
  const task=this.queue.then(async()=>{
   const records=await this.read();if(records.some(r=>r.id===m.id))return;
   records.push({id:m.id,seed:m.seed,kind:game.session.kind,difficulty:game.session.difficulty??'normal',humanFaction:game.session.humanFaction,
    mode:game.mode,winner:game.winner??'draw',rounds:game.round,durationSeconds:Math.max(0,Math.round((Date.now()-m.startedAt)/1000)),
    actions:m.actions,equipmentPurchases:m.equipmentPurchases,equipmentBuyers:m.equipmentBuyers.length,rulesVersion:game.rulesVersion,balanceVersion:game.balanceVersion});
   await mkdir(this.directory,{recursive:true});const path=join(this.directory,'matches.json');await writeFile(path+'.tmp',JSON.stringify(records,null,2));await rename(path+'.tmp',path);
  });this.queue=task.catch(()=>{});return task;
 }
 async view(){await this.queue;const matches=await this.read();return {matches,groups:summarizeMatches(matches)};}
}
export function summarizeMatches(matches:MatchRecord[]){
 const keys=[...new Set(matches.map(m=>[m.kind,m.difficulty,m.mode,m.rulesVersion,m.balanceVersion].join('/')))];
 return keys.map(key=>{const rows=matches.filter(m=>[m.kind,m.difficulty,m.mode,m.rulesVersion,m.balanceVersion].join('/')===key),n=rows.length;
  return {key,count:n,smugglerWinRate:rows.filter(m=>m.winner==='smuggler').length/n,officerWinRate:rows.filter(m=>m.winner==='officer').length/n,
   drawRate:rows.filter(m=>m.winner==='draw').length/n,averageRounds:rows.reduce((a,m)=>a+m.rounds,0)/n,
   averageMinutes:rows.reduce((a,m)=>a+m.durationSeconds,0)/n/60,equipmentPurchaseRate:rows.filter(m=>m.equipmentPurchases>0).length/n,
   characterEquipmentRate:rows.reduce((a,m)=>a+m.equipmentBuyers,0)/(n*4)};
 });
}
