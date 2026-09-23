import test from 'node:test';
import assert from 'node:assert/strict';
import { createInitialGame, startGame, applyCommand, RuleError, edgeKey } from '../src/index.ts';
import { legalActions } from '../src/actions.ts';

function setup() {
  const initial = createInitialGame(123);
  initial.eventDeck = ['V_OFFICER_PATROL'];
  const game = startGame(initial);
  game.characters[0].nodeId = 'E1';
  game.characters[1].nodeId = 'E1';
  game.characters[0].actionPoints = 7;
  return game;
}
function until(game: ReturnType<typeof setup>, id: string) {
  for (let i=0; i<8 && game.activeCharacterId !== id; i++) game = applyCommand(game,{type:'END_TURN',actorId:game.activeCharacterId!});
  return game;
}
test('night escape expires at turn end and is not permanent immunity', () => {
  let game=setup(); game.characters[0].hand=['T_NIGHT_ESCAPE'];
  game=applyCommand(game,{type:'PLAY_TACTIC',actorId:'SMUGGLER_1',cardId:'T_NIGHT_ESCAPE',path:[]});
  assert.ok(game.characters[0].untargetableThisTurn);
  game=applyCommand(game,{type:'END_TURN',actorId:'SMUGGLER_1'});
  assert.equal(game.characters[0].untargetableThisTurn,false);
});
test('drug wine applies to the next actual turn and expires after it', () => {
  let game=setup(); game.characters[0].hand=['T_DRUG_WINE']; game.characters[1].hand=['T_MARCH_RATION'];
  game=applyCommand(game,{type:'PLAY_TACTIC',actorId:'SMUGGLER_1',cardId:'T_DRUG_WINE',targetId:'OFFICER_1'});
  assert.equal(game.characters[1].tacticsBlockedThisTurn,false);
  game=applyCommand(game,{type:'END_TURN',actorId:'SMUGGLER_1'});
  assert.equal(game.characters[1].actionPoints,2);
  assert.throws(()=>applyCommand(game,{type:'PLAY_TACTIC',actorId:'OFFICER_1',cardId:'T_MARCH_RATION'}),RuleError);
  game=applyCommand(game,{type:'END_TURN',actorId:'OFFICER_1'});
  assert.equal(game.characters[1].tacticsBlockedThisTurn,false);
});
test('confuse pauses the target for controller movement or release', () => {
  let game=setup(); game.characters[0].hand=['T_CONFUSE'];
  game=applyCommand(game,{type:'PLAY_TACTIC',actorId:'SMUGGLER_1',cardId:'T_CONFUSE',targetId:'OFFICER_1'});
  game=applyCommand(game,{type:'END_TURN',actorId:'SMUGGLER_1'});
  assert.equal(game.characters[1].actionPoints,5);
  assert.throws(()=>applyCommand(game,{type:'END_TURN',actorId:'OFFICER_1'}),RuleError);
  game=applyCommand(game,{type:'CONTROLLED_MOVE',actorId:'SMUGGLER_1',targetId:'OFFICER_1',path:['E2']});
  game=applyCommand(game,{type:'RELEASE_CONTROL',actorId:'SMUGGLER_1',targetId:'OFFICER_1'});
  assert.equal(game.characters[1].actionPoints,4);
  assert.doesNotThrow(()=>applyCommand(game,{type:'END_TURN',actorId:'OFFICER_1'}));
});
test('a full hand can steal after paying the tactic card', () => {
  const game=setup();game.characters[0].hand=['T_STEAL_CARD','T_RESIST_SEARCH','T_RESIST_SEARCH','T_MARCH_RATION','T_LAUNDER'];game.characters[1].hand=['T_HIDDEN_ARROW'];
  const next=applyCommand(game,{type:'PLAY_TACTIC',actorId:'SMUGGLER_1',cardId:'T_STEAL_CARD',targetId:'OFFICER_1'});
  assert.equal(next.characters[0].hand.length,5);assert.equal(next.characters[1].hand.length,0);assert.equal(next.characters[0].hubEntryBanTurns,3);
});
test('private search cannot be resisted and invalid play is atomic', () => {
  let game=setup(); game.characters[0].hand=['T_PRIVATE_SEARCH']; game.characters[1].hand=['T_RESIST_SEARCH'];
  game=applyCommand(game,{type:'PLAY_TACTIC',actorId:'SMUGGLER_1',cardId:'T_PRIVATE_SEARCH',targetId:'OFFICER_1'});
  const before=structuredClone(game);
  assert.equal(game.pendingDecision?.kind,'splitGold');
  assert.throws(()=>applyCommand(game,{type:'PLAY_TACTIC',actorId:'OFFICER_1',cardId:'T_RESIST_SEARCH'}),RuleError);
  assert.deepEqual(game,before);
});
test('sealed gold survives a robbery once and is then unsealed', () => {
  let game=setup();game.characters[0].hand=['T_LAUNDER'];game.characters[0].gold=4;game.characters[0].silver=1;game.characters[1].hand=['T_ROAD_ROBBERY'];
  game=applyCommand(game,{type:'PLAY_TACTIC',actorId:'SMUGGLER_1',cardId:'T_LAUNDER'});
  game=applyCommand(game,{type:'END_TURN',actorId:'SMUGGLER_1'});
  game=applyCommand(game,{type:'PLAY_TACTIC',actorId:'OFFICER_1',cardId:'T_ROAD_ROBBERY',targetId:'SMUGGLER_1'});
  game=applyCommand(game,{type:'PASS_RESPONSE',actorId:'SMUGGLER_1'});
  assert.equal(game.characters[0].gold,2);assert.equal(game.characters[0].sealedGold,0);assert.equal(game.characters[1].gold,2);
});
test('red hare prices an entire four-edge path at two AP', () => {
  const game=setup();game.characters[0].nodeId='HUB';game.characters[0].mountId='M_RED_HARE';game.characters[0].mountTurnsRemaining=2;
  const next=applyCommand(game,{type:'MOVE',actorId:'SMUGGLER_1',path:['E1','E2','CP_D','E4']});
  assert.equal(next.characters[0].actionPoints,5);
});
test('dilu roll commits once and is deterministic', () => {
  const game=setup();game.characters[0].mountId='M_DILU';game.characters[0].mountTurnsRemaining=2;
  const a=applyCommand(game,{type:'ROLL_DILU',actorId:'SMUGGLER_1'});
  assert.deepEqual(a,applyCommand(game,{type:'ROLL_DILU',actorId:'SMUGGLER_1'}));
  assert.ok(a.characters[0].diluSteps!>=1&&a.characters[0].diluSteps!<=3);
  assert.throws(()=>applyCommand(a,{type:'ROLL_DILU',actorId:'SMUGGLER_1'}),RuleError);
});
test('horse stumble limits free movement as well as ordinary movement', () => {
  const game=setup();game.activeEventId='V_HORSE_STUMBLE';game.characters[0].mountId='M_RED_HARE';game.characters[0].enteredNodesThisTurn=2;game.characters[0].hand=['T_NIGHT_ESCAPE'];
  assert.throws(()=>applyCommand(game,{type:'PLAY_TACTIC',actorId:'SMUGGLER_1',cardId:'T_NIGHT_ESCAPE',path:['E2']}),RuleError);
});
test('gong creates a pre-event window without a horse and reverses turn order', () => {
  let game=createInitialGame(2);game.characters[0].equipped.document='E_TIME_GONG';
  game=startGame(game);assert.equal(game.phase,'preEvent');
  game=applyCommand(game,{type:'USE_EQUIPMENT',actorId:'SMUGGLER_1',cardId:'E_TIME_GONG'});
  game=applyCommand(game,{type:'SKIP_PRE_EVENT',actorId:'SMUGGLER_1'});
  assert.equal(game.activeCharacterId,'OFFICER_2');assert.ok(game.marketDiscard.includes('E_TIME_GONG'));
});
test('road blocks persist across rounds and are discarded only after removal', () => {
  let game=setup();game.characters[0].equipped.trap='E_ROAD_BLOCK';
  game=applyCommand(game,{type:'USE_EQUIPMENT',actorId:'SMUGGLER_1',cardId:'E_ROAD_BLOCK',edgeTo:'E2'});
  assert.ok(!game.marketDiscard.includes('E_ROAD_BLOCK'));
  while(game.round===1)game=applyCommand(game,{type:'END_TURN',actorId:game.activeCharacterId!});
  assert.ok(game.blockedEdges.includes(edgeKey('E1','E2')));
  game=until(game,'SMUGGLER_1');game.characters[0].actionPoints=3;
  game=applyCommand(game,{type:'REMOVE_BLOCK',actorId:'SMUGGLER_1',edgeTo:'E2'});
  assert.equal(game.blockedEdges.length,0);assert.ok(game.marketDiscard.includes('E_ROAD_BLOCK'));
});
test('mine output resets every round and collapse immediately clears contract storage', () => {
  let game=setup();game.mineOutputRemaining=0;game.eventDeck=['V_MINE_COLLAPSE'];game.characters[0].equipped.contract='E_MINER_CONTRACT';game.characters[0].contractGold=4;
  while(game.round===1)game=applyCommand(game,{type:'END_TURN',actorId:game.activeCharacterId!});
  assert.equal(game.mineOutputRemaining,8);assert.equal(game.characters[0].contractGold,0);
});
test('lockbox cannot be used with arbitrary resource fields and unloading restores resources', () => {
  let game=setup();game.characters[0].equipped.container='E_LOCKBOX';game.characters[0].gold=3;
  assert.throws(()=>applyCommand(game,{type:'USE_EQUIPMENT',actorId:'SMUGGLER_1',cardId:'E_LOCKBOX',direction:'deposit',resource:'actionPoints' as 'gold',amount:1}),RuleError);
  game=applyCommand(game,{type:'USE_EQUIPMENT',actorId:'SMUGGLER_1',cardId:'E_LOCKBOX',direction:'deposit',resource:'gold',amount:3});
  game=applyCommand(game,{type:'UNEQUIP',actorId:'SMUGGLER_1',cardId:'E_LOCKBOX'});
  assert.equal(game.characters[0].gold,3);assert.equal(game.characters[0].lockbox.gold,0);
});
test('every initial equipment and tactic has legal enumeration without exceptions', () => {
  const game=setup();game.characters[0].silver=20;
  game.characters[0].hand=['T_MARCH_RATION','T_INTERROGATION','T_HIDDEN_ARROW','T_CONFUSE'];
  for(const a of legalActions(game))assert.doesNotThrow(()=>applyCommand(game,a.command));
});

for (const event of ['V_CLEAR_ROAD','V_LIGHT_SNOW','V_FROZEN_ROAD','V_MERCHANT_SALE','V_HORSE_STUMBLE','V_RUSSIAN_PARTY','V_FOREST_FOG','V_MINE_COLLAPSE','V_BANDIT_RAID','V_POLAR_DAY','V_OFFICER_PATROL']) {
  test('event adjudication: ' + event, () => {
    let initial=createInitialGame(31);
    initial.eventDeck=[event];
    initial.characters[0].nodeId='E1';initial.characters[0].gold=5;
    initial.characters[0].equipped.contract='E_MINER_CONTRACT';initial.characters[0].contractGold=3;
    if(event==='V_HORSE_STUMBLE'){initial.characters[0].mountId='M_RED_HARE';initial.characters[0].mountTurnsRemaining=2;}
    let game=startGame(initial);
    if(event==='V_CLEAR_ROAD'){const before=game.characters[0].actionPoints;game=applyCommand(game,{type:'MOVE',actorId:'SMUGGLER_1',path:['E2','CP_D','E4']});assert.equal(game.characters[0].actionPoints,before-1);}
    if(event==='V_LIGHT_SNOW')assert.equal(game.characters[0].actionPoints,game.characters[0].actionRoll!-1);
    if(event==='V_FROZEN_ROAD')assert.equal(game.characters[0].actionPoints,Math.max(0,game.characters[0].actionRoll!-2));
    if(event==='V_MERCHANT_SALE'){game.characters[0].nodeId='HUB';game.characters[0].silver=3;game.marketSlots[0]='E_TIGER_WINE';game=applyCommand(game,{type:'BUY_MARKET',actorId:'SMUGGLER_1',slot:0});assert.equal(game.characters[0].silver,1);}
    if(event==='V_HORSE_STUMBLE')assert.throws(()=>applyCommand(game,{type:'MOVE',actorId:'SMUGGLER_1',path:['E2','CP_D','E4']}),RuleError);
    if(event==='V_RUSSIAN_PARTY'){const before=game.characters[0].actionPoints;game=applyCommand(game,{type:'FREE_MOVE',actorId:'SMUGGLER_1',path:['E2','CP_D','E4']});assert.equal(game.characters[0].actionPoints,before);assert.equal(game.characters[0].freeMoveAvailableThisTurn,false);}
    if(event==='V_FOREST_FOG'){game=until(game,'OFFICER_1');game.characters[1].nodeId='CP_D';game.characters[0].nodeId='E2';assert.throws(()=>applyCommand(game,{type:'INSPECT',actorId:'OFFICER_1',targetId:'SMUGGLER_1',distance:1}),RuleError);}
    if(event==='V_MINE_COLLAPSE'){assert.equal(game.characters[0].contractGold,0);game.characters[0].nodeId='MINE';assert.throws(()=>applyCommand(game,{type:'MINE',actorId:'SMUGGLER_1'}),RuleError);}
    if(event==='V_BANDIT_RAID')assert.equal(game.characters[0].gold,2);
    if(event==='V_POLAR_DAY'){assert.equal(game.characters[0].actionPoints,Math.min(7,game.characters[0].actionRoll!*2));assert.equal(game.characters[0].food,4);}
    if(event==='V_OFFICER_PATROL'){game=until(game,'OFFICER_1');game.characters[1].nodeId='CP_D';game.characters[0].nodeId='CP_D';const before=game.characters[1].actionPoints;game=applyCommand(game,{type:'INSPECT',actorId:'OFFICER_1',targetId:'SMUGGLER_1',distance:0});assert.equal(game.characters[1].actionPoints,before);}
  });
}
