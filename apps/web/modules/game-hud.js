// Shared by solo, hotseat and LAN: mode flags only change labels and permissions.
export function createGameHud({state,$,el,phases,factionName,playerName,nodeName,textCN,resourceIcon,portrait,card}){
return function renderHud(g){
 const active=g.characters.find((c)=>c.id===g.activeCharacterId);
 const lan=g.session.kind==='lan';
 $('#summary').textContent=(lan?'局域网对战 · '+state.room.capacity+'人 · 你是'+factionName(state.me.faction):g.session.kind==='solo'?'人机对战 · 你是'+factionName(g.session.humanFaction):'同屏对局')+'　｜　第'+g.round+'轮 · '+phases[g.phase]+'　｜　走私者 '+g.reputation.smuggler+' / 官兵 '+g.reputation.officer+' 声望';
 $('#round-number').textContent=String(g.round).padStart(2,'0');
 $('#round-phase').textContent=phases[g.phase];
 $('#score-smuggler').textContent=g.reputation.smuggler;
 $('#score-officer').textContent=g.reputation.officer;
 $('#victory-goal').textContent=g.mode==='race'?'五十声望竞速':'三十轮火并';
 const host=lan&&state.me.playerId===state.room.hostId;
 $('#save').hidden=$('#load').hidden=lan&&!host;
 $('#save').disabled=state.busy||(lan&&state.roomConnection!=='connected');
 $('#load').disabled=state.busy||(lan&&(state.room.status!=='paused'||state.roomConnection!=='connected'));
 $('#load').title=lan&&state.room.status!=='paused'?'先暂停对局再读取房间存档':'';
 $('#lan-toolbar').hidden=!lan;
 if(lan){const me=state.room.members.find((m)=>m.playerId===state.me.playerId),waiting=state.room.members.find((m)=>m.playerId===state.decisionPlayerId);$('#lan-player-status').textContent=me.nickname+' · '+state.me.characterIds.map(playerName).join('、')+'　｜　'+(state.roomConnection!=='connected'?'正在重新接通驿路…':state.pendingLanCommand?'正在确认上一条操作…':state.room.status==='paused'?'对局暂停 · '+state.room.pauseReason:g.phase==='finished'?'本局已结束':state.canAct?'轮到你操作':'等待'+(waiting?.nickname||'同伴')+'操作');$('#lan-sync-hint').textContent=state.roomConnection!=='connected'?'连接中断，正在自动重连；席位和进度已保留。':state.room.status==='paused'?'全员在线后由房主继续征程。':'驿路已接通 · 操作自动同步，每步自动保留';$('#report-project').textContent='投影战报';}
 else $('#report-project').textContent='投影战报 · 暂停对局';
 $('#bot-pause').hidden=g.session.kind!=='solo';$('#bot-pause').textContent=state.botPaused?'继续人机':'暂停人机';
 $('#bot-speed').hidden=g.session.kind!=='solo';$('#bot-speed').textContent='人机速度 · '+(state.botDelay===350?'快速':'正常');
 $('#autosave-state').textContent=(lan?'联机自动保留':'自动保留')+' · 第'+g.round+'轮';
 const track=$('#turn-track');track.replaceChildren();
 g.turnOrder.forEach((id,index)=>{const c=g.characters.find((c)=>c.id===id),piece=el('span',undefined,'turn-piece '+c.faction+(id===g.activeCharacterId?' active':''));if(id===g.activeCharacterId)piece.setAttribute('aria-current','step');piece.append(el('small',String(index+1)),el('strong',playerName(id)),el('span',g.phase==='finished'?'已结算':c.deadUntilRound?'等待复活':g.phase==='preEvent'?'轮前准备':id===g.activeCharacterId?'正在行动':index<g.turnIndex?'已行动':'待命'));track.append(piece);});
 $('#last-action').textContent=g.log.length?textCN(g.log.at(-1).message):'行程即将开始';
 const event=$('#event-banner');event.replaceChildren();
 if(g.phase==='finished')event.append(el('strong',g.winner==='draw'?'本局平分秋色':factionName(g.winner)+'获胜'),el('p','可保存战局，或回主菜单再来一局。'));
 else if(g.activeEventId)event.append(el('strong','本轮事件 · '+card(g.activeEventId).name),el('p',card(g.activeEventId).text));
 else event.append(el('strong','轮前准备'),el('p','在事件揭示前，处理白驹与铜锣。'));
 const info=$('#active-character');info.replaceChildren();
 if(active){
 info.dataset.faction=active.faction;
 info.append(portrait(active.id,el));
 info.append(el('strong',playerName(active.id)+' · '+nodeName(active.nodeId)));
 const resources=el('div',undefined,'resource-grid');for(const [label,value,kind] of [['行动 · 骰'+(active.actionRoll??'—'),active.actionPoints,null],['粮草',active.food,'food'],['碎金',active.gold,'gold'],['官银',active.silver,'silver']]){const token=el('span',undefined,'resource-token'),caption=el('small');if(kind)caption.append(resourceIcon(kind));caption.append(document.createTextNode(label));token.append(caption,el('strong',String(value)));resources.append(token);}info.append(resources);
 const statuses=[];if(active.mountId)statuses.push(card(active.mountId).name+' · 余'+active.mountTurnsRemaining+'回合');if(active.sealedGold)statuses.push('密封金 '+active.sealedGold);if(active.lockbox.gold+active.lockbox.silver)statuses.push('密匣：金'+active.lockbox.gold+' / 银'+active.lockbox.silver);if(active.tacticsBlockedThisTurn)statuses.push('本回合禁用功能牌');if(active.hubEntryBanTurns)statuses.push('暂禁进入驿站');if(active.controlledById)statuses.push('受'+playerName(active.controlledById)+'控制移动');info.append(el('p',statuses.join(' · '),'muted'));
 }
 $('#turn-hint').textContent=g.phase==='finished'?'对局结束':state.botPending?(state.botPaused?'人机已暂停':'对手正在行动，遇到你的决策会自动停下。'):'等待'+playerName(state.decisionActorId)+'操作。';

return active;
};
}
