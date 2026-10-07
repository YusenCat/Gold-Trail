import balanceData from '../../../../content/balance.v1.json' with { type: 'json' };
import { isSafeNode } from '../map.ts';
import { initialTurnOrder } from '../state.ts';
import type { CharacterState, Faction, GameState } from '../state.ts';
import { cardById, charge, checkWinner, character, discard, draw, equip, eventActive, fail, foodCapacity, hasCard, isAlive, log, marketPrice, randomFor, saveRandom, reshuffleIfNeeded, RuleError } from './shared.ts';

export function death(state: GameState, target: CharacterState): void {
  if (hasCard(target, 'E_LAST_WILL')) {
    const heir = state.characters
      .filter((item) => item.id !== target.id && item.faction === target.faction && isAlive(item))
      .sort((a, b) => a.seat - b.seat)[0];
    if (heir) {
      heir.gold += target.gold + target.sealedGold + target.lockbox.gold;
      heir.silver += target.silver + target.lockbox.silver;
      const availableHand = Math.max(0, balanceData.handLimit - heir.hand.length);
      heir.hand.push(...target.hand.splice(0, availableHand));
      const excessHand = target.hand.splice(0);
      const inheritedEquipment = Object.entries(target.equipped).filter(([, id]) => id !== 'E_LAST_WILL');
      for (const [slot, id] of inheritedEquipment) {
        equip(state, heir, id);
      }
      const lastWillSlot = Object.entries(target.equipped).find(([, id]) => id === 'E_LAST_WILL')?.[0];
      if (lastWillSlot) delete target.equipped[lastWillSlot];
      discard(state, 'market', 'E_LAST_WILL');
      target.gold = 0;
      target.silver = 0;
      target.sealedGold = 0;
      target.lockbox = { gold: 0, silver: 0 };
      target.hand = [];
      target.equipped = {};
      if (excessHand.length) {
        const dropped = state.droppedItems[target.nodeId] ?? { gold: 0, silver: 0, hand: [], equipment: [] };
        dropped.hand.push(...excessHand);
        state.droppedItems[target.nodeId] = dropped;
      }
      target.mountId = null;
      target.mountTurnsRemaining = 0;
      target.actionPoints = 0;
      target.deadUntilRound = state.round + 1;
      target.contractGold = 0;
      target.controlledById = null;
      target.controlledMovementAp = 0;
      log(state, 'lastWill', `${target.id}的临终遗嘱将遗产交给 ${heir.id}；超出手牌上限的牌掉落在原地。`);
      return;
    }
  }
  const droppedGold = target.gold + target.sealedGold + target.lockbox.gold;
  const droppedEquipment = Object.values(target.equipped);
  const dropped = droppedGold + target.silver + target.hand.length + droppedEquipment.length;
  const current = state.droppedItems[target.nodeId] ?? { gold: 0, silver: 0, hand: [], equipment: [] };
  current.gold += droppedGold;
  current.silver += target.silver + target.lockbox.silver;
  current.hand.push(...target.hand);
  current.equipment.push(...droppedEquipment);
  state.droppedItems[target.nodeId] = current;
  target.gold = 0;
  target.silver = 0;
  target.sealedGold = 0;
  target.lockbox = { gold: 0, silver: 0 };
  target.hand = [];
  target.equipped = {};
  target.mountId = null;
  target.mountTurnsRemaining = 0;
  target.actionPoints = 0;
  target.deadUntilRound = state.round + 1;
  target.contractGold = 0;
  target.controlledById = null;
  target.controlledMovementAp = 0;
  log(state, 'death', `${target.id}粮草耗尽，遗失 ${dropped} 件未保护物品，将于下一轮在二十二驿站复活。`);
}

export function applySupply(state: GameState): void {
  const extra = eventActive(state, 'V_POLAR_DAY') ? 1 : 0;
  for (const target of state.characters) {
    if (!isAlive(target)) continue;
    const cost = (isSafeNode(target.nodeId) ? 0 : 1) + extra;
    if (cost === 0) continue;
    if (target.food < cost) death(state, target);
    else {
      target.food -= cost;
      log(state, 'supply', `${target.id}消耗 ${cost} 粮草。`);
    }
  }
}

export function applyEventReveal(state: GameState): void {
  const eventId = draw(state, 'event');
  state.activeEventId = eventId;
  state.eventRoadAtReveal = state.characters.filter((item) => !isSafeNode(item.nodeId)).map((item) => item.id);
  state.eventMountedAtReveal = state.characters.filter((item) => item.mountId !== null).map((item) => item.id);
  if (!eventId) return;
  const card = cardById.get(eventId);
  log(state, 'event', `事件：${card?.name ?? eventId}`);
  if (eventId === 'V_BANDIT_RAID') {
    for (const target of state.characters) target.gold = Math.floor(target.gold / 2);
  }
  if (eventId === 'V_MINE_COLLAPSE') {
    for (const target of state.characters) {
      target.contractGold = 0;
      if (hasCard(target, 'E_MINER_CONTRACT')) log(state, 'event', `${target.id}的矿工契约存量被清空。`);
    }
  }
}

export function calculateAp(state: GameState, actor: CharacterState): number {
  const rng = randomFor(state);
  actor.actionRoll = rng.rollDie(balanceData.actionPointDieSides) + balanceData.actionPointDieOffset;
  saveRandom(state, rng);
  let ap = actor.actionRoll;
  if (eventActive(state, 'V_POLAR_DAY')) ap *= 2;
  if (hasCard(actor, 'E_TIGER_WINE')) ap += 1;
  if (actor.mountId === 'M_WHITE_STEED') ap += 1;
  if (state.eventRoadAtReveal.includes(actor.id) && eventActive(state, 'V_LIGHT_SNOW')) ap -= 1;
  if (state.eventRoadAtReveal.includes(actor.id) && eventActive(state, 'V_FROZEN_ROAD')) ap -= 2;
  ap -= actor.nextTurnApPenalty;
  actor.nextTurnApPenalty = 0;
  return Math.max(0, Math.min(balanceData.maxActionPoints, ap));
}

export function startTurn(state: GameState): void {
  const id = state.turnOrder[state.turnIndex];
  const actor = character(state, id);
  state.activeCharacterId = id;
  if (!isAlive(actor)) {
    log(state, 'turnSkip', `${id}尚未复活，跳过本回合。`);
    endTurnInternal(state);
    return;
  }
  actor.actionPoints = calculateAp(state, actor);
  actor.firstMoveUsedThisTurn = false;
  actor.diluSteps = null;
  actor.contractCollectedThisTurn = false;
  actor.tavernUsedThisTurn = false;
  actor.mineSearchedThisTurn = false;
  actor.exchangedThisTurn = false;
  actor.soldThisTurn = false;
  actor.refilledThisTurn = false;
  actor.tacticsBlockedThisTurn = actor.noTacticsNextTurn;
  actor.noTacticsNextTurn = false;
  actor.tacticsPlayedThisTurn = 0;
  actor.mineActionsThisTurn = 0;
  actor.inspectedThisTurn = false;
  actor.marketBoughtThisTurn = false;
  actor.blackMarketBoughtThisTurn = false;
  actor.blackMarketRedrawAvailable = false;
  actor.blackMarketDrawnCardId = null;
  actor.pickedUpThisTurn = false;
  actor.marketRefreshedThisTurn = false;
  actor.freeMoveAvailableThisTurn = eventActive(state, 'V_RUSSIAN_PARTY') && actor.faction === 'smuggler';
  actor.untargetableThisTurn = false;
  log(state, 'turnStart', `${id}掷出 ${actor.actionRoll} 点行动骰，获得 ${actor.actionPoints} 行动点。`, 'public', {actorId:id,roll:actor.actionRoll!,actionPoints:actor.actionPoints});
}

export function refillMarketAtRoundEnd(state: GameState): void {
  for (const cardId of state.marketSlots) if (cardId) discard(state, 'market', cardId);
  state.marketSlots = [];
  for (let i = 0; i < balanceData.marketSlots; i += 1) state.marketSlots.push(draw(state, 'market'));
}

export function continueAfterPreEvent(state: GameState): void {
  if (state.preEventQueue.length > 0) {
    state.activeCharacterId = state.preEventQueue[0];
    return;
  }
  state.phase = 'eventReveal';
  applyEventReveal(state);
  state.phase = 'supply';
  applySupply(state);
  state.phase = 'characterTurn';
  state.activeCharacterId = null;
  startTurn(state);
}

export function beginRound(state: GameState): void {
  state.phase = 'preEvent';
  state.turnOrder = initialTurnOrder(state.round, state.startingFaction ?? 'smuggler');
  state.turnIndex = 0;
  state.activeCharacterId = null;
  state.activeEventId = null;
  state.mineOutputRemaining = balanceData.miningGlobalOutputPerCharacterPerRound * state.characters.length;
  state.mineOutputByFaction = { smuggler: 0, officer: 0 };
  for (const target of state.characters) {
    target.enteredNodesThisTurn = 0;
    target.siteVisitsThisTurn = [];
    if (target.deadUntilRound !== null && target.deadUntilRound <= state.round) {
      target.deadUntilRound = null;
      target.nodeId = 'HUB';
      target.food = balanceData.respawnFood;
      log(state, 'revive', `${target.id}在二十二驿站复活，获得 ${target.food} 粮草。`);
    }
  }
  state.preEventQueue = state.turnOrder.filter((id) => {
    const target = character(state, id);
    return isAlive(target) && (target.mountId === 'M_WHITE_STEED' || hasCard(target, 'E_TIME_GONG'));
  });
  continueAfterPreEvent(state);
}

export function endTurnInternal(state: GameState): void {
  const actor = state.activeCharacterId ? character(state, state.activeCharacterId) : null;
  if (actor) {
    if (actor.mountId) {
      actor.mountTurnsRemaining -= 1;
      if (actor.mountTurnsRemaining <= 0) {
        log(state, 'mountReturn', `${actor.id}归还 ${cardById.get(actor.mountId)?.name ?? actor.mountId}。`);
        actor.mountId = null;
        actor.mountTurnsRemaining = 0;
      }
    }
    actor.actionPoints = 0;
    actor.controlledMovementAp = 0;
    actor.controlledById = null;
    if (actor.hubEntryBanTurns > 0) actor.hubEntryBanTurns -= 1;
    actor.tacticsBlockedThisTurn = false;
    actor.untargetableThisTurn = false;
    if (!actor.inspectedThisTurn) actor.successiveSuccessfulInspections = 0;
  }
  state.pendingDecision = null;
  state.turnIndex += 1;
  if (state.turnIndex < state.turnOrder.length) {
    startTurn(state);
    return;
  }
  state.phase = 'roundEnd';
  if (!eventActive(state, 'V_MINE_COLLAPSE')) {
    for (const owner of state.characters) {
      if (hasCard(owner, 'E_MINER_CONTRACT')) owner.contractGold = Math.min(6, owner.contractGold + 1);
    }
  } else {
    for (const owner of state.characters) owner.contractGold = 0;
  }
  if (state.activeEventId) discard(state, 'event', state.activeEventId);
  refillMarketAtRoundEnd(state);
  if (state.mode === 'fixedRounds' && state.round >= balanceData.fixedRoundLimit) {
    const delta = state.reputation.smuggler - state.reputation.officer;
    state.winner = delta === 0 ? 'draw' : delta > 0 ? 'smuggler' : 'officer';
    state.phase = 'finished';
    state.activeCharacterId = null;
    log(state, 'victory', state.winner === 'draw' ? '火并模式以平局结束。' : `${state.winner === 'smuggler' ? '走私者' : '官兵'}在火并模式获胜。`);
    return;
  }
  state.round += 1;
  beginRound(state);
}
