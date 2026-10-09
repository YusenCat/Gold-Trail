import { edgeKey, getNeighbors, isAdjacent, mapNodes } from './map.ts';
import type { NodeId } from './map.ts';
import type { Faction, GameState, SearchQuestion } from './state.ts';
import { cardById, character, charge, copy, discard, fail, foodCapacity, isAlive, log, randomFor, saveRandom, RuleError } from './engine/shared.ts';
import { beginRound, endTurnInternal } from './engine/lifecycle.ts';
import { actorForCommand, collectContract, controlledMove, freeMove, move, preEventMove, skipPreEvent } from './engine/movement.ts';
import { playTactic } from './engine/tactics.ts';
import { buyBlackMarket, buyMarket, exchange, mine, pickUp, refreshMarket, redrawBlackMarket, refillFood, rentMount, tavern, unequipAndDiscard, useEquipment } from './engine/economy.ts';
import { askSearchQuestion, chooseSearchBox, inspect, mineSearch, passResponse, splitGold } from './engine/search.ts';

export { RuleError };

export type GameCommand =
  | { type: 'MOVE'; actorId: string; path: NodeId[] }
  | { type: 'ROLL_DILU'; actorId: string }
  | { type: 'RELEASE_CONTROL'; actorId: string; targetId: string }
  | { type: 'REMOVE_BLOCK'; actorId: string; edgeTo: NodeId }
  | { type: 'UNEQUIP'; actorId: string; cardId: string }
  | { type: 'SELL_CARD'; actorId: string; cardId: string }
  | { type: 'END_TURN'; actorId: string }
  | { type: 'MINE'; actorId: string }
  | { type: 'EXCHANGE'; actorId: string; amount: number }
  | { type: 'REFILL_FOOD'; actorId: string; source: 'hub' | 'bazaar' }
  | { type: 'TAVERN'; actorId: string; bet: number; guess: 'big' | 'small' }
  | { type: 'BUY_MARKET'; actorId: string; slot: number }
  | { type: 'BUY_BLACK_MARKET'; actorId: string }
  | { type: 'RENT_MOUNT'; actorId: string; mountId: string }
  | { type: 'PLAY_TACTIC'; actorId: string; cardId: string; targetId?: string; path?: NodeId[] }
  | { type: 'PASS_RESPONSE'; actorId: string }
  | { type: 'PRE_EVENT_MOVE'; actorId: string; path: NodeId[] }
  | { type: 'SKIP_PRE_EVENT'; actorId: string }
  | { type: 'COLLECT_CONTRACT'; actorId: string; ownerId: string }
  | { type: 'PICK_UP'; actorId: string; gold: number; silver: number; handIds?: string[]; equipmentIds?: string[] }
  | { type: 'FREE_MOVE'; actorId: string; path: NodeId[] }
  | { type: 'CONTROLLED_MOVE'; actorId: string; targetId: string; path: NodeId[] }
  | { type: 'REDRAW_BLACK_MARKET'; actorId: string; cardId: string }
  | { type: 'USE_EQUIPMENT'; actorId: string; cardId: string; edgeTo?: NodeId; direction?: 'deposit' | 'withdraw'; resource?: 'gold' | 'silver'; amount?: number }
  | { type: 'REFRESH_MARKET'; actorId: string }
  | { type: 'INSPECT'; actorId: string; targetId: string; distance: number }
  | { type: 'MINE_SEARCH'; actorId: string; targetId: string }
  | { type: 'SPLIT_GOLD'; actorId: string; boxA: number; boxB: number }
  | { type: 'ASK_SEARCH_QUESTION'; actorId: string; question: SearchQuestion }
  | { type: 'CHOOSE_SEARCH_BOX'; actorId: string; box: 'A' | 'B' };



export function startGame(state: GameState): GameState {
  const next = copy(state);
  if (next.phase !== 'preEvent' || next.activeCharacterId !== null || next.log.length > 0) fail('对局已经开始');
  beginRound(next);
  next.revision = (state.revision ?? 0) + 1;
  return next;
}

function applyCommandInternal(state: GameState, command: GameCommand): GameState {
  if (state.phase === 'finished') fail('对局已经结束');
  const next = copy(state);
  if (command.type === 'PRE_EVENT_MOVE') {
    preEventMove(next, command.actorId, command.path);
    return next;
  }
  if (command.type === 'SKIP_PRE_EVENT') {
    skipPreEvent(next, command.actorId);
    return next;
  }
  if (command.type === 'PASS_RESPONSE') {
    passResponse(next, command.actorId);
    return next;
  }
  if (command.type === 'PLAY_TACTIC') {
    playTactic(next, command.actorId, command.cardId, command.targetId, command.path);
    return next;
  }
  if (command.type === 'SPLIT_GOLD') {
    splitGold(next, command.actorId, command.boxA, command.boxB);
    return next;
  }
  if (command.type === 'ASK_SEARCH_QUESTION') {
    askSearchQuestion(next, command.actorId, command.question);
    return next;
  }
  if (command.type === 'CHOOSE_SEARCH_BOX') {
    chooseSearchBox(next, command.actorId, command.box);
    return next;
  }
  if (command.type === 'USE_EQUIPMENT' && command.cardId === 'E_TIME_GONG') {
    useEquipment(next, character(next, command.actorId), command.cardId, command.edgeTo, command.direction, command.resource, command.amount);
    return next;
  }
  if (command.type === 'CONTROLLED_MOVE') {
    controlledMove(next, character(next, command.actorId), command.targetId, command.path);
    return next;
  }
  if (command.type === 'RELEASE_CONTROL') {
    const target = character(next, command.targetId);
    if (next.pendingDecision || next.phase !== 'characterTurn' || next.activeCharacterId !== target.id || target.controlledById !== command.actorId) fail('当前不能放弃控制');
    target.controlledById = null; target.controlledMovementAp = 0;
    log(next, 'controlRelease', `${command.actorId}放弃剩余控制移动。`);
    return next;
  }
  const actor = actorForCommand(next, command.actorId);
  if (command.type !== 'REDRAW_BLACK_MARKET') actor.blackMarketRedrawAvailable = false;
  switch (command.type) {
    case 'MOVE': move(next, actor, command.path); break;
    case 'ROLL_DILU': {
      if (actor.mountId !== 'M_DILU' || actor.firstMoveUsedThisTurn || actor.diluSteps !== null || actor.actionPoints < 1) fail('本回合不能再投的卢移动骰');
      const rng = randomFor(next), roll = rng.rollDie(6); saveRandom(next, rng);
      actor.diluSteps = Math.ceil(roll / 2);
      log(next, 'diluRoll', `${actor.id}的卢掷出 ${roll}，首次移动一点行动力可走 ${actor.diluSteps} 格。`);
      break;
    }
    case 'REMOVE_BLOCK': {
      if (!isAdjacent(actor.nodeId, command.edgeTo)) fail('只能从拒马所在道路的一端拆除');
      const key = edgeKey(actor.nodeId, command.edgeTo);
      if (!next.blockedEdges.includes(key)) fail('这条道路没有拒马');
      charge(actor, 2); next.blockedEdges = next.blockedEdges.filter((edge) => edge !== key);
      discard(next, 'market', 'E_ROAD_BLOCK');
      log(next, 'removeBlock', `${actor.id}拆除道路上的拒马。`); break;
    }
    case 'UNEQUIP': {
      if (!Object.values(actor.equipped).includes(command.cardId)) fail('未装备该牌');
      charge(actor, 1);
      unequipAndDiscard(next, actor, command.cardId);
      if (command.cardId === 'E_LOCKBOX') { actor.gold += actor.lockbox.gold; actor.silver += actor.lockbox.silver; actor.lockbox = { gold: 0, silver: 0 }; }
      if (command.cardId === 'E_MINER_CONTRACT') actor.contractGold = 0;
      actor.food = Math.min(actor.food, foodCapacity(actor));
      log(next, 'unequip', `${actor.id}卸下并弃置 ${cardById.get(command.cardId)?.name}。`);
      break;
    }
    case 'SELL_CARD': {
      if (actor.nodeId !== 'BAZAAR' || actor.soldThisTurn || !actor.hand.includes(command.cardId)) fail('只能在黑市每回合出售一张功能牌');
      charge(actor, 1);
      actor.hand.splice(actor.hand.indexOf(command.cardId), 1);
      discard(next, 'blackMarket', command.cardId); actor.silver += 1; actor.soldThisTurn = true;
      log(next, 'sell', `${actor.id}出售 ${cardById.get(command.cardId)?.name} 获得一官银。`); break;
    }
    case 'END_TURN': endTurnInternal(next); break;
    case 'MINE': mine(next, actor); break;
    case 'EXCHANGE': exchange(next, actor, command.amount); break;
    case 'REFILL_FOOD': refillFood(next, actor, command.source); break;
    case 'TAVERN': tavern(next, actor, command.bet, command.guess); break;
    case 'BUY_MARKET': buyMarket(next, actor, command.slot); break;
    case 'BUY_BLACK_MARKET': buyBlackMarket(next, actor); break;
    case 'RENT_MOUNT': rentMount(next, actor, command.mountId); break;
    case 'PICK_UP': pickUp(next, actor, command.gold, command.silver, command.handIds, command.equipmentIds); break;
    case 'FREE_MOVE': freeMove(next, actor, command.path); break;
    case 'REDRAW_BLACK_MARKET': redrawBlackMarket(next, actor, command.cardId); break;
    case 'USE_EQUIPMENT': useEquipment(next, actor, command.cardId, command.edgeTo, command.direction, command.resource, command.amount); break;
    case 'REFRESH_MARKET': refreshMarket(next, actor); break;
    case 'COLLECT_CONTRACT': collectContract(next, actor, command.ownerId); break;
    case 'INSPECT': inspect(next, actor, command.targetId, command.distance); break;
    case 'MINE_SEARCH': mineSearch(next, actor, command.targetId); break;
    default: fail('未知命令');
  }
  return next;
}

export function applyCommand(state: GameState, command: GameCommand): GameState {
  if (!command || typeof command !== 'object' || typeof command.type !== 'string' || typeof command.actorId !== 'string') fail('动作格式无效');
  if ('path' in command && command.path !== undefined && (!Array.isArray(command.path) || command.path.length > 20 || command.path.some((id) => typeof id !== 'string' || !mapNodes.some((n) => n.id === id)))) fail('移动路线无效');
  if ('edgeTo' in command && command.edgeTo !== undefined && !mapNodes.some((n) => n.id === command.edgeTo)) fail('道路节点无效');
  if (command.type === 'TAVERN' && !['big','small'].includes(command.guess)) fail('请选择猜大或猜小');
  if (command.type === 'REFILL_FOOD' && !['hub','bazaar'].includes(command.source)) fail('补给地点无效');
  const next = applyCommandInternal(state, command);
  next.revision = (state.revision ?? 0) + 1;
  return next;
}

export function publicView(state: GameState, faction?: Faction): GameState {
  const view = copy(state);
  delete view.metrics;
  view.marketDeck = []; view.blackMarketDeck = []; view.eventDeck = []; view.rngState = 0;
  const pending = view.pendingDecision;
  if (pending && 'boxA' in pending) { pending.boxA = NaN; pending.boxB = NaN; }
  if (faction) {
    for (const actor of view.characters) if (actor.faction !== faction) actor.hand = actor.hand.map(() => 'HIDDEN');
    const ownIds = view.characters.filter((c) => c.faction === faction).map((c) => c.id);
    view.log = view.log.filter((entry) => entry.visibility === 'public' || entry.visibility.some((id) => ownIds.includes(id)));
  }
  view.log = view.log.slice(-120);
  return view;
}

export function legalMoveTargets(state: GameState, actorId: string): NodeId[] {
  if (state.phase !== 'characterTurn' || state.activeCharacterId !== actorId || state.pendingDecision) return [];
  const actor = character(state, actorId);
  if (!isAlive(actor) || actor.actionPoints < 1) return [];
  return getNeighbors(actor.nodeId).filter((to) => {
    try { applyCommand({ ...state, log: [] }, { type: 'MOVE', actorId, path: [to] }); return true; } catch { return false; }
  });
}
