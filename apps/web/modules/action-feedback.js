const tones={tactic:[440,660],response:[330,220],mine:[160,320,480],searchStart:[220,294],searchResolve:[294,440],exchange:[523,659,784],buyMarket:[392,523]};
export function createActionFeedback({state,$,el,button,textCN}){
 let enabled=false,volume=.35,context=null,previous=null;
 try{enabled=localStorage.getItem('gold-trail-sound')==='on';const stored=localStorage.getItem('gold-trail-volume');if(stored!==null&&Number.isFinite(Number(stored)))volume=Math.max(0,Math.min(1,Number(stored)));}catch{}
 const controls=el('div',undefined,'sound-controls'),toggle=button('',()=>{}),label=el('label','音量 '),slider=el('input');
 slider.type='range';slider.min='0';slider.max='100';slider.step='5';slider.value=String(volume*100);slider.setAttribute('aria-label','动作音效音量');label.append(slider);controls.append(toggle,label);$('#effects-toggle').after(controls);
 const status=el('p',undefined,'action-feedback-status');status.setAttribute('role','status');status.setAttribute('aria-live','polite');$('#action-die').after(status);
 function update(){toggle.textContent='音效 · '+(enabled?'开启':'关闭');toggle.setAttribute('aria-pressed',String(enabled));}
 function unlock(){if(!enabled)return;try{context??=new (window.AudioContext||window.webkitAudioContext)();if(context.state==='suspended')void context.resume().catch(()=>{});}catch{enabled=false;update();}}
 document.addEventListener('pointerdown',unlock,{passive:true});document.addEventListener('keydown',unlock);
 toggle.onclick=()=>{enabled=!enabled;try{localStorage.setItem('gold-trail-sound',enabled?'on':'off');}catch{}if(enabled)unlock();else if(context)void context.suspend().catch(()=>{});update();};
 slider.oninput=()=>{volume=Number(slider.value)/100;try{localStorage.setItem('gold-trail-volume',String(volume));}catch{}};
 document.addEventListener('visibilitychange',()=>{if(document.hidden&&context)void context.suspend().catch(()=>{});else unlock();});
 update();
 function play(type){
  if(!enabled||volume===0||document.hidden||!context||context.state!=='running')return;
  const frequencies=tones[type];if(!frequencies)return;
  frequencies.forEach((hz,i)=>{const oscillator=context.createOscillator(),gain=context.createGain(),at=context.currentTime+i*.09;oscillator.type=type==='mine'?'triangle':'sine';oscillator.frequency.value=hz;gain.gain.setValueAtTime(0,at);gain.gain.linearRampToValueAtTime(volume*.12,at+.008);gain.gain.exponentialRampToValueAtTime(.0001,at+.12);oscillator.connect(gain);gain.connect(context.destination);oscillator.start(at);oscillator.stop(at+.14);oscillator.onended=()=>{oscillator.disconnect();gain.disconnect();};});
 }
 return {render(){
  const g=state.game,key=(state.room?state.room.id+':'+state.room.epoch:'local:'+state.actionDieGeneration)+(state.tutorial?':tutorial':'');
  if(!g||state.screen!=='play'){previous=null;status.hidden=true;return;}
  const id=g.log.at(-1)?.id??0;
  if(previous&&previous.key===key&&g.revision>previous.revision){
   const entries=g.log.filter(e=>e.id>previous.id&&tones[e.type]);
   if(entries.length){const entry=entries.at(-1);status.textContent=textCN(entry.message);status.hidden=false;play(entry.type);}
  }
  if(!previous||previous.key!==key)status.hidden=true;
  previous={key,id,revision:g.revision};
 }};
}
