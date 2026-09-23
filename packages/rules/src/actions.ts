import cards from '../../../content/cards.v1.json' with { type: 'json' };
import { applyCommand, RuleError, type GameCommand } from './engine.ts';
import { getNeighbors, getNode, edgeKey } from './map.ts';
import type { GameState } from './state.ts';

export interface LegalAction {
  label: string;
  description: string;
  group: 'movement' | 'location' | 'tactic' | 'equipment' | 'decision' | 'turn';
  command: GameCommand;
  actionPointCost?: number;
}
export const personName = (id: string) => id.replace('SMUGGLER_', '走私者').replace('OFFICER_', '官兵');
export function locationName(id: string): string {
  const node = getNode(id);
  return node.siteName ?? node.label?.replace(/C$/, '丙').replace(/D$/, '丁').replace(/E$/, '戊').replace(/F$/, '己')
    ?? id.replace(/^W/, '西路·').replace(/^E/, '东路·').replace(/^N/, '北路·').replace(/^R/, '绕行道·');
}
export function decisionActor(state: GameState): string | null {
  if (state.phase === 'finished') return null;
  const p = state.pendingDecision;
  if (p) return ['response', 'splitGold'].includes(p.kind) ? p.targetId : p.sourceId;
  const active = state.characters.find((c) => c.id === state.activeCharacterId);
  if (state.phase === 'characterTurn' && active?.controlledById && active.controlledMovementAp > 0 && active.actionPoints > 0) return active.controlledById;
  return state.activeCharacterId;
}
export function movementPaths(state: GameState, from: string, max: number): string[][] {
  const result: string[][] = [];
  const walk = (cursor: string, path: string[], seen: Set<string>) => {
    if (path.length) result.push(path);
    if (path.length === max) return;
    for (const to of getNeighbors(cursor)) {
      if (seen.has(to) || state.blockedEdges.includes(edgeKey(cursor, to))) continue;
      walk(to, [...path, to], new Set([...seen, to]));
    }
  };
  walk(from, [], new Set([from])); return result;
}
export function legalActions(state: GameState): LegalAction[] {
  const id = decisionActor(state);
  if (!id) return [];
  const actor = state.characters.find((c) => c.id === id)!;
  const actions: LegalAction[] = [];
  // Legality probes never commit state, draw outcomes, or logs.
  const probe = { ...state, log: [] };
  const add = (label: string, group: LegalAction['group'], command: GameCommand, description = '') => {
    try {
      const next = applyCommand(probe, command);
      if (command.type === 'MOVE') {
        const remaining = next.characters.find((c) => c.id === id)!.actionPoints;
        const cost = actor.actionPoints - remaining;
        label += ' · ' + cost + '点行动';
        description = '消耗' + cost + '点行动。' + description;
      }
      const payer = command.type === 'CONTROLLED_MOVE' ? state.characters.find((c) => c.id === command.targetId)! : actor;
      const remaining = next.characters.find((c) => c.id === payer.id)!.actionPoints;
      actions.push({ label, group, command, description, actionPointCost: Math.max(0, payer.actionPoints - remaining) });
    }
    catch (error) { if (!(error instanceof RuleError)) throw error; }
  };
  const p = state.pendingDecision;
  const cardAction = (cardId: string, targetId?: string, path?: string[]) => {
    const card = cards.cards.find((c) => c.id === cardId)!;
    add(card.name + (targetId ? ' → ' + personName(targetId) : '') + (path?.length ? ' → ' + locationName(path.at(-1)!) : ''), p ? 'decision' : 'tactic', { type: 'PLAY_TACTIC', actorId: id, cardId, targetId, path }, card.text);
  };
  if (p) {
    if (p.kind === 'response') {
      cardAction('T_RESIST_SEARCH');
      add('放弃响应', 'decision', { type: 'PASS_RESPONSE', actorId: id });
    } else if (p.kind === 'splitGold') {
      for (const a of [...new Set([0, Math.floor(actor.gold / 2), Math.ceil(actor.gold / 2), actor.gold])]) add('甲箱 ' + a + ' · 乙箱 ' + (actor.gold - a), 'decision', { type: 'SPLIT_GOLD', actorId: id, boxA: a, boxB: actor.gold - a });
    } else {
      if (p.kind === 'askSearchQuestion') cardAction('T_INTERROGATION');
      for (const [question, label] of Object.entries({ aMoreThanB: '甲箱比乙箱多吗？', aEmpty: '甲箱为空吗？', bAtLeast2: '乙箱至少有两枚碎金吗？', equal: '两箱一样多吗？' })) add(label, 'decision', { type: 'ASK_SEARCH_QUESTION', actorId: id, question: question as 'equal' });
      for (const box of ['A','B'] as const) add('打开' + (box === 'A' ? '甲' : '乙') + '箱', 'decision', { type: 'CHOOSE_SEARCH_BOX', actorId: id, box });
    }
    return actions;
  }
  if (state.phase === 'preEvent') {
    add('敲响时辰铜锣', 'equipment', { type: 'USE_EQUIPMENT', actorId: id, cardId: 'E_TIME_GONG' });
    for (const to of getNeighbors(actor.nodeId)) add('白驹 → ' + locationName(to), 'movement', { type: 'PRE_EVENT_MOVE', actorId: id, path: [to] });
    add('完成轮前准备', 'turn', { type: 'SKIP_PRE_EVENT', actorId: id }); return actions;
  }
  const active = state.characters.find((c) => c.id === state.activeCharacterId)!;
  if (active.controlledById && active.controlledMovementAp > 0 && active.actionPoints > 0) {
    for (const to of getNeighbors(active.nodeId)) add('控制移动 → ' + locationName(to), 'decision', { type: 'CONTROLLED_MOVE', actorId: id, targetId: active.id, path: [to] });
    add('放弃剩余控制', 'decision', { type: 'RELEASE_CONTROL', actorId: id, targetId: active.id }); return actions;
  }
  add('结束回合', 'turn', { type: 'END_TURN', actorId: id });
  add('的卢 · 掷移动骰', 'movement', { type: 'ROLL_DILU', actorId: id });
  for (const path of movementPaths(state, actor.nodeId, 6)) {
    add('前往' + locationName(path.at(-1)!) + ' · ' + path.length + '格', 'movement', { type: 'MOVE', actorId: id, path }, path.map(locationName).join(' → '));
    if (path.length <= 3) add('沙俄马队 → ' + locationName(path.at(-1)!), 'movement', { type: 'FREE_MOVE', actorId: id, path });
  }
  add('采矿 · 一点行动', 'location', { type: 'MINE', actorId: id });
  add('兑换全部碎金 · ' + actor.gold, 'location', { type: 'EXCHANGE', actorId: id, amount: actor.gold });
  for (const source of ['hub','bazaar'] as const) add(source === 'hub' ? '伙房补满 · 耗尽行动' : '粮食贩子 · 一点行动及一官银', 'location', { type: 'REFILL_FOOD', actorId: id, source });
  for (const guess of ['big','small'] as const) add('酒馆猜' + (guess === 'big' ? '大' : '小') + ' · 一官银', 'location', { type: 'TAVERN', actorId: id, bet: 1, guess });
  add('刷新市场', 'location', { type: 'REFRESH_MARKET', actorId: id });
  add('黑市盲抽', 'location', { type: 'BUY_BLACK_MARKET', actorId: id });
  if (actor.blackMarketDrawnCardId) add('重抽刚买的黑市牌', 'location', { type: 'REDRAW_BLACK_MARKET', actorId: id, cardId: actor.blackMarketDrawnCardId });
  state.marketSlots.forEach((cardId, slot) => {
    if (!cardId) return; const card = cards.cards.find((c) => c.id === cardId)!;
    add('购买' + card.name, 'location', { type: 'BUY_MARKET', actorId: id, slot }, card.text);
  });
  for (const mount of cards.cards.filter((c) => c.kind === 'mount')) add('租借' + mount.name, 'location', { type: 'RENT_MOUNT', actorId: id, mountId: mount.id }, mount.text);
  for (const target of state.characters) {
    add('领取' + personName(target.id) + '契约金', 'location', { type: 'COLLECT_CONTRACT', actorId: id, ownerId: target.id });
    add('金矿搜寻' + personName(target.id), 'location', { type: 'MINE_SEARCH', actorId: id, targetId: target.id });
    for (const distance of [0,1,2]) add('稽查' + personName(target.id) + ' · 距离' + distance, 'location', { type: 'INSPECT', actorId: id, targetId: target.id, distance });
  }
  for (const cardId of [...new Set(actor.hand)]) {
    const card = cards.cards.find((c) => c.id === cardId);
    if (!card) continue;
    add('出售' + card.name + ' · 一官银', 'location', { type: 'SELL_CARD', actorId: id, cardId });
    if (cardId === 'T_NIGHT_ESCAPE') { cardAction(cardId, undefined, []); for (const to of getNeighbors(actor.nodeId)) cardAction(cardId, undefined, [to]); }
    else if ('target' in card && card.target === 'self') cardAction(cardId);
    else for (const target of state.characters) cardAction(cardId, target.id);
  }
  for (const to of getNeighbors(actor.nodeId)) {
    add('拒马 → ' + locationName(to), 'equipment', { type: 'USE_EQUIPMENT', actorId: id, cardId: 'E_ROAD_BLOCK', edgeTo: to });
    add('拆除通往' + locationName(to) + '的拒马', 'equipment', { type: 'REMOVE_BLOCK', actorId: id, edgeTo: to });
  }
  for (const cardId of Object.values(actor.equipped)) add('卸下并弃置' + cards.cards.find((c) => c.id === cardId)!.name, 'equipment', { type: 'UNEQUIP', actorId: id, cardId }, '消耗一点行动力。密匣内容退回随身资源，矿工积累清空，粮草按新容量截断。');
  for (const direction of ['deposit','withdraw'] as const) for (const resource of ['gold','silver'] as const) for (const amount of [1,2,3]) {
    add('密匣' + (direction === 'deposit' ? '存入' : '取出') + amount + (resource === 'gold' ? '碎金' : '官银'), 'equipment', { type: 'USE_EQUIPMENT', actorId: id, cardId: 'E_LOCKBOX', direction, resource, amount });
  }
  const drop = state.droppedItems[actor.nodeId];
  if (drop) {
    add('拾取地上资源', 'location', { type: 'PICK_UP', actorId: id, gold: drop.gold, silver: drop.silver });
    for (const cardId of [...new Set(drop.hand)]) add('拾取' + cards.cards.find((c) => c.id === cardId)!.name, 'location', { type: 'PICK_UP', actorId: id, gold: 0, silver: 0, handIds: [cardId] });
    for (const cardId of [...new Set(drop.equipment)]) add('拾取' + cards.cards.find((c) => c.id === cardId)!.name, 'location', { type: 'PICK_UP', actorId: id, gold: 0, silver: 0, equipmentIds: [cardId] });
    add('拾取资源及可携带的牌', 'location', { type: 'PICK_UP', actorId: id, gold: drop.gold, silver: drop.silver, handIds: drop.hand.slice(0, Math.max(0,5-actor.hand.length)), equipmentIds: drop.equipment });
  }
  return actions;
}
