// Mode capabilities and invitation addresses belong to the shared entry hall.
export function createHallController({state,$,render}) {
  const key='golden-post-road-invite-address';
  let addresses=[];
  function chooseAddress(url) {
    state.invitationBase=addresses.find(entry=>entry.url===url)?.url ?? location.origin;
    for(const id of ['#hall-address','#invite-address'])if($(id))$(id).value=state.invitationBase;
    try{localStorage.setItem(key,state.invitationBase);}catch{}
    render();
  }
  function configure(session) {
    state.localAvailable=session.local;
    state.lanAvailable=session.lan;
    state.heartbeatMs=session.heartbeatMs;
    addresses=session.lanAddresses??[];
    let remembered='';try{remembered=localStorage.getItem(key)??'';}catch{}
    const requested=new URL(location.href).searchParams.get('network');
    const choice=addresses.find(entry=>entry.address===requested)?.url??addresses.find(entry=>entry.url===remembered)?.url??addresses[0]?.url??location.origin;
    for(const id of ['#hall-address','#invite-address']){
      const select=$(id);select.replaceChildren();
      for(const entry of addresses){const option=document.createElement('option');option.value=entry.url;option.textContent=entry.url+' · '+entry.name;select.append(option);}
      select.onchange=()=>chooseAddress(select.value);
    }
    $('#hall-network').hidden=!session.local||!session.lan||!addresses.length;
    $('#invite-address-field').hidden=!session.local||addresses.length<2;
    $('#lan-network-hint').textContent=session.lan?'从大厅创建房间，分享邀请链接；朋友连接同一网络后入席。':'当前为仅本机模式。跨设备游玩请重新运行“启动游戏.cmd”。';
    chooseAddress(choice);
  }
  function renderHall() {
    $('#mode-solo').disabled=$('#mode-hotseat').disabled=!state.localAvailable;
    $('#mode-lan').disabled=!state.lanAvailable;
    $('#hall-service-state').textContent=state.localAvailable?(state.lanAvailable?'人机与联机已就绪':'本机对局已就绪'):'已连接朋友的驿站';
    $('#hall-mode-note').textContent=state.localAvailable?'选择与人机练习，或邀朋友一起落座。':'选择联机对战加入房间；主机可在本机大厅游玩人机模式。';
  }
  return {configure,render:renderHall};
}
