export function createApiClient({ state, $, textCN, render, scheduleBot, notify }) {
  async function api(path, body) {
    const response = await fetch(path, body === undefined ? { signal: AbortSignal.timeout(8000) } : {
      method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body),
      signal: AbortSignal.timeout(8000),
    });
    const data = await response.json();
    if (!response.ok) {
      const error = new Error(data.error || '服务暂时不可用');
      error.status = response.status;
      error.data = data;
      throw error;
    }
    return data;
  }

  function absorb(view) {
    if (view.room && state.room?.id === view.room.id && (view.room.revision < state.room.revision || (view.game && state.game && view.game.revision < state.game.revision))) return false;
    const changedGame = view.room && state.room?.id === view.room.id && (view.game?.revision !== state.game?.revision || view.room.status !== state.room.status || view.room.epoch !== state.room.epoch);
    if (view.room) {
      state.room = view.room;
      state.me = view.me;
      state.serverCanAct = view.canAct;
      state.canAct = view.canAct && state.roomConnection === 'connected' && !state.pendingLanCommand;
      state.decisionPlayerId = view.decisionPlayerId;
      if (!view.game) { state.game = null; state.actions = []; state.legalMoves = []; state.botPending = false; }
    } else if (view.game) {
      state.disconnectRoom?.(); state.pendingLanCommand = null;
      state.room = null; state.me = null; state.canAct = false;
    }
    if (view.game) {
      if (!view.room || changedGame) { state.selectedCard = null; state.previewPath = null; }
      if (view.room && view.decisionActorId !== state.decisionActorId) state.handCharacterId = null;
      Object.assign(state, {
        game: view.game,
        actions: view.actions || [],
        legalMoves: view.legalMoves || [],
        balance: view.balance || {},
        foodAdvice: view.foodAdvice || [],
        botPending: view.botPending,
        decisionActorId: view.decisionActorId,
      });
    }
    if (changedGame && $('#interaction').open && !state.busy && !state.roomUtilityDialog) { $('#interaction').close(); notify('局面已更新，已关闭原操作窗口。'); }
    return true;
  }

  async function mutate(path, body = {}, retryPending = false) {
    if (state.busy) return false;
    if (state.pendingLanCommand && !retryPending && path.endsWith('/command')) { notify('正在确认上一条操作，请稍候。'); return false; }
    state.busy = true;
    clearTimeout(state.botTimer);
    document.body.classList.add('busy');
    render();
    const payload = { ...body, revision: body.revision ?? state.game?.revision };
    try {
      let result;
      try { result = await api(path, payload); }
      catch (error) {
        if (payload.commandId && !error.status) result = await api(path, payload);
        else throw error;
      }
      if (payload.commandId) state.pendingLanCommand = null;
      absorb(result);
      $('#notice').hidden = true;
      return true;
    } catch (error) {
      if (payload.commandId) {
        state.pendingLanCommand = error.status ? null : { path, body: payload };
        if (state.pendingLanCommand) state.canAct = false;
      }
      notify(error.message, true);
      $('#dialog-error').textContent = textCN(error.message);
      if (path.includes('bot-step')) state.botPaused = true;
      try { absorb(await api(state.room ? '/api/rooms/' + state.room.id : '/api/game')); } catch {}
      return false;
    } finally {
      state.busy = false;
      document.body.classList.remove('busy');
      render();
    }
  }

  state.retryPendingCommand = async () => {
    const pending = state.pendingLanCommand;
    if (!pending || state.busy || state.roomConnection !== 'connected' || !state.room || !pending.path.includes(state.room.id)) return;
    await mutate(pending.path, pending.body, true);
  };
  const command = (payload) => {
    if (state.room && state.roomConnection !== 'connected') { notify('连接正在恢复，请稍候。'); return false; }
    const commandId = Array.from(crypto.getRandomValues(new Uint8Array(16)), (n) => n.toString(16).padStart(2, '0')).join('');
    return mutate(state.room ? '/api/rooms/' + state.room.id + '/command' : '/api/game/command', state.room ? { ...payload, commandId } : payload);
  };
  return { api, absorb, mutate, command };
}
