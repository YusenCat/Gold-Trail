import { createRoomConnection } from './room-api.js';
import { portrait } from './player-tableau.js';
export function createLobbyController({ state, $, el, button, api, absorb, mutate, show, render, notify, confirm, modal, field, select, playerName, factionName }) {
  const storageKey = 'golden-post-road-room';
  const connection = createRoomConnection({ state, api, absorb, render, show, notify, onClosed: () => { reset(); show('lan'); } });
  function remember(id) { try { if (id) localStorage.setItem(storageKey, id); else localStorage.removeItem(storageKey); } catch {} }
  function enter(view) {
    absorb(view); remember(view.room.id);
    connection.connect(view.room.id);
    if ($('#interaction').open) $('#interaction').close();
    show(view.game ? 'play' : 'lobby');
  }
  async function refresh() {
    if (!state.room || state.busy) return;
    state.busy = true;
    try { enter(await api('/api/rooms/' + state.room.id)); }
    catch (error) {
      if (error.status === 404 || error.status === 403) { reset(); show('lan'); }
      notify(error.message, true);
    } finally { state.busy = false; render(); }
  }
  function reset() { connection.disconnect(); remember(null); state.pendingLanCommand = null; state.room = null; state.me = null; state.game = null; state.actions = []; state.legalMoves = []; state.canAct = false; if ($('#interaction').open && !state.busy) $('#interaction').close(); }
  async function act(action, body = {}) {
    if (!state.room) return;
    const ok = await mutate('/api/rooms/' + state.room.id + '/' + action, { ...body, roomRevision: state.room.revision });
    if (ok && (action === 'leave' || action === 'close')) { reset(); show('lan'); }
    else if (ok) show(state.game ? 'play' : 'lobby');
    return ok;
  }
  function renderLobby() {
    const room = state.room;
    if (!room) return;
    const me = room.members.find((m) => m.playerId === state.me.playerId);
    const connected = state.roomConnection === 'connected', host = me.playerId === room.hostId;
    $('#room-connection').textContent = connected ? '驿路已接通 · 自动同步' : '正在重新接通驿路…';
    $('#room-connection').className = 'room-connection ' + (connected ? 'connected' : 'reconnecting');
    $('#lobby-code').textContent = room.code;
    $('#lobby-description').textContent = room.capacity + ' 人对战 · ' + (room.mode === 'race' ? '五十声望竞速局' : '三十轮火并局') + ' · 已入席 ' + room.members.length + '/' + room.capacity;
    const invitation = new URL('/', state.invitationBase || location.href); invitation.searchParams.set('room', room.code);
    $('#room-invitation').value = invitation.href;
    $('#invite-hint').textContent = invitation.hostname === '127.0.0.1' || invitation.hostname === 'localhost'
      ? '这个地址只适用于本机。跨设备游玩请从启动窗口的局域网地址进入，再复制邀请链接。'
      : '朋友需连接同一局域网，并用浏览器打开此链接。';
    const members = $('#lobby-members'); members.replaceChildren();
    for (const member of room.members) {
      const row = el('article', undefined, 'character ' + (member.seat?.startsWith('OFFICER') || member.seat === 'officer' ? 'officer' : 'smuggler'));
      const seatName = member.seat ? (room.capacity === 2 ? factionName(member.seat) + ' · 控制两名角色' : playerName(member.seat)) : '尚未选择席位';
      row.append(portrait(member.seat?.startsWith('OFFICER') || member.seat === 'officer' ? (room.capacity === 4 ? member.seat : 'OFFICER_1') : (room.capacity === 4 && member.seat ? member.seat : 'SMUGGLER_1'), el));
      row.append(el('strong', member.nickname + (member.playerId === room.hostId ? ' · 房主' : '') + (member.playerId === me.playerId ? ' · 你' : '')),
        el('p', seatName), el('small', (member.online ? '在线' : '离线') + ' · ' + (member.ready ? '已准备' : '未准备'), member.online ? 'room-ready' : 'muted'));
      members.append(row);
    }
    const seats = $('#lobby-seats'); seats.replaceChildren();
    for (const seat of room.capacity === 2 ? ['smuggler', 'officer'] : ['SMUGGLER_1', 'OFFICER_1', 'SMUGGLER_2', 'OFFICER_2']) {
      const occupant = room.members.find((member) => member.seat === seat);
      const choice = button('', () => act('seat', { seat }), !connected || room.status !== 'lobby' || (!!occupant && occupant !== me));
      const faction = seat.startsWith('SMUGGLER') || seat === 'smuggler' ? 'smuggler' : 'officer';
      choice.className = 'room-seat choice ' + faction + (me.seat === seat ? ' selected' : '');
      choice.setAttribute('aria-pressed', String(me.seat === seat));
      choice.append(portrait(room.capacity === 2 ? (faction === 'smuggler' ? 'SMUGGLER_1' : 'OFFICER_1') : seat, el),
        el('span', faction === 'smuggler' ? '朱衣行商' : '蓝甲巡卫', 'seat-faction'),
        el('strong', room.capacity === 2 ? factionName(seat) : playerName(seat)), el('small', occupant ? occupant.nickname : '虚席以待'),
        el('span', me.seat === seat ? '已入席 ✓' : occupant ? '同伴席位' : '选择席位 →', 'seat-action'));
      seats.append(choice);
    }
    const ready = $('#room-ready'); ready.textContent = me.ready ? '取消准备' : '准备就绪'; ready.disabled = !connected || state.busy || !me.seat || room.status !== 'lobby';
    $('#room-start').hidden = me.playerId !== room.hostId;
    $('#room-start').disabled = !connected || state.busy || room.status !== 'lobby' || room.members.length !== room.capacity || !room.members.every((m) => m.seat && m.ready && m.online);
    $('#room-start').textContent = '全员出发';
    $('#room-release').disabled = !connected || state.busy || !me.seat || room.status !== 'lobby';
    $('#room-exit').textContent = me.playerId === room.hostId ? '关闭房间' : '离开房间';
    $('#room-exit').disabled = state.busy || !connected;
    $('#room-play').hidden = room.status === 'lobby';
    $('#lobby-phase').textContent = room.status === 'lobby' ? '选择席位，再与同伴一起准备。选位或成员变化后，全员需重新准备。' : room.status === 'paused' ? room.pauseReason + '。全员在线后由房主继续。' : room.status === 'finished' ? '本局已结算，可保存战报或再开一局。' : '对局正在进行，席位已经锁定。';
    $('#room-pause').hidden = !host || !['playing', 'paused'].includes(room.status);
    $('#room-pause').textContent = room.status === 'paused' ? '继续征程' : '暂停对局';
    $('#room-pause').disabled = !connected || state.busy || (room.status === 'paused' && !room.members.every((m) => m.online));
    $('#room-rematch').hidden = !host || room.status !== 'finished';
    $('#room-rematch').disabled = !connected || state.busy;
    $('#lan-pause').hidden = $('#room-pause').hidden; $('#lan-pause').textContent = $('#room-pause').textContent; $('#lan-pause').disabled = $('#room-pause').disabled;
    $('#lan-rematch').hidden = $('#room-rematch').hidden; $('#lan-rematch').disabled = $('#room-rematch').disabled;
  }
  function formBusy(busy) {
    for (const b of document.querySelectorAll('#screen-lan button[type="submit"]')) b.disabled = busy;
  }
  async function submit(event, create) {
    event.preventDefault(); if (state.busy) return;
    const form = new FormData(event.target);
    state.busy = true; formBusy(true);
    try {
      const body = create ? { nickname: form.get('nickname'), capacity: Number(form.get('capacity')), mode: form.get('mode') }
        : { nickname: form.get('nickname'), code: form.get('code') };
      enter(await api(create ? '/api/rooms' : '/api/rooms/join', body));
    } catch (error) { notify(error.message, true); }
    finally { state.busy = false; formBusy(false); render(); }
  }
  $('#mode-lan').onclick = async () => {
    if (!state.room) await restore();
    show(state.room ? (state.game ? 'play' : 'lobby') : 'lan');
  };
  $('#lan-back').onclick = () => show('home');
  $('#room-create-form').onsubmit = (e) => submit(e, true);
  $('#room-join-form').onsubmit = (e) => submit(e, false);
  $('#room-ready').onclick = () => act('ready', { ready: !state.room.members.find((m) => m.playerId === state.me.playerId).ready });
  $('#room-release').onclick = () => act('seat', { seat: null });
  $('#room-start').onclick = () => act('start');
  $('#room-pause').onclick = $('#lan-pause').onclick = () => act(state.room.status === 'paused' ? 'resume' : 'pause');
  $('#room-rematch').onclick = $('#lan-rematch').onclick = () => confirm('再开一局？', '当前战局会自动保留为“上局战报”，返回大厅后全员重新准备。', () => act('rematch'));
  $('#room-refresh').onclick = $('#lan-refresh').onclick = refresh;
  $('#lan-lobby').onclick = () => show('lobby');
  $('#room-play').onclick = () => show('play');
  $('#room-exit').onclick = () => {
    const host = state.me.playerId === state.room.hostId;
    confirm(host ? '关闭房间？' : '离开房间？', host ? '房间将关闭，不能再通过房间码加入。请先保存需要的战局；关闭不会删除主机上的存档文件。' : state.room.status === 'lobby' ? '你的席位会释放，其他成员需要重新准备。' : '对局将暂停并保留你的席位，可用原浏览器和房间码回来继续。', () => act(host ? 'close' : 'leave'));
  };
  $('#room-copy').onclick = async () => {
    const input = $('#room-invitation'); input.focus(); input.select();
    try { await navigator.clipboard.writeText(input.value); notify('邀请链接已复制。'); }
    catch { notify('邀请链接已选中，请手动复制。'); }
  };
  async function restore() {
    const code = new URL(location.href).searchParams.get('room');
    if (code) $('#join-code').value = code.slice(0, 6).toUpperCase();
    let id; try { id = localStorage.getItem(storageKey); } catch {}
    if (id && /^[a-f0-9-]{36}$/.test(id)) {
      try { enter(await api('/api/rooms/' + id)); return; }
      catch (error) { if (error.status === 403 || error.status === 404) remember(null); else notify('房间暂时无法读取，请稍后重试。', true); }
    }
    if (code || !state.localAvailable) show('lan');
  }
  function save() {
    if (state.me.playerId !== state.room.hostId) { notify('请由房主保存房间行程。'); return; }
    let overwrite = false;
    modal('保存联机行程', '存档只属于这个房间，保存在主机上；每步也会自动保留。', () => {
      const input = el('input'); input.required = true; input.maxLength = 48; input.value = '第' + state.game.round + '轮-' + Date.now().toString().slice(-6); return field('存档名称', input);
    }, async (input) => {
      try { await api('/api/rooms/' + state.room.id + '/saves', { name: input.value.trim(), overwrite }); notify('联机行程已保存。'); return true; }
      catch (error) { if (error.status === 409 && !overwrite) { overwrite = true; $('#dialog-description').textContent = error.message; $('#dialog-confirm').textContent = '确认覆盖'; return false; } throw error; }
    }, '保存行程');
    state.roomUtilityDialog = true;
  }
  async function load() {
    if (state.room.status !== 'paused') { notify('请先暂停对局，再读取房间存档。'); return; }
    try {
      const result = await api('/api/rooms/' + state.room.id + '/saves');
      if (!result.saves.length) { notify('这个房间还没有命名存档。'); return; }
      modal('读取联机行程', '仅恢复游戏局面，所有成员保留当前席位。读取后由房主继续。', () => select('房间存档', result.saves.map((s) => [s.id, s.name + ' · 第' + s.round + '轮 · ' + new Date(s.savedAt).toLocaleString('zh-CN')])),
        async (input) => { const ok = await mutate('/api/rooms/' + state.room.id + '/saves/load', { id: input.value, roomRevision: state.room.revision }); if (ok) show('play'); return ok; }, '恢复行程');
      state.roomUtilityDialog = true;
    } catch (error) { notify(error.message, true); }
  }
  return { renderLobby, refresh, restore, save, load };
}
