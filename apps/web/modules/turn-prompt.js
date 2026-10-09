// Presentation only: ownership and available choices come from the server view.
export function turnPrompt(state, playerName) {
  const g = state.game;
  const lan = g.session.kind === 'lan';
  const actor = g.characters.find(c => c.id === state.decisionActorId);
  const name = actor ? playerName(actor.id) : '当前角色';
  const owner = lan ? state.room.members.find(m => m.playerId === state.decisionPlayerId)?.nickname : null;
  const yours = lan ? state.canAct : !state.botPending;
  const label = yours ? (g.session.kind === 'hotseat' ? name : '你 · ' + name) : (owner ? owner + ' · ' : '') + name;
  const result = (tone, title, detail, target, action) => ({tone, title, detail, target, action});
  if (lan && state.roomConnection !== 'connected') return result('waiting', '正在恢复连接', '席位与进度已保留。接通后会恢复操作，请勿重复提交。', '#lan-toolbar', '查看连接');
  if (state.pendingLanCommand || state.busy) return result('waiting', '正在确认操作', '等待主机确认结果，当前操作不会重复执行。', null, '请稍候');
  if (g.phase === 'finished') return result('finished', '本局已结束', '查看结算与战报，或再开一局。', '#result-panel', '查看结算');
  if (lan && state.room.status === 'paused') return result('waiting', '对局已暂停', (state.room.pauseReason || '行程暂歇') + '；全员在线后由房主继续，原决策会保留。', '#lan-toolbar', '查看房间状态');
  const p = g.pendingDecision;
  const controlled = !p && state.decisionActorId !== g.activeCharacterId && actor;
  const detail = {
    response: state.actions.some(a => a.command.cardId === 'T_RESIST_SEARCH') ? '可打出「暴力拒查」，或选择放弃响应。完成后才会继续结算。' : '你没有可用的拒查牌，请选择「放弃响应」继续结算。',
    splitGold: '秘密分配甲、乙两箱。箱数仅向有权查看的玩家展示，确认后由对方提问。',
    askSearchQuestion: '选择一个问题，系统会如实回答；可用「刑讯逼供」追加提问。',
    chooseSearchBox: p?.questionsRemaining ? '还需要提出一个不同的问题，之后再选箱。' : '阅读已获得的回答，再选择打开甲箱或乙箱。',
  };
  const action = {response:'处理响应', splitGold:'秘密分箱', askSearchQuestion:'继续问话', chooseSearchBox:p?.questionsRemaining?'继续问话':'选择箱子'}[p?.kind];
  if (p || controlled) {
    const task = action || '控制移动';
    return result(yours ? 'attention' : 'waiting', (yours ? '需要' : '等待') + label + ' · ' + task,
      yours ? (detail[p?.kind] || '由你决定受控角色的移动，或放弃剩余控制。') : state.botPending ? (state.botPaused ? '人机已暂停，点击「继续人机」后处理决策。' : '人机正在处理这项决策，完成后自动继续。') : '当前由该玩家处理决策；其他角色暂不能行动，结果会自动同步。',
      yours ? '#decision-section' : '.situation-panel', yours ? task : '查看局势');
  }
  if (state.botPending) return result('waiting', state.botPaused ? '人机已暂停' : '人机正在行动 · ' + name,
    state.botPaused ? '点击「继续人机」恢复。遇到你的响应或分箱决策时，人机会停下等你。' : '遇到你的响应或分箱决策时，会自动交给你处理。', state.botPaused ? '#bot-pause' : '.control-panel', state.botPaused ? '查看人机控制' : '查看当前角色');
  if (!yours) return result('waiting', '等待' + label + '行动', '你可以查看地图、你方手牌和战报；轮到你时会在这里提示。', '.situation-panel', '查看局势');
  if (g.phase === 'preEvent') return result('ready', label + ' · 轮前准备', '先处理白驹或时辰铜锣，或点击「完成轮前准备」。', '.control-panel', '轮前操作');
  const end = state.actions.some(a => a.command.type === 'END_TURN');
  if (actor?.actionPoints === 0 && end) return result('ready', label + ' · 行动点已用完', '仍可查看合法的免费操作；准备好后结束回合，交给下一名角色。', '#end-turn', '前往结束回合');
  return result('ready', label + ' · 轮到你行动', '剩余 ' + (actor?.actionPoints ?? 0) + ' 点行动。点击亮起的地图节点，或选择地点行动、装备与手牌。', '.control-panel', '查看可用操作');
}

export function createTurnPrompt({state, $, playerName}) {
  let current;
  function jump(selector) {
    const target = selector && $(selector);
    if (!target || target.hidden) return;
    target.setAttribute('tabindex', '-1');
    target.focus({preventScroll:true});
    target.scrollIntoView({block:'start', behavior:matchMedia('(prefers-reduced-motion: reduce)').matches ? 'instant' : 'smooth'});
  }
  $('#turn-prompt-action').onclick = () => jump(current?.target);
  for (const button of document.querySelectorAll('[data-play-jump]')) button.onclick = () => {
    const destination = button.dataset.playJump;
    jump(destination === 'action' ? (current?.tone === 'attention' ? '#decision-section' : '.control-panel') : destination);
  };
  function text(selector, value) { if ($(selector).textContent !== value) $(selector).textContent = value; }
  return function renderTurnPrompt() {
    current = turnPrompt(state, playerName);
    if(state.tutorial?.finished)current={tone:'ready',title:'实操教学已完成',detail:'返回原对局或进入人机练习，开始完整征程。',target:'#tutorial-panel',action:'查看教学结果'};
    else if(state.tutorial?.completed)current={tone:'ready',title:'本步操作已完成',detail:'先查看操作结果，再点击“理解了，继续”。',target:'#tutorial-panel',action:'查看本步结果'};
    $('#turn-prompt').dataset.tone = current.tone;
    text('#turn-prompt-title', current.title);
    text('#turn-prompt-detail', current.detail);
    text('#turn-prompt-action', current.action);
    $('#turn-prompt-action').disabled = !current.target;
    text('#mobile-turn-label', current.title);
    text('#mobile-action-jump', current.tone === 'attention' ? '回应决策' : '行动');
    $('#mobile-action-jump').classList.toggle('needs-response', current.tone === 'attention');
    text('#turn-hint', current.detail);
    $('#turn-title').textContent = state.game.pendingDecision || state.decisionActorId !== state.game.activeCharacterId ? '当前回合角色 · 决策另有归属' : '当前回合角色';
  };
}
