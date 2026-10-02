export function bindReportView({state,$,render}){
const reportDialog=$('#report-projection');
let reportRestorePause=false;
function setReportCollapsed(collapsed){
 $('#log').hidden=collapsed;
 $('#report-toggle').textContent=collapsed?'展开':'收起';
 $('#report-toggle').setAttribute('aria-expanded',String(!collapsed));
 $('.report-panel').classList.toggle('collapsed',collapsed);
}
function closeReportProjection(){
 if(!reportDialog.open)return;
 reportDialog.close();
 setReportCollapsed(true);
 state.botPaused=reportRestorePause;
 render();
}
$('#report-toggle').onclick=()=>setReportCollapsed(!$('#log').hidden);
$('#report-project').onclick=()=>{
 if(!state.game)return;
 reportRestorePause=state.botPaused;
 state.botPaused=true;
 clearTimeout(state.botTimer);
 render();
 reportDialog.showModal();
};
reportDialog.addEventListener('click',closeReportProjection);
reportDialog.addEventListener('cancel',(event)=>{event.preventDefault();closeReportProjection();});

}
