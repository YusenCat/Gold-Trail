import test from 'node:test';
import assert from 'node:assert/strict';
import { applyCommand, createInitialGame, RuleError, startGame } from '../src/index.ts';
import { legalActions } from '../src/actions.ts';

function started(seed = 7) {
  return startGame(createInitialGame(seed));
}

function endUntil(game: ReturnType<typeof started>, characterId: string) {
  let current = game;
  while (current.activeCharacterId !== characterId) {
    current = applyCommand(current, { type: 'END_TURN', actorId: current.activeCharacterId! });
  }
  return current;
}

test('game begins with event, supply and first active character', () => {
  const game = started();
  assert.equal(game.phase, 'characterTurn');
  assert.equal(game.activeCharacterId, 'SMUGGLER_1');
  assert.equal(game.characters[0].actionPoints >= 0, true);
  assert.equal(game.activeEventId !== null, true);
});

test('action dice are replayable and grant 2–4 base AP', () => {
  const rolls = new Set<number>();
  for (let seed = 1; seed <= 48; seed += 1) {
    const a = started(seed);
    const b = started(seed);
    const roll = a.characters.find((item) => item.id === a.activeCharacterId)!.actionRoll;
    assert.ok(roll !== null && roll >= 2 && roll <= 4);
    assert.equal(roll, b.characters.find((item) => item.id === b.activeCharacterId)!.actionRoll);
    assert.match(a.log.find((entry) => entry.type === 'turnStart')!.message, /掷出 [234] 点行动骰/);
    rolls.add(roll);
  }
  assert.deepEqual([...rolls].sort(), [2, 3, 4]);
});

test('landing at a marked route site triggers one replayable encounter per character turn', () => {
  const base = started(119);
  const actor = base.characters.find((item) => item.id === 'SMUGGLER_1')!;
  actor.actionPoints = 7;
  const moved = applyCommand(base, { type: 'MOVE', actorId: actor.id, path: ['W1'] });
  const replay = applyCommand(base, { type: 'MOVE', actorId: actor.id, path: ['W1'] });
  assert.deepEqual(moved.log.at(-1), replay.log.at(-1));
  assert.equal(moved.log.filter((entry) => entry.type === 'siteEncounter').length, 1);
  let returned = applyCommand(moved, { type: 'MOVE', actorId: actor.id, path: ['HUB'] });
  returned = applyCommand(returned, { type: 'MOVE', actorId: actor.id, path: ['W1'] });
  assert.equal(returned.log.filter((entry) => entry.type === 'siteEncounter').length, 1);
  assert.ok(returned.characters.find((item) => item.id === actor.id)!.siteVisitsThisTurn.includes('W1'));
});

test('a full food pouch does not claim to gain food from a landing encounter', () => {
  let checked = false;
  for (let seed = 1; seed <= 48 && !checked; seed += 1) {
    const game = started(seed);
    const actor = game.characters.find((item) => item.id === 'SMUGGLER_1')!;
    actor.food = 6;
    actor.actionPoints = 7;
    const moved = applyCommand(game, { type: 'MOVE', actorId: actor.id, path: ['W1'] });
    const encounter = moved.log.find((entry) => entry.type === 'siteEncounter');
    if (encounter?.message.includes('粮草已满')) {
      assert.equal(moved.characters.find((item) => item.id === actor.id)!.food, 6);
      checked = true;
    }
  }
  assert.equal(checked, true, 'test seeds should cover a capped food outcome');
});

test('movement validates adjacency and pays the correct AP', () => {
  const game = started();
  const moved = applyCommand(game, { type: 'MOVE', actorId: 'SMUGGLER_1', path: ['E1'] });
  assert.equal(moved.characters[0].nodeId, 'E1');
  assert.equal(moved.characters[0].actionPoints, game.characters[0].actionPoints - 1);
  assert.throws(() => applyCommand(game, { type: 'MOVE', actorId: 'SMUGGLER_1', path: ['MINE'] }), RuleError);
});

test('mine is server-random but replayable with fixed seed', () => {
  const base = started(41);
  const smuggler = base.characters.find((item) => item.id === 'SMUGGLER_1')!;
  smuggler.nodeId = 'MINE';
  const a = applyCommand(base, { type: 'MINE', actorId: 'SMUGGLER_1' });
  const b = applyCommand(base, { type: 'MINE', actorId: 'SMUGGLER_1' });
  assert.deepEqual(a, b);
  assert.equal(a.characters.find((item) => item.id === 'SMUGGLER_1')!.gold >= 1, true);
});

test('mine output reserves an equal four-gold convoy quota for each faction', () => {
  let game = started(42);
  const smuggler = game.characters.find((item) => item.id === 'SMUGGLER_1')!;
  smuggler.nodeId = 'MINE';
  smuggler.actionPoints = 6;
  game.mineOutputByFaction.smuggler = 4;
  game.activeCharacterId = smuggler.id;
  assert.throws(() => applyCommand(game, { type: 'MINE', actorId: smuggler.id }), /本阵营本轮矿车已满/);
  const officer = game.characters.find((item) => item.id === 'OFFICER_1')!;
  officer.nodeId = 'MINE';
  officer.actionPoints = 6;
  game.activeCharacterId = officer.id;
  const mined = applyCommand(game, { type: 'MINE', actorId: officer.id });
  assert.equal(mined.mineOutputByFaction.officer >= 1, true);
  assert.equal(mined.mineOutputByFaction.smuggler, 4);
});

test('officer inspection uses split, question and choose phases', () => {
  let game = started(19);
  game = endUntil(game, 'OFFICER_1');
  const officer = game.characters.find((item) => item.id === 'OFFICER_1')!;
  const smuggler = game.characters.find((item) => item.id === 'SMUGGLER_1')!;
  officer.nodeId = 'CP_D';
  officer.actionPoints = 3;
  smuggler.nodeId = 'E2';
  smuggler.gold = 3;
  game = applyCommand(game, { type: 'INSPECT', actorId: 'OFFICER_1', targetId: 'SMUGGLER_1', distance: 1 });
  assert.equal(game.pendingDecision?.kind, 'response');
  game = applyCommand(game, { type: 'PASS_RESPONSE', actorId: 'SMUGGLER_1' });
  assert.equal(game.pendingDecision?.kind, 'splitGold');
  game = applyCommand(game, { type: 'SPLIT_GOLD', actorId: 'SMUGGLER_1', boxA: 2, boxB: 1 });
  game = applyCommand(game, { type: 'ASK_SEARCH_QUESTION', actorId: 'OFFICER_1', question: 'aMoreThanB' });
  assert.equal(game.pendingDecision?.kind, 'chooseSearchBox');
  game = applyCommand(game, { type: 'CHOOSE_SEARCH_BOX', actorId: 'OFFICER_1', box: 'A' });
  assert.equal(game.pendingDecision, null);
  assert.equal(game.characters.find((item) => item.id === 'SMUGGLER_1')!.gold, 1);
  assert.equal(game.characters.find((item) => item.id === 'OFFICER_1')!.gold, 2);
  assert.equal(game.characters.find((item) => item.id === 'OFFICER_1')!.nextTurnApPenalty, 1);
});

test('split boxes reject malformed, fractional and out-of-range values', () => {
  let game = started(91);
  game = endUntil(game, 'OFFICER_1');
  const officer = game.characters.find((item) => item.id === 'OFFICER_1')!;
  const smuggler = game.characters.find((item) => item.id === 'SMUGGLER_1')!;
  officer.nodeId = 'CP_D'; officer.actionPoints = 3; smuggler.nodeId = 'E2'; smuggler.gold = 3;
  game = applyCommand(game, { type: 'INSPECT', actorId: officer.id, targetId: smuggler.id, distance: 1 });
  game = applyCommand(game, { type: 'PASS_RESPONSE', actorId: smuggler.id });
  assert.throws(() => applyCommand(game, { type: 'SPLIT_GOLD', actorId: smuggler.id, boxA: Number.NaN, boxB: 3 }), /分箱数量无效/);
  assert.throws(() => applyCommand(game, { type: 'SPLIT_GOLD', actorId: smuggler.id, boxA: 1.5, boxB: 1.5 }), /分箱数量无效/);
  assert.throws(() => applyCommand(game, { type: 'SPLIT_GOLD', actorId: smuggler.id, boxA: 4, boxB: 0 }), /两箱碎金必须等于/);
  assert.throws(() => applyCommand(game, { type: 'SPLIT_GOLD', actorId: smuggler.id, boxA: '2' as never, boxB: 1 }), /分箱数量无效/);
});

test('hunger death drops resources and revives next round at hub', () => {
  let game = started(33);
  const target = game.characters.find((item) => item.id === 'SMUGGLER_1')!;
  target.nodeId = 'E1';
  target.food = 0;
  target.gold = 2;
  target.silver = 1;
  while (game.round < 3) game = applyCommand(game, { type: 'END_TURN', actorId: game.activeCharacterId! });
  const revived = game.characters.find((item) => item.id === 'SMUGGLER_1')!;
  assert.equal(revived.nodeId, 'HUB');
  assert.equal(revived.food, 3);
  assert.equal(game.droppedItems.E1.gold, 2);
  assert.equal(game.droppedItems.E1.silver, 1);
});

test('a character can collect dropped resources once per turn', () => {
  const game = started(55);
  const actor = game.characters.find((item) => item.id === 'SMUGGLER_1')!;
  actor.nodeId = 'E1';
  actor.silver = 0;
  game.droppedItems.E1 = { gold: 2, silver: 1, hand: [], equipment: [] };
  const picked = applyCommand(game, { type: 'PICK_UP', actorId: actor.id, gold: 2, silver: 1 });
  const updated = picked.characters.find((item) => item.id === actor.id)!;
  assert.equal(updated.gold, 2);
  assert.equal(updated.silver, 1);
  assert.equal(picked.droppedItems.E1, undefined);
  assert.throws(() => applyCommand(picked, { type: 'PICK_UP', actorId: actor.id, gold: 1, silver: 0 }), RuleError);
});

test('a single pickup can recover dropped tactics and equip dropped equipment', () => {
  const game = started(56);
  const actor = game.characters.find((item) => item.id === 'SMUGGLER_1')!;
  actor.nodeId = 'E1';
  game.droppedItems.E1 = { gold: 1, silver: 2, hand: ['T_MARCH_RATION'], equipment: ['E_BACKPACK'] };
  const picked = applyCommand(game, { type: 'PICK_UP', actorId: actor.id, gold: 1, silver: 2, handIds: ['T_MARCH_RATION'], equipmentIds: ['E_BACKPACK'] });
  const updated = picked.characters.find((item) => item.id === actor.id)!;
  assert.deepEqual(updated.hand, ['T_MARCH_RATION']);
  assert.equal(updated.equipped.bag, 'E_BACKPACK');
  assert.equal(picked.droppedItems.E1, undefined);
});

test('resist search cancels a robbery during its response window', () => {
  const game = started(57);
  const source = game.characters.find((item) => item.id === 'SMUGGLER_1')!;
  const target = game.characters.find((item) => item.id === 'OFFICER_1')!;
  source.nodeId = 'E1'; target.nodeId = 'E1';
  source.hand = ['T_ROAD_ROBBERY'];
  target.hand = ['T_RESIST_SEARCH'];
  target.gold = 3; target.silver = 2;
  const opened = applyCommand(game, { type: 'PLAY_TACTIC', actorId: source.id, cardId: 'T_ROAD_ROBBERY', targetId: target.id });
  assert.equal(opened.pendingDecision?.kind, 'response');
  const resolved = applyCommand(opened, { type: 'PLAY_TACTIC', actorId: target.id, cardId: 'T_RESIST_SEARCH' });
  assert.equal(resolved.pendingDecision, null);
  assert.equal(resolved.characters.find((item) => item.id === target.id)!.gold, 3);
  assert.equal(resolved.characters.find((item) => item.id === source.id)!.nextTurnApPenalty, 2);
});

test('a human response window enumerates the held resist card as a playable decision', () => {
  let game = started(59);
  game = endUntil(game, 'OFFICER_1');
  const officer = game.characters.find((item) => item.id === 'OFFICER_1')!;
  const smuggler = game.characters.find((item) => item.id === 'SMUGGLER_1')!;
  officer.nodeId = 'CP_D'; officer.actionPoints = 3;
  smuggler.nodeId = 'E2'; smuggler.gold = 2; smuggler.hand = ['T_RESIST_SEARCH'];
  game = applyCommand(game, { type: 'INSPECT', actorId: officer.id, targetId: smuggler.id, distance: 1 });
  assert.equal(legalActions(game).some((action) => action.command.type === 'PLAY_TACTIC' && action.command.cardId === 'T_RESIST_SEARCH'), true);
});

test('interrogation during a search permits a second distinct question', () => {
  let game = started(58);
  game = endUntil(game, 'OFFICER_1');
  const officer = game.characters.find((item) => item.id === 'OFFICER_1')!;
  const smuggler = game.characters.find((item) => item.id === 'SMUGGLER_1')!;
  officer.nodeId = 'CP_D'; officer.actionPoints = 3; officer.hand = ['T_INTERROGATION'];
  smuggler.nodeId = 'E2'; smuggler.gold = 3;
  game = applyCommand(game, { type: 'INSPECT', actorId: officer.id, targetId: smuggler.id, distance: 1 });
  game = applyCommand(game, { type: 'PASS_RESPONSE', actorId: smuggler.id });
  game = applyCommand(game, { type: 'SPLIT_GOLD', actorId: smuggler.id, boxA: 2, boxB: 1 });
  game = applyCommand(game, { type: 'PLAY_TACTIC', actorId: officer.id, cardId: 'T_INTERROGATION' });
  game = applyCommand(game, { type: 'ASK_SEARCH_QUESTION', actorId: officer.id, question: 'aMoreThanB' });
  assert.throws(() => applyCommand(game, { type: 'CHOOSE_SEARCH_BOX', actorId: officer.id, box: 'A' }), RuleError);
  assert.equal(game.characters.find((item) => item.id === smuggler.id)!.gold, 3);
  assert.throws(() => applyCommand(game, { type: 'ASK_SEARCH_QUESTION', actorId: officer.id, question: 'aMoreThanB' }), RuleError);
  game = applyCommand(game, { type: 'ASK_SEARCH_QUESTION', actorId: officer.id, question: 'aEmpty' });
  assert.deepEqual(game.pendingDecision && 'answers' in game.pendingDecision ? game.pendingDecision.answers : null, [{question:'aMoreThanB',answer:true},{question:'aEmpty',answer:false}]);
  game = applyCommand(game, { type: 'CHOOSE_SEARCH_BOX', actorId: officer.id, box: 'B' });
  assert.equal(game.pendingDecision, null);
  assert.equal(game.characters.find((item) => item.id === officer.id)!.gold, 1);
  assert.equal(game.characters.find((item) => item.id === smuggler.id)!.gold, 2);
});

test('officer market refresh replaces all slots without AP cost', () => {
  const game = started(67);
  let officerTurn = endUntil(game, 'OFFICER_1');
  const officer = officerTurn.characters.find((item) => item.id === 'OFFICER_1')!;
  officer.nodeId = 'HUB';
  const before = [...officerTurn.marketSlots];
  officerTurn = applyCommand(officerTurn, { type: 'REFRESH_MARKET', actorId: officer.id });
  assert.equal(officerTurn.characters.find((item) => item.id === officer.id)!.actionPoints, officer.actionPoints);
  assert.equal(officerTurn.characters.find((item) => item.id === officer.id)!.marketRefreshedThisTurn, true);
  assert.equal(officerTurn.marketSlots.length, 3);
  assert.notDeepEqual(officerTurn.marketSlots, before);
});

test('merchant sale discounts black market and redraw only accepts the purchased card', () => {
  let game = started(77);
  const actor = game.characters.find((c) => c.id === 'SMUGGLER_1')!;
  actor.nodeId = 'BAZAAR';
  actor.silver = 2;
  actor.actionPoints = 3;
  actor.hand = ['T_HIDDEN_ARROW'];
  game.activeEventId = 'V_MERCHANT_SALE';
  game.blackMarketDeck = ['T_MARCH_RATION', 'T_NIGHT_ESCAPE'];
  game = applyCommand(game, { type: 'BUY_BLACK_MARKET', actorId: actor.id });
  assert.equal(game.characters.find((c) => c.id === actor.id)!.silver, 0);
  assert.throws(() => applyCommand(game, { type: 'REDRAW_BLACK_MARKET', actorId: actor.id, cardId: 'T_HIDDEN_ARROW' }), RuleError);
  game = applyCommand(game, { type: 'REDRAW_BLACK_MARKET', actorId: actor.id, cardId: 'T_MARCH_RATION' });
  assert.deepEqual(game.characters.find((c) => c.id === actor.id)!.hand, ['T_HIDDEN_ARROW', 'T_NIGHT_ESCAPE']);
  assert.throws(() => applyCommand(game, { type: 'REDRAW_BLACK_MARKET', actorId: actor.id, cardId: 'T_NIGHT_ESCAPE' }), RuleError);
});
