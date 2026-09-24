import test from 'node:test';
import assert from 'node:assert/strict';
import { createInitialGame, edgeKey, getNeighbors, initialTurnOrder, isCheckpoint, isSafeNode, RandomStream, shortestPath, staticDistance } from '../src/index.ts';

test('map has the canonical depot distances', () => {
  assert.equal(staticDistance('HUB', 'MRG'), 4);
  assert.equal(staticDistance('HUB', 'MINE'), 5);
  assert.equal(staticDistance('HUB', 'BAZAAR'), 5);
  assert.equal(staticDistance('MINE', 'BAZAAR'), 10);
  assert.equal(staticDistance('MINE', 'MRG'), 9);
  assert.equal(staticDistance('MINE', 'CP_E'), 3);
  assert.equal(staticDistance('MINE', 'CP_F'), 7);
  assert.equal(isSafeNode('HUB'), true);
  assert.equal(isSafeNode('CP_C'), false);
  assert.equal(isCheckpoint('CP_G'), true);
  assert.deepEqual(getNeighbors('MRG'), ['NW1', 'W4', 'W5']);
  assert.deepEqual(getNeighbors('F1'), ['E2', 'E4']);
});

test('a road block changes legal route but not static distance', () => {
  const blocked = new Set([edgeKey('HUB', 'N1')]);
  assert.equal(staticDistance('HUB', 'BAZAAR'), 5);
  assert.equal(shortestPath('HUB', 'BAZAAR', blocked)?.length, 13);
});

test('same seed yields identical shuffled setup', () => {
  assert.deepEqual(createInitialGame(1234), createInitialGame(1234));
  assert.notDeepEqual(createInitialGame(1234).eventDeck, createInitialGame(1235).eventDeck);
});

test('starting characters and decks match rules', () => {
  const game = createInitialGame(1, 'fixedRounds');
  assert.equal(game.characters.length, 4);
  assert.equal(game.characters.filter((character) => character.faction === 'officer').length, 2);
  assert(game.characters.every((character) => character.nodeId === 'HUB' && character.food === 6));
  assert.equal(game.mineOutputRemaining, 8);
  assert.deepEqual(game.mineOutputByFaction, { smuggler: 0, officer: 0 });
  assert.equal(game.marketSlots.length, 3);
  assert.equal(game.marketDeck.length, 20);
  assert.equal(game.blackMarketDeck.length, 22);
  assert.equal(game.eventDeck.length, 11);
  assert.deepEqual(initialTurnOrder(2), ['OFFICER_1', 'SMUGGLER_1', 'OFFICER_2', 'SMUGGLER_2']);
});

test('random die stream can be replayed', () => {
  const a = new RandomStream(444);
  const b = new RandomStream(444);
  const rollsA = Array.from({ length: 12 }, () => a.rollDie(6));
  const rollsB = Array.from({ length: 12 }, () => b.rollDie(6));
  assert.deepEqual(rollsA, rollsB);
  assert(rollsA.every((roll) => roll >= 1 && roll <= 6));
});
