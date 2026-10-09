import cards from '../../../content/cards.v1.json' with { type: 'json' };
import balance from '../../../content/balance.v1.json' with { type: 'json' };
import type { GameState } from './state.ts';
import type { GameCommand } from './engine.ts';
import { publicView } from './engine.ts';
import { decisionActor, legalActions, type LegalAction } from './actions.ts';
import { shortestPath, isCheckpoint, isSafeNode, edgeKey, getNode } from './map.ts';
import { createBotPlan } from './bot/planning.ts';
import { bestBoxValue, chooseSplit, inspectionValue, publicJitter, questionValue } from './bot/search-policy.ts';
import { tacticValue } from './bot/tactic-policy.ts';

export function isBotTurn(state: GameState): boolean {
  const actor = state.characters.find((c) => c.id === decisionActor(state));
  return state.session.kind === 'solo' && !!actor && actor.faction !== state.session.humanFaction;
}

/** Candidates are legality-only. The scoring policy receives no deck, RNG, enemy hand or box contents. */
export function chooseBotCommand(state: GameState, supplied?: LegalAction[]): GameCommand | null {
  const id = decisionActor(state);
  if (!id) return null;
  const fullActor = state.characters.find((c) => c.id === id)!;
  const candidates = supplied ?? legalActions(state);
  const view = publicView(state, fullActor.faction);
  return selectFromObservation(view, id, candidates, state.session.difficulty ?? 'normal');
}

export function selectFromObservation(view: GameState, id: string, candidates: LegalAction[], difficulty: 'easy' | 'normal' | 'hard' = 'normal'): GameCommand | null {
  const actor = view.characters.find((c) => c.id === id)!;
  const depot = actor.faction === 'smuggler' ? 'BAZAAR' : 'MRG';
  const blocked = new Set(view.blockedEdges);
  const plan = createBotPlan(view, actor);
  const { distance, destination, valuableSmuggler, interceptNode, victoryLoad, finalDelivery, exhaustedMine } = plan;
  const gold = actor.gold + actor.sealedGold + actor.lockbox.gold;
  const capacity = Object.values(actor.equipped).includes('E_BACKPACK') ? 9 : 6;
  const enemies = view.characters.filter((c) => c.faction !== actor.faction && !c.deadUntilRound);
  const progress = (node: string) => distance(actor.nodeId, destination) - distance(node, destination);
  const pending = view.pendingDecision;
  if (pending?.kind === 'splitGold') return chooseSplit(view, id, candidates)?.command ?? null;
  const score = (action: LegalAction): number => {
    const c = action.command;
    if (c.type === 'PASS_RESPONSE') return 5;
    if (c.type === 'ASK_SEARCH_QUESTION') return 80 + questionValue(view, c.question) * 12 + publicJitter(view, id, c.question) * 0.1;
    if (c.type === 'CHOOSE_SEARCH_BOX' && pending?.kind === 'chooseSearchBox') {
      return 60 + bestBoxValue(view, c.box) * 20 + publicJitter(view, id, c.box) * 0.1;
    }
    if (c.type === 'RELEASE_CONTROL') return 10;
    if (c.type === 'CONTROLLED_MOVE') {
      const target = view.characters.find((t) => t.id === c.targetId)!;
      const goal = target.gold >= 4 ? (target.faction === 'smuggler' ? 'BAZAAR' : 'MRG') : 'MINE';
      return 20 + distance(c.path.at(-1)!, goal) - distance(target.nodeId, goal);
    }
    if (c.type === 'EXCHANGE') return 200;
    if (c.type === 'REFILL_FOOD') return actor.food < capacity && (plan.goal === 'refill' || actor.food <= 2 || (actor.nodeId === 'HUB' && actor.food < 5)) ? 180 : -100;
    if (c.type === 'MINE') return plan.goal === 'mine' && !victoryLoad && !finalDelivery && !exhaustedMine ? 110 : -100;
    if (c.type === 'COLLECT_CONTRACT') return 150;
    if (c.type === 'PICK_UP') return 140 + c.gold + c.silver + (c.handIds?.length ?? 0) + (c.equipmentIds?.length ?? 0);
    if (c.type === 'MOVE' || c.type === 'FREE_MOVE' || c.type === 'PRE_EVENT_MOVE') {
      const end = c.path.at(-1)!, gain = progress(end);
      const cost = action.actionPointCost ?? (c.type === 'MOVE' ? c.path.length : 0);
      const safe = isSafeNode(end);
      const encounterBonus = getNode(end).site && !actor.siteVisitsThisTurn.includes(end) ? 5 : 0;
      if (actor.food === 0 && safe) return 175 + gain - cost;
      if (gain <= 0) return -80;
      const starvationRisk = !safe && actor.food === 0 && cost >= actor.actionPoints;
      const threats = enemies.filter((t)=>distance(end,t.nodeId)<=1).length;
      const checkpointRisk = actor.faction === 'smuggler' && gold > 0
        ? enemies.filter((t) => t.faction === 'officer' && isCheckpoint(t.nodeId)).reduce((risk, officer) => {
          const passesOfficer = c.path.includes(officer.nodeId);
          const endpointRange = distance(end, officer.nodeId);
          return risk + (passesOfficer ? 32 : 0) + (endpointRange <= 2 ? (3 - endpointRange) * 7 : 0);
        }, 0)
        : 0;
      const targetDistance = valuableSmuggler ? distance(end, valuableSmuggler.nodeId) : 99;
      const inspectionCost = valuableSmuggler && isCheckpoint(end) && targetDistance <= 2
        ? Math.max(0, balance.checkpointActionPointCosts[targetDistance as 0 | 1 | 2] - (view.activeEventId === 'V_OFFICER_PATROL' ? 1 : 0))
        : 99;
      const canPrepareInspection = actor.faction === 'officer' && valuableSmuggler && isCheckpoint(end)
        && targetDistance <= 2 && actor.actionPoints - cost >= inspectionCost;
      const interceptionBonus = actor.faction === 'officer' && valuableSmuggler
        ? (end === interceptNode ? 28 : 0) + (canPrepareInspection ? 95 : 0) - Math.min(16, targetDistance * 3)
        : 0;
      const remainingAp = actor.actionPoints - cost;
      const immediateGoalAction = end === destination && remainingAp > 0 && (plan.goal === 'mine' || plan.goal === 'deliver' || plan.goal === 'intercept') ? 18 : 0;
      return 40 + gain * 5 - cost + encounterBonus + immediateGoalAction + (c.type === 'FREE_MOVE' ? 15 : 0) + (safe ? 5 : 0) + interceptionBonus - (starvationRisk ? 120 : 0) - (gold > 0 ? threats * 2 + checkpointRisk : 0);
    }
    if (c.type === 'ROLL_DILU') return 60;
    if (c.type === 'INSPECT' || c.type === 'MINE_SEARCH') {
      const target = view.characters.find((t) => t.id === c.targetId)!;
      return inspectionValue(actor, target, action.actionPointCost ?? 1, c.type);
    }
    if (c.type === 'PLAY_TACTIC') return tacticValue(view, actor, action, plan);
    if (c.type === 'BUY_MARKET') {
      const card = cards.cards.find((item) => item.id === view.marketSlots[c.slot])!;
      const basePrice = 'marketPrice' in card ? card.marketPrice : 99;
      const eventPrice = view.activeEventId === 'V_MERCHANT_SALE' ? Math.ceil(basePrice * .6) : basePrice;
      const price = Math.max(1, eventPrice - (view.round === 1 ? balance.openingMarketDiscount : 0));
      if (view.mode === 'fixedRounds' && view.round >= 28) return -80;
      if ('slot' in card && actor.equipped[card.slot]) return -80;
      const durable = ['E_TIGER_WINE','E_PICKAXE','E_MINER_CONTRACT','E_BACKPACK'].includes(card.id);
      const usefulTactic = ['T_MARCH_RATION','T_ROAD_ROBBERY','T_RESIST_SEARCH'].includes(card.id);
      return actor.silver >= price + 1 && (durable || usefulTactic) ? durable ? 95 : 70 : -80;
    }
    if (c.type === 'REFRESH_MARKET') return view.marketSlots.some(Boolean) ? 74 : -80;
    if (c.type === 'BUY_BLACK_MARKET') {
      const price = view.activeEventId === 'V_MERCHANT_SALE' ? Math.ceil(balance.blackMarketBlindDrawPrice * .6) : balance.blackMarketBlindDrawPrice;
      return actor.silver >= price && actor.hand.length < 3 ? 65 + (view.activeEventId === 'V_MERCHANT_SALE' ? 15 : 0) : -80;
    }
    if (c.type === 'REDRAW_BLACK_MARKET') {
      const drawn = c.cardId;
      const useful = drawn === 'T_MARCH_RATION' || drawn === 'T_NIGHT_ESCAPE' || drawn === 'T_RESIST_SEARCH'
        || (drawn === 'T_ROAD_ROBBERY' && enemies.some((t) => distance(actor.nodeId, t.nodeId) <= 1 && t.gold + t.silver > 0))
        || (drawn === 'T_PRIVATE_SEARCH' && enemies.some((t) => t.gold > 1))
        || (drawn === 'T_STEAL_CARD' && enemies.some((t) => t.hand.length > 0));
      return useful ? -80 : 72;
    }
    if (c.type === 'RENT_MOUNT') return actor.silver >= 9 ? 62 : -80;
    if (c.type === 'USE_EQUIPMENT' && c.cardId === 'E_LOCKBOX' && c.direction === 'withdraw' && c.resource === 'gold') return actor.nodeId === depot ? 170 + (c.amount ?? 0) : -80;
    if (c.type === 'REMOVE_BLOCK') {
      const opened = new Set(blocked);opened.delete(edgeKey(actor.nodeId,c.edgeTo));
      const newDistance = (shortestPath(actor.nodeId,destination,opened)?.length ?? 1000)-1;
      return newDistance < distance(actor.nodeId,destination) ? 75 : -80;
    }
    if (c.type === 'SKIP_PRE_EVENT') return 0;
    if (c.type === 'END_TURN') return -50;
    return -90;
  };
  let best: LegalAction | undefined, bestScore = -Infinity;
  for (const action of candidates) {
    const c = action.command;
    let value = score(action);
    // All levels observe the same public information and use the same legal commands.
    if (difficulty === 'easy') {
      if (['INSPECT','MINE_SEARCH','PLAY_TACTIC','BUY_MARKET'].includes(c.type)) value -= 65;
      if (c.type === 'MOVE') value += publicJitter(view, id, JSON.stringify(c)) * 22;
    }
    if (difficulty === 'hard') {
      if (c.type === 'MOVE') {
        const end = c.path.at(-1)!;
        // Reserve AP for a productive arrival and prefer a safe overnight stop.
        if (end === destination && actor.actionPoints > (action.actionPointCost ?? c.path.length)) value += 24;
        if (actor.food <= 1 && !isSafeNode(end)) value -= 24;
      }
      if (c.type === 'PLAY_TACTIC' && value > 5) value += 15;
      if (c.type === 'BUY_MARKET' && ['E_PICKAXE','E_MINER_CONTRACT'].includes(view.marketSlots[c.slot] ?? '') && view.round < 12) value += 22;
    }
    if (value > bestScore) { best = action; bestScore = value; }
  }
  return best?.command ?? null;
}
