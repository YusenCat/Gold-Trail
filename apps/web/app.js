import { createApiClient } from './modules/api.js';
import { createBoardRenderer } from './modules/board.js';
import { createGamePanels } from './modules/panels.js';
import { createLibraryRenderer } from './modules/library.js';
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
 return n?.siteName || n?.label?.replace(/C$/,'丙').replace(/D$/,'丁').replace(/E$/,'戊').replace(/F$/,'己') || (id || '').replace(/^W/,'西路·').replace(/^E/,'东路·').replace(/^N/,'北路·').replace(/^R/,'绕行道·');
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
function notify(message,error=false){const n=$('#notice');n.hidden=false;n.textContent=textCN(message);n.className=error?'notice error':'notice';}
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
function scheduleBot(){
 clearTimeout(state.botTimer);
 if(state.screen!=='play'||!state.botPending||state.botPaused||state.busy||$('#interaction').open||$('#report-projection').open)return;
 state.botTimer=setTimeout(async()=>{if(state.screen==='play'&&!state.botPaused)await mutate('/api/game/bot-step');},state.botDelay??1000);
}
function modal(title,description,build,submit,label='确认'){
 if($('#interaction').open)return;
 clearTimeout(state.botTimer);$('#dialog-title').textContent=title;$('#dialog-description').textContent=description;$('#dialog-error').textContent='';$('#dialog-fields').replaceChildren();$('#dialog-confirm').disabled=false;$('#dialog-confirm').textContent=label;
 const controls=build();
 $('#interaction-form').onsubmit=async(event)=>{event.preventDefault();if(state.busy)return;try{if(await submit(controls)){$('#interaction').close();scheduleBot();}}catch(e){$('#dialog-error').textContent=e.message;}};
 $('#interaction').showModal();
}
$('#dialog-cancel').onclick=()=>{if(!state.busy){$('#interaction').close();scheduleBot();}};
$('#interaction').addEventListener('close',()=>{state.previewPath=null;if(state.screen==='play')renderBoard();scheduleBot();});
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
 $('#preview-card').replaceChildren(cardFace(item));if(!dialog.open)dialog.showModal();
}
$('#preview-close').onclick=()=>$('#card-preview').close();
const reportDialog=$('#report-projection');
let reportRestorePause=false;
function setReportCollapsed(collapsed){
 $('#log').hidden=collapsed;
 $('#report-toggle').textContent=collapsed?'展开':'收起';
 $('#report-toggle').setAttribute('aria-expanded',String(!collapsed));
 $('.report-panel').classList.toggle('collapsed',collapsed);
}
function closeReportProjection(){
 if(!reportDialog.open)return;
 reportDialog.close();
 setReportCollapsed(true);
 state.botPaused=reportRestorePause;
 render();
}
$('#report-toggle').onclick=()=>setReportCollapsed(!$('#log').hidden);
$('#report-project').onclick=()=>{
 if(!state.game)return;
 reportRestorePause=state.botPaused;
 state.botPaused=true;
 clearTimeout(state.botTimer);
 render();
 reportDialog.showModal();
};
reportDialog.addEventListener('click',closeReportProjection);
reportDialog.addEventListener('cancel',(event)=>{event.preventDefault();closeReportProjection();});
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
 const visible=actor&&(state.game.session.kind!=='solo'||actor.faction===state.game.session.humanFaction)?actor:null;
 $('#hand-title').textContent=state.game.phase==='finished'?'本局已结束':visible?playerName(visible.id)+' · 手牌 '+visible.hand.length+'/5':'等待你的回合';
 $('#hand-hint').textContent=state.selectedCard?'已选中「'+card(state.selectedCard).name+'」 · 点击发光棋子或目的地':'点击卡牌选取目标 · 每回合至多两张';
 if(!visible){tray.append(el('p',state.game.phase==='finished'?'可以保存战局，或回主菜单开始新的行程。':'对手正在行动。你的响应窗口出现时，手牌会自动切换。','empty-hand'));return;}
 if(!visible.hand.length){tray.append(el('p','行囊里还没有功能牌。到驿站购买明牌，或在黑市盲抽。','empty-hand'));return;}
 visible.hand.forEach((id)=>{
  const item=card(id),available=state.actions.filter((a)=>a.command.type==='PLAY_TACTIC'&&a.command.cardId===id),row=button('',()=>selectCard(id),!available.length),slot=el('div',undefined,'hand-card-slot');
  row.className='playing-card card-illustrated'+(available.length?' playable':'')+(state.selectedCard===id?' picked':'');
  row.setAttribute('aria-label',item.name+'：'+item.text);
  row.setAttribute('aria-pressed',String(state.selectedCard===id));
  row.append(cardFace(item));
  row.append(el('small',available.length?'点击打出':item.timing==='responseToSearchOrRobbery'?'等待响应时机':'查看牌面与效果','card-footer'));
  slot.append(row);const look=button('放大查看',()=>showCardPreview(item));look.className='hand-preview-button';look.setAttribute('aria-label','放大查看'+item.name);slot.append(look);tray.append(slot);
 });
}
function setup(kind){
 state.setupKind=kind;$('#setup-title').textContent=kind==='solo'?'本地人机对战':'本地同屏对局';$('#faction-choice').hidden=kind!=='solo';show('setup');
}
$('#setup-form').onsubmit=async(event)=>{
 event.preventDefault();const form=new FormData(event.target);
 const start=async()=>{const ok=await mutate('/api/game/new',{kind:state.setupKind,mode:form.get('mode'),humanFaction:form.get('faction'),start:true});if(ok){state.botPaused=false;show('play');}return ok;};
 if(state.game?.log.length && state.game.phase!=='finished')confirm('替换当前对局？','新局会替换当前未保存进度，请先保存需要保留的行程。',start);else await start();
};
$('#mode-solo').onclick=()=>setup('solo');$('#mode-hotseat').onclick=()=>setup('hotseat');
$('#nav-home').onclick=()=>show('home');$('#nav-help').onclick=$('#home-help').onclick=()=>show('help');$('#nav-library').onclick=()=>show('library');$('#setup-back').onclick=()=>show('home');
for(const b of document.querySelectorAll('.return-game'))b.onclick=()=>show(state.previous);
$('#resume').onclick=()=>show('play');
for(const b of document.querySelectorAll('[data-tab]'))b.onclick=()=>{state.tab=b.dataset.tab;render();};
$('#bot-pause').onclick=()=>{state.botPaused=!state.botPaused;render();};
$('#bot-speed').onclick=()=>{state.botDelay=state.botDelay===350?1000:350;render();};
document.addEventListener('keydown',(event)=>{if(event.key==='Escape'&&!$('#interaction').open&&state.selectedCard){state.selectedCard=null;state.previewPath=null;render();}});
$('#save').onclick=()=>{
 let overwrite=false;
 modal('保存行程','每个名称对应独立存档。输入新名称；同名存档会先询问是否覆盖。',()=>{
  const i=el('input');i.required=true;i.maxLength=48;i.autocomplete='off';i.value='第'+state.game.round+'轮-'+Date.now().toString().slice(-6);return field('存档名称',i);
 },async(i)=>{
  try{await api('/api/saves',{name:i.value.trim(),overwrite});notify(overwrite?'存档已覆盖并更新。':'新存档已创建。');return true;}
  catch(e){if(e.status===409&&!overwrite){overwrite=true;$('#dialog-description').textContent='“'+(e.data.conflict?.name||i.value.trim())+'”已存在。再次点击“确认覆盖”会更新这个存档；取消则保留原存档。';$('#dialog-confirm').textContent='确认覆盖';return false;}throw e;}
 },'新建存档');
};
async function load(){
 clearTimeout(state.botTimer);
 try{
 const {saves}=await api('/api/saves');
 if(!saves.length){notify('还没有本地存档。');scheduleBot();return;}
 const modeName=(s)=>s.mode==='fixedRounds'?'固定轮数':'竞速';
 const sessionName=(s)=>s.kind==='solo'?'人机':'本地双人';
 const phaseName=(s)=>({preEvent:'轮前准备',eventReveal:'事件揭示',supply:'粮草结算',characterTurn:'角色行动',roundEnd:'轮末结算',finished:'已结束'}[s.phase]||'进行中');
 const optionLabel=(s)=>`${s.name}　·　第${s.round}轮　·　${modeName(s)}${s.kind?' / '+sessionName(s):''}${s.faction?' / '+(s.faction==='smuggler'?'走私者':'官兵'):''}　·　${phaseName(s)}　·　${new Date(s.savedAt).toLocaleString('zh-CN')}`;
 modal('读取行程','选择要读取的独立存档。读取后会替换当前对局；自动恢复进度不会出现在此列表。旧规则存档会保留，但不能用于当前规则。',()=>select('可读取存档',saves.map((s)=>[s.id,optionLabel(s)])),async(i)=>{const ok=await mutate('/api/saves/load',{id:i.value});if(ok){state.botPaused=false;show('play');}return ok;},'读取所选存档');
 }catch(e){notify(e.message,true);scheduleBot();}
}
$('#load').onclick=$('#home-load').onclick=load;
function pickup(actor){
 const drop=state.game.droppedItems[actor.nodeId];if(!drop)return;
 modal('拾取路上遗物','每回合一次。手牌上限五张；同槽装备替换现有装备。',()=>{
 const gold=number('碎金',drop.gold,0,drop.gold),silver=number('官银',drop.silver,0,drop.silver);
 const checks=(ids)=>ids.map((id)=>{const input=el('input');input.type='checkbox';input.value=id;field(card(id).name,input).parentElement.classList.add('check-row');return input;});
 return {gold,silver,hand:checks(drop.hand),equipment:checks(drop.equipment)};
 },(f)=>{const chosen=(items)=>items.filter((i)=>i.checked).map((i)=>i.value);const handIds=chosen(f.hand);if(handIds.length+actor.hand.length>5)throw new Error('手牌不能超过五张');return command({type:'PICK_UP',actorId:actor.id,gold:Number(f.gold.value),silver:Number(f.silver.value),handIds,equipmentIds:chosen(f.equipment)});},'确认拾取');
}
const renderBoard = createBoardRenderer({ state, $, playerName, factionName, nodeName, card, command, chooseAction, inspectCharacter });

function guideFor(g,active){
 if(g.phase==='finished')return ['行程结算','本局胜负已定。保存这份战报，或从主菜单开启新的行程。'];
 if(g.pendingDecision)return ['需要回应','当前不是普通回合。先完成右侧“当前决策”，再继续行程。'];
 if(state.botPending)return ['对手行棋','人机正在落子；它结束后会自动交回你的角色。可用右上角暂停。'];
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

const { renderResult, renderDecision, renderOperations } = createGamePanels({ state, $, el, button, factionName, playerName, card, modal, field, number, boundedInteger, command, execute, actionMark, actionArt, actionLabel, chooseAction, displayedMarketPrice, displayedBlackMarketPrice, marketTile, pickup, setup, render: () => render(), renderBoard });

function render(){
 const g=state.game;if(!g||!state.map)return;
 $('#resume').disabled=!g.log.length;$('#home-status').textContent=g.log.length?'自动恢复已就绪 · 第'+g.round+'轮 · '+phases[g.phase]+' · 每次落子都会保留。':'先选择一种游玩方式。';
 if(state.screen==='library')renderLibrary();
 if(state.screen!=='play')return;
 const active=g.characters.find((c)=>c.id===g.activeCharacterId);
 $('#summary').textContent=(g.session.kind==='solo'?'人机对战 · 你是'+factionName(g.session.humanFaction):'同屏对局')+'　｜　第'+g.round+'轮 · '+phases[g.phase]+'　｜　走私者 '+g.reputation.smuggler+' / 官兵 '+g.reputation.officer+' 声望';
 $('#bot-pause').hidden=g.session.kind!=='solo';$('#bot-pause').textContent=state.botPaused?'继续人机':'暂停人机';
 $('#bot-speed').hidden=g.session.kind!=='solo';$('#bot-speed').textContent='人机速度 · '+(state.botDelay===350?'快速':'正常');
 $('#autosave-state').textContent='自动保留 · 第'+g.round+'轮';
 const track=$('#turn-track');track.replaceChildren();
 g.turnOrder.forEach((id,index)=>{const c=g.characters.find((c)=>c.id===id),piece=el('span',undefined,'turn-piece '+c.faction+(id===g.activeCharacterId?' active':''));if(id===g.activeCharacterId)piece.setAttribute('aria-current','step');piece.append(el('small',String(index+1)),el('strong',playerName(id)),el('span',g.phase==='finished'?'已结算':c.deadUntilRound?'等待复活':g.phase==='preEvent'?'轮前准备':id===g.activeCharacterId?'正在行动':index<g.turnIndex?'已行动':'待命'));track.append(piece);});
 $('#last-action').textContent=g.log.length?textCN(g.log.at(-1).message):'行程即将开始';
 const event=$('#event-banner');event.replaceChildren();
 if(g.phase==='finished')event.append(el('strong',g.winner==='draw'?'本局平分秋色':factionName(g.winner)+'获胜'),el('p','可保存战局，或回主菜单再来一局。'));
 else if(g.activeEventId)event.append(el('strong','本轮事件 · '+card(g.activeEventId).name),el('p',card(g.activeEventId).text));
 else event.append(el('strong','轮前准备'),el('p','在事件揭示前，处理白驹与铜锣。'));
 const info=$('#active-character');info.replaceChildren();
 if(active){
 info.append(el('strong',playerName(active.id)+' · '+nodeName(active.nodeId)));
 const resources=el('div',undefined,'resource-grid');for(const [label,value,kind] of [['行动 · 骰'+(active.actionRoll??'—'),active.actionPoints,null],['粮草',active.food,'food'],['碎金',active.gold,'gold'],['官银',active.silver,'silver']]){const token=el('span',undefined,'resource-token'),caption=el('small');if(kind)caption.append(resourceIcon(kind));caption.append(document.createTextNode(label));token.append(caption,el('strong',String(value)));resources.append(token);}info.append(resources);
 const statuses=[];if(active.mountId)statuses.push(card(active.mountId).name+' · 余'+active.mountTurnsRemaining+'回合');if(active.sealedGold)statuses.push('密封金 '+active.sealedGold);if(active.lockbox.gold+active.lockbox.silver)statuses.push('密匣：金'+active.lockbox.gold+' / 银'+active.lockbox.silver);if(active.tacticsBlockedThisTurn)statuses.push('本回合禁用功能牌');if(active.hubEntryBanTurns)statuses.push('暂禁进入驿站');if(active.controlledById)statuses.push('受'+playerName(active.controlledById)+'控制移动');info.append(el('p',statuses.join(' · '),'muted'));
 }
 $('#turn-hint').textContent=g.phase==='finished'?'对局结束':state.botPending?(state.botPaused?'人机已暂停':'对手正在行动，遇到你的决策会自动停下。'):'等待'+playerName(state.decisionActorId)+'操作。';
 renderResult(g);renderBoard();renderDecision();renderOperations();renderHand();renderGuide(g,active);
 const characters=$('#characters');characters.replaceChildren();
 for(const c of g.characters){const row=el('div',undefined,'character '+c.faction+(c.id===g.activeCharacterId?' selected':'')),detail=el('p');detail.append(document.createTextNode(nodeName(c.nodeId)+'　'));for(const [label,value,kind] of [['粮',c.food,'food'],['金',c.gold,'gold'],['银',c.silver,'silver']]){const resource=el('span',undefined,'roster-resource');resource.append(resourceIcon(kind),document.createTextNode(label+' '+value));detail.append(resource);}row.append(el('strong',playerName(c.id)+(g.session.kind==='solo'?(c.faction===g.session.humanFaction?' · 你方':' · 人机'):'')),detail,el('small','手牌 '+c.hand.length+' · 装备 '+Object.values(c.equipped).map((id)=>card(id).name).join('、')));if(c.deadUntilRound)row.append(el('p','第'+c.deadUntilRound+'轮复活'));characters.append(row);}
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
async function init(){try{const [view,map,cards]=await Promise.all([api('/api/game'),api('/api/map'),api('/api/cards')]);state.map=map;state.cards=cards.cards;absorb(view);render();}catch(e){notify('连接失败，请启动服务后刷新页面。',true);}}
init();
