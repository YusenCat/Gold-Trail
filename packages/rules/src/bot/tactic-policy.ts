import type { LegalAction } from '../actions.ts';
import { isSafeNode } from '../map.ts';
import type { CharacterState, GameState } from '../state.ts';
import type { BotPlan } from './planning.ts';
import { interrogationMarginalValue } from './search-policy.ts';

/** Value a card's immediate effect and the opportunity to keep it for a better turn. */
export function tacticValue(view: GameState, actor: CharacterState, action: LegalAction, plan: BotPlan): number {
  const command = action.command;
  if (command.type !== 'PLAY_TACTIC') return -Infinity;
  const target = command.targetId ? view.characters.find((character) => character.id === command.targetId) : undefined;
  const distance = plan.distance;
  const nearbyThreats = view.characters.filter((character) => character.faction !== actor.faction && !character.deadUntilRound && distance(actor.nodeId, character.nodeId) <= 2).length;
  if (command.cardId === 'T_RESIST_SEARCH') {
    const pending = view.pendingDecision;
    const exposed = pending?.kind === 'response' && pending.responseTo === 'robbery' ? actor.gold + actor.silver : actor.gold;
    return exposed > 0 ? 105 + exposed * 20 : -80;
  }
  if (command.cardId === 'T_MARCH_RATION') {
    const apGain = Math.min(3, Math.max(0, 7 - actor.actionPoints));
    const foodGain = Math.min(2, Math.max(0, (Object.values(actor.equipped).includes('E_BACKPACK') ? 9 : 6) - actor.food));
    const canUseAp = plan.destination !== actor.nodeId || plan.goal === 'mine' || plan.goal === 'intercept';
    return canUseAp && apGain > 0 ? 65 + apGain * 19 + foodGain * 12 : foodGain >= 2 && actor.food <= 1 ? 95 : -80;
  }
  if (command.cardId === 'T_NIGHT_ESCAPE') {
    const end = command.path?.at(-1);
    const progress = end ? distance(actor.nodeId, plan.destination) - distance(end, plan.destination) : 0;
    return progress > 0 ? 70 + progress * 16 + (actor.gold && nearbyThreats ? 30 : 0) : actor.gold && nearbyThreats >= 2 ? 78 : -80;
  }
  if (command.cardId === 'T_LAUNDER') {
    if (!actor.gold || actor.silver <= 0) return -80;
    const checkpoint = view.characters.some((character) => character.faction === 'officer' && distance(actor.nodeId, character.nodeId) <= 3);
    return checkpoint && plan.goal === 'deliver' ? 85 + Math.min(2, actor.gold) * 14 : -80;
  }
  if (command.cardId === 'T_INTERROGATION') {
    if (view.pendingDecision?.kind !== 'askSearchQuestion') return -80;
    const total = view.characters.find((character) => character.id === view.pendingDecision!.targetId)?.gold ?? 0;
    const information = interrogationMarginalValue(view);
    return total >= 3 && information >= 0.15 ? 105 + information * 30 : -80;
  }
  if (!target || target.faction === actor.faction) return -80;
  const visibleHandCount = target.hand.length;
  const nearEnemyDepot = distance(target.nodeId, target.faction === 'smuggler' ? 'BAZAAR' : 'MRG') <= 3;
  const responseDiscount = 1 - Math.min(0.4, visibleHandCount * 0.12);
  if (command.cardId === 'T_ROAD_ROBBERY') {
    const value = target.gold * 21 + target.silver * 8;
    return value > 0 ? 65 + value * responseDiscount : -80;
  }
  if (command.cardId === 'T_PRIVATE_SEARCH') return target.gold >= 2 ? 67 + target.gold * 13 : -80;
  if (command.cardId === 'T_STEAL_CARD') {
    const hubBan = plan.destination === 'HUB' || actor.food <= 2 ? 45 : 0;
    return visibleHandCount ? 68 + Math.min(3, visibleHandCount) * 12 - hubBan : -80;
  }
  if (command.cardId === 'T_HIDDEN_ARROW') {
    const lostFood = target.food - Math.ceil(target.food / 2);
    return target.nextTurnApPenalty >= 2 && lostFood === 0 ? -80 : 72 + lostFood * 8 + target.gold * 5 + (nearEnemyDepot ? 14 : 0) + (!isSafeNode(target.nodeId) && target.food <= 2 ? 18 : 0);
  }
  if (command.cardId === 'T_DRUG_WINE') return target.noTacticsNextTurn ? -80 : 68 + target.gold * 6 + Math.min(3, visibleHandCount) * 6 + (nearEnemyDepot ? 15 : 0);
  if (command.cardId === 'T_CONFUSE') return target.gold >= 3 && nearEnemyDepot ? 88 + target.gold * 5 : -80;
  return -80;
}
