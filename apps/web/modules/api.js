export function createApiClient({ state, $, textCN, render, scheduleBot, notify }) {
  async function api(path, body) {
    const response = await fetch(path, body === undefined ? {} : {
      method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body),
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
    if (view.game) {
      state.selectedCard = null;
      state.previewPath = null;
      Object.assign(state, {
        game: view.game,
        actions: view.actions || [],
        legalMoves: view.legalMoves || [],
        balance: view.balance || {},
        botPending: view.botPending,
        decisionActorId: view.decisionActorId,
      });
    }
  }

  async function mutate(path, body = {}) {
    if (state.busy) return false;
    state.busy = true;
    clearTimeout(state.botTimer);
    document.body.classList.add('busy');
    try {
      absorb(await api(path, { ...body, revision: state.game?.revision }));
      $('#notice').hidden = true;
      return true;
    } catch (error) {
      notify(error.message, true);
      $('#dialog-error').textContent = textCN(error.message);
      if (path.includes('bot-step')) state.botPaused = true;
      try { absorb(await api('/api/game')); } catch {}
      return false;
    } finally {
      state.busy = false;
      document.body.classList.remove('busy');
      render();
    }
  }

  const command = (payload) => mutate('/api/game/command', payload);
  return { api, absorb, mutate, command };
}
