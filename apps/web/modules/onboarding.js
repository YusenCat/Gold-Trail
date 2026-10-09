export const lessons = [
 ['一局要做什么？','双方各两名角色。走私者把碎金送到边境黑市，官兵送到墨尔根。每兑换一枚碎金，获得一点阵营声望和一官银。竞速先到50声望；火并在第30轮结束比较声望。'],
 ['先认清轮到谁','每轮揭示事件、结算粮草，再轮流行动。回合开始掷行动骰得到2–4点基础行动，事件与装备可能改变它。响应者可能不是当前回合角色，请看“驿路传令”。'],
 ['怎样移动？','点击地图亮起的节点，先查看路线和行动费用，再确认。两个相邻地点之间是一段路；曲线长短不影响费用。取消确认不扣行动。手机建议点“放大地图”。'],
 ['采矿、押运与兑换','到漠河金矿采矿，然后前往己方交金点。每人每回合最多采矿两次，每阵营每轮最多取4金。官兵也可以通过合法稽查取得碎金。背着金子不等于已有声望，必须送到目的地兑换。'],
 ['粮草是生存资源','轮初通常在驿道消耗1粮，安全地点免常规耗粮；极昼额外耗粮也影响安全地点。恰好够吃会剩0粮，但不立即死亡，下次扣粮不足才会饿死。驿站伙房耗尽剩余行动补满粮，黑市补给花1行动和1银。'],
 ['卡牌与装备怎么用？','手牌在棋盘下方。亮起的功能牌可以选中，再选合法目标并确认；不能使用的牌可以放大阅读。自己回合通常最多两张，响应牌有专门窗口。装备购入即生效，同槽替换需确认。'],
 ['遇到收缴怎么办？','依次为：被查者响应 → 被查者秘密分箱 → 发动者问系统问题 → 发动者选一箱。只有轮到的决策者能操作。“暴力拒查”可阻止稽查、搜寻或劫道，不能阻止私刑查抄。回答始终真实。'],
 ['哪些操作不消耗进度？','查看地图、切换手牌、打开规则、取消确认和新手指引都不执行动作。准备结束回合时看剩余行动。开始新局会替换当前自动恢复记录，重要行程请先保存。'],
 ['怎样和朋友玩？','主机启动游戏，在大厅建2或4人房间，朋友用同一局域网打开邀请链接。选位、全员准备后房主开始。2人各管两名角色，4人各管一名；队友共享手牌，但不能代操作。断线后暂停，回来由房主继续。'],
];
const steps = [
 ['看懂胜负目标','先看两队声望。碎金需要在己方交金点兑换才算得分。','.expedition-scoreboard'],
 ['找到当前操作者','传令会告诉你现在谁行动、谁响应。按钮只带你到操作区，不会代你执行动作。','#turn-prompt'],
 ['试着看一条路线','点击一个亮圈，查看路线和消耗；暂时不想走就取消。手机可先放大地图。','.board-panel'],
 ['认识地点行动','这里列出的操作都经过服务端验证。在金矿采矿、在交金点兑换；不要把“查看操作”当作已经执行。','.control-panel'],
 ['留意粮草','行动角色区展示粮草、行动点、金与银。轮初扣粮前及时规划补给；0粮并不等于当场死亡。','#active-character'],
 ['检查你自己的手牌','先放大阅读，再选择亮起的牌。别把当前回合角色和当前响应者混为一谈。','.hand-table'],
 ['理解响应流程','如果发生收缴，请跟随传令依次响应、分箱、问话、选箱。当前没有收缴也无需制造它；遇到时可随时重开指引。','#decision-section'],
 ['保存并开始自由探索','自动恢复保留最新动作；手动保存可以建立独立命名档案。你随时能从“新手指引”重看这些步骤。','.game-toolbar'],
];
export function createOnboarding({state,$,el,button,show,setup}) {
 let index=0,open=false;const key='gold-trail-onboarding-v1';
 const grid=$('#learning-lessons');
 for(const [title,detail] of lessons){const section=el('article',undefined,'panel learning-lesson');section.append(el('h3',title),el('p',detail));grid.append(section);}
 function remember(){try{localStorage.setItem(key,String(index));}catch{}}
 function clear(){document.querySelectorAll('.coach-highlight').forEach(e=>e.classList.remove('coach-highlight'));}
 function end(){open=false;state.coachPending=false;clear();render();}
 function begin(){open=true;index=0;show('play');render();}
 $('#coach-open').onclick=begin;
 $('#learn-tour').onclick=begin;
 $('#learn-practice').onclick=async()=>{state.coachPending=true;await setup('solo');$('#setup-form input[name=faction][value=smuggler]').checked=true;$('#setup-form input[name=mode][value=race]').checked=true;};
 $('#coach-close').onclick=end;
 $('#coach-previous').onclick=()=>{index=Math.max(0,index-1);remember();render();};
 $('#coach-next').onclick=()=>{if(index===steps.length-1){end();return;}index++;remember();render();};
 $('#coach-locate').onclick=()=>{let target=$(steps[index][2]);if(!target||target.hidden)target=$('#turn-prompt');target.setAttribute('tabindex','-1');target.focus({preventScroll:true});target.scrollIntoView({block:'center',behavior:matchMedia('(prefers-reduced-motion: reduce)').matches?'instant':'smooth'});};
 function render(){
  $('#learn-practice').disabled=!state.localAvailable;
  $('#learn-tour').disabled=!state.game?.log.length||state.game.phase==='finished';
  $('#learning-mode-note').textContent=state.localAvailable?'先完成实操教学，再开始人机练习。':'联机开始后，可开启棋盘指引。';
  if(state.coachPending&&state.screen==='play'&&state.game?.session.kind==='solo'){open=true;index=0;state.coachPending=false;}
  clear();const panel=$('#coach-panel');panel.hidden=!open||state.screen!=='play';if(panel.hidden)return;
  const [title,detail,selector]=steps[index];$('#coach-progress').textContent='新手旅程 '+(index+1)+' / '+steps.length;$('#coach-title').textContent=title;$('#coach-detail').textContent=detail;
  $('#coach-previous').disabled=index===0;$('#coach-next').textContent=index===steps.length-1?'完成指引':'下一步';
  const target=$(selector);if(target&&!target.hidden)target.classList.add('coach-highlight');
  if(selector==='#decision-section'&&target.hidden)$('#coach-detail').textContent=detail+' 当前没有待处理决策，先继续了解其他区域。';
 }
 return {render};
}
