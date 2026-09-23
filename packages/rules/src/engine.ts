import balanceData from '../../../content/balance.v1.json' with { type: 'json' };
import cardsData from '../../../content/cards.v1.json' with { type: 'json' };
import { edgeKey, getNeighbors, getNode, isAdjacent, isCheckpoint, isSafeNode, staticDistance, mapNodes, type NodeId } from './map.ts';
import { RandomStream } from './random.ts';
import type { CharacterState, Faction, GameState, PendingDecision, SearchQuestion } from './state.ts';
import { initialTurnOrder } from './state.ts';

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

export class RuleError extends Error {}

const cardById = new Map(cardsData.cards.map((card) => [card.id, card]));
const mountIds = new Set(cardsData.cards.filter((card) => card.kind === 'mount').map((card) => card.id));

function copy<T>(value: T): T {
  return structuredClone(value);
}

function fail(message: string): never {
  throw new RuleError(message);
}

function character(state: GameState, id: string): CharacterState {
  const result = state.characters.find((item) => item.id === id);
  if (!result) fail(`未知角色：${id}`);
  return result;
}

function isAlive(item: CharacterState): boolean {
  return item.deadUntilRound === null;
}

function log(state: GameState, type: string, message: string, visibility: 'public' | string[] = 'public'): void {
  state.log.push({ id: state.log.length + 1, round: state.round, type, message, visibility });
}

function charge(actor: CharacterState, ap: number): void {
  if (!Number.isInteger(ap) || ap < 0 || actor.actionPoints < ap) fail('行动点不足');
  actor.actionPoints -= ap;
}

function hasCard(actor: CharacterState, id: string): boolean {
  return actor.hand.includes(id) || Object.values(actor.equipped).includes(id);
}

function foodCapacity(actor: CharacterState): number {
  return balanceData.baseFoodCapacity + (hasCard(actor, 'E_BACKPACK') ? 3 : 0);
}

function equip(state: GameState, actor: CharacterState, cardId: string): void {
  const card = cardById.get(cardId);
  if (!card || card.kind !== 'equipment' || !('slot' in card)) fail('未知装备');
  const previous = actor.equipped[card.slot];
  if (previous) {
    discard(state, 'market', previous);
    if (previous === 'E_LOCKBOX') {
      actor.gold += actor.lockbox.gold; actor.silver += actor.lockbox.silver;
      actor.lockbox = { gold: 0, silver: 0 };
    }
    if (previous === 'E_MINER_CONTRACT') actor.contractGold = 0;
  }
  actor.equipped[card.slot] = cardId;
  actor.food = Math.min(actor.food, foodCapacity(actor));
}

function eventActive(state: GameState, id: string): boolean {
  return state.activeEventId === id;
}

function randomFor(state: GameState): RandomStream {
  return new RandomStream(state.rngState);
}

function saveRandom(state: GameState, rng: RandomStream): void {
  state.rngState = rng.getState();
}

function reshuffleIfNeeded(state: GameState, deck: 'market' | 'blackMarket' | 'event'): void {
  const deckKey = `${deck}Deck` as const;
  const discardKey = `${deck}Discard` as const;
  if (state[deckKey].length || !state[discardKey].length) return;
  const rng = randomFor(state);
  state[deckKey] = rng.shuffle(state[discardKey]);
  state[discardKey] = [];
  saveRandom(state, rng);
}

function draw(state: GameState, deck: 'market' | 'blackMarket' | 'event'): string | null {
  reshuffleIfNeeded(state, deck);
  const deckKey = `${deck}Deck` as const;
  return state[deckKey].shift() ?? null;
}

function discard(state: GameState, deck: 'market' | 'blackMarket' | 'event', cardId: string): void {
  const discardKey = `${deck}Discard` as const;
  state[discardKey].push(cardId);
}

function marketPrice(state: GameState, cardId: string): number {
  const card = cardById.get(cardId);
  if (!card || !('marketPrice' in card) || typeof card.marketPrice !== 'number') fail('市场卡数据错误');
  const eventPrice = eventActive(state, 'V_MERCHANT_SALE') ? Math.ceil(card.marketPrice * 0.6) : card.marketPrice;
  const openingDiscount = state.round === 1 ? (balanceData.openingMarketDiscount || 0) : 0;
  return Math.max(1, eventPrice - openingDiscount);
}

function checkWinner(state: GameState, faction: Faction): void {
  if (state.mode === 'race' && state.reputation[faction] >= balanceData.raceReputationTarget) {
    state.winner = faction;
    state.phase = 'finished';
    state.activeCharacterId = null;
    state.pendingDecision = null;
    log(state, 'victory', `${faction === 'smuggler' ? '走私者' : '官兵'}达到 ${balanceData.raceReputationTarget} 声望并获胜。`);
  }
}

function death(state: GameState, target: CharacterState): void {
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

function applySupply(state: GameState): void {
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

function applyEventReveal(state: GameState): void {
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

function calculateAp(state: GameState, actor: CharacterState): number {
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

function startTurn(state: GameState): void {
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
  log(state, 'turnStart', `${id}掷出 ${actor.actionRoll} 点行动骰，获得 ${actor.actionPoints} 行动点。`);
}

function refillMarketAtRoundEnd(state: GameState): void {
  for (const cardId of state.marketSlots) if (cardId) discard(state, 'market', cardId);
  state.marketSlots = [];
  for (let i = 0; i < balanceData.marketSlots; i += 1) state.marketSlots.push(draw(state, 'market'));
}

function continueAfterPreEvent(state: GameState): void {
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

function beginRound(state: GameState): void {
  state.phase = 'preEvent';
  state.turnOrder = initialTurnOrder(state.round);
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

function endTurnInternal(state: GameState): void {
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

function actorForCommand(state: GameState, actorId: string): CharacterState {
  if (state.phase !== 'characterTurn') fail('当前不在角色行动阶段');
  if (state.pendingDecision) fail('必须先完成待决策步骤');
  if (state.activeCharacterId !== actorId) fail('现在不是该角色的回合');
  const actor = character(state, actorId);
  if (!isAlive(actor)) fail('角色已死亡');
  if (actor.controlledById && actor.controlledMovementAp > 0 && actor.actionPoints > 0) fail('请先由混淆视听的施用者决定移动或放弃控制');
  return actor;
}

/** A landing encounter is deterministic for a saved RNG state and can trigger once per site per turn. */
function resolveLandingEncounter(state: GameState, actor: CharacterState): void {
  const node = getNode(actor.nodeId);
  actor.siteVisitsThisTurn ??= [];
  if (!node.site || actor.siteVisitsThisTurn.includes(node.id)) return;
  actor.siteVisitsThisTurn.push(node.id);
  const rng = randomFor(state);
  const roll = rng.rollDie(6);
  saveRandom(state, rng);
  const food = (amount: number) => {
    const before = actor.food;
    actor.food = Math.min(foodCapacity(actor), Math.max(0, actor.food + amount));
    return actor.food - before;
  };
  const silver = (amount: number) => { actor.silver = Math.max(0, actor.silver + amount); };
  const gold = (amount: number) => { actor.gold = Math.max(0, actor.gold + amount); };
  const outcomes: Record<string, Array<() => string>> = {
    forage: [
      () => '风雪太急，没能找到补给。', () => '只拾到几根干柴。',
      () => food(1) ? '找到一份干粮（粮草 +1）。' : '找到一份干粮，但粮草已满，未能装下。',
      () => food(1) ? '找到一份干粮（粮草 +1）。' : '找到一份干粮，但粮草已满，未能装下。',
      () => { silver(1); return '路边木匣里有一枚官银（官银 +1）。'; },
      () => { gold(1); return '碎石间闪出一枚碎金（碎金 +1）。'; },
    ],
    forest: [
      () => food(-1) ? '穿林时损失一份干粮（粮草 -1）。' : '穿林受阻，未找到补给。',
      () => food(1) ? '猎户留下了干粮（粮草 +1）。' : '猎户留下了干粮，但粮草已满，未能装下。',
      () => food(1) ? '猎户留下了干粮（粮草 +1）。' : '猎户留下了干粮，但粮草已满，未能装下。',
      () => { silver(1); return '树洞里藏着一枚官银（官银 +1）。'; },
      () => { silver(1); return '树洞里藏着一枚官银（官银 +1）。'; },
      () => { gold(1); return '雪下露出一枚碎金（碎金 +1）。'; },
    ],
    caravan: [
      () => food(-1) ? '翻车的马匹踩坏一份干粮（粮草 -1）。' : '翻车现场空空如也。',
      () => food(1) ? '商队分给你一份干粮（粮草 +1）。' : '商队分给你一份干粮，但粮草已满，未能装下。',
      () => { silver(1); return '货箱里找到一枚官银（官银 +1）。'; },
      () => { silver(1); return '货箱里找到一枚官银（官银 +1）。'; },
      () => { const gained = food(2); return gained ? `商队补给充足，分得干粮（粮草 +${gained}）。` : '商队补给充足，但粮草已满，未能装下。'; },
      () => { gold(1); return '车辙下滚出一枚碎金（碎金 +1）。'; },
    ],
    ruins: [
      () => '旧驿棚已经空了。', () => '旧驿棚已经空了。',
      () => food(1) ? '找到一份封存干粮（粮草 +1）。' : '找到一份封存干粮，但粮草已满，未能装下。',
      () => { silver(1); return '墙缝中有一枚官银（官银 +1）。'; },
      () => { silver(1); return '墙缝中有一枚官银（官银 +1）。'; },
      () => { gold(1); return '瓦砾下有一枚碎金（碎金 +1）。'; },
    ],
    signal: [
      () => { silver(1); return '烽燧暗格里有一枚官银（官银 +1）。'; },
      () => { silver(1); return '烽燧暗格里有一枚官银（官银 +1）。'; },
      () => food(1) ? '守台人留下了干粮（粮草 +1）。' : '守台人留下了干粮，但粮草已满，未能装下。',
      () => food(1) ? '守台人留下了干粮（粮草 +1）。' : '守台人留下了干粮，但粮草已满，未能装下。',
      () => { gold(1); return '望台下发现一枚碎金（碎金 +1）。'; },
      () => { gold(1); return '望台下发现一枚碎金（碎金 +1）。'; },
    ],
  };
  const outcome = outcomes[node.site]?.[roll - 1]?.() ?? '驿路上没有新的发现。';
  log(state, 'siteEncounter', `${actor.id}抵达${node.siteName ?? node.label ?? node.id}，掷出 ${roll}：${outcome}`);
}

function move(state: GameState, actor: CharacterState, path: NodeId[]): void {
  if (!Array.isArray(path) || path.length === 0) fail('移动路径不能为空');
  let cursor = actor.nodeId;
  for (const to of path) {
    if (!isAdjacent(cursor, to)) fail('移动路径必须逐格相邻');
    if (state.blockedEdges.includes(edgeKey(cursor, to))) fail('该道路被铁索拒马阻挡');
    if (to === 'HUB' && actor.hubEntryBanTurns > 0) fail('该角色暂时无法进入二十二驿站');
    cursor = to;
  }
  let discountSteps = 1;
  if (actor.mountId === 'M_RED_HARE') discountSteps = 2;
  else if (actor.mountId && !actor.firstMoveUsedThisTurn) discountSteps = 2;
  if (eventActive(state, 'V_CLEAR_ROAD') && state.eventRoadAtReveal.includes(actor.id) && !actor.firstMoveUsedThisTurn) discountSteps += 2;
  if (actor.diluSteps !== null && !actor.firstMoveUsedThisTurn) discountSteps = actor.diluSteps + (eventActive(state, 'V_CLEAR_ROAD') && state.eventRoadAtReveal.includes(actor.id) ? 2 : 0);
  const remaining = Math.max(0, path.length - discountSteps);
  const apCost = 1 + (actor.mountId === 'M_RED_HARE' ? Math.ceil(remaining / 2) : remaining);
  if (eventActive(state, 'V_HORSE_STUMBLE') && actor.mountId && actor.enteredNodesThisTurn + path.length > 2) fail('马失前蹄限制本回合移动');
  charge(actor, apCost);
  actor.nodeId = cursor;
  if (path.some(isSafeNode) && actor.sealedGold > 0) {
    actor.gold += actor.sealedGold;
    log(state, 'unseal', `${actor.id}进入安全地点，拆封 ${actor.sealedGold} 碎金。`);
    actor.sealedGold = 0;
  }
  actor.firstMoveUsedThisTurn = true;
  actor.enteredNodesThisTurn += path.length;
  log(state, 'move', `${actor.id}移动 ${path.length} 格至 ${getNode(cursor).siteName ?? getNode(cursor).label ?? cursor}，消耗 ${apCost} 行动点。`);
  resolveLandingEncounter(state, actor);
}

function canUseOfficerRole(actor: CharacterState): boolean {
  return actor.faction === 'officer' || hasCard(actor, 'E_DOUBLE_AGENT');
}

function canUseSmugglerRole(actor: CharacterState): boolean {
  return actor.faction === 'smuggler' || hasCard(actor, 'E_DOUBLE_AGENT');
}

function moveWithoutAp(state: GameState, actor: CharacterState, path: NodeId[], label: string): void {
  if (!Array.isArray(path) || path.length < 1) fail('移动路径不能为空');
  let cursor = actor.nodeId;
  for (const to of path) {
    if (!isAdjacent(cursor, to) || state.blockedEdges.includes(edgeKey(cursor, to))) fail('免费移动路径不可通行');
    if (to === 'HUB' && actor.hubEntryBanTurns > 0) fail('该角色暂时无法进入二十二驿站');
    cursor = to;
  }
  actor.nodeId = cursor;
  if (eventActive(state, 'V_HORSE_STUMBLE') && actor.mountId && actor.enteredNodesThisTurn + path.length > 2) fail('马失前蹄限制额外移动');
  if (path.some(isSafeNode)) { actor.gold += actor.sealedGold; actor.sealedGold = 0; }
  actor.enteredNodesThisTurn += path.length;
  log(state, 'freeMove', `${actor.id}${label}移动 ${path.length} 格至 ${getNode(cursor).siteName ?? getNode(cursor).label ?? cursor}。`);
  resolveLandingEncounter(state, actor);
}

function discardTactic(state: GameState, actor: CharacterState, cardId: string): void {
  const index = actor.hand.indexOf(cardId);
  if (index < 0) fail('角色未持有该功能牌');
  actor.hand.splice(index, 1);
  actor.blackMarketRedrawAvailable = false;
  discard(state, 'blackMarket', cardId);
  if (state.activeCharacterId === actor.id) actor.tacticsPlayedThisTurn += 1;
}

function requireTacticTarget(state: GameState, actor: CharacterState, targetId: string): CharacterState {
  const target = character(state, targetId);
  if (!isAlive(target) || target.untargetableThisTurn || staticDistance(actor.nodeId, target.nodeId) > 1) fail('目标不在有效范围或不可成为目标');
  return target;
}

function playTactic(state: GameState, actorId: string, cardId: string, targetId?: string, path?: NodeId[]): void {
  const pending = state.pendingDecision;
  if (pending?.kind === 'response') {
    if (cardId !== 'T_RESIST_SEARCH' || pending.targetId !== actorId) fail('当前响应窗口只能由目标使用暴力拒查');
    const target = character(state, actorId);
    if (state.activeCharacterId === target.id && target.tacticsBlockedThisTurn) fail('该角色本回合不能使用功能牌');
    discardTactic(state, target, cardId);
    const source = character(state, pending.sourceId);
    source.nextTurnApPenalty += 2;
    state.pendingDecision = null;
    log(state, 'response', `${target.id}使用暴力拒查，取消本次${pending.responseTo === 'search' ? '收缴' : '抢劫'}。`);
    return;
  }
  if (pending?.kind === 'askSearchQuestion') {
    if (pending.sourceId !== actorId || cardId !== 'T_INTERROGATION' || pending.interrogationUsed) fail('此时只能由收缴发动者打出一次刑讯逼供');
    const actor = character(state, actorId);
    if (actor.tacticsBlockedThisTurn || actor.tacticsPlayedThisTurn >= balanceData.cardsPlayedPerOwnTurn) fail('本回合不能再使用功能牌');
    if (!actor.hand.includes(cardId)) fail('角色未持有该功能牌');
    discardTactic(state, actor, cardId);
    pending.interrogationUsed = true;
    log(state, 'tactic', `${actor.id}对 ${pending.targetId} 使用刑讯逼供并查看其功能牌：${character(state, pending.targetId).hand.join('、') || '无'}。`, [actor.id]);
    return;
  }
  const actor = actorForCommand(state, actorId);
  if (actor.tacticsBlockedThisTurn) fail('该角色本回合无法打出功能牌');
  if (actor.tacticsPlayedThisTurn >= balanceData.cardsPlayedPerOwnTurn) fail('本回合功能牌出牌次数已达上限');
  if (!actor.hand.includes(cardId)) fail('角色未持有该功能牌');
  const target = targetId ? (['T_CONFUSE', 'T_HIDDEN_ARROW'].includes(cardId) ? character(state, targetId) : requireTacticTarget(state, actor, targetId)) : undefined;
  if (target && (!isAlive(target) || target.untargetableThisTurn)) fail('目标已死亡或不能成为目标');
  if (target?.id === actor.id) fail('指定角色的攻击功能牌不能以自己为目标');
  switch (cardId) {
    case 'T_MARCH_RATION':
      discardTactic(state, actor, cardId);
      actor.actionPoints = Math.min(balanceData.maxActionPoints, actor.actionPoints + 3);
      actor.food = Math.min(foodCapacity(actor), actor.food + 2);
      log(state, 'tactic', `${actor.id}使用急行军粮。`);
      return;
    case 'T_NIGHT_ESCAPE':
      if (!path || path.length > 1) fail('暗夜遁形只能免费移动最多 1 格');
      discardTactic(state, actor, cardId);
      if (path.length) moveWithoutAp(state, actor, path, '借暗夜遁形');
      actor.untargetableThisTurn = true;
      log(state, 'tactic', `${actor.id}进入暗夜遁形状态。`);
      return;
    case 'T_STEAL_CARD': {
      if (!target || actor.nodeId === 'HUB' || target.hand.length === 0) fail('无法偷取功能牌');
      discardTactic(state, actor, cardId);
      const rng = randomFor(state);
      const index = rng.nextUint32() % target.hand.length;
      const [stolen] = target.hand.splice(index, 1);
      saveRandom(state, rng);
      actor.hand.push(stolen);
      actor.hubEntryBanTurns = 3;
      log(state, 'tactic', `${actor.id}从 ${target.id} 随机偷取一张功能牌。`);
      return;
    }
    case 'T_DRUG_WINE':
      if (!target) fail('蒙汗药酒需要目标');
      discardTactic(state, actor, cardId);
      target.nextTurnApPenalty += 1;
      target.noTacticsNextTurn = true;
      log(state, 'tactic', `${actor.id}对 ${target.id}使用蒙汗药酒。`);
      return;
    case 'T_PRIVATE_SEARCH':
      if (!target) fail('私刑查抄需要目标');
      discardTactic(state, actor, cardId);
      initiateSearch(state, actor, target, 'privateSearch');
      return;
    case 'T_ROAD_ROBBERY':
      if (!target) fail('劫道夺财需要目标');
      discardTactic(state, actor, cardId);
      state.pendingDecision = { kind: 'response', sourceId: actor.id, targetId: target.id, responseTo: 'robbery', sourceKind: 'privateSearch' };
      log(state, 'robberyStart', `${actor.id}对 ${target.id}发动劫道夺财。`);
      return;
    case 'T_CONFUSE':
      if (!target || target.id === actor.id) fail('混淆视听需要另一名角色');
      discardTactic(state, actor, cardId);
      target.nextTurnApPenalty -= 2;
      target.controlledMovementAp = 2;
      target.controlledById = actor.id;
      log(state, 'tactic', `${actor.id}混淆 ${target.id}，其下回合行动点加 2。`);
      return;
    case 'T_LAUNDER': {
      if (!isSafeNode(actor.nodeId) && actor.silver >= 1 && actor.gold >= 1 && actor.sealedGold === 0) {
        discardTactic(state, actor, cardId);
        actor.silver -= 1;
        const amount = Math.min(2, actor.gold);
        actor.gold -= amount;
        actor.sealedGold = amount;
        log(state, 'tactic', `${actor.id}密封 ${amount} 碎金。`);
        return;
      }
      fail('黑市洗钱只能在驿道上、持有官银与碎金且没有密封包时使用');
    }
    case 'T_HIDDEN_ARROW':
      if (!target) fail('暗箭伤人需要目标');
      discardTactic(state, actor, cardId);
      target.food = Math.ceil(target.food / 2);
      target.nextTurnApPenalty += 2;
      log(state, 'tactic', `${actor.id}对 ${target.id}使用暗箭伤人。`);
      return;
    case 'T_INTERROGATION':
      if (!target) fail('刑讯逼供需要目标');
      discardTactic(state, actor, cardId);
      log(state, 'tactic', `${actor.id}查看 ${target.id} 的功能牌：${target.hand.join('、') || '无'}。`, [actor.id]);
      return;
    default:
      fail('该功能牌的执行尚未定义');
  }
}

function mine(state: GameState, actor: CharacterState): void {
  if (actor.nodeId !== 'MINE') fail('只能在漠河金矿采矿');
  if (eventActive(state, 'V_MINE_COLLAPSE')) fail('矿洞塌方，本轮不能采矿');
  if (state.mineOutputRemaining === 0 && !hasCard(actor, 'E_MINE_MAP')) fail('本轮矿产已耗尽');
  const factionRemaining = balanceData.mineFactionOutputPerRound - state.mineOutputByFaction[actor.faction];
  if (factionRemaining <= 0) fail('本阵营本轮矿车已满');
  if (actor.mineActionsThisTurn >= balanceData.mineActionsPerCharacterTurn) fail('本回合采矿次数已达上限');
  charge(actor, 1);
  const rng = randomFor(state);
  const roll = rng.rollDie(6);
  saveRandom(state, rng);
  let yieldGold = roll <= 2 ? 1 : roll <= 4 ? 2 : 3;
  if (hasCard(actor, 'E_PICKAXE')) yieldGold = Math.ceil(yieldGold * 1.5);
  const ignoresLimit = hasCard(actor, 'E_MINE_MAP');
  const gained = ignoresLimit ? Math.min(yieldGold, factionRemaining) : Math.min(yieldGold, state.mineOutputRemaining, factionRemaining);
  if (!ignoresLimit) state.mineOutputRemaining -= gained;
  state.mineOutputByFaction[actor.faction] += gained;
  actor.gold += gained;
  actor.mineActionsThisTurn += 1;
  log(state, 'mine', `${actor.id}采矿掷出 ${roll}，获得 ${gained} 碎金。`);
}

function exchange(state: GameState, actor: CharacterState, amount: number): void {
  if (actor.exchangedThisTurn) fail('本回合已经兑换');
  if (!Number.isInteger(amount) || amount < 1 || amount > actor.gold) fail('兑换数量无效');
  const permitted = (actor.faction === 'smuggler' && actor.nodeId === 'BAZAAR') || (actor.faction === 'officer' && actor.nodeId === 'MRG');
  if (!permitted) fail('该阵营无法在当前位置兑换');
  charge(actor, 1);
  actor.exchangedThisTurn = true;
  actor.gold -= amount;
  actor.silver += amount;
  state.reputation[actor.faction] += amount;
  log(state, 'exchange', `${actor.id}兑换 ${amount} 碎金，${actor.faction}获得 ${amount} 声望。`);
  checkWinner(state, actor.faction);
}

function refillFood(state: GameState, actor: CharacterState, source: 'hub' | 'bazaar'): void {
  if (actor.refilledThisTurn) fail('本回合已经补给');
  if (source === 'hub') {
    if (actor.nodeId !== 'HUB') fail('伙房只在二十二驿站可用');
    if (actor.actionPoints < 1) fail('伙房需要至少 1 点行动力');
    actor.actionPoints = 0;
  } else {
    if (actor.nodeId !== 'BAZAAR') fail('粮食贩子只在边境黑市可用');
    if (actor.silver < 1) fail('官银不足');
    charge(actor, 1);
    actor.silver -= 1;
  }
  actor.food = foodCapacity(actor);
  actor.refilledThisTurn = true;
  log(state, 'food', `${actor.id}将粮草补至 ${actor.food}。`);
}

function tavern(state: GameState, actor: CharacterState, bet: number, guess: 'big' | 'small'): void {
  if (actor.tavernUsedThisTurn) fail('本回合已经使用酒馆');
  if (actor.nodeId !== 'HUB') fail('酒馆只在二十二驿站可用');
  if (!Number.isInteger(bet) || bet < 1 || bet > 3 || actor.silver < bet) fail('下注金额无效');
  charge(actor, 1);
  actor.tavernUsedThisTurn = true;
  actor.silver -= bet;
  const rng = randomFor(state);
  const roll = rng.rollDie(6);
  saveRandom(state, rng);
  const won = (roll <= 3 ? 'small' : 'big') === guess;
  if (won) actor.silver += bet * 2;
  log(state, 'tavern', `${actor.id}在酒馆掷出 ${roll}，${won ? `赢得 ${bet * 2}` : `失去 ${bet}`} 官银。`);
}

function buyMarket(state: GameState, actor: CharacterState, slot: number): void {
  if (actor.nodeId !== 'HUB') fail('交易市场只在二十二驿站可用');
  if (actor.marketBoughtThisTurn) fail('每回合只能购买一张市场牌');
  if (!Number.isInteger(slot) || slot < 0 || slot >= state.marketSlots.length) fail('市场位置无效');
  const cardId = state.marketSlots[slot];
  if (!cardId) fail('该市场位置为空');
  const cost = marketPrice(state, cardId);
  if (actor.silver < cost) fail('官银不足');
  charge(actor, 1);
  actor.silver -= cost;
  const card = cardById.get(cardId);
  if (!card) fail('未知市场牌');
  if (card.kind === 'equipment') {
    const slotName = 'slot' in card ? card.slot : undefined;
    if (!slotName) fail('装备缺少槽位');
    equip(state, actor, cardId);
  } else {
    if (actor.hand.length >= balanceData.handLimit) fail('手牌已达上限');
    actor.hand.push(cardId);
  }
  state.marketSlots[slot] = draw(state, 'market');
  actor.marketBoughtThisTurn = true;
  log(state, 'buyMarket', `${actor.id}以 ${cost} 官银购买 ${card.name}。`);
}

function buyBlackMarket(state: GameState, actor: CharacterState): void {
  if (actor.nodeId !== 'BAZAAR') fail('黑市商人只在边境黑市可用');
  if (actor.blackMarketBoughtThisTurn) fail('每回合只能购买一张黑市牌');
  const cost = eventActive(state, 'V_MERCHANT_SALE') ? Math.ceil(balanceData.blackMarketBlindDrawPrice * 0.6) : balanceData.blackMarketBlindDrawPrice;
  if (actor.silver < cost) fail('官银不足');
  if (actor.hand.length >= balanceData.handLimit) fail('手牌已达上限');
  charge(actor, 1);
  actor.silver -= cost;
  const cardId = draw(state, 'blackMarket');
  if (!cardId) fail('黑市牌库为空');
  actor.hand.push(cardId);
  actor.blackMarketBoughtThisTurn = true;
  actor.blackMarketRedrawAvailable = canUseSmugglerRole(actor);
  actor.blackMarketDrawnCardId = cardId;
  log(state, 'buyBlackMarket', `${actor.id}从黑市盲抽一张功能牌。`, [actor.id]);
}

function rentMount(state: GameState, actor: CharacterState, mountId: string): void {
  if (actor.nodeId !== 'HUB') fail('马厩只在二十二驿站可用');
  if (!mountIds.has(mountId)) fail('未知马匹');
  if (actor.mountId) fail('每名角色只能租一匹马');
  if (state.characters.some((item) => item.mountId === mountId)) fail('该马已被租用');
  const card = cardById.get(mountId);
  const price = card && 'rentalPrice' in card ? card.rentalPrice : null;
  if (typeof price !== 'number' || actor.silver < price) fail('官银不足');
  charge(actor, 1);
  actor.silver -= price;
  actor.mountId = mountId;
  actor.mountTurnsRemaining = balanceData.mountRentalOwnTurns + (hasCard(actor, 'E_HORSE_FEED') ? 1 : 0);
  log(state, 'rentMount', `${actor.id}租借 ${card.name}，租期 ${actor.mountTurnsRemaining} 次自己的回合。`);
}

function pickUp(state: GameState, actor: CharacterState, gold: number, silver: number, handIds: string[] = [], equipmentIds: string[] = []): void {
  if (actor.pickedUpThisTurn) fail('每回合只能拾取一次');
  if (!Number.isInteger(gold) || !Number.isInteger(silver) || gold < 0 || silver < 0 || !Array.isArray(handIds) || !Array.isArray(equipmentIds) || gold + silver + handIds.length + equipmentIds.length < 1) fail('拾取内容无效');
  const dropped = state.droppedItems[actor.nodeId];
  if (!dropped || gold > dropped.gold || silver > dropped.silver) fail('该地点没有足够的掉落资源');
  if (actor.hand.length + handIds.length > balanceData.handLimit) fail('拾取后手牌将超过上限');
  const removeRequested = (items: string[], requested: string[]): void => {
    const available = [...items];
    for (const id of requested) {
      const index = available.indexOf(id);
      if (index < 0) fail('指定的掉落卡牌不存在');
      available.splice(index, 1);
    }
    items.splice(0, items.length, ...available);
  };
  for (const id of handIds) if (cardById.get(id)?.kind !== 'tactic') fail('只能作为手牌拾取功能牌');
  for (const id of equipmentIds) if (cardById.get(id)?.kind !== 'equipment') fail('只能作为装备拾取装备牌');
  removeRequested(dropped.hand, handIds);
  removeRequested(dropped.equipment, equipmentIds);
  dropped.gold -= gold;
  dropped.silver -= silver;
  actor.gold += gold;
  actor.silver += silver;
  actor.hand.push(...handIds);
  for (const id of equipmentIds) {
    const card = cardById.get(id);
    const slotName = card && 'slot' in card ? card.slot : undefined;
    if (!slotName) fail('装备缺少槽位');
    equip(state, actor, id);
  }
  actor.pickedUpThisTurn = true;
  if (dropped.gold === 0 && dropped.silver === 0 && dropped.hand.length === 0 && dropped.equipment.length === 0) delete state.droppedItems[actor.nodeId];
  log(state, 'pickup', `${actor.id}拾取 ${gold} 碎金、${silver} 官银、${handIds.length} 张功能牌和 ${equipmentIds.length} 件装备。`);
}

function refreshMarket(state: GameState, actor: CharacterState): void {
  if (!canUseOfficerRole(actor) || actor.nodeId !== 'HUB') fail('只有具有官兵技能且位于二十二驿站的角色可刷新市场');
  if (actor.marketRefreshedThisTurn) fail('每回合只能刷新一次市场');
  for (const cardId of state.marketSlots) if (cardId) discard(state, 'market', cardId);
  state.marketSlots = [];
  for (let i = 0; i < balanceData.marketSlots; i += 1) state.marketSlots.push(draw(state, 'market'));
  actor.marketRefreshedThisTurn = true;
  log(state, 'refreshMarket', `${actor.id}强制刷新市场货物。`);
}

function initiateSearch(state: GameState, source: CharacterState, target: CharacterState, sourceKind: PendingDecision['sourceKind']): void {
  if (!isAlive(target) || target.id === source.id) fail('收缴目标无效');
  if (target.untargetableThisTurn) fail('目标本回合无法成为收缴目标');
  if (target.faction !== 'smuggler' && sourceKind !== 'privateSearch') fail('稽查目标必须是走私者');
  if (target.searchProtectedUntilRound !== null && target.searchProtectedUntilRound >= state.round && sourceKind !== 'privateSearch') fail('目标受免搜查保护');
  if (sourceKind === 'privateSearch') {
    state.pendingDecision = { kind: 'splitGold', sourceId: source.id, targetId: target.id, sourceKind };
  } else {
    state.pendingDecision = { kind: 'response', sourceId: source.id, targetId: target.id, responseTo: 'search', sourceKind };
  }
  log(state, 'searchStart', `${source.id}对 ${target.id}发动收缴。`);
}

function inspect(state: GameState, actor: CharacterState, targetId: string, distance: number): void {
  if (!isCheckpoint(actor.nodeId)) fail('只能在稽查站发动稽查');
  if (actor.faction !== 'officer') fail('只有官兵能发动稽查');
  if (actor.inspectedThisTurn) fail('每回合只能稽查一次');
  if (!Number.isInteger(distance) || distance < 0 || distance > 2) fail('稽查距离只能为 0、1 或 2');
  if (eventActive(state, 'V_FOREST_FOG') && distance > 0) fail('林海迷雾禁止远程稽查');
  const target = character(state, targetId);
  if (!isAlive(target) || staticDistance(actor.nodeId, target.nodeId) !== distance) fail('目标不在指定稽查距离');
  const baseCost = balanceData.checkpointActionPointCosts[distance];
  charge(actor, Math.max(0, baseCost - (eventActive(state, 'V_OFFICER_PATROL') ? 1 : 0)));
  actor.inspectedThisTurn = true;
  initiateSearch(state, actor, target, 'inspection');
}

function mineSearch(state: GameState, actor: CharacterState, targetId: string): void {
  if (actor.mineSearchedThisTurn) fail('本回合已经使用金矿搜寻');
  if (actor.nodeId !== 'MINE' || actor.faction !== 'officer') fail('只有位于金矿的官兵可搜寻');
  const target = character(state, targetId);
  if (target.nodeId !== 'MINE') fail('搜寻目标必须同处金矿');
  charge(actor, 1);
  actor.mineSearchedThisTurn = true;
  initiateSearch(state, actor, target, 'mineSearch');
}

function answerFor(boxA: number, boxB: number, question: SearchQuestion): boolean {
  if (question === 'aMoreThanB') return boxA > boxB;
  if (question === 'aEmpty') return boxA === 0;
  if (question === 'bAtLeast2') return boxB >= 2;
  return boxA === boxB;
}

function splitGold(state: GameState, actorId: string, boxA: number, boxB: number): void {
  const pending = state.pendingDecision;
  if (!pending || pending.kind !== 'splitGold') fail('当前不需要分箱');
  if (pending.targetId !== actorId) fail('只有被收缴者可以分箱');
  if (!Number.isInteger(boxA) || !Number.isInteger(boxB) || boxA < 0 || boxB < 0) fail('分箱数量无效');
  const target = character(state, actorId);
  if (boxA + boxB !== target.gold) fail('两箱碎金必须等于全部可收缴碎金');
  state.pendingDecision = { ...pending, kind: 'askSearchQuestion', boxA, boxB, interrogationUsed: false, askedQuestions: [], answers: [] };
  log(state, 'searchSplit', `${target.id}已完成秘密分箱。`, [target.id]);
}

function askSearchQuestion(state: GameState, actorId: string, question: SearchQuestion): void {
  const pending = state.pendingDecision;
  if (!pending || (pending.kind !== 'askSearchQuestion' && !(pending.kind === 'chooseSearchBox' && pending.questionsRemaining > 0))) fail('当前不需要提问');
  if (pending.sourceId !== actorId) fail('只有收缴发动者可以提问');
  if (pending.askedQuestions.includes(question)) fail('刑讯逼供的两次提问必须不同');
  if (!['aMoreThanB', 'aEmpty', 'bAtLeast2', 'equal'].includes(question)) fail('请选择系统提供的问题');
  const answer = answerFor(pending.boxA, pending.boxB, question);
  const answers = pending.answers ?? (pending.kind === 'chooseSearchBox' ? [{ question: pending.question, answer: pending.answer }] : []);
  state.pendingDecision = { ...pending, kind: 'chooseSearchBox', question, answer, questionsRemaining: pending.kind === 'askSearchQuestion' && pending.interrogationUsed && pending.askedQuestions.length === 0 ? 1 : 0, askedQuestions: [...pending.askedQuestions, question], answers: [...answers, { question, answer }] };
  const questionText = { aMoreThanB:'甲箱比乙箱多吗', aEmpty:'甲箱为空吗', bAtLeast2:'乙箱至少有两枚碎金吗', equal:'两箱一样多吗' }[question];
  log(state, 'searchQuestion', `${actorId}问「${questionText}」，系统回答：${answer ? '是' : '否'}。`);
}

function chooseSearchBox(state: GameState, actorId: string, box: 'A' | 'B'): void {
  const pending = state.pendingDecision;
  if (!pending || pending.kind !== 'chooseSearchBox') fail('当前不需要选择箱子');
  if (pending.sourceId !== actorId) fail('只有收缴发动者可以选箱');
  if (pending.questionsRemaining > 0) fail('请先完成第二个问题，再选择一个箱子');
  if (box !== 'A' && box !== 'B') fail('请选择甲箱或乙箱');
  const source = character(state, pending.sourceId);
  const target = character(state, pending.targetId);
  const gained = box === 'A' ? pending.boxA : pending.boxB;
  target.gold -= gained;
  source.gold += gained;
  if (pending.sourceKind === 'inspection') {
    if (gained > 0) {
      source.successiveSuccessfulInspections += 1;
      source.nextTurnApPenalty += Math.min(balanceData.maxSuccessiveInspectionPenalty, source.successiveSuccessfulInspections);
    } else {
      source.successiveSuccessfulInspections = 0;
      target.searchProtectedUntilRound = state.round + 1;
    }
  }
  if (source.faction === 'officer' && gained > 0 && hasCard(source, 'E_BOUNTY')) source.silver += 2;
  if (pending.sourceKind === 'mineSearch' && gained === 0) target.searchProtectedUntilRound = state.round + 1;
  if (target.sealedGold > 0) {
    target.gold += target.sealedGold;
    log(state, 'unseal', `${target.id}的密封包在收缴后拆封 ${target.sealedGold} 碎金。`);
    target.sealedGold = 0;
  }
  state.pendingDecision = null;
  log(state, 'searchResolve', `${source.id}打开 ${box} 箱，获得 ${gained} 碎金；另一箱为 ${box === 'A' ? pending.boxB : pending.boxA} 碎金。`);
}

function preEventMove(state: GameState, actorId: string, path: NodeId[]): void {
  if (state.phase !== 'preEvent' || state.activeCharacterId !== actorId || !state.preEventQueue.includes(actorId)) fail('当前不是该角色的轮前移动窗口');
  const actor = character(state, actorId);
  if (actor.mountId !== 'M_WHITE_STEED' || !isAlive(actor) || !path || path.length !== 1) fail('白驹只能在轮前免费移动 1 格');
  moveWithoutAp(state, actor, path, '骑白驹在轮前');
  state.preEventQueue.shift();
  continueAfterPreEvent(state);
}

function skipPreEvent(state: GameState, actorId: string): void {
  if (state.phase !== 'preEvent' || state.activeCharacterId !== actorId || state.preEventQueue[0] !== actorId) fail('当前不是该角色的轮前窗口');
  state.preEventQueue.shift();
  log(state, 'preEventSkip', `${actorId}放弃白驹轮前移动。`);
  continueAfterPreEvent(state);
}

function collectContract(state: GameState, actor: CharacterState, ownerId: string): void {
  if (actor.nodeId !== 'MINE') fail('只能在金矿领取矿工契约产出');
  const owner = character(state, ownerId);
  if (actor.contractCollectedThisTurn || !hasCard(owner, 'E_MINER_CONTRACT') || owner.faction !== actor.faction || owner.contractGold < 1) fail('没有可领取的契约产出或本回合已经领取');
  actor.contractCollectedThisTurn = true;
  actor.gold += owner.contractGold;
  log(state, 'contractCollect', `${actor.id}领取 ${owner.id} 矿工契约的 ${owner.contractGold} 碎金。`);
  owner.contractGold = 0;
}

function freeMove(state: GameState, actor: CharacterState, path: NodeId[]): void {
  if (!actor.freeMoveAvailableThisTurn) fail('本回合没有可用的沙俄马队免费移动');
  if (!Array.isArray(path) || path.length < 1 || path.length > 3) fail('沙俄马队只能免费移动 1 至 3 格');
  moveWithoutAp(state, actor, path, '借沙俄马队');
  actor.freeMoveAvailableThisTurn = false;
}

function controlledMove(state: GameState, controller: CharacterState, targetId: string, path: NodeId[]): void {
  const target = character(state, targetId);
  if (state.pendingDecision || state.phase !== 'characterTurn' || state.activeCharacterId !== target.id || target.controlledById !== controller.id || target.controlledMovementAp < 1) fail('当前没有可控制的移动');
  if (!Array.isArray(path) || path.length !== 1) fail('受控移动每次只能走 1 格');
  const before = target.actionPoints;
  move(state, target, path);
  const spent = before - target.actionPoints;
  if (spent > target.controlledMovementAp) fail('本次移动超出可控制行动点');
  target.controlledMovementAp -= spent;
  if (target.controlledMovementAp === 0) target.controlledById = null;
  log(state, 'controlledMove', `${controller.id}决定 ${target.id} 的受控移动。`);
}

function redrawBlackMarket(state: GameState, actor: CharacterState, cardId: string): void {
  if (!actor.blackMarketRedrawAvailable || !canUseSmugglerRole(actor)) fail('当前不能重抽黑市牌');
  if (actor.blackMarketDrawnCardId !== cardId) fail('只能重抽本次购买的黑市牌');
  const index = actor.hand.indexOf(cardId);
  if (index < 0) fail('必须弃置刚购得的黑市功能牌');
  actor.hand.splice(index, 1);
  discard(state, 'blackMarket', cardId);
  const replacement = draw(state, 'blackMarket');
  if (!replacement) fail('黑市牌库为空');
  actor.hand.push(replacement);
  actor.blackMarketRedrawAvailable = false;
  log(state, 'blackMarketRedraw', `${actor.id}弃置黑市牌并重抽一张。`, [actor.id]);
}

function unequipAndDiscard(state: GameState, actor: CharacterState, cardId: string): void {
  const entry = Object.entries(actor.equipped).find(([, id]) => id === cardId);
  if (!entry) fail('角色未装备该牌');
  delete actor.equipped[entry[0]];
  discard(state, 'market', cardId);
}

function useEquipment(state: GameState, actor: CharacterState, cardId: string, edgeTo?: NodeId, direction?: 'deposit' | 'withdraw', resource?: 'gold' | 'silver', amount?: number): void {
  if (cardId === 'E_TIME_GONG') {
    if (state.phase !== 'preEvent' || !actor.equipped.document || actor.equipped.document !== cardId) fail('时辰铜锣只能在轮前由装备者使用');
    if (state.preEventQueue[0] !== actor.id) fail('请在自己的轮前窗口使用时辰铜锣');
    state.turnOrder.reverse();
    state.preEventQueue = [actor.id, ...state.preEventQueue.slice(1).reverse()];
    unequipAndDiscard(state, actor, cardId);
    log(state, 'equipment', `${actor.id}敲响时辰铜锣，本轮行动顺序反转。`);
    return;
  }
  const activeActor = actorForCommand(state, actor.id);
  if (activeActor !== actor) fail('当前不是该角色的回合');
  if (cardId === 'E_ROAD_BLOCK') {
    if (!actor.equipped.trap || actor.equipped.trap !== cardId || !edgeTo || !isAdjacent(actor.nodeId, edgeTo)) fail('铁索拒马必须布置在当前节点的一条相邻边');
    if (isSafeNode(actor.nodeId)) fail('只能在驿道节点布置拒马');
    charge(actor, 1);
    const key = edgeKey(actor.nodeId, edgeTo);
    if (state.blockedEdges.includes(key)) fail('该道路已经被阻断');
    state.blockedEdges.push(key);
    delete actor.equipped.trap;
    log(state, 'equipment', `${actor.id}在道路 ${key} 布置铁索拒马。`);
    return;
  }
  if (cardId === 'E_LOCKBOX') {
    if (actor.equipped.container !== cardId || !['gold','silver'].includes(resource!) || !['deposit','withdraw'].includes(direction!) || !Number.isInteger(amount) || amount! < 1) fail('密匣操作参数无效');
    charge(actor, 1);
    if (direction === 'deposit') {
      if (actor.lockbox.gold + actor.lockbox.silver + amount > 3 || actor[resource] < amount) fail('密匣容量不足或资源不足');
      actor[resource] -= amount;
      actor.lockbox[resource] += amount;
    } else {
      if (actor.lockbox[resource] < amount) fail('密匣内资源不足');
      actor.lockbox[resource] -= amount;
      actor[resource] += amount;
    }
    log(state, 'equipment', `${actor.id}${direction === 'deposit' ? '存入' : '取出'} ${amount} ${resource === 'gold' ? '碎金' : '官银'}。`);
    return;
  }
  fail('该装备没有可主动使用的效果');
}

function passResponse(state: GameState, actorId: string): void {
  const pending = state.pendingDecision;
  if (!pending || pending.kind !== 'response') fail('当前没有可放弃的响应');
  if (pending.targetId !== actorId) fail('只有被指定目标可以放弃响应');
  if (pending.responseTo === 'search') {
    state.pendingDecision = { kind: 'splitGold', sourceId: pending.sourceId, targetId: pending.targetId, sourceKind: pending.sourceKind };
    log(state, 'responsePass', `${actorId}放弃响应，进入双箱分配。`);
    return;
  }
  const source = character(state, pending.sourceId);
  const target = character(state, pending.targetId);
  const gold = target.gold;
  const silver = target.silver;
  target.gold = 0;
  target.silver = 0;
  source.gold += gold;
  source.silver += silver;
  if (target.sealedGold > 0) {
    target.gold += target.sealedGold;
    log(state, 'unseal', `${target.id}的密封包在劫道后拆封 ${target.sealedGold} 碎金。`);
    target.sealedGold = 0;
  }
  state.pendingDecision = null;
  log(state, 'robberyResolve', `${source.id}劫得 ${gold} 碎金与 ${silver} 官银。`);
}

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
