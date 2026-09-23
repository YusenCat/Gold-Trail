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
function button(label,action,disabled=false){const b=el('button',label);b.type='button';b.disabled=disabled||state.busy;b.onclick=async()=>{if(state.busy)return;try{await action();}catch(e){notify(e.message,true);}};return b;}
function notify(message,error=false){const n=$('#notice');n.hidden=false;n.textContent=textCN(message);n.className=error?'notice error':'notice';}
async function api(path,body){
 const response=await fetch(path,body===undefined?{}:{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(body)});
 const data=await response.json();if(!response.ok){const error=new Error(data.error||'服务暂时不可用');error.status=response.status;error.data=data;throw error;}return data;
}
function absorb(view){if(view.game){state.selectedCard=null;state.previewPath=null;Object.assign(state,{game:view.game,actions:view.actions||[],legalMoves:view.legalMoves||[],balance:view.balance||{},botPending:view.botPending,decisionActorId:view.decisionActorId});}}
async function mutate(path,body={}){
 if(state.busy)return false;
 state.busy=true;clearTimeout(state.botTimer);document.body.classList.add('busy');
 try {absorb(await api(path,{...body,revision:state.game?.revision}));$('#notice').hidden=true;return true;}
 catch(e){notify(e.message,true);$('#dialog-error').textContent=textCN(e.message);if(path.includes('bot-step'))state.botPaused=true;try{absorb(await api('/api/game'));}catch{}return false;}
 finally{state.busy=false;document.body.classList.remove('busy');render();}
}
const command=(payload)=>mutate('/api/game/command',payload);
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
 if(state.screen!=='play'||!state.botPending||state.botPaused||state.busy||$('#interaction').open)return;
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
function cardFace(item){
 const face=el('div',undefined,'card-face');face.setAttribute('aria-label',item.name+'：'+item.text);
 const art=el('img');art.src='/assets/cards/'+item.id+'.png';art.alt='';art.loading='lazy';face.append(art);
 face.append(el('strong',item.name,'card-face-title'),el('span',item.text,'card-face-rules'));
 return face;
}
function marketTile(item,price,action,status){
 const tile=el('article',undefined,'market-card');tile.append(cardFace(item));
 const caption=el('div',undefined,'market-caption');caption.append(el('strong',price===null?status:price+' 官银'));tile.append(caption);
 if(action)tile.append(button(action.command.type==='RENT_MOUNT'?'租借 · '+price+' 银':'购入 · '+price+' 银',()=>execute(action)));
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
  const item=card(id),available=state.actions.filter((a)=>a.command.type==='PLAY_TACTIC'&&a.command.cardId===id),row=button('',()=>selectCard(id),!available.length);
  row.className='playing-card card-illustrated'+(available.length?' playable':'')+(state.selectedCard===id?' picked':'');
  row.setAttribute('aria-label',item.name+'：'+item.text);
  row.append(cardFace(item));
  row.append(el('small',available.length?'点击打出':item.timing==='responseToSearchOrRobbery'?'等待响应时机':'查看牌面与效果','card-footer'));
  tray.append(row);
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
function svg(tag,attributes,text){const e=document.createElementNS('http://www.w3.org/2000/svg',tag);for(const [k,v]of Object.entries(attributes))e.setAttribute(k,v);if(text)e.textContent=text;return e;}
function renderBoard(){
 const board=$('#board');board.replaceChildren();const nodes=Object.fromEntries(state.map.nodes.map((n)=>[n.id,n]));
 const landscape=svg('g',{class:'landscape','aria-hidden':'true'});
 for(const [x,y,s] of [[-5,-4,1.2],[-3.9,-4.3,.9],[-2.6,-3.8,1.3],[-5.7,-2.3,.7],[1.4,-3,.8],[2.2,-3.3,.65],[1.4,-1.5,.55]]){
  landscape.append(svg('path',{d:'M-1 .7 L-.3 -.8 L.1 -.2 L.5 -1.2 L1.2 .7 M-.3 -.8 L-.1 -.35 L.1 -.2 M.5 -1.2 L.65 -.6 L.9 -.25',transform:`translate(${x} ${y}) scale(${s})`,class:'mountain'}));
 }
 landscape.append(svg('text',{x:-4.4,y:-5.7,class:'map-title'},'兴 安 雪 岭'),svg('text',{x:1.9,y:-4.1,class:'map-region'},'林海绕行道'),svg('text',{x:-3,y:-.5,class:'map-region'},'墨尔根官道'),svg('text',{x:-4.6,y:-1.25,class:'map-caption'},'风雪八百里 · 黄金二十二驿'));
 board.append(landscape);
 for(const route of state.map.routes)for(let i=1;i<route.nodes.length;i++){
 const a=nodes[route.nodes[i-1]],b=nodes[route.nodes[i]],blocked=state.game.blockedEdges.includes([a.id,b.id].sort().join('::'));
 board.append(svg('line',{x1:a.x,y1:-a.y,x2:b.x,y2:-b.y,class:'route'+(blocked?' blocked-route':'')}));
 }
 const moveTypes=['MOVE','FREE_MOVE','PRE_EVENT_MOVE','CONTROLLED_MOVE'];
 const boardActions=state.selectedCard?state.actions.filter((a)=>a.command.cardId===state.selectedCard&&a.command.path?.length):state.actions.filter((a)=>moveTypes.includes(a.command.type)&&a.command.path?.length);
 if(state.previewPath){
  const actor=state.game.characters.find((c)=>c.id===state.game.activeCharacterId);
  if(actor)board.append(svg('polyline',{points:[actor.nodeId,...state.previewPath].map((id)=>nodes[id].x+','+-nodes[id].y).join(' '),class:'route-preview'}));
 }
 for(const node of state.map.nodes){
 const options=boardActions.filter((a)=>a.command.path.at(-1)===node.id).sort((a,b)=>(a.actionPointCost??0)-(b.actionPointCost??0)||a.command.path.length-b.command.path.length),action=options[0];
 const group=svg('g',{transform:'translate('+node.x+' '+-node.y+')',class:'node '+(node.type==='road'?'':'safe ')+(action?'reachable':'')});
 group.classList.toggle('encounter-site',Boolean(node.site));
 const displayName=nodeName(node.id),siteNote=node.siteName&&node.siteName!==displayName?' · '+node.siteName:'';
 group.append(svg('circle',{r:node.type==='road'?'.19':'.27'}),svg('title',{},displayName+siteNote+(node.site?'（抵达时触发驿路遭遇）':'')));
 if(node.type!=='road')group.append(svg('path',{d:node.type==='mine'?'M-.14 .1 L-.04 -.12 L.03 -.04 L.1 -.16 L.2 .1 Z':node.type==='checkpoint'?'M-.16 .15 V-.13 H.16 V.15 M-.22 -.13 H.22 M0 -.13 V.15':'M-.18 -.02 L0 -.17 L.18 -.02 M-.12 -.02 V.14 H.12 V-.02 M-.035 .14 V.03 H.035 V.14',class:'location-icon'}));
 if(node.site)group.append(svg('text',{y:'.08',class:'site-symbol'},({forage:'粮',forest:'林',caravan:'商',ruins:'遗',signal:'烽'})[node.site]));
 if(node.label)group.append(svg('text',{y:'-.39'},nodeName(node.id)));
 if(state.game.droppedItems[node.id])group.append(svg('text',{y:'.6',class:'drop-label'},'遗物'));
 if(action){group.setAttribute('role','button');group.setAttribute('tabindex','0');group.setAttribute('aria-label','前往'+nodeName(node.id));const go=()=>{if(state.busy)return;state.previewPath=action.command.path;renderBoard();chooseAction('前往'+nodeName(node.id),'金色虚线是推荐路线。确认后移动，取消不会消耗行动。',options);};group.onclick=go;group.onkeydown=(e)=>{if(e.key==='Enter'||e.key===' '){e.preventDefault();go();}};}
 board.append(group);
 }
 for(const actor of state.game.characters){
 if(actor.deadUntilRound)continue;
 const occupants=state.game.characters.filter((c)=>c.nodeId===actor.nodeId&&!c.deadUntilRound),index=occupants.indexOf(actor),n=nodes[actor.nodeId];
 const target=state.selectedCard&&state.actions.some((a)=>a.command.cardId===state.selectedCard&&a.command.targetId===actor.id);
 const pawn=svg('g',{class:'pawn-group '+actor.faction+(actor.id===state.game.activeCharacterId?' current':'')+(target?' targetable':''),transform:`translate(${n.x+(index-(occupants.length-1)/2)*.48} ${-n.y+.46})`,role:'button',tabindex:'0','aria-label':playerName(actor.id)+(target?' · 选为目标':' · 查看角色')});
 pawn.append(svg('ellipse',{cx:0,cy:.27,rx:.23,ry:.07,class:'pawn-shadow'}),svg('circle',{r:.235,class:'pawn-medallion'}));
 pawn.append(svg('path',{d:actor.faction==='officer'?'M-.19 .15 L-.13 -.03 H.13 L.19 .15 L0 .21 Z':'M-.2 .16 L-.14 -.05 L0 -.12 L.14 -.05 L.2 .16 Z',class:'pawn-coat'}));
 pawn.append(svg('path',{d:'M-.075 -.12 Q0 -.2 .075 -.12 L.065 -.015 Q0 .055 -.065 -.015 Z',class:'pawn-face'}));
 pawn.append(svg('path',{d:actor.faction==='officer'?'M-.13 -.09 Q-.14 -.26 0 -.26 Q.14 -.26 .13 -.09 Z M0 -.26 L.04 -.36 M-.15 -.08 H.15':'M-.15 -.03 Q-.2 -.26 0 -.27 Q.19 -.24 .15 .01 L.09 -.12 Q0 -.21 -.09 -.1 Z M-.075 -.035 L.09 -.02 L.02 .07 Z',class:'pawn-headgear'}));
 pawn.append(svg('path',{d:actor.faction==='officer'?'M-.12 .07 H.12 M-.08 .13 H.08 M0 .03 V.19':'M-.12 .03 L.13 .17 M.04 .03 L-.09 .17',class:'pawn-trim'}));
 pawn.append(svg('circle',{cx:.16,cy:.18,r:.09,class:'pawn-badge'}),svg('text',{x:.16,y:.218,'text-anchor':'middle',class:'pawn-number'},actor.id.endsWith('1')?'一':'二'),svg('title',{},playerName(actor.id)));
 pawn.onclick=()=>{if(!state.busy)inspectCharacter(actor);};pawn.onkeydown=(e)=>{if(e.key==='Enter'||e.key===' '){e.preventDefault();if(!state.busy)inspectCharacter(actor);}};board.append(pawn);
 }
 $('#board-prompt').textContent=state.selectedCard?'已选「'+card(state.selectedCard).name+'」 · 点击发光目标，再确认出牌':state.botPending?'对手行棋中 · 可点击棋子查看状态':'落到带字圆点会触发一次驿路遭遇 · 点击亮圈规划移动';
 const active=state.game.characters.find((c)=>c.id===state.game.activeCharacterId);
 const mined=state.game.mineOutputByFaction||{smuggler:0,officer:0},quota=state.balance.mineFactionOutputLimit??4;
 const mineText=state.game.activeEventId==='V_MINE_COLLAPSE'?'本轮矿洞塌方 · 暂停采矿':'本轮矿脉余量 '+state.game.mineOutputRemaining+' 枚 · 走私者 '+mined.smuggler+'/'+quota+' · 官兵 '+mined.officer+'/'+quota;
 $('#board-status').textContent=active?.nodeId==='MINE'?mineText:'金矿情报 · '+mineText;
}

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

function renderResult(g){
 const panel=$('#result-panel');panel.replaceChildren();panel.hidden=g.phase!=='finished';if(g.phase!=='finished')return;
 const title=g.winner==='draw'?'平分秋色':factionName(g.winner)+'赢得此局';
 const left=el('div',undefined,'result-title');left.append(el('small',g.mode==='race'?'竞速局结算':'三十轮火并结算'),el('h2',title),el('p','第'+g.round+'轮结束 · 自动恢复已保留本局。'));
 const score=el('div',undefined,'result-score');for(const faction of ['smuggler','officer']){const chip=el('span',undefined,'result-score-item '+faction);chip.append(el('small',factionName(faction)),el('strong',String(g.reputation[faction])));score.append(chip);}
 const controls=el('div',undefined,'result-actions');controls.append(button('保存战报',()=>$('#save').click()),button('再开一局',()=>setup(g.session.kind)));
 panel.append(left,score,controls);
}
function renderDecision(){
 const section=$('#decision-section'),panel=$('#decision');panel.replaceChildren();
 const actions=state.actions.filter((a)=>a.group==='decision');section.hidden=!state.game.pendingDecision&&!actions.length;
 if(state.botPending){panel.append(el('p','人机正在处理决策…','muted'));return;}
 const p=state.game.pendingDecision;
 if(p?.kind==='splitGold'){
 const actor=state.game.characters.find((c)=>c.id===p.targetId);
 panel.append(el('p',playerName(p.targetId)+'分箱。同屏对局请让其他玩家暂时避看。'));
 panel.append(button('秘密分箱 · '+actor.gold+'枚碎金',()=>modal('双箱分配','乙箱自动接收剩余碎金，回答由系统如实生成。',()=>{
 const input=el('input');Object.assign(input,{type:'number',value:'0',min:'0',max:String(actor.gold),step:'1',required:true,inputMode:'numeric',autocomplete:'off',ariaDescription:'只能输入 0 到 '+actor.gold+' 的整数'});const rest=el('p','乙箱：'+actor.gold),hint=el('small','甲箱可分配 0 至 '+actor.gold+' 枚碎金。','muted');field('甲箱碎金',input);$('#dialog-fields').append(rest,hint);
 const update=()=>{const valid=input.value!==''&&Number.isInteger(input.valueAsNumber)&&input.valueAsNumber>=0&&input.valueAsNumber<=actor.gold;input.setCustomValidity(valid?'':'请输入 0 至 '+actor.gold+' 的整数。');$('#dialog-confirm').disabled=!valid;rest.textContent=valid?'乙箱：'+(actor.gold-input.valueAsNumber):'乙箱：—';hint.textContent=valid?'两箱合计 '+actor.gold+' 枚碎金。':'请输入 0 至 '+actor.gold+' 的整数。';};input.oninput=update;update();return input;
 },(i)=>{const boxA=boundedInteger(i.value,0,actor.gold);return command({type:'SPLIT_GOLD',actorId:actor.id,boxA,boxB:actor.gold-boxA});},'确认分箱')));
 return;
 }
 if(p?.kind==='response')panel.append(el('p',playerName(p.sourceId)+'向'+playerName(p.targetId)+'发动'+(p.responseTo==='robbery'?'劫道夺财':'收缴')+'。可打出“暴力拒查”，或放弃响应继续结算。'));
 if(p?.kind==='askSearchQuestion')panel.append(el('p','分箱已完成。选择一个问题，系统会如实回答；持有“刑讯逼供”可先打出以追加提问。'));
 if(p?.kind==='chooseSearchBox'){
  for(const answer of p.answers??[{question:p.question,answer:p.answer}]){const question={aMoreThanB:'甲箱比乙箱多吗',aEmpty:'甲箱为空吗',bAtLeast2:'乙箱至少有两枚碎金吗',equal:'两箱一样多吗'}[answer.question];panel.append(el('p',question+'？　'+(answer.answer?'是':'否'),'answer'));}
  panel.append(el('p',p.questionsRemaining?'还需问一个不同的问题，再打开一箱。':'请选择一箱打开，另一箱归还对方。','muted'));
 }
 for(const action of actions){const b=button(action.label,()=>execute(action));if(action.command.type==='CHOOSE_SEARCH_BOX')b.className='search-box';panel.append(b);}
}
function renderOperations(){
 const panel=$('#actions'),cardsPanel=$('#cards');panel.replaceChildren();cardsPanel.replaceChildren();$('#end-turn').replaceChildren();$('#move-actions').replaceChildren();
 const actor=state.game.characters.find((c)=>c.id===state.decisionActorId);
 for(const b of document.querySelectorAll('[data-tab]')){b.classList.toggle('selected',b.dataset.tab===state.tab);b.setAttribute('aria-pressed',String(b.dataset.tab===state.tab));}
 if(state.botPending){panel.append(el('p',state.botPaused?'人机已暂停，可随时继续。':'人机正在思考与行动…','muted'));return;}
 if(!actor)return;
 const moves=state.actions.filter((a)=>a.group==='movement');
 if(state.selectedCard)$('#move-actions').append(button('取消选牌',()=>{state.selectedCard=null;render();}));
 for(const a of moves.filter((a)=>!a.command.path))$('#move-actions').append(button(a.label,()=>execute(a)));
 const special=state.selectedCard?state.actions.filter((a)=>a.command.cardId===state.selectedCard&&!a.command.targetId&&!a.command.path?.length):[];
 for(const a of special)$('#move-actions').append(button(a.label,()=>chooseAction(card(state.selectedCard).name,a.description,[a])));
 if(moves.some((a)=>a.command.path))$('#move-actions').append(el('span','亮起的驿路节点均可到达，点击查看路线与消耗。','map-instruction'));
 for(const a of state.actions.filter((a)=>a.group==='turn'))$('#end-turn').append(button(a.label,()=>execute(a)));
 if(state.tab==='location'){
 const available=state.actions.filter((a)=>a.group==='location'&&!['PICK_UP','BUY_MARKET','RENT_MOUNT'].includes(a.command.type));
 for(const a of available){const b=button('',()=>execute(a));b.className='table-action';b.append(el('span',actionMark(a.command.type),'action-glyph'));const copy=el('span',undefined,'action-copy');copy.append(el('strong',actionLabel(a)),el('small',a.actionPointCost===undefined?'':a.actionPointCost===0?'不消耗行动':a.actionPointCost+' 点行动'));b.append(copy);panel.append(b);}
 const market=state.actions.filter((a)=>['BUY_MARKET','RENT_MOUNT'].includes(a.command.type));
 for(const a of market){const item=a.command.type==='BUY_MARKET'?card(state.game.marketSlots[a.command.slot]):card(a.command.mountId);const price=a.command.type==='BUY_MARKET'?displayedMarketPrice(item):item.rentalPrice;cardsPanel.append(marketTile(item,price,a));}
 if(actor.nodeId==='HUB'&&!state.game.pendingDecision){
  for(const id of state.game.marketSlots.filter(Boolean)){const item=card(id);if(!market.some((a)=>a.command.type==='BUY_MARKET'&&state.game.marketSlots[a.command.slot]===id)){const price=displayedMarketPrice(item),status=actor.actionPoints<1?'行动点不足':actor.marketBoughtThisTurn?'本回合已购买':actor.silver<price?'官银不足':'当前不能购买';cardsPanel.append(marketTile(item,price,null,status));}}
 }
 if(state.actions.some((a)=>a.command.type==='PICK_UP'))panel.append(button('选择拾取遗物',()=>pickup(actor)));
 }else{
 const ids=state.tab==='tactic'?actor.hand:Object.values(actor.equipped);
 for(const id of ids){const item=card(id),row=el('article',undefined,'hand-card');row.append(el('strong',item.name),el('p',item.text));
 const available=state.actions.filter((a)=>a.command.cardId===id && a.group===state.tab);
 if(available.length)row.append(button(state.tab==='equipment'?'查看可用操作':'使用'+item.name,()=>chooseAction(item.name,item.text,available)));
 else row.append(el('small',id==='T_RESIST_SEARCH'?'受到稽查、搜寻或劫道时，在响应窗口使用。':state.game.pendingDecision?'请先完成当前决策。':actor.tacticsBlockedThisTurn?'本回合被禁止出牌。':actor.tacticsPlayedThisTurn>=2&&state.tab==='tactic'?'本回合已使用两张功能牌。':state.tab==='equipment'?'被动生效，或当前不满足主动使用条件。':'当前没有合法目标或不满足使用条件。','muted'));cardsPanel.append(row);}
 if(!ids.length)cardsPanel.append(el('p',state.tab==='tactic'?'暂无功能牌，可在驿站或黑市购买。':'暂无装备，可在驿站购买。','muted'));
 }
 for(const a of state.actions.filter((a)=>a.command.type==='REMOVE_BLOCK'))panel.append(button(a.label,()=>execute(a)));
 if(state.game.phase==='preEvent')for(const a of state.actions.filter((a)=>a.command.cardId==='E_TIME_GONG'))panel.append(button(a.label,()=>execute(a)));
 if(!panel.children.length&&!cardsPanel.children.length)panel.append(el('p','当前位置暂无此类操作，请移动或切换分类。','muted'));
}
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
 g.turnOrder.forEach((id,index)=>{const c=g.characters.find((c)=>c.id===id),piece=el('span',undefined,'turn-piece '+c.faction+(id===g.activeCharacterId?' active':''));piece.append(el('small',String(index+1)),el('strong',playerName(id)),el('span',g.phase==='finished'?'已结算':c.deadUntilRound?'等待复活':g.phase==='preEvent'?'轮前准备':id===g.activeCharacterId?'正在行动':index<g.turnIndex?'已行动':'待命'));track.append(piece);});
 $('#last-action').textContent=g.log.length?textCN(g.log.at(-1).message):'行程即将开始';
 const event=$('#event-banner');event.replaceChildren();
 if(g.phase==='finished')event.append(el('strong',g.winner==='draw'?'本局平分秋色':factionName(g.winner)+'获胜'),el('p','可保存战局，或回主菜单再来一局。'));
 else if(g.activeEventId)event.append(el('strong','本轮事件 · '+card(g.activeEventId).name),el('p',card(g.activeEventId).text));
 else event.append(el('strong','轮前准备'),el('p','在事件揭示前，处理白驹与铜锣。'));
 const info=$('#active-character');info.replaceChildren();
 if(active){
 info.append(el('strong',playerName(active.id)+' · '+nodeName(active.nodeId)));
 const resources=el('div',undefined,'resource-grid');for(const [label,value] of [['行动 · 骰'+(active.actionRoll??'—'),active.actionPoints],['粮草',active.food],['碎金',active.gold],['官银',active.silver]]){const token=el('span',undefined,'resource-token');token.append(el('small',label),el('strong',String(value)));resources.append(token);}info.append(resources);
 const statuses=[];if(active.mountId)statuses.push(card(active.mountId).name+' · 余'+active.mountTurnsRemaining+'回合');if(active.sealedGold)statuses.push('密封金 '+active.sealedGold);if(active.lockbox.gold+active.lockbox.silver)statuses.push('密匣：金'+active.lockbox.gold+' / 银'+active.lockbox.silver);if(active.tacticsBlockedThisTurn)statuses.push('本回合禁用功能牌');if(active.hubEntryBanTurns)statuses.push('暂禁进入驿站');if(active.controlledById)statuses.push('受'+playerName(active.controlledById)+'控制移动');info.append(el('p',statuses.join(' · '),'muted'));
 }
 $('#turn-hint').textContent=g.phase==='finished'?'对局结束':state.botPending?(state.botPaused?'人机已暂停':'对手正在行动，遇到你的决策会自动停下。'):'等待'+playerName(state.decisionActorId)+'操作。';
 renderResult(g);renderBoard();renderDecision();renderOperations();renderHand();renderGuide(g,active);
 const characters=$('#characters');characters.replaceChildren();
 for(const c of g.characters){const row=el('div',undefined,'character '+c.faction+(c.id===g.activeCharacterId?' selected':''));row.append(el('strong',playerName(c.id)+(g.session.kind==='solo'?(c.faction===g.session.humanFaction?' · 你方':' · 人机'):'')),el('p',nodeName(c.nodeId)+'　粮 '+c.food+'　金 '+c.gold+'　银 '+c.silver),el('small','手牌 '+c.hand.length+' · 装备 '+Object.values(c.equipped).map((id)=>card(id).name).join('、')));if(c.deadUntilRound)row.append(el('p','第'+c.deadUntilRound+'轮复活'));characters.append(row);}
 const log=$('#log');log.replaceChildren();for(const entry of g.log.slice(-35).reverse())log.append(el('li',textCN(entry.message)));
 scheduleBot();
}
function renderLibrary(){
 const grid=$('#library-grid');grid.replaceChildren();const search=$('#card-search').value.trim(),kind=$('#card-kind').value;
 const list=state.cards.filter((c)=>(kind==='all'||c.kind===kind)&&(!search||c.name.includes(search)||c.text.includes(search)));
 $('#library-count').textContent='共 '+list.length+' 张';
 for(const item of list){const row=el('article',undefined,'catalogue-card');
  row.append(cardFace(item));
  row.append(el('small',kinds[item.kind],'eyebrow'));
 if(item.marketPrice)row.append(el('small','市场价 '+item.marketPrice+'官银'));
 if(item.rentalPrice)row.append(el('small','租金 '+item.rentalPrice+'官银 · 基础两次自身回合'));
 grid.append(row);}
 if(!list.length)grid.append(el('p','没有匹配的卡牌，试试其他关键词。','muted'));
}
$('#card-search').oninput=$('#card-kind').onchange=renderLibrary;
const hintsButton=$('#toggle-hints');
function setHintsVisible(visible){document.body.classList.toggle('hints-hidden',!visible);hintsButton.textContent=visible?'隐藏提示':'显示提示';hintsButton.setAttribute('aria-pressed',String(visible));try{localStorage.setItem('golden-post-road-hints',visible?'show':'hide');}catch{}}
hintsButton.onclick=()=>setHintsVisible(document.body.classList.contains('hints-hidden'));
try{setHintsVisible(localStorage.getItem('golden-post-road-hints')!=='hide');}catch{setHintsVisible(true);}
async function init(){try{const [view,map,cards]=await Promise.all([api('/api/game'),api('/api/map'),api('/api/cards')]);state.map=map;state.cards=cards.cards;absorb(view);render();}catch(e){notify('连接失败，请启动服务后刷新页面。',true);}}
init();
