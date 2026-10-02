export function bindSaveControls({state,$,api,mutate,lobby,modal,el,field,select,notify,scheduleBot,show}){
$('#save').onclick=()=>{
 if(state.room){lobby.save();return;}
 let overwrite=false;
 modal('保存行程','每个名称对应独立存档。输入新名称；同名存档会先询问是否覆盖。',()=>{
  const i=el('input');i.required=true;i.maxLength=48;i.autocomplete='off';i.value='第'+state.game.round+'轮-'+Date.now().toString().slice(-6);return field('存档名称',i);
 },async(i)=>{
  try{await api('/api/saves',{name:i.value.trim(),overwrite});notify(overwrite?'存档已覆盖并更新。':'新存档已创建。');return true;}
  catch(e){if(e.status===409&&!overwrite){overwrite=true;$('#dialog-description').textContent='“'+(e.data.conflict?.name||i.value.trim())+'”已存在。再次点击“确认覆盖”会更新这个存档；取消则保留原存档。';$('#dialog-confirm').textContent='确认覆盖';return false;}throw e;}
 },'新建存档');
};
async function load(){
 if(state.room){await lobby.load();return;}
 if(!state.localAvailable){notify('本地存档只能在主机本机使用。',true);return;}
 clearTimeout(state.botTimer);
 try{
 const {saves}=await api('/api/saves');
 if(!saves.length){notify('还没有本地存档。');scheduleBot();return;}
 const modeName=(s)=>s.mode==='fixedRounds'?'固定轮数':'竞速';
 const sessionName=(s)=>s.kind==='solo'?'人机':'本地双人';
 const phaseName=(s)=>({preEvent:'轮前准备',eventReveal:'事件揭示',supply:'粮草结算',characterTurn:'角色行动',roundEnd:'轮末结算',finished:'已结束'}[s.phase]||'进行中');
 const optionLabel=(s)=>`${s.name}　·　第${s.round}轮　·　${modeName(s)}${s.kind?' / '+sessionName(s):''}${s.faction?' / '+(s.faction==='smuggler'?'走私者':'官兵'):''}　·　${phaseName(s)}　·　${new Date(s.savedAt).toLocaleString('zh-CN')}`;
 modal('读取行程','选择要读取的独立存档。读取后会替换当前对局；自动恢复进度不会出现在此列表。旧规则存档会保留，但不能用于当前规则。',()=>select('可读取存档',saves.map((s)=>[s.id,optionLabel(s)])),async(i)=>{const ok=await mutate('/api/saves/load',{id:i.value});if(ok){state.botPaused=false;show('play');}return ok;},'读取所选存档');
 }catch(e){notify(e.message,true);scheduleBot();}
}
$('#load').onclick=$('#home-load').onclick=load;

}
