import balance from '../../../../content/balance.v1.json' with { type: 'json' };
import { isCheckpoint, shortestPath } from '../map.ts';
import type { CharacterState, GameState } from '../state.ts';

export interface BotPlan {
  goal: 'mine' | 'deliver' | 'refill' | 'intercept' | 'wait';
  destination: string;
  valuableSmuggler?: CharacterState;
  interceptNode?: string;
  victoryLoad: boolean;
  finalDelivery: boolean;
  exhaustedMine: boolean;
  distance: (from: string, to: string) => number;
}

/** Compare complete near-term jobs: travel, act, then reach a delivery point. */
export function createBotPlan(view: GameState, actor: CharacterState): BotPlan {
  const blocked = new Set(view.blockedEdges);
  const distance = (from: string, to: string) => (shortestPath(from, to, blocked)?.length ?? 1000) - 1;
  const depot = actor.faction === 'smuggler' ? 'BAZAAR' : 'MRG';
  const cargo = actor.gold + actor.sealedGold + actor.lockbox.gold;
  const capacity = Object.values(actor.equipped).includes('E_BACKPACK') ? 9 : 6;
  const valuableSmuggler = actor.faction === 'officer'
    ? view.characters.filter((character) => character.faction === 'smuggler' && !character.deadUntilRound && character.gold >= 4)
      .sort((a, b) => b.gold - a.gold || distance(actor.nodeId, a.nodeId) - distance(actor.nodeId, b.nodeId))[0]
    : undefined;
  const interceptNode = valuableSmuggler
    ? shortestPath(valuableSmuggler.nodeId, 'BAZAAR', blocked)?.find(isCheckpoint) ?? valuableSmuggler.nodeId
    : undefined;
  const victoryLoad = view.mode === 'race' && cargo >= balance.raceReputationTarget - view.reputation[actor.faction];
  const roundsLeft = view.mode === 'fixedRounds' ? balance.fixedRoundLimit - view.round : 1000;
  const finalDelivery = cargo > 0 && roundsLeft <= Math.ceil(distance(actor.nodeId, depot) / 3) + 1;
  const exhaustedMine = view.activeEventId === 'V_MINE_COLLAPSE'
    || (view.mineOutputRemaining === 0 && !Object.values(actor.equipped).includes('E_MINE_MAP'));
  const expectedMining = exhaustedMine ? 0 : Math.min(Math.max(0, capacity - cargo), 4, Math.max(0, view.mineOutputRemaining));
  const tripTurns = (steps: number) => Math.max(0, steps) / (actor.mountId === 'M_RED_HARE' ? 5 : 3);
  const loadedCheckpointThreat = actor.faction === 'smuggler' && cargo >= 4
    && view.characters.some((character) => character.faction === 'officer' && !character.deadUntilRound
      && isCheckpoint(character.nodeId) && distance(actor.nodeId, character.nodeId) <= 3);
  const deliveryScore = cargo > 0 ? cargo * 55 * (cargo < 5 && !victoryLoad && !finalDelivery ? 0.75 : 1)
    / (1 + tripTurns(distance(actor.nodeId, depot))) + (victoryLoad ? 200 : 0) + (finalDelivery ? 90 : 0)
      + (loadedCheckpointThreat ? 50 : 0) : -Infinity;
  const miningScore = expectedMining > 0
    ? expectedMining * 55 / (1 + tripTurns(distance(actor.nodeId, 'MINE')) + 0.65 + tripTurns(distance('MINE', depot)))
      + (actor.nodeId === 'MINE' && actor.mineActionsThisTurn < balance.mineActionsPerCharacterTurn ? 18 : 0)
    : -Infinity;
  const interceptScore = valuableSmuggler && interceptNode && !cargo
    && distance(actor.nodeId, interceptNode) <= 3 && distance(valuableSmuggler.nodeId, interceptNode) <= 2
    && actor.food >= 2
    ? valuableSmuggler.gold * 15 / (1 + tripTurns(distance(actor.nodeId, interceptNode)))
      + (distance(actor.nodeId, interceptNode) <= actor.actionPoints ? 12 : 0)
      - actor.successiveSuccessfulInspections * 8
    : -Infinity;
  let goal: BotPlan['goal'] = 'wait';
  let destination = 'HUB';
  if (deliveryScore >= miningScore && deliveryScore >= interceptScore) { goal = 'deliver'; destination = depot; }
  else if (interceptScore > miningScore) { goal = 'intercept'; destination = interceptNode!; }
  else if (miningScore > -Infinity) { goal = 'mine'; destination = 'MINE'; }
  else if (cargo > 0) { goal = 'deliver'; destination = depot; }

  // Reconsider a stop before the next supply tick, using only visible food and road distance.
  const futureSteps = Math.max(0, distance(actor.nodeId, destination) - Math.max(1, actor.actionPoints));
  const foodNeeded = Math.ceil(futureSteps / 3) + 2;
  if (actor.food < foodNeeded && actor.nodeId !== depot) {
    const refill = ['HUB', ...(actor.silver > 0 ? ['BAZAAR'] : [])]
      .sort((a, b) => distance(actor.nodeId, a) - distance(actor.nodeId, b))[0];
    if (distance(actor.nodeId, refill) < 1000) { goal = 'refill'; destination = refill; }
  }
  return { goal, destination, valuableSmuggler, interceptNode, victoryLoad, finalDelivery, exhaustedMine, distance };
}
