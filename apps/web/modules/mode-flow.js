export function createModeFlow({state,$,api,absorb,mutate,notify,show,confirm,render}){
async function setup(kind){
 if(!state.localAvailable){notify('本地模式只能在主机本机地址游玩，请选择局域网对战。',true);return;}
 if(state.room){try{absorb(await api('/api/game'));}catch(e){notify(e.message,true);return;}}
 state.setupKind=kind;$('#setup-title').textContent=kind==='solo'?'本地人机对战':'本地同屏对局';$('#faction-choice').hidden=kind!=='solo';$('#difficulty-choice').hidden=kind!=='solo';show('setup');
}
$('#setup-form').onsubmit=async(event)=>{
 event.preventDefault();const form=new FormData(event.target);
 const start=async()=>{const raw=String(form.get('seed')||'').trim();const seed=raw===''?undefined:Number(raw);if(seed!==undefined&&!Number.isSafeInteger(seed)){notify('种子请填写安全范围内的整数，或留空随机。',true);return false;}const ok=await mutate('/api/game/new',{kind:state.setupKind,mode:form.get('mode'),humanFaction:form.get('faction'),difficulty:form.get('difficulty'),seed,start:true});if(ok){state.botPaused=false;show('play');}return ok;};
 if(state.game?.log.length && state.game.phase!=='finished')confirm('替换当前对局？','新局会替换当前未保存进度，请先保存需要保留的行程。',start);else await start();
};
$('#mode-solo').onclick=()=>setup('solo');$('#mode-hotseat').onclick=()=>setup('hotseat');
$('#nav-home').onclick=()=>show('home');$('#nav-help').onclick=$('#home-help').onclick=()=>show('help');$('#nav-library').onclick=()=>show('library');$('#setup-back').onclick=()=>show('home');
for(const b of document.querySelectorAll('.return-game'))b.onclick=()=>show(state.previous);
$('#resume').onclick=()=>show(state.room&&!state.game?'lobby':'play');
for(const b of document.querySelectorAll('[data-tab]'))b.onclick=()=>{state.tab=b.dataset.tab;render();};
document.addEventListener('keydown',(event)=>{if(event.key==='Escape'&&!$('#interaction').open&&state.selectedCard){state.selectedCard=null;state.previewPath=null;render();}});

return {setup};
}
