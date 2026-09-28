import balanceData from '../../../../content/balance.v1.json' with { type: 'json' };
import cardsData from '../../../../content/cards.v1.json' with { type: 'json' };
import { RandomStream } from '../random.ts';
import type { CharacterState, Faction, GameState } from '../state.ts';

export class RuleError extends Error {}
export const cardById = new Map(cardsData.cards.map((card) => [card.id, card]));
export const mountIds = new Set(cardsData.cards.filter((card) => card.kind === 'mount').map((card) => card.id));

export function copy<T>(value: T): T {
  return structuredClone(value);
}

export function fail(message: string): never {
  throw new RuleError(message);
}

export function character(state: GameState, id: string): CharacterState {
  const result = state.characters.find((item) => item.id === id);
  if (!result) fail(`未知角色：${id}`);
  return result;
}

export function isAlive(item: CharacterState): boolean {
  return item.deadUntilRound === null;
}

export function log(state: GameState, type: string, message: string, visibility: 'public' | string[] = 'public'): void {
  state.log.push({ id: state.log.length + 1, round: state.round, type, message, visibility });
}

export function charge(actor: CharacterState, ap: number): void {
  if (!Number.isInteger(ap) || ap < 0 || actor.actionPoints < ap) fail('行动点不足');
  actor.actionPoints -= ap;
}

export function hasCard(actor: CharacterState, id: string): boolean {
  return actor.hand.includes(id) || Object.values(actor.equipped).includes(id);
}

export function foodCapacity(actor: CharacterState): number {
  return balanceData.baseFoodCapacity + (hasCard(actor, 'E_BACKPACK') ? 3 : 0);
}

export function equip(state: GameState, actor: CharacterState, cardId: string): void {
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

export function eventActive(state: GameState, id: string): boolean {
  return state.activeEventId === id;
}

export function randomFor(state: GameState): RandomStream {
  return new RandomStream(state.rngState);
}

export function saveRandom(state: GameState, rng: RandomStream): void {
  state.rngState = rng.getState();
}

export function reshuffleIfNeeded(state: GameState, deck: 'market' | 'blackMarket' | 'event'): void {
  const deckKey = `${deck}Deck` as const;
  const discardKey = `${deck}Discard` as const;
  if (state[deckKey].length || !state[discardKey].length) return;
  const rng = randomFor(state);
  state[deckKey] = rng.shuffle(state[discardKey]);
  state[discardKey] = [];
  saveRandom(state, rng);
}

export function draw(state: GameState, deck: 'market' | 'blackMarket' | 'event'): string | null {
  reshuffleIfNeeded(state, deck);
  const deckKey = `${deck}Deck` as const;
  return state[deckKey].shift() ?? null;
}

export function discard(state: GameState, deck: 'market' | 'blackMarket' | 'event', cardId: string): void {
  const discardKey = `${deck}Discard` as const;
  state[discardKey].push(cardId);
}

export function marketPrice(state: GameState, cardId: string): number {
  const card = cardById.get(cardId);
  if (!card || !('marketPrice' in card) || typeof card.marketPrice !== 'number') fail('市场卡数据错误');
  const eventPrice = eventActive(state, 'V_MERCHANT_SALE') ? Math.ceil(card.marketPrice * 0.6) : card.marketPrice;
  const openingDiscount = state.round === 1 ? (balanceData.openingMarketDiscount || 0) : 0;
  return Math.max(1, eventPrice - openingDiscount);
}

export function checkWinner(state: GameState, faction: Faction): void {
  if (state.mode === 'race' && state.reputation[faction] >= balanceData.raceReputationTarget) {
    state.winner = faction;
    state.phase = 'finished';
    state.activeCharacterId = null;
    state.pendingDecision = null;
    log(state, 'victory', `${faction === 'smuggler' ? '走私者' : '官兵'}达到 ${balanceData.raceReputationTarget} 声望并获胜。`);
  }
}
