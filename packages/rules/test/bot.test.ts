import test from 'node:test';
import assert from 'node:assert/strict';
import { createInitialGame, startGame, applyCommand, publicView } from '../src/index.ts';
import { chooseBotCommand } from '../src/bot.ts';
import { legalActions, decisionActor } from '../src/actions.ts';
import { chooseSplit, inspectionValue, questionValue } from '../src/bot/search-policy.ts';
import { createBotPlan } from '../src/bot/planning.ts';

function strategyPosition() {
  const game = startGame(createInitialGame(7));
  game.phase = 'characterTurn';game.activeCharacterId = 'SMUGGLER_1';game.pendingDecision = null;game.activeEventId = null;
  const actor = game.characters.find((c)=>c.id==='SMUGGLER_1')!;
  actor.actionPoints=3;actor.food=6;actor.gold=0;actor.hand=[];
  return {game,actor};
}

test('bot returns with the last point needed to win instead of mining again',()=>{
  const {game,actor}=strategyPosition();actor.nodeId='MINE';actor.gold=1;game.reputation.smuggler=49;
  assert.equal(chooseBotCommand(game)?.type,'MOVE');
});

test('bot resupplies before leaving the hub with insufficient food',()=>{
  const {game,actor}=strategyPosition();actor.food=2;
  assert.equal(chooseBotCommand(game)?.type,'REFILL_FOOD');
});

test('bot avoids spending silver to replace an identical piece of equipment',()=>{
  const {game,actor}=strategyPosition();actor.silver=12;actor.equipped.tool='E_PICKAXE';game.marketSlots=['E_PICKAXE',null,null];
  assert.notEqual(chooseBotCommand(game)?.type,'BUY_MARKET');
});

test('officer uses the free market refresh when no affordable useful item is available',()=>{
  const {game}=strategyPosition();game.activeCharacterId='OFFICER_1';
  const officer=game.characters.find((character)=>character.id==='OFFICER_1')!;
  officer.nodeId='HUB';officer.actionPoints=0;officer.silver=0;
  game.marketSlots=['T_CONFUSE','T_STEAL_CARD','E_LOCKBOX'];
  assert.equal(chooseBotCommand(game)?.type,'REFRESH_MARKET');
});

test('smuggler carrying cargo avoids an occupied checkpoint instead of marching through it',()=>{
  const {game,actor}=strategyPosition();
  actor.nodeId='MINE';actor.gold=4;actor.actionPoints=3;
  game.characters.find((c)=>c.id==='OFFICER_1')!.nodeId='CP_D';
  const command=chooseBotCommand(game);
  assert.equal(command?.type,'MOVE');
  assert.ok(command && 'path' in command && !command.path.includes('CP_D'));
});

test('smuggler buys a discounted black-market card when it can afford the current price',()=>{
  const {game,actor}=strategyPosition();
  actor.nodeId='BAZAAR';actor.silver=2;game.activeEventId='V_MERCHANT_SALE';
  assert.equal(chooseBotCommand(game)?.type,'BUY_BLACK_MARKET');
});

test('smuggler redraws a freshly bought unusable black-market card',()=>{
  const {game,actor}=strategyPosition();
  actor.nodeId='BAZAAR';actor.silver=0;actor.hand=['T_STEAL_CARD'];
  actor.blackMarketDrawnCardId='T_STEAL_CARD';actor.blackMarketRedrawAvailable=true;actor.blackMarketBoughtThisTurn=true;
  assert.equal(chooseBotCommand(game)?.type,'REDRAW_BLACK_MARKET');
});

test('officer abandons mining to occupy the next checkpoint of a valuable smuggler',()=>{
  const {game}=strategyPosition();
  game.activeCharacterId='OFFICER_1';
  const officer=game.characters.find((c)=>c.id==='OFFICER_1')!;
  const smuggler=game.characters.find((c)=>c.id==='SMUGGLER_1')!;
  officer.nodeId='E4';officer.actionPoints=3;officer.gold=0;
  smuggler.nodeId='MINE';smuggler.gold=4;
  const command=chooseBotCommand(game);
  assert.equal(command?.type,'MOVE');
  assert.equal(command && 'path' in command ? command.path.at(-1) : null,'CP_D');
});

test('starving bot takes a reachable safe haven even when it is away from its destination',()=>{
  const {game,actor}=strategyPosition();actor.nodeId='E4';actor.food=0;actor.actionPoints=1;actor.gold=5;
  const command=chooseBotCommand(game);
  assert.equal(command?.type,'MOVE');
  assert.equal(command && 'path' in command ? command.path?.at(-1) : null,'MINE');
});

test('movement previews report authoritative action cost including mount discounts',()=>{
  const {game,actor}=strategyPosition();actor.mountId='M_RED_HARE';actor.mountTurnsRemaining=2;
  const moves=legalActions(game).filter((a)=>a.command.type==='MOVE');
  assert.ok(moves.some((a)=>a.command.type==='MOVE'&&a.command.path.length===4&&a.actionPointCost===2));
  for(const a of moves){const next=applyCommand(game,a.command);assert.equal(a.actionPointCost,actor.actionPoints-next.characters.find((c)=>c.id===actor.id)!.actionPoints);}
});

for (const seed of [7, 19, 41]) test('bots finish a thirty-round game using only legal commands: ' + seed, () => {
  let game = startGame(createInitialGame(seed, 'fixedRounds'));
  let steps = 0;
  while (game.phase !== 'finished' && steps < 2000) {
    const command = chooseBotCommand(game);
    assert.ok(command, 'bot has a legal continuation for ' + decisionActor(game));
    game = applyCommand(game, command);
    for (const actor of game.characters) {
      for (const resource of [actor.gold, actor.silver, actor.food, actor.actionPoints]) assert.ok(Number.isInteger(resource) && resource >= 0);
      assert.ok(actor.hand.length <= 5);
    }
    steps++;
  }
  assert.equal(game.phase, 'finished', 'bot must not loop forever');
  assert.ok(game.reputation.smuggler + game.reputation.officer > 0, 'bots must deliver gold, not only pass');
});

test('bot box choice is unaffected by secret contents and hidden state', () => {
  const game = startGame(createInitialGame(7));
  game.pendingDecision = { kind:'chooseSearchBox', sourceId:'SMUGGLER_1', targetId:'OFFICER_1', sourceKind:'privateSearch', boxA:4, boxB:2, question:'aMoreThanB', answer:true, questionsRemaining:0, askedQuestions:['aMoreThanB'] };
  const altered = structuredClone(game);
  if (altered.pendingDecision?.kind === 'chooseSearchBox') { altered.pendingDecision.boxA = 200; altered.pendingDecision.boxB = 0; }
  altered.rngState = 999;
  altered.marketDeck.reverse();
  altered.characters.find((c) => c.id === 'OFFICER_1')!.hand = ['T_RESIST_SEARCH'];
  assert.deepEqual(chooseBotCommand(game), chooseBotCommand(altered));
  const projected = publicView(game, 'smuggler');
  assert.ok(projected.pendingDecision && 'boxA' in projected.pendingDecision && Number.isNaN(projected.pendingDecision.boxA));
  assert.deepEqual(projected.marketDeck, []);
});

test('bot combines both truthful answers rather than forgetting the first one',()=>{
  const {game}=strategyPosition();game.characters.find((c)=>c.id==='OFFICER_1')!.gold=6;
  game.pendingDecision={kind:'chooseSearchBox',sourceId:'SMUGGLER_1',targetId:'OFFICER_1',sourceKind:'privateSearch',boxA:2,boxB:4,question:'aEmpty',answer:false,questionsRemaining:0,askedQuestions:['aMoreThanB','aEmpty'],answers:[{question:'aMoreThanB',answer:false},{question:'aEmpty',answer:false}]};
  assert.deepEqual(chooseBotCommand(game),{type:'CHOOSE_SEARCH_BOX',actorId:'SMUGGLER_1',box:'B'});
});

test('balanced box splits vary across public decision states without using hidden data',()=>{
  const {game,actor}=strategyPosition();actor.gold=6;
  game.pendingDecision={kind:'splitGold',sourceId:'OFFICER_1',targetId:actor.id,sourceKind:'inspection'};
  const actions=legalActions(game);
  const choices=new Set<number>();
  for(let revision=1;revision<=24;revision++){
    game.revision=revision;
    const picked=chooseSplit(publicView(game,'smuggler'),actor.id,actions)?.command;
    assert.equal(picked?.type,'SPLIT_GOLD');
    if(picked?.type==='SPLIT_GOLD'){
      assert.ok(Math.abs(picked.boxA-picked.boxB)<=2);
      choices.add(picked.boxA);
    }
  }
  assert.ok(choices.size>1);
});

test('search estimates account for question value, AP cost and inspection streak',()=>{
  const {game,actor}=strategyPosition();
  const target=game.characters.find((character)=>character.id==='OFFICER_1')!;
  target.gold=5;
  game.pendingDecision={kind:'askSearchQuestion',sourceId:actor.id,targetId:target.id,sourceKind:'privateSearch',boxA:2,boxB:3,interrogationUsed:false,askedQuestions:[]};
  assert.ok(questionValue(publicView(game,'smuggler'),'aMoreThanB')>=2.5);
  const fresh=inspectionValue(actor,target,1,'INSPECT');
  actor.successiveSuccessfulInspections=2;
  assert.ok(inspectionValue(actor,target,1,'INSPECT')<fresh);
  assert.ok(inspectionValue(actor,target,3,'INSPECT')<inspectionValue(actor,target,1,'INSPECT'));
});

test('short plan changes from mining to delivery as cargo grows',()=>{
  const {game,actor}=strategyPosition();actor.nodeId='MINE';actor.gold=1;
  assert.equal(createBotPlan(publicView(game,'smuggler'),actor).goal,'mine');
  actor.gold=5;
  assert.equal(createBotPlan(publicView(game,'smuggler'),actor).goal,'deliver');
});

test('all enumerated moves pass through the same rule engine without changing the source', () => {
  const game = startGame(createInitialGame(18));
  const before = structuredClone(game);
  for (const action of legalActions(game)) applyCommand(game, action.command);
  assert.deepEqual(game, before);
});

test('bots reach the fifty-reputation race finish without external intervention', () => {
  let game = startGame(createInitialGame(19, 'race'));
  let steps = 0;
  while (game.phase !== 'finished' && steps < 2500) {
    const command = chooseBotCommand(game);
    assert.ok(command);
    game = applyCommand(game, command); steps++;
  }
  assert.equal(game.phase, 'finished');
  assert.ok(Math.max(game.reputation.smuggler, game.reputation.officer) >= 50);
});
