import { isSafeNode, getNode, isAdjacent, isCheckpoint, edgeKey, staticDistance } from '../map.ts';
import type { CharacterState, GameState } from '../state.ts';
import { charge, character, discard, eventActive, fail, foodCapacity, hasCard, isAlive, log, randomFor, saveRandom, RuleError } from './shared.ts';
import { continueAfterPreEvent } from './lifecycle.ts';

export function actorForCommand(state: GameState, actorId: string): CharacterState {
  if (state.phase !== 'characterTurn') fail('当前不在角色行动阶段');
  if (state.pendingDecision) fail('必须先完成待决策步骤');
  if (state.activeCharacterId !== actorId) fail('现在不是该角色的回合');
  const actor = character(state, actorId);
  if (!isAlive(actor)) fail('角色已死亡');
  if (actor.controlledById && actor.controlledMovementAp > 0 && actor.actionPoints > 0) fail('请先由混淆视听的施用者决定移动或放弃控制');
  return actor;
}

/** A landing encounter is deterministic for a saved RNG state and can trigger once per site per turn. */

export function resolveLandingEncounter(state: GameState, actor: CharacterState): void {
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

export function move(state: GameState, actor: CharacterState, path: NodeId[]): void {
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

export function canUseOfficerRole(actor: CharacterState): boolean {
  return actor.faction === 'officer' || hasCard(actor, 'E_DOUBLE_AGENT');
}

export function canUseSmugglerRole(actor: CharacterState): boolean {
  return actor.faction === 'smuggler' || hasCard(actor, 'E_DOUBLE_AGENT');
}

export function moveWithoutAp(state: GameState, actor: CharacterState, path: NodeId[], label: string): void {
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

export function preEventMove(state: GameState, actorId: string, path: NodeId[]): void {
  if (state.phase !== 'preEvent' || state.activeCharacterId !== actorId || !state.preEventQueue.includes(actorId)) fail('当前不是该角色的轮前移动窗口');
  const actor = character(state, actorId);
  if (actor.mountId !== 'M_WHITE_STEED' || !isAlive(actor) || !path || path.length !== 1) fail('白驹只能在轮前免费移动 1 格');
  moveWithoutAp(state, actor, path, '骑白驹在轮前');
  state.preEventQueue.shift();
  continueAfterPreEvent(state);
}

export function skipPreEvent(state: GameState, actorId: string): void {
  if (state.phase !== 'preEvent' || state.activeCharacterId !== actorId || state.preEventQueue[0] !== actorId) fail('当前不是该角色的轮前窗口');
  state.preEventQueue.shift();
  log(state, 'preEventSkip', `${actorId}放弃白驹轮前移动。`);
  continueAfterPreEvent(state);
}

export function collectContract(state: GameState, actor: CharacterState, ownerId: string): void {
  if (actor.nodeId !== 'MINE') fail('只能在金矿领取矿工契约产出');
  const owner = character(state, ownerId);
  if (actor.contractCollectedThisTurn || !hasCard(owner, 'E_MINER_CONTRACT') || owner.faction !== actor.faction || owner.contractGold < 1) fail('没有可领取的契约产出或本回合已经领取');
  actor.contractCollectedThisTurn = true;
  actor.gold += owner.contractGold;
  log(state, 'contractCollect', `${actor.id}领取 ${owner.id} 矿工契约的 ${owner.contractGold} 碎金。`);
  owner.contractGold = 0;
}

export function freeMove(state: GameState, actor: CharacterState, path: NodeId[]): void {
  if (!actor.freeMoveAvailableThisTurn) fail('本回合没有可用的沙俄马队免费移动');
  if (!Array.isArray(path) || path.length < 1 || path.length > 3) fail('沙俄马队只能免费移动 1 至 3 格');
  moveWithoutAp(state, actor, path, '借沙俄马队');
  actor.freeMoveAvailableThisTurn = false;
}

export function controlledMove(state: GameState, controller: CharacterState, targetId: string, path: NodeId[]): void {
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
