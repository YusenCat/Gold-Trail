// Decorative feedback reads authoritative snapshots; it never sends game commands.
export function createTabletopEffects({state,$,textCN,playerName}) {
 const reduced=matchMedia('(prefers-reduced-motion: reduce)'),compact=matchMedia('(max-width: 700px)');
 const key='gold-trail-effects';let preference,previous=null,timer;const pulses=new Map();
 try{preference=localStorage.getItem(key);}catch{}
 if(!['full','light','off'].includes(preference))preference=compact.matches?'light':'full';
 const layer=document.createElement('div');layer.id='tabletop-weather';layer.setAttribute('aria-hidden','true');document.body.append(layer);
 const feedback=document.createElement('div');feedback.id='tabletop-feedback';feedback.setAttribute('aria-hidden','true');feedback.hidden=true;document.body.append(feedback);
 const toggle=$('#effects-toggle'),labels={full:'完整',light:'轻量',off:'关闭'};
 const mode=()=>reduced.matches?'off':preference;
 function configure(){
  const effective=mode();document.body.dataset.effects=effective;
  toggle.textContent='桌面特效 · '+labels[effective];toggle.setAttribute('aria-label','桌面特效：'+labels[effective]+'。点击切换完整、轻量或关闭。'+(reduced.matches?'系统已启用减少动态效果。':''));
  toggle.title=reduced.matches?'遵循系统的减少动态效果设置':'完整：落雪与行动反馈；轻量：仅行动反馈；关闭：静态桌面';
  layer.replaceChildren();feedback.hidden=true;clearTimeout(timer);pulses.clear();
  if(effective==='full')for(let i=0;i<20;i++){
   const flake=document.createElement('i');flake.style.cssText=`--x:${(i*37)%100}%;--delay:-${i*.83}s;--duration:${12+(i%7)}s;--size:${2+i%3}px`;layer.append(flake);
  }
 }
 toggle.onclick=()=>{preference={full:'light',light:'off',off:'full'}[preference];try{localStorage.setItem(key,preference);}catch{}configure();};
 reduced.addEventListener('change',configure);
 document.addEventListener('visibilitychange',()=>{document.body.classList.toggle('effects-paused',document.hidden);if(document.hidden){feedback.hidden=true;clearTimeout(timer);}});
 configure();
 function pulse(selector,kind='arrival'){
  if(mode()==='off'||document.hidden)return;
  pulses.set(selector,{kind,started:performance.now(),duration:kind==='arrival'?850:kind==='gold'?1000:650});
 }
 function restorePulses(){
  const now=performance.now();
  for(const [selector,effect] of pulses){
   const elapsed=now-effect.started;if(elapsed>=effect.duration){pulses.delete(selector);continue;}
   for(const target of document.querySelectorAll(selector)){
    if(target.classList.contains('tabletop-'+effect.kind))continue;
    target.style.animationDelay=`-${elapsed}ms`;target.classList.add('tabletop-'+effect.kind);
    target.addEventListener('animationend',()=>{target.classList.remove('tabletop-'+effect.kind);target.style.animationDelay='';},{once:true});
   }
  }
 }
 function announce(message){
  if(mode()==='off'||document.hidden||!message)return;
  feedback.textContent=message;feedback.hidden=false;feedback.classList.remove('reveal');void feedback.offsetWidth;feedback.classList.add('reveal');
  clearTimeout(timer);timer=setTimeout(()=>{feedback.hidden=true;},3500);
 }
 return {refresh:restorePulses,render(){
  const g=state.game;
  if(state.screen!=='play'||!g){previous=null;feedback.hidden=true;pulses.clear();return;}
  const next={session:state.room?.id||g.session.kind,revision:g.revision,round:g.round,event:g.activeEventId,phase:g.phase,active:g.activeCharacterId,log:g.log.length,scores:{...g.reputation},positions:Object.fromEntries(g.characters.map(c=>[c.id,c.nodeId]))};
  if(previous&&previous.session===next.session&&next.revision!==previous.revision&&next.revision>previous.revision&&next.log>=previous.log){
   for(const actor of g.characters)if(previous.positions[actor.id]!==actor.nodeId)pulse(`[data-character-id="${actor.id}"] .pawn-medallion`);
   for(const faction of ['smuggler','officer'])if(next.scores[faction]>previous.scores[faction])pulse('#score-'+faction,'gold');
   if(next.round!==previous.round||next.event!==previous.event)pulse('.round-dial','reveal');
   if(next.active!==previous.active)pulse('.turn-prompt','reveal');
   if(next.phase==='finished'&&previous.phase!=='finished')pulse('#result-panel','gold');
   const last=g.log.at(-1);announce(next.phase==='finished'?'本局已结束 · 战报已生成':next.active!==previous.active?playerName(next.active)+'接过行动令':last?textCN(last.message):'行动已结算');
  }
  previous=next;
  restorePulses();
 }};
}
