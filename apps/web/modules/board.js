import { MAP_VIEWBOX, mapPoint, edgePath, edgeGeometry, cityLabels } from './map-layout.js';
import { drawTerrain, drawLocation } from './map-terrain.js';

export function createBoardRenderer(deps) {
  const { state, $, playerName, factionName, nodeName, card, command, chooseAction, inspectCharacter } = deps;
  function svg(tag, attributes, text) {
    const element = document.createElementNS('http://www.w3.org/2000/svg', tag);
    for (const [key, value] of Object.entries(attributes)) element.setAttribute(key, value);
    if (text) element.textContent = text;
    return element;
  }
  function renderBoard(){
   const board=$('#board');board.replaceChildren();board.setAttribute('viewBox',MAP_VIEWBOX);board.classList.add('expedition-map');const nodes=Object.fromEntries(state.map.nodes.map((n)=>[n.id,n]));
   board.append(drawTerrain(svg));
   const roads=svg('g',{class:'atlas-roads'});
   for(const route of state.map.routes)for(let i=1;i<route.nodes.length;i++){
   const a=nodes[route.nodes[i-1]],b=nodes[route.nodes[i]],blocked=state.game.blockedEdges.includes([a.id,b.id].sort().join('::'));
   const d=edgePath(a,b),edgeId=[a.id,b.id].sort().join('::');
   const road=svg('g',{'data-edge':edgeId,class:route.shortcut?'atlas-shortcut':'atlas-road'});
   road.append(svg('path',{d,class:'atlas-road-bed','aria-hidden':'true'}),svg('path',{d,class:'atlas-route'+(route.shortcut?' atlas-shortcut-route':'')+(blocked?' atlas-blocked-route':''),'data-from':a.id,'data-to':b.id}),svg('title',{},nodeName(a.id)+' ↔ '+nodeName(b.id)+' · 一步'+(route.shortcut?' · 捷径':'')+(blocked?' · 已封路':'')));
   if(blocked){const {start,end,controls:[c,d]}=edgeGeometry(a,b);road.append(svg('text',{x:(start.x+3*c[0]+3*d[0]+end.x)/8,y:(start.y+3*c[1]+3*d[1]+end.y)/8-10,class:'atlas-blocked-mark'},'封'));}
   roads.append(road);
   }
   board.append(roads);
   const moveTypes=['MOVE','FREE_MOVE','PRE_EVENT_MOVE','CONTROLLED_MOVE'];
   const boardActions=state.game.session.kind==='lan'&&!state.canAct?[]:state.selectedCard?state.actions.filter((a)=>a.command.cardId===state.selectedCard&&a.command.path?.length):state.actions.filter((a)=>moveTypes.includes(a.command.type)&&a.command.path?.length);
   if(state.previewPath){
    const previewAction=boardActions.find((a)=>a.command.path===state.previewPath);
    const moverId=previewAction?.command.type==='CONTROLLED_MOVE'?previewAction.command.targetId:previewAction?.command.actorId??state.game.activeCharacterId;
    const actor=state.game.characters.find((c)=>c.id===moverId);
    if(actor){const path=[actor.nodeId,...state.previewPath];board.append(svg('path',{d:path.slice(1).map((id,i)=>edgePath(nodes[path[i]],nodes[id])).join(' '),class:'atlas-route-preview'}));}
   }
   for(const node of state.map.nodes){
   const options=boardActions.filter((a)=>a.command.path.at(-1)===node.id).sort((a,b)=>(a.actionPointCost??0)-(b.actionPointCost??0)||a.command.path.length-b.command.path.length),action=options[0];
   const point=mapPoint(node),group=svg('g',{transform:`translate(${point.x} ${point.y})`,'data-node-id':node.id,class:'atlas-node '+(node.type==='road'?'road-node ':'city-node ')+(action?'reachable':'')});
   group.classList.toggle('encounter-site',Boolean(node.site));
   const displayName=nodeName(node.id),siteNote=node.siteName&&node.siteName!==displayName?' · '+node.siteName:'';
   group.append(svg('circle',{r:node.type==='road'?29:43,class:'atlas-hit-area'}),svg('circle',{r:node.type==='road'?20:node.type==='checkpoint'?30:36,class:'atlas-node-ring'}),svg('title',{},displayName+siteNote+(node.site?'（抵达时触发驿路遭遇）':'')));
   if(node.type!=='road')group.append(drawLocation(svg,node.type));
   if(node.site)group.append(svg('text',{y:7,class:'atlas-site-symbol'},({forage:'粮',forest:'林',caravan:'商',ruins:'遗',signal:'烽'})[node.site]));
   if(node.label){const label=cityLabels[node.id]??{x:0,y:-40};group.append(svg('text',{x:label.x,y:label.y,'text-anchor':label.anchor??'middle',class:'atlas-node-label'},nodeName(node.id)));if(label.subtitle)group.append(svg('text',{x:label.x,y:label.y+19,'text-anchor':'middle',class:'atlas-city-subtitle'},label.subtitle));}
   if(state.game.droppedItems[node.id])group.append(svg('text',{x:27,y:31,class:'atlas-drop-marker'},'◆'));
   if(action){group.setAttribute('role','button');group.setAttribute('tabindex','0');group.setAttribute('aria-label','前往'+nodeName(node.id));const go=()=>{if(state.busy)return;state.previewPath=action.command.path;renderBoard();chooseAction(action.command.type==='CONTROLLED_MOVE'?'受控移动 · '+playerName(action.command.targetId)+' → '+nodeName(node.id):'前往'+nodeName(node.id),action.command.type==='CONTROLLED_MOVE'?playerName(action.command.actorId)+'指挥'+playerName(action.command.targetId)+'移动，消耗被控制角色的行动点；确认后才移动。':'金色虚线是推荐路线。确认后移动，取消不会消耗行动。',options);};group.onclick=go;group.onkeydown=(e)=>{if(e.key==='Enter'||e.key===' '){e.preventDefault();go();}};}
   board.append(group);
   }
   for(const actor of state.game.characters){
   if(actor.deadUntilRound)continue;
   const occupants=state.game.characters.filter((c)=>c.nodeId===actor.nodeId&&!c.deadUntilRound),index=occupants.indexOf(actor),n=mapPoint(nodes[actor.nodeId]);
   const target=(state.game.session.kind!=='lan'||state.canAct)&&state.selectedCard&&state.actions.some((a)=>a.command.cardId===state.selectedCard&&a.command.targetId===actor.id);
   const pawn=svg('g',{'data-character-id':actor.id,class:'pawn-group '+actor.faction+(actor.id===state.game.activeCharacterId?' current':'')+(target?' targetable':''),transform:`translate(${n.x+(index-(occupants.length-1)/2)*38} ${n.y+46}) scale(80)`,role:'button',tabindex:'0','aria-label':playerName(actor.id)+(target?' · 选为目标':' · 查看角色')});
   pawn.append(svg('ellipse',{cx:0,cy:.27,rx:.23,ry:.07,class:'pawn-shadow'}),svg('circle',{r:.235,class:'pawn-medallion'}));
   pawn.append(svg('path',{d:actor.faction==='officer'?'M-.19 .15 L-.13 -.03 H.13 L.19 .15 L0 .21 Z':'M-.2 .16 L-.14 -.05 L0 -.12 L.14 -.05 L.2 .16 Z',class:'pawn-coat'}));
   pawn.append(svg('path',{d:'M-.075 -.12 Q0 -.2 .075 -.12 L.065 -.015 Q0 .055 -.065 -.015 Z',class:'pawn-face'}));
   pawn.append(svg('path',{d:actor.faction==='officer'?'M-.13 -.09 Q-.14 -.26 0 -.26 Q.14 -.26 .13 -.09 Z M0 -.26 L.04 -.36 M-.15 -.08 H.15':'M-.15 -.03 Q-.2 -.26 0 -.27 Q.19 -.24 .15 .01 L.09 -.12 Q0 -.21 -.09 -.1 Z M-.075 -.035 L.09 -.02 L.02 .07 Z',class:'pawn-headgear'}));
   pawn.append(svg('path',{d:actor.faction==='officer'?'M-.12 .07 H.12 M-.08 .13 H.08 M0 .03 V.19':'M-.12 .03 L.13 .17 M.04 .03 L-.09 .17',class:'pawn-trim'}));
   pawn.append(svg('circle',{cx:.16,cy:.18,r:.09,class:'pawn-badge'}),svg('text',{x:.16,y:.218,'text-anchor':'middle',class:'pawn-number'},actor.id.endsWith('1')?'一':'二'),svg('title',{},playerName(actor.id)));
   pawn.onclick=()=>{if(!state.busy)inspectCharacter(actor);};pawn.onkeydown=(e)=>{if(e.key==='Enter'||e.key===' '){e.preventDefault();if(!state.busy)inspectCharacter(actor);}};board.append(pawn);
   }
   $('#board-prompt').textContent=state.selectedCard?'已选「'+card(state.selectedCard).name+'」 · 点击发光目标，再确认出牌':state.game.session.kind==='lan'&&!state.canAct?'等待征程继续 · 局面自动同步':state.botPending?'对手行棋中 · 可点击棋子查看状态':'落到带字圆点会触发一次驿路遭遇 · 点击亮圈规划移动';
   const active=state.game.characters.find((c)=>c.id===state.game.activeCharacterId);
   const mined=state.game.mineOutputByFaction||{smuggler:0,officer:0},quota=state.balance.mineFactionOutputLimit??4;
   const mineText=state.game.activeEventId==='V_MINE_COLLAPSE'?'本轮矿洞塌方 · 暂停采矿':'本轮矿脉余量 '+state.game.mineOutputRemaining+' 枚 · 走私者 '+mined.smuggler+'/'+quota+' · 官兵 '+mined.officer+'/'+quota;
   $('#board-status').textContent=active?.nodeId==='MINE'?mineText:'金矿情报 · '+mineText;
  }
  return renderBoard;
}
