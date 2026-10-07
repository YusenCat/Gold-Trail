import balanceData from '../../../../content/balance.v1.json' with { type: 'json' };
import cardsData from '../../../../content/cards.v1.json' with { type: 'json' };
import { edgeKey, isAdjacent, isSafeNode } from '../map.ts';
import type { CharacterState, GameState } from '../state.ts';
import { cardById, charge, character, checkWinner, discard, draw, equip, eventActive, fail, foodCapacity, hasCard, isAlive, log, marketPrice, mountIds, randomFor, saveRandom, reshuffleIfNeeded } from './shared.ts';
import { actorForCommand, canUseOfficerRole, canUseSmugglerRole } from './movement.ts';

export function mine(state: GameState, actor: CharacterState): void {
  if (actor.nodeId !== 'MINE') fail('只能在漠河金矿采矿');
  if (eventActive(state, 'V_MINE_COLLAPSE')) fail('矿洞塌方，本轮不能采矿');
  if (state.mineOutputRemaining === 0) fail('本轮矿产已耗尽');
  const factionRemaining = balanceData.mineFactionOutputPerRound - state.mineOutputByFaction[actor.faction];
  if (factionRemaining <= 0) fail('本阵营本轮矿车已满');
  if (actor.mineActionsThisTurn >= balanceData.mineActionsPerCharacterTurn) fail('本回合采矿次数已达上限');
  charge(actor, hasCard(actor, 'E_MINE_MAP') && actor.mineActionsThisTurn === 0 ? 0 : 1);
  const rng = randomFor(state);
  const roll = rng.rollDie(6);
  saveRandom(state, rng);
  let yieldGold = roll <= 2 ? 1 : roll <= 4 ? 2 : 3;
  if (hasCard(actor, 'E_PICKAXE')) yieldGold = Math.ceil(yieldGold * 1.5);
  const gained = Math.min(yieldGold, state.mineOutputRemaining, factionRemaining);
  state.mineOutputRemaining -= gained;
  state.mineOutputByFaction[actor.faction] += gained;
  actor.gold += gained;
  actor.mineActionsThisTurn += 1;
  log(state, 'mine', `${actor.id}采矿掷出 ${roll}，获得 ${gained} 碎金。`);
}

export function exchange(state: GameState, actor: CharacterState, amount: number): void {
  if (actor.exchangedThisTurn) fail('本回合已经兑换');
  if (!Number.isInteger(amount) || amount < 1 || amount > actor.gold) fail('兑换数量无效');
  const permitted = (actor.faction === 'smuggler' && actor.nodeId === 'BAZAAR') || (actor.faction === 'officer' && actor.nodeId === 'MRG');
  if (!permitted) fail('该阵营无法在当前位置兑换');
  charge(actor, 1);
  actor.exchangedThisTurn = true;
  actor.gold -= amount;
  actor.silver += amount;
  state.reputation[actor.faction] += amount;
  log(state, 'exchange', `${actor.id}兑换 ${amount} 碎金，${actor.faction}获得 ${amount} 声望。`);
  checkWinner(state, actor.faction);
}

export function refillFood(state: GameState, actor: CharacterState, source: 'hub' | 'bazaar'): void {
  if (actor.refilledThisTurn) fail('本回合已经补给');
  if (source === 'hub') {
    if (actor.nodeId !== 'HUB') fail('伙房只在二十二驿站可用');
    if (actor.actionPoints < 1) fail('伙房需要至少 1 点行动力');
    actor.actionPoints = 0;
  } else {
    if (actor.nodeId !== 'BAZAAR') fail('粮食贩子只在边境黑市可用');
    if (actor.silver < 1) fail('官银不足');
    charge(actor, 1);
    actor.silver -= 1;
  }
  actor.food = foodCapacity(actor);
  actor.refilledThisTurn = true;
  log(state, 'food', `${actor.id}将粮草补至 ${actor.food}。`);
}

export function tavern(state: GameState, actor: CharacterState, bet: number, guess: 'big' | 'small'): void {
  if (actor.tavernUsedThisTurn) fail('本回合已经使用酒馆');
  if (actor.nodeId !== 'HUB') fail('酒馆只在二十二驿站可用');
  if (!Number.isInteger(bet) || bet < 1 || bet > 3 || actor.silver < bet) fail('下注金额无效');
  charge(actor, 1);
  actor.tavernUsedThisTurn = true;
  actor.silver -= bet;
  const rng = randomFor(state);
  const roll = rng.rollDie(6);
  saveRandom(state, rng);
  const won = (roll <= 3 ? 'small' : 'big') === guess;
  if (won) actor.silver += bet * 2;
  log(state, 'tavern', `${actor.id}在酒馆掷出 ${roll}，${won ? `赢得 ${bet * 2}` : `失去 ${bet}`} 官银。`);
}

export function buyMarket(state: GameState, actor: CharacterState, slot: number): void {
  if (actor.nodeId !== 'HUB') fail('交易市场只在二十二驿站可用');
  if (actor.marketBoughtThisTurn) fail('每回合只能购买一张市场牌');
  if (!Number.isInteger(slot) || slot < 0 || slot >= state.marketSlots.length) fail('市场位置无效');
  const cardId = state.marketSlots[slot];
  if (!cardId) fail('该市场位置为空');
  const cost = marketPrice(state, cardId);
  if (actor.silver < cost) fail('官银不足');
  charge(actor, 1);
  actor.silver -= cost;
  const card = cardById.get(cardId);
  if (!card) fail('未知市场牌');
  if (card.kind === 'equipment') {
    const slotName = 'slot' in card ? card.slot : undefined;
    if (!slotName) fail('装备缺少槽位');
    equip(state, actor, cardId);
  } else {
    if (actor.hand.length >= balanceData.handLimit) fail('手牌已达上限');
    actor.hand.push(cardId);
  }
  state.marketSlots[slot] = draw(state, 'market');
  actor.marketBoughtThisTurn = true;
  log(state, 'buyMarket', `${actor.id}以 ${cost} 官银购买 ${card.name}。`);
}

export function buyBlackMarket(state: GameState, actor: CharacterState): void {
  if (actor.nodeId !== 'BAZAAR') fail('黑市商人只在边境黑市可用');
  if (actor.blackMarketBoughtThisTurn) fail('每回合只能购买一张黑市牌');
  const cost = eventActive(state, 'V_MERCHANT_SALE') ? Math.ceil(balanceData.blackMarketBlindDrawPrice * 0.6) : balanceData.blackMarketBlindDrawPrice;
  if (actor.silver < cost) fail('官银不足');
  if (actor.hand.length >= balanceData.handLimit) fail('手牌已达上限');
  charge(actor, 1);
  actor.silver -= cost;
  const cardId = draw(state, 'blackMarket');
  if (!cardId) fail('黑市牌库为空');
  actor.hand.push(cardId);
  actor.blackMarketBoughtThisTurn = true;
  actor.blackMarketRedrawAvailable = canUseSmugglerRole(actor);
  actor.blackMarketDrawnCardId = cardId;
  log(state, 'buyBlackMarket', `${actor.id}从黑市盲抽一张功能牌。`, [actor.id]);
}

export function rentMount(state: GameState, actor: CharacterState, mountId: string): void {
  if (actor.nodeId !== 'HUB') fail('马厩只在二十二驿站可用');
  if (!mountIds.has(mountId)) fail('未知马匹');
  if (actor.mountId) fail('每名角色只能租一匹马');
  if (state.characters.some((item) => item.mountId === mountId)) fail('该马已被租用');
  const card = cardById.get(mountId);
  const price = card && 'rentalPrice' in card ? card.rentalPrice : null;
  if (typeof price !== 'number' || actor.silver < price) fail('官银不足');
  charge(actor, 1);
  actor.silver -= price;
  actor.mountId = mountId;
  actor.mountTurnsRemaining = balanceData.mountRentalOwnTurns + (hasCard(actor, 'E_HORSE_FEED') ? 1 : 0);
  log(state, 'rentMount', `${actor.id}租借 ${card.name}，租期 ${actor.mountTurnsRemaining} 次自己的回合。`);
}

export function pickUp(state: GameState, actor: CharacterState, gold: number, silver: number, handIds: string[] = [], equipmentIds: string[] = []): void {
  if (actor.pickedUpThisTurn) fail('每回合只能拾取一次');
  if (!Number.isInteger(gold) || !Number.isInteger(silver) || gold < 0 || silver < 0 || !Array.isArray(handIds) || !Array.isArray(equipmentIds) || gold + silver + handIds.length + equipmentIds.length < 1) fail('拾取内容无效');
  const dropped = state.droppedItems[actor.nodeId];
  if (!dropped || gold > dropped.gold || silver > dropped.silver) fail('该地点没有足够的掉落资源');
  if (actor.hand.length + handIds.length > balanceData.handLimit) fail('拾取后手牌将超过上限');
  const removeRequested = (items: string[], requested: string[]): void => {
    const available = [...items];
    for (const id of requested) {
      const index = available.indexOf(id);
      if (index < 0) fail('指定的掉落卡牌不存在');
      available.splice(index, 1);
    }
    items.splice(0, items.length, ...available);
  };
  for (const id of handIds) if (cardById.get(id)?.kind !== 'tactic') fail('只能作为手牌拾取功能牌');
  for (const id of equipmentIds) if (cardById.get(id)?.kind !== 'equipment') fail('只能作为装备拾取装备牌');
  removeRequested(dropped.hand, handIds);
  removeRequested(dropped.equipment, equipmentIds);
  dropped.gold -= gold;
  dropped.silver -= silver;
  actor.gold += gold;
  actor.silver += silver;
  actor.hand.push(...handIds);
  for (const id of equipmentIds) {
    const card = cardById.get(id);
    const slotName = card && 'slot' in card ? card.slot : undefined;
    if (!slotName) fail('装备缺少槽位');
    equip(state, actor, id);
  }
  actor.pickedUpThisTurn = true;
  if (dropped.gold === 0 && dropped.silver === 0 && dropped.hand.length === 0 && dropped.equipment.length === 0) delete state.droppedItems[actor.nodeId];
  log(state, 'pickup', `${actor.id}拾取 ${gold} 碎金、${silver} 官银、${handIds.length} 张功能牌和 ${equipmentIds.length} 件装备。`);
}

export function refreshMarket(state: GameState, actor: CharacterState): void {
  if (!canUseOfficerRole(actor) || actor.nodeId !== 'HUB') fail('只有具有官兵技能且位于二十二驿站的角色可刷新市场');
  if (actor.marketRefreshedThisTurn) fail('每回合只能刷新一次市场');
  for (const cardId of state.marketSlots) if (cardId) discard(state, 'market', cardId);
  state.marketSlots = [];
  for (let i = 0; i < balanceData.marketSlots; i += 1) state.marketSlots.push(draw(state, 'market'));
  actor.marketRefreshedThisTurn = true;
  log(state, 'refreshMarket', `${actor.id}强制刷新市场货物。`);
}

export function redrawBlackMarket(state: GameState, actor: CharacterState, cardId: string): void {
  if (!actor.blackMarketRedrawAvailable || !canUseSmugglerRole(actor)) fail('当前不能重抽黑市牌');
  if (actor.blackMarketDrawnCardId !== cardId) fail('只能重抽本次购买的黑市牌');
  const index = actor.hand.indexOf(cardId);
  if (index < 0) fail('必须弃置刚购得的黑市功能牌');
  actor.hand.splice(index, 1);
  discard(state, 'blackMarket', cardId);
  const replacement = draw(state, 'blackMarket');
  if (!replacement) fail('黑市牌库为空');
  actor.hand.push(replacement);
  actor.blackMarketRedrawAvailable = false;
  log(state, 'blackMarketRedraw', `${actor.id}弃置黑市牌并重抽一张。`, [actor.id]);
}

export function unequipAndDiscard(state: GameState, actor: CharacterState, cardId: string): void {
  const entry = Object.entries(actor.equipped).find(([, id]) => id === cardId);
  if (!entry) fail('角色未装备该牌');
  delete actor.equipped[entry[0]];
  discard(state, 'market', cardId);
}

export function useEquipment(state: GameState, actor: CharacterState, cardId: string, edgeTo?: NodeId, direction?: 'deposit' | 'withdraw', resource?: 'gold' | 'silver', amount?: number): void {
  if (cardId === 'E_TIME_GONG') {
    if (state.phase !== 'preEvent' || !actor.equipped.document || actor.equipped.document !== cardId) fail('时辰铜锣只能在轮前由装备者使用');
    if (state.preEventQueue[0] !== actor.id) fail('请在自己的轮前窗口使用时辰铜锣');
    state.turnOrder.reverse();
    state.preEventQueue = [actor.id, ...state.preEventQueue.slice(1).reverse()];
    unequipAndDiscard(state, actor, cardId);
    log(state, 'equipment', `${actor.id}敲响时辰铜锣，本轮行动顺序反转。`);
    return;
  }
  const activeActor = actorForCommand(state, actor.id);
  if (activeActor !== actor) fail('当前不是该角色的回合');
  if (cardId === 'E_ROAD_BLOCK') {
    if (!actor.equipped.trap || actor.equipped.trap !== cardId || !edgeTo || !isAdjacent(actor.nodeId, edgeTo)) fail('铁索拒马必须布置在当前节点的一条相邻边');
    if (isSafeNode(actor.nodeId)) fail('只能在驿道节点布置拒马');
    charge(actor, 1);
    const key = edgeKey(actor.nodeId, edgeTo);
    if (state.blockedEdges.includes(key)) fail('该道路已经被阻断');
    state.blockedEdges.push(key);
    delete actor.equipped.trap;
    log(state, 'equipment', `${actor.id}在道路 ${key} 布置铁索拒马。`);
    return;
  }
  if (cardId === 'E_LOCKBOX') {
    if (actor.equipped.container !== cardId || !['gold','silver'].includes(resource!) || !['deposit','withdraw'].includes(direction!) || !Number.isInteger(amount) || amount! < 1) fail('密匣操作参数无效');
    charge(actor, 1);
    if (direction === 'deposit') {
      if (actor.lockbox.gold + actor.lockbox.silver + amount > 3 || actor[resource] < amount) fail('密匣容量不足或资源不足');
      actor[resource] -= amount;
      actor.lockbox[resource] += amount;
    } else {
      if (actor.lockbox[resource] < amount) fail('密匣内资源不足');
      actor.lockbox[resource] -= amount;
      actor[resource] += amount;
    }
    log(state, 'equipment', `${actor.id}${direction === 'deposit' ? '存入' : '取出'} ${amount} ${resource === 'gold' ? '碎金' : '官银'}。`);
    return;
  }
  fail('该装备没有可主动使用的效果');
}
