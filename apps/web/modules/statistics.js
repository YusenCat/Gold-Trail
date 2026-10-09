export function bindStatistics({state,$,el,button,api,modal,notify}){
 const percent=n=>(n*100).toFixed(1)+'%';
 const open=async()=>{
  try{
   const data=await api('/api/game/statistics');
   modal('试玩统计','只记录本机主机上完成的正式对局；教学和未结束对局不计入。局长含暂停时间，旧档缺少统计字段时不补造记录。',()=>{
    $('#dialog-fields').append(el('p','已完成 '+data.matches.length+' 局。装备购买率＝买过装备的对局占比；角色购买率＝买过装备的角色数／总角色数。'));
    for(const group of data.groups){const [kind,difficulty,mode,rules,balance]=group.key.split('/');const title=({solo:'人机',hotseat:'同屏',lan:'局域网'})[kind]+' · '+(kind==='solo'?({easy:'入门',normal:'标准',hard:'进阶'})[difficulty]+' · ':'')+(mode==='race'?'竞速':'火并');const p=el('p');p.textContent=title+' · '+group.count+'局\n走私胜率 '+percent(group.smugglerWinRate)+' / 官兵 '+percent(group.officerWinRate)+' / 平局 '+percent(group.drawRate)+'\n平均 '+group.averageRounds.toFixed(1)+'轮 · '+group.averageMinutes.toFixed(1)+'分钟 · 装备购买率 '+percent(group.equipmentPurchaseRate)+' · 角色购买率 '+percent(group.characterEquipmentRate)+'\n规则 '+rules+' · 平衡 '+balance;p.style.whiteSpace='pre-line';$('#dialog-fields').append(p);}
    if(!data.groups.length)$('#dialog-fields').append(el('p','还没有完成的样本。先完成不同阵营、难度和种子的对局，再依据样本评估平衡。'));
    const exportButton=button('导出统计 JSON',()=>{const blob=new Blob([JSON.stringify(data,null,2)],{type:'application/json'}),url=URL.createObjectURL(blob),a=el('a');a.href=url;a.download='黄金邮道试玩统计.json';a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);});$('#dialog-fields').append(exportButton);
   },async()=>true,'关闭');
  }catch(e){notify(e.message,true);}
 };
 const trigger=button('试玩统计',open);$('#home-load').after(trigger);
 return ()=>{trigger.hidden=!state.localAvailable;};
}
