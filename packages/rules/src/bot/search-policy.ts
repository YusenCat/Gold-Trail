import type { LegalAction } from '../actions.ts';
import type { CharacterState, GameState, SearchQuestion } from '../state.ts';

const questions: SearchQuestion[] = ['aMoreThanB', 'aEmpty', 'bAtLeast2', 'equal'];

function answerFor(a: number, total: number, question: SearchQuestion): boolean {
  const b = total - a;
  return question === 'aMoreThanB' ? a > b : question === 'aEmpty' ? a === 0 : question === 'bAtLeast2' ? b >= 2 : a === b;
}

function publicHash(view: GameState, id: string): number {
  let hash = 2166136261;
  const key = `${view.round}:${view.revision}:${id}:${view.pendingDecision?.kind ?? ''}`;
  for (const letter of key) hash = Math.imul(hash ^ letter.charCodeAt(0), 16777619);
  return hash >>> 0;
}

export function publicJitter(view: GameState, id: string, label: string): number {
  let hash = publicHash(view, id);
  for (const letter of label) hash = Math.imul(hash ^ letter.charCodeAt(0), 16777619);
  return (hash >>> 0) / 0xffffffff;
}

/** Keep low-loss splits, but vary the exact partition using only public state. */
export function chooseSplit(view: GameState, id: string, actions: LegalAction[]): LegalAction | undefined {
  const splits = actions.filter((action) => action.command.type === 'SPLIT_GOLD');
  if (!splits.length) return undefined;
  const minimum = Math.min(...splits.map((action) => {
    const command = action.command;
    return command.type === 'SPLIT_GOLD' ? Math.abs(command.boxA - command.boxB) : Infinity;
  }));
  const safe = splits.filter((action) => {
    const command = action.command;
    return command.type === 'SPLIT_GOLD' && Math.abs(command.boxA - command.boxB) <= minimum + 2;
  });
  const weights = safe.map((action) => {
    const command = action.command;
    return command.type === 'SPLIT_GOLD' && Math.abs(command.boxA - command.boxB) === minimum ? 3 : 1;
  });
  const total = weights.reduce((sum, weight) => sum + weight, 0);
  let ticket = publicHash(view, id) % total;
  for (let index = 0; index < safe.length; index++) {
    ticket -= weights[index];
    if (ticket < 0) return safe[index];
  }
  return safe[0];
}

function splitWeight(a: number, total: number): number {
  const gap = Math.abs(2 * a - total);
  return 0.35 + 0.65 * Math.exp(-gap / Math.max(1, total / 2));
}

function plausibleSplits(total: number, answers: Array<{ question: SearchQuestion; answer: boolean }>) {
  return Array.from({ length: total + 1 }, (_, a) => ({ a, b: total - a, weight: splitWeight(a, total) }))
    .filter(({ a }) => answers.every(({ question, answer }) => answerFor(a, total, question) === answer));
}

function expectedBestBox(splits: ReturnType<typeof plausibleSplits>): number {
  const mass = splits.reduce((sum, split) => sum + split.weight, 0);
  if (!mass) return 0;
  const a = splits.reduce((sum, split) => sum + split.a * split.weight, 0);
  const b = splits.reduce((sum, split) => sum + split.b * split.weight, 0);
  return Math.max(a, b) / mass;
}

function expectedAfterQuestion(splits: ReturnType<typeof plausibleSplits>, total: number, question: SearchQuestion): number {
  const mass = splits.reduce((sum, split) => sum + split.weight, 0);
  if (!mass) return 0;
  return [true, false].reduce((sum, answer) => {
    const subset = splits.filter(({ a }) => answerFor(a, total, question) === answer);
    return sum + expectedBestBox(subset) * subset.reduce((subtotal, split) => subtotal + split.weight, 0);
  }, 0) / mass;
}

/** Information value of a truthful question under an explicit, balanced-biased split prior. */
export function questionValue(view: GameState, question: SearchQuestion): number {
  const pending = view.pendingDecision;
  if (!pending || !('targetId' in pending)) return 0;
  const target = view.characters.find((character) => character.id === pending.targetId);
  const total = target?.gold ?? 0;
  const previous = pending.kind === 'chooseSearchBox' ? pending.answers ?? [{ question: pending.question, answer: pending.answer }] : [];
  const splits = plausibleSplits(total, previous);
  const mass = splits.reduce((sum, split) => sum + split.weight, 0);
  if (!mass) return 0;
  const withAnswer = (answer: boolean) => splits.filter(({ a }) => answerFor(a, total, question) === answer);
  const trueSet = withAnswer(true), falseSet = withAnswer(false);
  const weighted = [trueSet, falseSet].reduce((sum, set) => sum + expectedBestBox(set) * set.reduce((subtotal, split) => subtotal + split.weight, 0), 0) / mass;
  return weighted;
}

export function interrogationMarginalValue(view: GameState): number {
  const pending = view.pendingDecision;
  if (!pending || pending.kind !== 'askSearchQuestion') return 0;
  const total = view.characters.find((character) => character.id === pending.targetId)?.gold ?? 0;
  const splits = plausibleSplits(total, []);
  const mass = splits.reduce((sum, split) => sum + split.weight, 0);
  if (!mass) return 0;
  const oneQuestion = Math.max(...questions.map((question) => expectedAfterQuestion(splits, total, question)));
  const twoQuestions = Math.max(...questions.map((first) => [true, false].reduce((sum, answer) => {
    const subset = splits.filter(({ a }) => answerFor(a, total, first) === answer);
    const subsetMass = subset.reduce((subtotal, split) => subtotal + split.weight, 0);
    if (!subsetMass) return sum;
    const bestFollowUp = Math.max(...questions.filter((question) => question !== first).map((second) => expectedAfterQuestion(subset, total, second)));
    return sum + bestFollowUp * subsetMass;
  }, 0) / mass));
  return Math.max(0, twoQuestions - oneQuestion);
}

export function bestBoxValue(view: GameState, box: 'A' | 'B'): number {
  const pending = view.pendingDecision;
  if (!pending || pending.kind !== 'chooseSearchBox') return 0;
  const total = view.characters.find((character) => character.id === pending.targetId)?.gold ?? 0;
  const answers = pending.answers ?? [{ question: pending.question, answer: pending.answer }];
  const splits = plausibleSplits(total, answers);
  const mass = splits.reduce((sum, split) => sum + split.weight, 0);
  return mass ? splits.reduce((sum, split) => sum + (box === 'A' ? split.a : split.b) * split.weight, 0) / mass : total / 2;
}

export function inspectionValue(actor: CharacterState, target: CharacterState, cost: number, kind: 'INSPECT' | 'MINE_SEARCH'): number {
  if (target.gold <= 0) return -80;
  const expectedGold = target.gold / 2;
  const successChance = target.gold >= 2 ? 0.85 : 0.55;
  const nextPenalty = kind === 'INSPECT' ? Math.min(3, actor.successiveSuccessfulInspections + 1) * successChance * 11 : 0;
  const reward = expectedGold * (actor.faction === target.faction ? 16 : 27);
  return 76 + reward - cost * 9 - nextPenalty;
}

export const searchQuestions = questions;
