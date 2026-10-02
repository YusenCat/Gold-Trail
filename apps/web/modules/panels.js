export function createGamePanels(deps) {
  const { state, $, el, button, factionName, playerName, card, modal, field, number, boundedInteger, command,
    execute, actionMark, actionArt, actionLabel, chooseAction, displayedMarketPrice, displayedBlackMarketPrice, marketTile, pickup, setup, render, renderBoard } = deps;
  function renderResult(g){
   const panel=$('#result-panel');panel.replaceChildren();panel.hidden=g.phase!=='finished';if(g.phase!=='finished')return;
   const title=g.winner==='draw'?'平分秋色':factionName(g.winner)+'赢得此局';
   const left=el('div',undefined,'result-title');left.append(el('small',g.mode==='race'?'竞速局结算':'三十轮火并结算'),el('h2',title),el('p','第'+g.round+'轮结束 · 自动保留已记录本局。'));
   const score=el('div',undefined,'result-score');for(const faction of ['smuggler','officer']){const chip=el('span',undefined,'result-score-item '+faction);chip.append(el('small',factionName(faction)),el('strong',String(g.reputation[faction])));score.append(chip);}
   const controls=el('div',undefined,'result-actions');
   if(g.session.kind==='lan'){controls.append(button('返回房间',()=>$('#lan-lobby').click()));if(state.me.playerId===state.room.hostId)controls.append(button('保存战报',()=>$('#save').click()),button('再开一局',()=>$('#lan-rematch').click(),state.roomConnection!=='connected'));}
   else controls.append(button('保存战报',()=>$('#save').click()),button('再开一局',()=>setup(g.session.kind)));
   panel.append(left,score,controls);
  }
  
    function renderDecision(){
   const section=$('#decision-section'),panel=$('#decision');panel.replaceChildren();
   const actions=state.actions.filter((a)=>a.group==='decision');section.hidden=!state.game.pendingDecision&&!actions.length;
   if(state.botPending){panel.append(el('p','人机正在处理决策…','muted'));return;}
   const p=state.game.pendingDecision;
   if(state.game.session.kind==='lan'&&!state.canAct){panel.append(el('p',state.room.status==='paused'?'对局已暂停，原决策会保留。':'等待'+playerName(state.decisionActorId)+'处理，结果会自动同步。','muted'));return;}
   if(p?.kind==='splitGold'){
   const actor=state.game.characters.find((c)=>c.id===p.targetId);
   panel.append(el('p',playerName(p.targetId)+'分箱。'+(state.game.session.kind==='lan'?'箱数不会发送给其他玩家。':'同屏对局请让其他玩家暂时避看。')));
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
   if(state.game.session.kind==='lan'&&!state.canAct){panel.append(el('p',state.roomConnection!=='connected'?'正在恢复连接，暂时不能操作。':state.room.status==='paused'?'对局暂停。等待全员在线后，由房主继续。':'等待同伴操作，行程会自动更新。','muted'));return;}
   if(!actor)return;
   const moves=state.actions.filter((a)=>a.group==='movement');
   if(state.selectedCard)$('#move-actions').append(button('取消选牌',()=>{state.selectedCard=null;render();}));
   for(const a of moves.filter((a)=>!a.command.path))$('#move-actions').append(button(a.label,()=>execute(a)));
   const special=state.selectedCard?state.actions.filter((a)=>a.command.cardId===state.selectedCard&&!a.command.targetId&&!a.command.path?.length):[];
   for(const a of special)$('#move-actions').append(button(a.label,()=>chooseAction(card(state.selectedCard).name,a.description,[a])));
   if(moves.some((a)=>a.command.path))$('#move-actions').append(el('span','亮起的驿路节点均可到达，点击查看路线与消耗。','map-instruction'));
   for(const a of state.actions.filter((a)=>a.group==='turn')){const end=button(a.label,()=>execute(a));end.classList.add('art-command-button');end.prepend(el('span',undefined,'button-seal art-end'));$('#end-turn').append(end);}
   if(state.tab==='location'){
   const available=state.actions.filter((a)=>a.group==='location'&&!['PICK_UP','BUY_MARKET','RENT_MOUNT'].includes(a.command.type));
   for(const a of available){const b=button('',()=>execute(a));b.className='table-action';b.append(el('span',actionMark(a.command.type),'action-glyph art-'+actionArt(a.command.type)));const copy=el('span',undefined,'action-copy');copy.append(el('strong',actionLabel(a)),el('small',a.actionPointCost===undefined?'':a.actionPointCost===0?'不消耗行动':a.actionPointCost+' 点行动'));b.append(copy);panel.append(b);}
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
  return { renderResult, renderDecision, renderOperations };
}
