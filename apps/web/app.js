import {createModeFlow} from './modules/mode-flow.js';
import {createOnboarding} from './modules/onboarding.js';
import {createSurvivalAdvisor} from './modules/survival-advisor.js';
import {createTabletopEffects} from './modules/tabletop-effects.js';
import {createActionDie} from './modules/action-die.js';
import {createTutorial} from './modules/tutorial.js';
import {createActionFeedback} from './modules/action-feedback.js';
import {bindStatistics} from './modules/statistics.js';
import {bindSaveControls} from './modules/local-saves.js';
import {createBotController} from './modules/bot-controller.js';
import {bindReportView} from './modules/report-view.js';
import {createGameHud} from './modules/game-hud.js';
import {createTurnPrompt, turnPrompt} from './modules/turn-prompt.js';
import {createHallController} from './modules/hall.js';
import { createApiClient } from './modules/api.js';
import { createBoardRenderer } from './modules/board.js';
import { createGamePanels } from './modules/panels.js';
import { createLibraryRenderer } from './modules/library.js';
import { createLobbyController } from './modules/lobby.js';
import { portrait, renderPlayerTableaux } from './modules/player-tableau.js';
const state = { game: null, map: null, cards: [], actions: [], legalMoves: [], balance: {}, botPending: false, decisionActorId: null, busy: false, screen: 'home', previous: 'home', setupKind: 'solo', tab: 'location', botPaused: false, botTimer: null };
const $ = (selector) => document.querySelector(selector);
const phases = { preEvent:'轮前准备', eventReveal:'揭示事件', supply:'粮草结算', characterTurn:'角色行动', roundEnd:'轮末结算', finished:'对局结束' };
const kinds = { tactic:'功能牌', equipment:'装备', mount:'马匹', event:'事件', role:'阵营技能' };
const checkpointIds = new Set(['CP_C','CP_D','CP_E','CP_F','CP_G']);
const playerName = (id) => (id || '').replace('SMUGGLER_', '走私者').replace('OFFICER_', '官兵');
const factionName = (id) => id === 'smuggler' ? '走私者' : '官兵';
const card = (id) => state.cards.find((c) => c.id === id) || { name:'未知牌', text:'' };
function nodeName(id) {
 const n=state.map?.nodes.find((n)=>n.id===id);
 return n?.siteName || n?.label?.replace(/C$/,'丙').replace(/D$/,'丁').replace(/E$/,'戊').replace(/F$/,'己').replace(/G$/,'庚') || (id || '').replace(/^W/,'西路·').replace(/^E/,'东路·').replace(/^N/,'北路·').replace(/^R/,'绕行道·');
}
function textCN(value) {
 let text=String(value);
 for(const c of state.cards)text=text.replaceAll(c.id,c.name);
 for(const c of state.game?.characters||[])text=text.replaceAll(c.id,playerName(c.id));
 for(const n of [...(state.map?.nodes||[])].sort((a,b)=>b.id.length-a.id.length))text=text.replaceAll(n.id,nodeName(n.id));
 return text.replaceAll('smuggler','走私者').replaceAll('officer','官兵').replaceAll('AP','行动点').replaceAll('A 箱','甲箱').replaceAll('B 箱','乙箱').replaceAll('HIDDEN','隐藏功能牌');
}
function el(tag,text,cls){const e=document.createElement(tag);if(text!==undefined)e.textContent=text;if(cls)e.className=cls;return e;}
function resourceIcon(kind){const icon=el('span',undefined,'resource-icon resource-icon-'+kind);icon.setAttribute('aria-hidden','true');return icon;}
function button(label,action,disabled=false){const b=el('button',label);b.type='button';b.disabled=disabled||state.busy;b.onclick=async()=>{if(state.busy)return;try{await action();}catch(e){notify(e.message,true);}};return b;}
function notify(message,error=false){const n=$('#notice');n.hidden=false;n.textContent=textCN(message);n.className=error?'notice error':'notice';n.setAttribute('role',error?'alert':'status');}
const { api, absorb, mutate, command } = createApiClient({ state, $, textCN, render: () => render(), scheduleBot: () => scheduleBot(), notify });
function show(screen){
 if(state.screen!==screen && ['help','library'].includes(screen))state.previous=state.screen;
 state.screen=screen;clearTimeout(state.botTimer);
 for(const section of document.querySelectorAll('.screen'))section.hidden=section.id!=='screen-'+screen;
 window.scrollTo({top:0,behavior:'instant'});
 if(screen==='library')renderLibrary();
 if(screen==='help' && !state.rulesLoaded)api('/api/rules').then((result)=>{$('#full-rules').textContent=result.text;state.rulesLoaded=true;}).catch(()=>{$('#full-rules').textContent='规则书暂时无法载入，请稍后重试。';});
 render();
}
function scheduleBot(){botController.schedule();}
function modal(title,description,build,submit,label='确认'){
 if($('#interaction').open)return;
 clearTimeout(state.botTimer);$('#dialog-title').textContent=title;$('#dialog-description').textContent=description;$('#dialog-error').textContent='';$('#dialog-fields').replaceChildren();$('#dialog-confirm').disabled=false;$('#dialog-confirm').textContent=label;
 const controls=build();
 $('#interaction-form').onsubmit=async(event)=>{event.preventDefault();if(state.busy)return;try{if(await submit(controls)){$('#interaction').close();scheduleBot();}}catch(e){$('#dialog-error').textContent=e.message;}};
 $('#interaction').showModal();
}
$('#dialog-cancel').onclick=()=>{if(!state.busy){$('#interaction').close();scheduleBot();}};
$('#interaction').addEventListener('close',()=>{state.roomUtilityDialog=false;state.previewPath=null;if(state.screen==='play'&&state.game)renderBoard();scheduleBot();});
$('#interaction').addEventListener('cancel',(e)=>{if(state.busy)e.preventDefault();else setTimeout(scheduleBot,0);});
function field(label,input){const row=el('label',label,'field');row.append(input);$('#dialog-fields').append(row);return input;}
function select(label,options){const input=el('select');for(const [id,name] of options){const option=el('option',name);option.value=id;input.append(option);}return field(label,input);}
function number(label,value,min,max){const input=el('input');Object.assign(input,{type:'number',value,min,max,step:1,required:true,inputMode:'numeric'});return field(label,input);}
function boundedInteger(raw,min,max){
 const text=String(raw ?? '').trim();
 if(!/^\d+$/.test(text))throw new Error('请输入 '+min+' 至 '+max+' 的整数。');
 const value=Number(text);
 if(!Number.isSafeInteger(value)||value<min||value>max)throw new Error('请输入 '+min+' 至 '+max+' 的整数。');
 return value;
}
function confirm(title,description,submit){modal(title,description,()=>null,submit);}
function displayedMarketPrice(item){const eventPrice=state.game.activeEventId==='V_MERCHANT_SALE'?Math.ceil(item.marketPrice*.6):item.marketPrice;const openingDiscount=Number(state.game.round)===1?(state.balance.openingMarketDiscount??1):0;return Math.max(1,eventPrice-openingDiscount);}
function displayedBlackMarketPrice(){const base=state.balance.blackMarketBlindDrawPrice??3;return state.game.activeEventId==='V_MERCHANT_SALE'?Math.ceil(base*.6):base;}
function actionMark(type){return ({REFRESH_MARKET:'市',TAVERN:'骰',REFILL_FOOD:'粮',MINE:'镐',MINE_SEARCH:'查',INSPECT:'缉',EXCHANGE:'兑',SELL_CARD:'售',COLLECT_CONTRACT:'契',PICK_UP:'拾',USE_EQUIPMENT:'装',REMOVE_BLOCK:'拆',END_TURN:'休'})[type]||'行';}
function actionArt(type){return ({REFRESH_MARKET:'market',TAVERN:'market',REFILL_FOOD:'ration',MINE:'mine',MINE_SEARCH:'inspect',INSPECT:'inspect',EXCHANGE:'exchange',SELL_CARD:'market',COLLECT_CONTRACT:'cards',PICK_UP:'market',USE_EQUIPMENT:'cards',REMOVE_BLOCK:'block',END_TURN:'end',BUY_BLACK_MARKET:'market',PLAY_TACTIC:'cards',MOVE:'move'})[type]||'move';}
function cardFace(item){
 const face=el('div',undefined,'card-face');face.setAttribute('aria-label',item.name+'：'+item.text);
 const illustration=el('div',undefined,'card-face-art');const art=el('img');art.src='/assets/cards/'+item.id+'.png';art.alt='';art.loading='lazy';illustration.append(art);face.append(illustration);
 face.append(el('strong',item.name,'card-face-title'),el('span',item.text,'card-face-rules'));
 return face;
}
function showCardPreview(item){
 const dialog=$('#card-preview');$('#preview-kind').textContent=kinds[item.kind]||'卡牌';$('#preview-title').textContent=item.name;
 $('#preview-card').replaceChildren(cardFace(item),el('p',item.text,'preview-rule-copy'));if(!dialog.open)dialog.showModal();
}
$('#preview-close').onclick=()=>$('#card-preview').close();
const renderLibrary = createLibraryRenderer({ state, $, el, button, kinds, cardFace, showCardPreview });
function marketTile(item,price,action,status){
 const tile=el('article',undefined,'market-card');const look=button('',()=>showCardPreview(item));look.className='market-art-preview';look.setAttribute('aria-label','放大查看'+item.name);look.append(cardFace(item),el('small','放大查看牌面'));tile.append(look);
 const caption=el('div',undefined,'market-caption');caption.append(el('strong',price===null?status:price+' 官银'));tile.append(caption);
 if(action){const buy=button(action.command.type==='RENT_MOUNT'?'租借 · '+price+' 银':'购入 · '+price+' 银',()=>execute(action));buy.classList.add('art-command-button');buy.prepend(el('span',undefined,'button-seal art-market'));tile.append(buy);}
 else tile.append(el('small',status,'market-disabled'));return tile;
}
function actionLabel(a){
 const c=a.command;
 if(c.type==='BUY_MARKET'){const item=card(state.game.marketSlots[c.slot]);return a.label+' · '+displayedMarketPrice(item)+'官银';}
 if(c.type==='BUY_BLACK_MARKET')return a.label+' · '+displayedBlackMarketPrice()+'官银';
 return a.label;
}
function execute(action){
 const c=action.command,actor=state.game.characters.find((p)=>p.id===c.actorId);
 if(c.type==='END_TURN'&&actor.actionPoints>0)return confirm('结束本回合？','还有'+actor.actionPoints+'点行动力。结束后由下一角色行动。',()=>command(c));
 if(c.type==='BUY_MARKET'){
  const item=card(state.game.marketSlots[c.slot]),old=actor.equipped[item.slot];
  if(old)return confirm('更换装备',item.name+'将替换'+card(old).name+'，旧牌弃置。',()=>command(c));
 }
 return command(c);
}
function chooseAction(title,description,actions){
 if($('#interaction').open)return;
 if(actions[0]?.command.path?.length){state.previewPath=actions[0].command.path;renderBoard();}
 modal(title,description,()=>{
  const container=el('div',undefined,'action-choices');let selected=0;
  actions.forEach((a,i)=>{const row=el('label',undefined,'action-choice'),input=el('input');input.type='radio';input.name='action-choice';input.checked=i===0;input.onchange=()=>{selected=i;if(a.command.path){state.previewPath=a.command.path;renderBoard();}};
   const copy=el('span');copy.append(el('strong',actionLabel(a)),el('small',a.description||('消耗 '+(a.actionPointCost??0)+' 点行动')));row.append(input,copy);container.append(row);});
  $('#dialog-fields').append(container);return ()=>actions[selected];
 },async(get)=>{
  const a=get(),c=a.command,actor=state.game.characters.find((p)=>p.id===c.actorId),item=c.type==='BUY_MARKET'?card(state.game.marketSlots[c.slot]):null;
  if(item&&actor.equipped[item.slot])throw new Error('请从市场卡牌的购买按钮确认装备替换。');
  return command(c);
 },'确认执行');
}

function selectCard(id){
 state.selectedCard=state.selectedCard===id?null:id;state.previewPath=null;
 const actions=state.actions.filter((a)=>a.command.type==='PLAY_TACTIC'&&a.command.cardId===id);
 if(state.selectedCard&&actions.length&&!actions.some((a)=>a.command.targetId||a.command.path?.length)){
  state.selectedCard=null;chooseAction(card(id).name,card(id).text,actions);
 }
 render();
}
function inspectCharacter(actor){
 const targets=state.selectedCard?state.actions.filter((a)=>a.command.cardId===state.selectedCard&&a.command.targetId===actor.id):[];
 if(targets.length)return chooseAction(card(state.selectedCard).name,'目标：'+playerName(actor.id)+' · '+nodeName(actor.nodeId),targets);
 modal(playerName(actor.id),nodeName(actor.nodeId)+' · '+factionName(actor.faction),()=>{
  const p=el('p','粮草 '+actor.food+'　碎金 '+actor.gold+'　官银 '+actor.silver+'\n装备：'+(Object.values(actor.equipped).map((id)=>card(id).name).join('、')||'无')+'\n手牌数量：'+actor.hand.length);p.style.whiteSpace='pre-line';$('#dialog-fields').append(p);
 },async()=>true,'返回棋盘');
}

function renderHand(){
 const tray=$('#hand-tray');tray.replaceChildren();
 const actor=state.game.characters.find((c)=>c.id===state.decisionActorId);
 const lan=state.game.session.kind==='lan';
 const visible=lan ? (state.game.characters.find((c)=>c.id===state.handCharacterId&&state.me?.characterIds.includes(c.id)) || state.game.characters.find((c)=>c.id===(state.canAct?state.decisionActorId:state.me?.characterIds[0]))) : actor&&(state.game.session.kind!=='solo'||actor.faction===state.game.session.humanFaction)?actor:null;
 const choices=$('#hand-characters');choices.replaceChildren();choices.hidden=!lan;
 if(lan)for(const c of state.game.characters.filter((c)=>c.faction===state.me?.faction))choices.append(button(playerName(c.id)+(state.me.characterIds.includes(c.id)?' · 你':' · 队友'),()=>{state.handCharacterId=c.id;state.selectedCard=null;state.previewPath=null;render();}));
 const chosen=lan&&state.handCharacterId?state.game.characters.find((c)=>c.id===state.handCharacterId&&c.faction===state.me?.faction):visible;
 const handActor=chosen||visible;
 $('#hand-hint').hidden=!handActor?.hand.length;
 $('#hand-title').textContent=state.game.phase==='finished'?'本局已结束':handActor?playerName(handActor.id)+' · 手牌 '+handActor.hand.length+'/5':'等待你的回合';
 $('#hand-hint').textContent=state.selectedCard?'已选中「'+card(state.selectedCard).name+'」 · 点击发光棋子或目的地':'点击卡牌选取目标 · 每回合至多两张';
 if(lan&&!state.canAct)$('#hand-hint').textContent='可查看你方手牌 · 等待你的行动或响应窗口';
 if(state.game.pendingDecision&&!state.botPending&&(!lan||state.canAct))$('#hand-hint').textContent=state.game.pendingDecision.kind==='response'?'响应窗口 · 可使用亮起的响应牌，或在当前决策中放弃响应':'当前决策 · 仅亮起的卡牌可用，请先处理分箱、问话或选箱';
 if(!handActor){tray.append(el('p',state.game.phase==='finished'?'可回主菜单开始新的行程。':'对手正在行动。你的响应窗口出现时，手牌会自动切换。','empty-hand'));return;}
 if(!handActor.hand.length){tray.append(el('p','暂无手牌','empty-hand'));return;}
 handActor.hand.forEach((id)=>{
  const item=card(id),available=lan&&!state.canAct?[]:state.actions.filter((a)=>a.command.type==='PLAY_TACTIC'&&a.command.cardId===id&&a.command.actorId===handActor.id),row=button('',()=>selectCard(id),!available.length),slot=el('div',undefined,'hand-card-slot');
  row.className='playing-card card-illustrated'+(available.length?' playable':'')+(state.selectedCard===id?' picked':'');
  row.setAttribute('aria-label',item.name+'：'+item.text);
  row.setAttribute('aria-pressed',String(state.selectedCard===id));
  row.append(cardFace(item));
  row.append(el('small',available.length?'点击打出':item.timing==='responseToSearchOrRobbery'?'等待响应时机':'查看牌面与效果','card-footer'));
  slot.append(row);const look=button('放大查看',()=>showCardPreview(item));look.className='hand-preview-button';look.setAttribute('aria-label','放大查看'+item.name);slot.append(look);tray.append(slot);
 });
}
function setup(kind){return modeFlow.setup(kind);}
function pickup(actor){
 const drop=state.game.droppedItems[actor.nodeId];if(!drop)return;
 modal('拾取路上遗物','每回合一次。手牌上限五张；同槽装备替换现有装备。',()=>{
 const gold=number('碎金',drop.gold,0,drop.gold),silver=number('官银',drop.silver,0,drop.silver);
 const checks=(ids)=>ids.map((id)=>{const input=el('input');input.type='checkbox';input.value=id;field(card(id).name,input).parentElement.classList.add('check-row');return input;});
 return {gold,silver,hand:checks(drop.hand),equipment:checks(drop.equipment)};
 },(f)=>{const chosen=(items)=>items.filter((i)=>i.checked).map((i)=>i.value);const handIds=chosen(f.hand);if(handIds.length+actor.hand.length>5)throw new Error('手牌不能超过五张');return command({type:'PICK_UP',actorId:actor.id,gold:Number(f.gold.value),silver:Number(f.silver.value),handIds,equipmentIds:chosen(f.equipment)});},'确认拾取');
}
const drawBoard = createBoardRenderer({ state, $, playerName, factionName, nodeName, card, command, chooseAction, inspectCharacter });
const renderBoard = ()=>{drawBoard();tabletopEffects.refresh();};
$('#map-expand').onclick=()=>{const dialog=$('#map-detail');$('#map-detail-viewport').append($('#board'));dialog.showModal();};
$('#map-detail-close').onclick=()=>$('#map-detail').close();
$('#map-detail').addEventListener('close',()=>{$('#map-home-viewport').append($('#board'));});

function guideFor(g,active){
 if(g.phase==='finished')return ['行程结算','本局胜负已定。保存这份战报，或从主菜单开启新的行程。'];
 if(g.pendingDecision||state.botPending||(g.session.kind==='lan'&&!state.canAct)||state.decisionActorId!==g.activeCharacterId){const prompt=turnPrompt(state,playerName);return [prompt.title,prompt.detail];}
 if(!active)return ['轮前准备','关注事件旗帜；白驹与时辰铜锣会在这里生效。'];
 const sameNodeSmuggler=g.characters.find(c=>c.faction==='smuggler'&&c.nodeId===active.nodeId&&!c.deadUntilRound);
 if(active.faction==='officer'&&sameNodeSmuggler&&active.actionPoints<=0&&checkpointIds.has(active.nodeId))return ['稽查准备','你与'+playerName(sameNodeSmuggler.id)+'同处稽查站，但稽查仍需至少 1 点行动。此回合已无法发动，结束回合后留意对方是否离开。'];
 if(active.nodeId==='MINE'){
  if(g.activeEventId==='V_MINE_COLLAPSE')return ['矿洞封闭','本轮不能采矿。移动离开，或结束回合等待下一轮矿脉恢复。'];
  if(active.mineActionsThisTurn>=(state.balance.mineActionsPerTurn??2))return ['矿工歇息','这名角色本回合已采矿'+(state.balance.mineActionsPerTurn??2)+'次。碎金已装车，规划下一段押运路线。'];
  if(g.mineOutputRemaining===0)return ['矿脉已空','其他人已采完本轮矿脉。下一轮恢复前，建议离开或调整站位。'];
  const mined=g.mineOutputByFaction||{smuggler:0,officer:0};
  const mineCount=mined[active.faction]||0;
  if(mineCount>=(state.balance.mineFactionOutputLimit??4))return ['本阵营矿车已满','本阵营本轮已装满 '+(state.balance.mineFactionOutputLimit??4)+' 枚碎金；留给对方的矿额不受影响。建议押运或转向市场。'];
  const depot=active.faction==='smuggler'?'边境黑市':'墨尔根';
  const actionLimit=state.balance.mineActionsPerTurn??2,quota=state.balance.mineFactionOutputLimit??4;
  return ['采矿与撤离','矿脉还剩 '+g.mineOutputRemaining+' 枚；本阵营已取 '+mineCount+'/'+quota+' 枚，你本回合已采 '+active.mineActionsThisTurn+'/'+actionLimit+' 次。采到碎金后沿驿道前往'+depot+'交金。'];
 }
 const depot=active.faction==='smuggler'?'边境黑市':'墨尔根';
 if(active.gold>0)return ['押运目标','你携带 '+active.gold+' 枚碎金。前往'+depot+'后，在地点行动中兑换为声望。'];
 if(active.actionPoints===0)return ['本回合结束','行动点已用完。按“结束回合”，轮到下一名角色。'];
 if(g.activeEventId==='V_MINE_COLLAPSE')return ['矿洞封闭','本轮不能采矿。不要急着前往漠河金矿；可在驿站准备、购买功能牌，或调整下一轮的拦截站位。'];
 return ['下一步建议','先向漠河金矿推进并采矿。地图亮圈是本回合可达终点，点击后查看费用再确认。'];
}

function renderGuide(g,active){
 const panel=$('#guide-strip');panel.replaceChildren();const [title,detail]=guideFor(g,active);
 panel.append(el('span','行前指引','guide-stamp'),el('strong',title),el('p',detail));
}

const { renderResult, renderDecision, renderOperations } = createGamePanels({ state, $, el, button, factionName, playerName, card, modal, field, number, boundedInteger, command, execute, actionMark, actionArt, actionLabel, chooseAction, displayedMarketPrice, displayedBlackMarketPrice, marketTile, pickup, setup, render: () => render(), renderBoard, nodeName });

function render(){
 lobby.renderLobby();
 hall.render();
 onboarding.render();
 tutorial.render();renderStatistics();syncButton.hidden=!!state.room;
  actionDie.render();
  if(state.screen!=='play')tabletopEffects.render();
 $('#home-load').hidden=!state.localAvailable||!!state.room;
 if(state.room){$('#resume').disabled=false;$('#resume').textContent=state.game?'返回联机对局':'返回联机房间';$('#home-status').textContent='房间 '+state.room.code+' · '+state.room.capacity+' 人局 · '+(state.roomConnection==='connected'?'自动同步与保存':'正在恢复连接…');}
 else {$('#resume').textContent=state.tutorial?'继续实操教学':'继续当前对局';$('#resume').disabled=!state.game?.log.length;$('#home-status').textContent=state.localAvailable?'先选择一种游玩方式。':'已连接主机，请选择局域网对战。';}
 const g=state.game;if(!g||!state.map)return;
 if(!state.room)$('#home-status').textContent=g.log.length?'自动恢复已就绪 · 第'+g.round+'轮 · '+phases[g.phase]:'先选择一种游玩方式。';
 if(state.tutorial)$('#home-status').textContent=state.tutorial.finished?'实操教学已完成':'实操教学 · 第'+(state.tutorial.stage+1)+'／'+state.tutorial.total+'步';
 if(state.screen==='library')renderLibrary();
 if(state.screen!=='play')return;
 const active=renderHud(g);
 renderTurnPrompt();
 renderSurvival();
 renderResult(g);renderBoard();renderDecision();renderOperations();renderHand();renderGuide(g,active);
 renderPlayerTableaux({state,el,button,playerName,nodeName,card,inspectCharacter,resourceIcon});
  tabletopEffects.render();
 tutorial.render();actionFeedback.render();
 const log=$('#log');log.replaceChildren();for(const entry of g.log.slice(-35).reverse())log.append(el('li',textCN(entry.message)));
 $('#projection-summary').textContent=$('#summary').textContent;
 const projectionLog=$('#projection-log');projectionLog.replaceChildren();for(const entry of g.log.slice(-60).reverse())projectionLog.append(el('li',textCN(entry.message)));
 scheduleBot();
}
$('#card-search').oninput=$('#card-kind').onchange=renderLibrary;
const hintsButton=$('#toggle-hints');
function setHintsVisible(visible){document.body.classList.toggle('hints-hidden',!visible);hintsButton.textContent=visible?'隐藏提示':'显示提示';hintsButton.setAttribute('aria-pressed',String(visible));try{localStorage.setItem('golden-post-road-hints',visible?'show':'hide');}catch{}}
hintsButton.onclick=()=>setHintsVisible(document.body.classList.contains('hints-hidden'));
try{setHintsVisible(localStorage.getItem('golden-post-road-hints')!=='hide');}catch{setHintsVisible(true);}
const lobby = createLobbyController({ state, $, el, button, api, absorb, mutate, show, render, notify, confirm, modal, field, select, playerName, factionName });
const modeFlow=createModeFlow({state,$,api,absorb,mutate,notify,show,confirm,render});
const botController=createBotController({state,$,mutate,render});
bindSaveControls({state,$,api,mutate,lobby,modal,el,field,select,notify,scheduleBot,show});
bindReportView({state,$,render});
const renderHud=createGameHud({state,$,el,phases,factionName,playerName,nodeName,textCN,resourceIcon,portrait,card});
const renderTurnPrompt=createTurnPrompt({state,$,playerName});
const hall=createHallController({state,$,render});
const onboarding=createOnboarding({state,$,el,button,show,setup});
const renderSurvival=createSurvivalAdvisor({state,$,playerName,nodeName,el});
const tabletopEffects=createTabletopEffects({state,$,textCN,playerName});
const actionDie=createActionDie({state,$,playerName});
const tutorial=createTutorial({state,$,el,button,api,absorb,mutate,show,notify});
const actionFeedback=createActionFeedback({state,$,el,button,textCN});
const renderStatistics=bindStatistics({state,$,el,button,api,modal,notify});
const syncButton=button('重新同步本地进度',async()=>{absorb(await api(state.tutorial?'/api/game/tutorial':'/api/game'));render();notify('已同步主机保存的最新进度。');});$('#effects-toggle').before(syncButton);
const settingsMenu=$('.game-toolbar');
document.addEventListener('pointerdown',event=>{if(settingsMenu.open&&!settingsMenu.contains(event.target))settingsMenu.open=false;});
document.addEventListener('keydown',event=>{if(event.key==='Escape')settingsMenu.open=false;});
async function init(){
 try{
  const [session,map,cards]=await Promise.all([api('/api/session'),api('/api/map'),api('/api/cards')]);
  state.map=map;state.cards=cards.cards;hall.configure(session);
  if(session.local){absorb(await api('/api/game'));await tutorial.restore();}
  await lobby.restore();render();
 }catch(e){notify('连接失败，正在重试；请确认主机服务已启动。',true);setTimeout(init,3000);}
}
init();
