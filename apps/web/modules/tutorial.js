export function createTutorial({state,$,el,button,api,absorb,mutate,show,notify}){
 const activeKey='gold-trail-tutorial-active';
 const start=async()=>{
  if(!state.localAvailable){notify('可操作教学请在主机本机打开。',true);return;}
  if(state.room){notify('请先返回本地大厅，再开启教学。',true);return;}
  try{
   const saved=await api('/api/game/tutorial');
   if(saved.tutorial&&!saved.tutorial.finished)absorb(saved);
   else if(!await mutate('/api/game/tutorial/new',{}))return;
   try{localStorage.setItem(activeKey,'yes');}catch{}
   state.actionDieGeneration=(state.actionDieGeneration||0)+1;show('play');
  }catch(e){notify(e.message,true);}
 };
 const learning=button('开始／继续实操教学',start);$('#learn-practice').before(learning);
 $('#tutorial-next').onclick=()=>mutate('/api/game/tutorial/next');
 $('#tutorial-exit').onclick=async()=>{
  try{absorb(await api('/api/game'));try{localStorage.removeItem(activeKey);}catch{}state.actionDieGeneration=(state.actionDieGeneration||0)+1;show(state.game?.log.length?'play':'home');}catch(e){notify(e.message,true);}
 };
 $('#tutorial-locate').onclick=()=>{
  const t=state.tutorial;const selector=[0,3,6].includes(t?.stage)?'.board-panel':t?.stage===9?'.hand-table':t?.stage>=11?'#decision-section':'.control-panel';
  const target=$(selector);target.setAttribute('tabindex','-1');target.focus({preventScroll:true});target.scrollIntoView({block:'start',behavior:'instant'});
 };
 return {async restore(){try{if(localStorage.getItem(activeKey)==='yes'){const view=await api('/api/game/tutorial');if(view.tutorial)absorb(view);}}catch{}},render(){
  const t=state.tutorial,panel=$('#tutorial-panel');panel.hidden=!t||state.screen!=='play';learning.disabled=!state.localAvailable||!!state.room;
  $('#screen-play').classList.toggle('is-tutorial',!!t);$('#cards').hidden=!!t;
  for(const id of ['save','load','bot-pause','bot-speed'])$( '#'+id).hidden=!!t;
  if(!t)return;
  $('#action-die').hidden=!(t.stage===2&&t.completed);
  $('#result-panel').hidden=true;
  $('#tutorial-progress').textContent=t.finished?'实操教学 · 已完成':'实操教学 '+(t.stage+1)+' / '+t.total;
  $('#tutorial-title').textContent=t.title;$('#tutorial-detail').textContent=t.detail;
  $('#tutorial-result').textContent=t.completed?'操作成功：'+(state.game.log.at(-1)?.message||'已完成').replaceAll('SMUGGLER_','走私者').replaceAll('OFFICER_','官兵'):t.finished?'教学完成，开始你的第一局吧。':'';
  $('#tutorial-next').hidden=t.finished;$('#tutorial-next').disabled=!t.completed||state.busy;$('#tutorial-locate').disabled=t.completed||t.finished;
 }};
}
