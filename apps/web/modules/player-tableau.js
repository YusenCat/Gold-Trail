export function portrait(id, el) {
  const image = el('span', undefined, 'character-portrait portrait-' + id);
  image.setAttribute('aria-hidden', 'true'); return image;
}

// Render only the server's filtered observation; no additional game data is fetched.
export function renderPlayerTableaux({ state, el, button, playerName, nodeName, card, inspectCharacter, resourceIcon }) {
  const grid = document.querySelector('#characters'); grid.replaceChildren();
  for (const actor of state.game.characters) {
    const owner = state.room?.members.find((member) => member.characterIds.includes(actor.id));
    const mine = state.room ? state.me.characterIds.includes(actor.id) : state.game.session.kind === 'solo' && actor.faction === state.game.session.humanFaction;
    const current = actor.id === state.decisionActorId;
    const board = el('article', undefined, 'player-tableau ' + actor.faction + (current ? ' current' : '') + (mine ? ' own' : ''));
    if (current) board.setAttribute('aria-current', 'true');
    const head = el('div', undefined, 'tableau-heading');
    const look = button('', () => inspectCharacter(actor)); look.className = 'portrait-button'; look.setAttribute('aria-label', '查看' + playerName(actor.id)); look.append(portrait(actor.id, el));
    const title = el('div', undefined, 'tableau-title');
    title.append(el('small', actor.faction === 'smuggler' ? '朱衣 · 走私者' : '蓝甲 · 官兵', 'tableau-faction'), el('h3', playerName(actor.id)), el('span', owner ? owner.nickname + (mine ? ' · 你' : '') : state.game.session.kind === 'solo' ? (mine ? '你方角色' : '人机角色') : '同屏角色', 'tableau-owner'));
    head.append(look, title); board.append(head);
    const location = el('p', nodeName(actor.nodeId), 'tableau-location'); location.append(el('span', actor.deadUntilRound ? '待复活' : current ? '正在决策' : '待命', 'tableau-status')); board.append(location);
    const resources = el('div', undefined, 'tableau-resources');
    for (const [label, value, kind] of [['粮草', actor.food, 'food'], ['碎金', actor.gold, 'gold'], ['官银', actor.silver, 'silver']]) {
      const token = el('div'); token.append(resourceIcon(kind), el('strong', String(value)), el('small', label)); resources.append(token);
    }
    board.append(resources);
    const equipment = el('div', undefined, 'tableau-equipment');
    equipment.append(el('small', '随身装备'));
    const names = [...Object.values(actor.equipped), ...(actor.mountId ? [actor.mountId] : [])];
    if (names.length) for (const id of names) equipment.append(el('span', card(id).name, 'equipment-chip'));
    else equipment.append(el('span', '轻装上路', 'muted'));
    board.append(equipment, el('p', '手牌 ' + actor.hand.length + ' / 5' + (owner ? ' · ' + (owner.online ? '在线' : '离线') : '') + (actor.deadUntilRound ? ' · 第' + actor.deadUntilRound + '轮复活' : ''), 'tableau-footnote'));
    grid.append(board);
  }
}
