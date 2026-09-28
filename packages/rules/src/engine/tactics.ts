import balanceData from '../../../../content/balance.v1.json' with { type: 'json' };
import cardsData from '../../../../content/cards.v1.json' with { type: 'json' };
import { getNeighbors, isSafeNode, staticDistance } from '../map.ts';
import type { CharacterState, GameState, PendingDecision } from '../state.ts';
import { charge, character, discard, eventActive, fail, foodCapacity, hasCard, isAlive, log, randomFor, saveRandom } from './shared.ts';
import { actorForCommand, moveWithoutAp } from './movement.ts';
import { initiateSearch } from './search.ts';

export function discardTactic(state: GameState, actor: CharacterState, cardId: string): void {
  const index = actor.hand.indexOf(cardId);
  if (index < 0) fail('角色未持有该功能牌');
  actor.hand.splice(index, 1);
  actor.blackMarketRedrawAvailable = false;
  discard(state, 'blackMarket', cardId);
  if (state.activeCharacterId === actor.id) actor.tacticsPlayedThisTurn += 1;
}

export function requireTacticTarget(state: GameState, actor: CharacterState, targetId: string): CharacterState {
  const target = character(state, targetId);
  if (!isAlive(target) || target.untargetableThisTurn || staticDistance(actor.nodeId, target.nodeId) > 1) fail('目标不在有效范围或不可成为目标');
  return target;
}

export function playTactic(state: GameState, actorId: string, cardId: string, targetId?: string, path?: NodeId[]): void {
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
