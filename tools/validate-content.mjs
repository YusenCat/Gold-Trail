import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const read = (name) => JSON.parse(readFileSync(new URL(`../content/${name}`, import.meta.url), 'utf8'));
const map = read('map.v1.json');
const cards = read('cards.v1.json');
const balance = read('balance.v1.json');

const nodeIds = new Set(map.nodes.map((node) => node.id));
assert.equal(nodeIds.size, map.nodes.length, 'duplicate map node ID');
for (const route of map.routes) {
  assert.equal(route.nodes.length - 1, route.steps, `${route.id} step count`);
  for (const nodeId of route.nodes) assert(nodeIds.has(nodeId), `unknown node ${nodeId}`);
}
assert(map.routes.some((route) => route.id === 'WEST_SHORTCUT'
  && route.shortcut === true
  && route.nodes.length === 2
  && new Set(route.nodes).has('W2')
  && new Set(route.nodes).has('W4')), 'west shortcut should directly connect W2 and W4');
assert(map.routes.some((route) => route.id === 'WEST_DEPOT_LINK'
  && route.shortcut === true
  && route.nodes.length === 2
  && new Set(route.nodes).has('W4')
  && new Set(route.nodes).has('MRG')), 'west depot link should directly connect W4 and MRG');
const roadNodes = map.nodes.filter((node) => node.type === 'road');
assert(roadNodes.length > map.nodes.length / 2, 'most map spaces should be interactive road encounters');
for (const node of roadNodes) {
  assert(node.site && node.siteName, `${node.id} needs a named landing encounter`);
  assert(['forage','forest','caravan','ruins','signal'].includes(node.site), `${node.id} has an unknown encounter`);
}
for (const nodeId of map.checkpointNodeIds) assert.equal(map.nodes.find((node) => node.id === nodeId)?.type, 'checkpoint', `${nodeId} should be a checkpoint node`);

const neighbors = new Map([...nodeIds].map((id) => [id, new Set()]));
for (const route of map.routes) {
  for (let i = 1; i < route.nodes.length; i += 1) {
    const a = route.nodes[i - 1];
    const b = route.nodes[i];
    neighbors.get(a).add(b);
    neighbors.get(b).add(a);
  }
}

function distance(start, end) {
  const queue = [[start, 0]];
  const visited = new Set([start]);
  for (const [node, steps] of queue) {
    if (node === end) return steps;
    for (const next of neighbors.get(node)) {
      if (!visited.has(next)) {
        visited.add(next);
        queue.push([next, steps + 1]);
      }
    }
  }
  throw new Error(`${start} cannot reach ${end}`);
}

for (const [a, b, expected] of [
  ['HUB', 'MRG', 4],
  ['HUB', 'MINE', 5],
  ['HUB', 'BAZAAR', 5],
  ['MINE', 'BAZAAR', 10],
  ['MINE', 'MRG', 9],
  ['HUB', 'CP_C', 4],
  ['HUB', 'CP_D', 3],
  ['MINE', 'CP_E', 3],
  ['MINE', 'CP_F', 7],
]) {
  assert.equal(distance(a, b), expected, `${a} -> ${b} distance`);
}

const cardIds = new Set(cards.cards.map((card) => card.id));
assert.equal(cardIds.size, cards.cards.length, 'duplicate card ID');
const counts = Object.fromEntries(['tactic', 'equipment', 'mount', 'event', 'role'].map((kind) => [kind, 0]));
const pages = new Set();
for (const card of cards.cards) {
  assert(cardIds.has(card.id));
  assert(card.effectId, `${card.id} lacks effectId`);
  assert(card.name && card.text, `${card.id} lacks text`);
  assert(!pages.has(card.pdfPage), `duplicate PDF page ${card.pdfPage}`);
  pages.add(card.pdfPage);
  counts[card.kind] += 1;
  if (card.kind === 'tactic' || card.kind === 'equipment') {
    assert(Number.isInteger(card.marketPrice) && card.marketPrice > 0, `${card.id} price`);
  }
}
assert.deepEqual(counts, { tactic: 11, equipment: 12, mount: 3, event: 11, role: 2 });
assert.equal(cards.cards.length, 39);
assert.equal(balance.actionPointDieSides, 3);
assert.equal(balance.actionPointDieOffset, 1);
assert.equal(balance.charactersPerTeam * 2, 4);
assert.equal(balance.checkpointDistances.length, balance.checkpointActionPointCosts.length);

const marketCards = counts.tactic * cards.rules.marketTacticCopiesEach
  + counts.equipment * cards.rules.marketEquipmentCopiesEach;
const blackMarketCards = counts.tactic * cards.rules.blackMarketTacticCopiesEach;
assert.equal(marketCards, 23);
assert.equal(blackMarketCards, 22);

console.log(JSON.stringify({
  mapNodes: nodeIds.size,
  interactiveRoadSites: roadNodes.length,
  routes: map.routes.length,
  mapEdges: [...neighbors.values()].reduce((sum, set) => sum + set.size, 0) / 2,
  cardCounts: counts,
  marketCards,
  blackMarketCards,
  distancesVerified: 9,
}, null, 2));
