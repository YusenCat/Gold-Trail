export function createRoomConnection({ state, api, absorb, render, show, onClosed, notify }) {
  let source = null, roomId = null, timer = null, generation = 0, heartbeatBusy = false;
  function status(value) {
    state.roomConnection = value;
    state.canAct = state.serverCanAct && value === 'connected' && !state.pendingLanCommand;
    render();
  }
  function disconnect() {
    generation++; source?.close(); source = null; roomId = null; clearInterval(timer); timer = null;
    state.roomConnection = 'disconnected'; state.canAct = false;
  }
  async function heartbeat() {
    if (!roomId || heartbeatBusy) return;
    const id = roomId, attempt = generation; heartbeatBusy = true;
    try {
      await api('/api/rooms/' + id + '/heartbeat', {});
      if (attempt === generation && state.room?.id === id && state.roomConnection !== 'connected' && source?.readyState === EventSource.OPEN) {
        const before = state.room, view = await api('/api/rooms/' + id);
        if (attempt === generation && absorb(view)) { status('connected'); if (before.status === 'lobby' && view.game && state.screen === 'lobby') show('play'); }
      }
      if (attempt === generation) await state.retryPendingCommand?.();
    } catch (error) {
      if (attempt !== generation) return;
      if (error.status === 403 || error.status === 404) { disconnect(); onClosed(); notify(error.message, true); }
      else status('reconnecting');
    } finally { heartbeatBusy = false; }
  }
  function connect(id) {
    if (roomId === id && source) return;
    disconnect(); roomId = id;
    const attempt = generation;
    state.roomConnection = 'connecting'; state.canAct = false;
    source = new EventSource('/api/rooms/' + id + '/events');
    const receive = (event) => {
      if (attempt !== generation || state.room?.id !== id) return;
      try {
        const view = JSON.parse(event.data);
        const before = state.room;
        if (!absorb(view)) return;
        status('connected');
        if ((before?.status === 'lobby' && view.game) || (view.room.status === 'lobby' && before?.status !== 'lobby')) {
          if (['play', 'lobby', 'lan'].includes(state.screen)) show(view.game ? 'play' : 'lobby');
        }
        void state.retryPendingCommand?.();
      } catch { status('reconnecting'); }
    };
    source.addEventListener('view', receive); source.addEventListener('reset', receive);
    source.addEventListener('closed', () => { if (attempt === generation) { disconnect(); onClosed(); notify('房间已关闭或你已离开房间。'); } });
    source.onerror = () => { if (attempt === generation) status('reconnecting'); };
    timer = setInterval(() => { void heartbeat(); }, state.heartbeatMs ?? 5000);
    void heartbeat(); render();
  }
  window.addEventListener('online', () => { void heartbeat(); });
  document.addEventListener('visibilitychange', () => { if (!document.hidden) { void heartbeat(); if (roomId && state.roomConnection === 'reconnecting') { const id = roomId; disconnect(); connect(id); } } });
  state.disconnectRoom = disconnect;
  return { connect, disconnect, heartbeat };
}
