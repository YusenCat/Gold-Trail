import {applyCommand, createInitialGame, publicView, RuleError, type GameState, type GameCommand} from '../../packages/rules/src/index.ts';
import {decisionActor, legalActions, type LegalAction} from '../../packages/rules/src/actions.ts';
import {SaveStore} from './save-store.ts';
import {isDeepStrictEqual} from 'node:util';

// Prepared teaching scenes use the production rules. Only scene transitions set up positions/resources.
export const tutorialSteps = [
 ['认识移动','点击松烟林道的亮圈，查看费用后确认移动。每段路均为一步；取消不扣行动。','MOVE','E1'],
 ['及时补给','在驿站补满粮草再出发。补给会耗尽剩余行动点。','REFILL_FOOD'],
 ['交出行动令','补给后行动点为0。亲手结束回合，观察下一角色接过行动骰。','END_TURN'],
 ['抵达金矿','从商队营地前往漠河金矿，留些行动点采矿。','MOVE','MINE'],
 ['第一次采矿','点击采矿，观察采矿骰点、碎金与本阵营配额变化。采矿骰和行动骰不同。','MINE'],
 ['矿额与撤离','再采一次；个人每回合最多两次，阵营每轮最多4金。采完应规划押运。','MINE'],
 ['押运终点','从稽查站丙前往边境黑市，准备兑换刚采到的碎金。','MOVE','BAZAAR'],
 ['兑换才得分','选择兑换。碎金会减少，官银和阵营声望会增加；身上的金还不算声望。','EXCHANGE'],
 ['尝试官兵稽查','现在扮演官兵1。稽查同站的走私者1，等待对方响应。','INSPECT'],
 ['打出响应牌','现在由走私者1决策。到手牌区打出暴力拒查并确认；它会终止本次收缴。','PLAY_TACTIC'],
 ['再查一次','再次稽查，试着从双箱中找出碎金。','INSPECT'],
 ['选择不响应','本次没有响应牌。点击放弃响应，进入秘密分箱；没有牌也需要明确作出决策。','PASS_RESPONSE'],
 ['亲手秘密分箱','把4金分到两箱。甲箱可填0至4，乙箱自动接收剩余；对手看不到每箱的数量。','SPLIT_GOLD'],
 ['问一个真实问题','切回官兵1，选择一个问题。系统如实作答；根据回答推断金子的分布。','ASK_SEARCH_QUESTION'],
 ['选择并打开一箱','依据答案选甲箱或乙箱，查看收缴结果。另一箱留给走私者，空箱还会带来免查保护。','CHOOSE_SEARCH_BOX'],
] as const;

export function tutorialAllowed(game: GameState, action: LegalAction): boolean {
 const t=game.tutorial, step=t && tutorialSteps[t.stage];
 if(!step || t!.completed)return false;
 const c=action.command;
 if(c.type!==step[2])return false;
 if(c.type==='MOVE')return c.path.length===1 && c.path[0]===step[3];
 if(c.type==='INSPECT')return c.targetId==='SMUGGLER_1' && c.distance===0;
 if(c.type==='PLAY_TACTIC')return c.cardId==='T_RESIST_SEARCH';
 return true;
}

function prepare(game: GameState) {
 const stage=game.tutorial!.stage, sm=game.characters.find(c=>c.id==='SMUGGLER_1')!, off=game.characters.find(c=>c.id==='OFFICER_1')!;
 const setActor=(id:string)=>{game.phase='characterTurn';game.activeCharacterId=id;game.turnIndex=game.turnOrder.indexOf(id);game.characters.find(c=>c.id===id)!.actionPoints=3;};
 if(stage===0){setActor(sm.id);sm.nodeId='HUB';}
 if(stage===1){setActor(sm.id);sm.nodeId='HUB';sm.food=2;}
 if(stage===3){setActor(sm.id);sm.nodeId='E4';game.activeEventId=null;}
 if(stage===6){setActor(sm.id);sm.nodeId='CP_C';}
 if(stage===8 || stage===10){
  setActor(off.id);off.nodeId='CP_D';sm.nodeId='CP_D';sm.gold=4;off.inspectedThisTurn=false;sm.searchProtectedUntilRound=null;game.pendingDecision=null;
  sm.hand=stage===8?['T_RESIST_SEARCH']:[];
 }
 // Preserve all other results until the learner acknowledges them.
 game.log.push({id:(game.log.at(-1)?.id??0)+1,round:game.round,type:'tutorial',message:`教学 ${stage+1}：${tutorialSteps[stage]?.[0]??'完成'}`,visibility:'public'});
}

export class TutorialService {
 private game: GameState | null = null;
 private saves: SaveStore;
 constructor(directory:string){this.saves=new SaveStore(directory);}
 async initialize(){this.game=await this.saves.loadRecovery();}
 view(){
  if(!this.game?.tutorial)return {tutorial:null};
  const game=this.game,t=game.tutorial,step=tutorialSteps[t.stage];
  const actions=legalActions(game).filter(a=>tutorialAllowed(game,a));
  const visible=publicView(game);
  visible.log=visible.log.map(entry=>entry.type==='tutorial'?{...entry,message:entry.message.replace('教学场景','教学').replace('（位置与资源按练习需要准备）','')}:entry);
  return {game:visible,actions,legalMoves:[],decisionActorId:decisionActor(game),botPending:false,
   balance:{mineActionsPerTurn:2,mineFactionOutputLimit:4},
   tutorial:{stage:t.stage,total:tutorialSteps.length,completed:t.completed,finished:t.stage===tutorialSteps.length,
    title:step?.[0]??'学成出发',detail:step?.[1]??'你已亲手完成移动、补给、采矿、兑换、稽查、响应与双箱流程。接下来选择阵营和难度，进行完整对局。'}};
 }
 private check(revision:unknown){if(!this.game || revision!==this.game.revision)throw new RuleError('教学进度已更新，请重新同步后再试。');}
 private async commit(game:GameState){await this.saves.saveRecovery(game);this.game=game;return this.view();}
 async create(body:Record<string,unknown>){
  const seed=Number.isSafeInteger(body.seed)?body.seed as number:Date.now();
  const game=createInitialGame(seed);game.revision=(this.game?.revision??0)+1;
  game.tutorial={stage:0,completed:false,seed};prepare(game);return this.commit(game);
 }
 async command(body:GameCommand & {revision?:number}){
  this.check(body.revision);
  // Validate against server-side legal actions, including command parameters.
  const clean=(value:object)=>Object.fromEntries(Object.entries(value).filter(([k,v])=>k!=='revision'&&v!==undefined));
  const valid=legalActions(this.game!).some(a=>tutorialAllowed(this.game!,a)&&isDeepStrictEqual(clean(a.command),clean(body)));
  if(!valid)throw new RuleError('请先完成当前教学目标；确认路线或当前决策者后再操作。');
  const game=applyCommand(this.game!,body);game.tutorial!.completed=true;return this.commit(game);
 }
 async next(body:Record<string,unknown>){
  this.check(body.revision);const game=structuredClone(this.game!);
  if(!game.tutorial!.completed)throw new RuleError('请亲手完成当前操作后再继续。');
  if(game.tutorial!.stage>=tutorialSteps.length)return this.view();
  game.tutorial!.stage++;game.tutorial!.completed=false;game.revision++;
  if(game.tutorial!.stage===tutorialSteps.length){game.phase='finished';game.winner='draw';}
  else prepare(game);
  return this.commit(game);
 }
}
