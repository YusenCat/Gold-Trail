import cards from '../../../content/cards.v1.json' with { type: 'json' };
import balance from '../../../content/balance.v1.json' with { type: 'json' };
import type { GameState } from './state.ts';
import type { GameCommand } from './engine.ts';
import { publicView } from './engine.ts';
import { decisionActor, legalActions, type LegalAction } from './actions.ts';
import { shortestPath, isCheckpoint, isSafeNode, edgeKey, getNode } from './map.ts';

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
  return selectFromObservation(view, id, candidates);
}

export function selectFromObservation(view: GameState, id: string, candidates: LegalAction[]): GameCommand | null {
  const actor = view.characters.find((c) => c.id === id)!;
  const depot = actor.faction === 'smuggler' ? 'BAZAAR' : 'MRG';
  const blocked = new Set(view.blockedEdges);
  const distance = (a: string, b: string) => (shortestPath(a, b, blocked)?.length ?? 1000) - 1;
  const gold = actor.gold + actor.sealedGold + actor.lockbox.gold;
  const capacity = Object.values(actor.equipped).includes('E_BACKPACK') ? 9 : 6;
  const enemies = view.characters.filter((c) => c.faction !== actor.faction && !c.deadUntilRound);
  const valuableSmuggler = actor.faction === 'officer'
    ? enemies.filter((c) => c.faction === 'smuggler' && c.gold + c.sealedGold + c.lockbox.gold >= 2)
      .sort((a, b) => (b.gold + b.sealedGold + b.lockbox.gold) - (a.gold + a.sealedGold + a.lockbox.gold) || distance(actor.nodeId, a.nodeId) - distance(actor.nodeId, b.nodeId))[0]
    : undefined;
  const interceptNode = valuableSmuggler
    ? shortestPath(valuableSmuggler.nodeId, 'BAZAAR', blocked)?.find(isCheckpoint) ?? valuableSmuggler.nodeId
    : undefined;
  const victoryLoad = view.mode === 'race' && gold >= 50 - view.reputation[actor.faction];
  const finalDelivery = gold > 0 && view.mode === 'fixedRounds' && 30 - view.round <= Math.ceil(distance(actor.nodeId, depot) / 3) + 1;
  let destination = gold >= 4 || (gold > 0 && (victoryLoad || finalDelivery)) ? depot : 'MINE';
  if (actor.faction === 'officer' && gold === 0 && interceptNode) destination = interceptNode;
  const exhaustedMine = view.activeEventId === 'V_MINE_COLLAPSE' || (view.mineOutputRemaining === 0 && !Object.values(actor.equipped).includes('E_MINE_MAP'));
  if (actor.nodeId === 'MINE' && (actor.mineActionsThisTurn >= 3 || exhaustedMine)) destination = gold > 0 ? depot : 'HUB';
  // Plan for the next safe stop using public distances; never peek at future events.
  const refill = ['HUB', ...(actor.silver > 0 ? ['BAZAAR'] : [])].sort((a,b)=>distance(actor.nodeId,a)-distance(actor.nodeId,b))[0];
  const travelBudget = Math.max(1, actor.actionPoints) * (actor.mountId === 'M_RED_HARE' ? 2 : 1);
  const foodNeeded = Math.max(0, Math.ceil((distance(actor.nodeId, destination) - travelBudget) / 3)) + 1;
  if (actor.food < foodNeeded && actor.nodeId !== depot) destination = refill;
  const progress = (node: string) => distance(actor.nodeId, destination) - distance(node, destination);
  const pending = view.pendingDecision;
  const score = (action: LegalAction): number => {
    const c = action.command;
    if (c.type === 'PASS_RESPONSE') return 5;
    if (c.type === 'SPLIT_GOLD') return 100 - Math.abs(c.boxA - c.boxB);
    if (c.type === 'ASK_SEARCH_QUESTION') return c.question === 'aMoreThanB' ? 90 : c.question === 'aEmpty' ? 80 : 70;
    if (c.type === 'CHOOSE_SEARCH_BOX' && pending?.kind === 'chooseSearchBox') {
      const answers = pending.answers ?? [{ question: pending.question, answer: pending.answer }];
      const total = view.characters.find((t)=>t.id===pending.targetId)!.gold;
      let possible = 0, sumA = 0;
      for(let a=0;a<=total;a++) {
        const b=total-a;
        if(answers.every(({question,answer})=>({aMoreThanB:a>b,aEmpty:a===0,bAtLeast2:b>=2,equal:a===b}[question])===answer)){possible++;sumA+=a;}
      }
      if(possible) return c.box === (sumA / possible >= total / 2 ? 'A' : 'B') ? 100 : 0;
      let preferred = 'A';
      if (pending.question === 'aMoreThanB') preferred = pending.answer ? 'A' : 'B';
      if (pending.question === 'aEmpty') preferred = pending.answer ? 'B' : 'A';
      if (pending.question === 'bAtLeast2') preferred = pending.answer ? 'B' : 'A';
      return c.box === preferred ? 100 : 0;
    }
    if (c.type === 'RELEASE_CONTROL') return 10;
    if (c.type === 'CONTROLLED_MOVE') {
      const target = view.characters.find((t) => t.id === c.targetId)!;
      const goal = target.gold >= 4 ? (target.faction === 'smuggler' ? 'BAZAAR' : 'MRG') : 'MINE';
      return 20 + distance(c.path.at(-1)!, goal) - distance(target.nodeId, goal);
    }
    if (c.type === 'EXCHANGE') return 200;
    if (c.type === 'REFILL_FOOD') return actor.food < capacity && (actor.food <= 3 || (actor.nodeId === 'HUB' && actor.food < 5)) ? 180 : -100;
    if (c.type === 'MINE') return destination === 'MINE' && !victoryLoad && !finalDelivery && !exhaustedMine ? 110 : -100;
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
      return 40 + gain * 4 - cost + encounterBonus + (c.type === 'FREE_MOVE' ? 15 : 0) + (safe ? 5 : 0) + interceptionBonus - (starvationRisk ? 120 : 0) - (gold > 0 ? threats * 2 + checkpointRisk : 0);
    }
    if (c.type === 'ROLL_DILU') return 60;
    if (c.type === 'INSPECT' || c.type === 'MINE_SEARCH') {
      const target = view.characters.find((t) => t.id === c.targetId)!;
      return target.gold > 1 ? 100 + target.gold : -80;
    }
    if (c.type === 'PLAY_TACTIC') {
      const target = 'targetId' in c ? view.characters.find((t) => t.id === c.targetId) : undefined;
      if (c.cardId === 'T_RESIST_SEARCH') return actor.gold + actor.silver > 0 ? 200 : -80;
      if (c.cardId === 'T_MARCH_RATION') return actor.actionPoints <= 4 || actor.food <= 2 ? 190 : -80;
      if (c.cardId === 'T_NIGHT_ESCAPE') return c.path?.length && progress(c.path.at(-1)!) > 0 ? 65 : -80;
      if (c.cardId === 'T_LAUNDER') return actor.gold > 1 && actor.silver > 2 ? 70 : -80;
      if (pending && c.cardId === 'T_INTERROGATION') return 120;
      if (!target || target.faction === actor.faction) return -100;
      if (c.cardId === 'T_ROAD_ROBBERY') return target.gold + target.silver > 0 ? 150 + target.gold : -80;
      if (c.cardId === 'T_PRIVATE_SEARCH') return target.gold > 1 ? 130 : -80;
      if (c.cardId === 'T_STEAL_CARD') return target.hand.length ? 120 : -80;
      if (c.cardId === 'T_HIDDEN_ARROW') return target.nextTurnApPenalty >= 2 && target.food <= 1 ? -80 : 95 + target.gold + (!isSafeNode(target.nodeId) ? 15 : 0);
      if (c.cardId === 'T_DRUG_WINE') return target.noTacticsNextTurn ? -80 : 90 + target.gold + target.hand.length * 3;
      if (c.cardId === 'T_CONFUSE') return target.gold > 0 ? 75 : -80;
      return -80;
    }
    if (c.type === 'BUY_MARKET') {
      const card = cards.cards.find((item) => item.id === view.marketSlots[c.slot])!;
      const basePrice = 'marketPrice' in card ? card.marketPrice : 99;
      const price = view.activeEventId === 'V_MERCHANT_SALE' ? Math.ceil(basePrice * .6) : basePrice;
      if (view.mode === 'fixedRounds' && view.round >= 28) return -80;
      if ('slot' in card && actor.equipped[card.slot]) return -80;
      return actor.silver >= price + 1 && ['E_TIGER_WINE','E_PICKAXE','E_MINER_CONTRACT','E_BACKPACK','T_MARCH_RATION','T_ROAD_ROBBERY','T_RESIST_SEARCH'].includes(card.id) ? 68 : -80;
    }
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
  for (const action of candidates) { const value = score(action); if (value > bestScore) { best = action; bestScore = value; } }
  return best?.command ?? null;
}
