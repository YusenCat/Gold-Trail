export function createSurvivalAdvisor({state,$,playerName,nodeName,el}) {
 return function renderSurvival(){
  const warnings=(state.foodAdvice||[]).filter(a=>a.risk!=='safe');const panel=$('#survival-alert');panel.hidden=!warnings.length||state.game.phase==='finished';panel.replaceChildren();
  if(panel.hidden)return;
  const urgent=warnings.some(w=>w.risk==='urgent');panel.dataset.urgency=urgent?'urgent':'low';panel.append(el('strong',urgent?'粮草急报 · 请在轮初扣粮前补给':'粮草预警 · 提前规划补给'));
  for(const w of warnings){const c=state.game.characters.find(c=>c.id===w.characterId);panel.append(el('p',playerName(c.id)+' · '+nodeName(c.nodeId)+' · 剩'+w.food+'粮。'+(w.ordinaryCost?(w.food===0?'在驿道常规扣粮需要1，若轮初仍不足就会饿死。':'只够一次驿道常规耗粮。'):'当前安全地点免常规耗粮。')+'下一轮事件尚未知，极昼还会额外耗1粮。'));}
  panel.append(el('small','驿站伙房：耗尽剩余行动补满；黑市：1行动＋1银补满。普通移动不扣粮，不能等饿死后再补。'));
 };
}
