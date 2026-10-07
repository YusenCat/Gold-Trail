// A six-face presentation of the existing uniform 2/3/4 backend roll.
// Result metadata is public and replayable; animation never uses random game values.
export function readActionRoll(entry){
 if(entry?.type!=='turnStart')return null;
 const old=entry.message.match(/^(\S+)掷出 (\d+) 点行动骰，获得 (\d+) 行动点/);
 const value=entry.actionDie||(old?{actorId:old[1],roll:Number(old[2]),actionPoints:Number(old[3])}:null);
 return value&&[2,3,4].includes(value.roll)?{...value,id:entry.id}:null;
}
export function createActionDie({state,$,playerName}){
 const panel=$('#action-die'),cube=$('#action-die-cube'),title=$('#action-die-title'),result=$('#action-die-result');
 const motion=matchMedia('(prefers-reduced-motion: reduce)');let key,lastId=0,roomStatus,pending=null,timer,visibleRoll=null;
 function settle(){
  clearTimeout(timer);cube.classList.remove('rolling');panel.dataset.rolling='false';
  if(visibleRoll)result.textContent='骰面 '+visibleRoll.roll+' · 基础 '+visibleRoll.roll+' → 修正后 '+visibleRoll.actionPoints+' 行动点';
 }
 function show(roll,animate){
  settle();visibleRoll=roll;panel.hidden=false;panel.dataset.rollId=String(roll.id);panel.dataset.roll=String(roll.roll);
  title.textContent=playerName(roll.actorId)+' · 掷行动骰';
  cube.style.setProperty('--die-x',roll.roll===4?'-90deg':'0deg');cube.style.setProperty('--die-y',roll.roll===3?'-90deg':'0deg');
  cube.setAttribute('aria-label','六面行动骰，2、3、4各两面。本次掷出'+roll.roll+'。');
  if(animate&&!motion.matches&&document.body.dataset.effects!=='off'&&!document.hidden){
   result.textContent='正在掷行动骰…';panel.dataset.rolling='true';cube.style.setProperty('--roll-duration',document.body.dataset.effects==='light'?'600ms':'950ms');
   void cube.offsetWidth;cube.classList.add('rolling');timer=setTimeout(settle,document.body.dataset.effects==='light'?600:950);
  }else settle();
 }
 motion.addEventListener('change',settle);
 new MutationObserver(()=>{if(document.body.dataset.effects==='off')settle();}).observe(document.body,{attributes:true,attributeFilter:['data-effects']});
 document.addEventListener('visibilitychange',()=>{if(document.hidden)settle();});
 return {render(){
  const g=state.game,nextKey=state.room?state.room.id+':'+state.room.epoch:'local:'+state.actionDieGeneration;
  const fresh=state.actionDieFreshStart||roomStatus==='lobby'&&state.room?.status==='playing';roomStatus=state.room?.status;state.actionDieFreshStart=false;
  if(!g){panel.hidden=true;return;}
  const entries=g.log.map(readActionRoll).filter(Boolean),latest=entries.at(-1),maxId=g.log.at(-1)?.id||0;
  if(key!==nextKey){settle();visibleRoll=null;key=nextKey;lastId=maxId;pending=latest?{roll:latest,animate:!!fresh}:null;}
  else if(maxId<lastId){lastId=maxId;pending=latest?{roll:latest,animate:false}:null;}
  else {const added=entries.filter(e=>e.id>lastId);if(added.length)pending={roll:added.at(-1),animate:true};lastId=maxId;}
  if(state.screen!=='play'){settle();panel.hidden=true;return;}
  if(pending){show(pending.roll,pending.animate);pending=null;}
  else panel.hidden=!visibleRoll;
 }};
}
