export function createBotController({state,$,mutate,render}){
function scheduleBot(){
 clearTimeout(state.botTimer);
 if(state.screen!=='play'||!state.botPending||state.botPaused||state.busy||$('#interaction').open||$('#report-projection').open)return;
 state.botTimer=setTimeout(async()=>{if(state.screen==='play'&&!state.botPaused)await mutate('/api/game/bot-step');},state.botDelay??1000);
}

$('#bot-pause').onclick=()=>{state.botPaused=!state.botPaused;render();};
$('#bot-speed').onclick=()=>{state.botDelay=state.botDelay===350?1000:350;render();};

return {schedule:scheduleBot};
}
