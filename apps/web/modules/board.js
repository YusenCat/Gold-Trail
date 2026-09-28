export function createBoardRenderer(deps) {
  const { state, $, playerName, factionName, nodeName, card, command, chooseAction, inspectCharacter } = deps;
  function svg(tag, attributes, text) {
    const element = document.createElementNS('http://www.w3.org/2000/svg', tag);
    for (const [key, value] of Object.entries(attributes)) element.setAttribute(key, value);
    if (text) element.textContent = text;
    return element;
  }
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
   board.append(svg('line',{x1:a.x,y1:-a.y,x2:b.x,y2:-b.y,class:'route'+(route.shortcut?' shortcut-route':'')+(blocked?' blocked-route':'')}));
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
  return renderBoard;
}
