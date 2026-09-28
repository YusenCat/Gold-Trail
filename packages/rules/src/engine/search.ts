import balanceData from '../../../../content/balance.v1.json' with { type: 'json' };
import { isCheckpoint, staticDistance } from '../map.ts';
import type { CharacterState, GameState, PendingDecision, SearchQuestion } from '../state.ts';
import { charge, character, eventActive, fail, hasCard, isAlive, log, RuleError } from './shared.ts';

export function initiateSearch(state: GameState, source: CharacterState, target: CharacterState, sourceKind: PendingDecision['sourceKind']): void {
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

export function inspect(state: GameState, actor: CharacterState, targetId: string, distance: number): void {
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

export function mineSearch(state: GameState, actor: CharacterState, targetId: string): void {
  if (actor.mineSearchedThisTurn) fail('本回合已经使用金矿搜寻');
  if (actor.nodeId !== 'MINE' || actor.faction !== 'officer') fail('只有位于金矿的官兵可搜寻');
  const target = character(state, targetId);
  if (target.nodeId !== 'MINE') fail('搜寻目标必须同处金矿');
  charge(actor, 1);
  actor.mineSearchedThisTurn = true;
  initiateSearch(state, actor, target, 'mineSearch');
}

export function answerFor(boxA: number, boxB: number, question: SearchQuestion): boolean {
  if (question === 'aMoreThanB') return boxA > boxB;
  if (question === 'aEmpty') return boxA === 0;
  if (question === 'bAtLeast2') return boxB >= 2;
  return boxA === boxB;
}

export function splitGold(state: GameState, actorId: string, boxA: number, boxB: number): void {
  const pending = state.pendingDecision;
  if (!pending || pending.kind !== 'splitGold') fail('当前不需要分箱');
  if (pending.targetId !== actorId) fail('只有被收缴者可以分箱');
  if (!Number.isInteger(boxA) || !Number.isInteger(boxB) || boxA < 0 || boxB < 0) fail('分箱数量无效');
  const target = character(state, actorId);
  if (boxA + boxB !== target.gold) fail('两箱碎金必须等于全部可收缴碎金');
  state.pendingDecision = { ...pending, kind: 'askSearchQuestion', boxA, boxB, interrogationUsed: false, askedQuestions: [], answers: [] };
  log(state, 'searchSplit', `${target.id}已完成秘密分箱。`, [target.id]);
}

export function askSearchQuestion(state: GameState, actorId: string, question: SearchQuestion): void {
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

export function chooseSearchBox(state: GameState, actorId: string, box: 'A' | 'B'): void {
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

export function passResponse(state: GameState, actorId: string): void {
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
