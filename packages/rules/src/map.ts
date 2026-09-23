import mapData from '../../../content/map.v1.json' with { type: 'json' };

export type NodeId = string;

export interface MapNode {
  id: NodeId;
  type: string;
  label?: string;
  site?: 'forage' | 'forest' | 'caravan' | 'ruins' | 'signal';
  siteName?: string;
  x: number;
  y: number;
}

export interface MapRoute {
  id: string;
  label: string;
  nodes: NodeId[];
  steps: number;
}

const nodes = new Map<string, MapNode>(mapData.nodes.map((node) => [node.id, node]));
const neighbors = new Map<string, Set<string>>(mapData.nodes.map((node) => [node.id, new Set<string>()]));

for (const route of mapData.routes) {
  for (let i = 1; i < route.nodes.length; i += 1) {
    const from = route.nodes[i - 1];
    const to = route.nodes[i];
    neighbors.get(from)?.add(to);
    neighbors.get(to)?.add(from);
  }
}

export function getNode(id: NodeId): MapNode {
  const node = nodes.get(id);
  if (!node) throw new Error(`Unknown map node: ${id}`);
  return node;
}

export function getNeighbors(id: NodeId): NodeId[] {
  getNode(id);
  return [...(neighbors.get(id) ?? [])].sort();
}

export function isAdjacent(a: NodeId, b: NodeId): boolean {
  getNode(a);
  getNode(b);
  return neighbors.get(a)?.has(b) ?? false;
}

export function isSafeNode(id: NodeId): boolean {
  getNode(id);
  return mapData.safeNodeIds.includes(id);
}

export function isCheckpoint(id: NodeId): boolean {
  getNode(id);
  return mapData.checkpointNodeIds.includes(id);
}

export function shortestPath(from: NodeId, to: NodeId, blockedEdges: ReadonlySet<string> = new Set()): NodeId[] | null {
  getNode(from);
  getNode(to);
  const queue: NodeId[] = [from];
  const predecessor = new Map<NodeId, NodeId | null>([[from, null]]);

  for (const node of queue) {
    if (node === to) {
      const path: NodeId[] = [];
      let current: NodeId | null = to;
      while (current !== null) {
        path.push(current);
        current = predecessor.get(current) ?? null;
      }
      return path.reverse();
    }
    for (const next of getNeighbors(node)) {
      if (predecessor.has(next) || blockedEdges.has(edgeKey(node, next))) continue;
      predecessor.set(next, node);
      queue.push(next);
    }
  }
  return null;
}

export function staticDistance(from: NodeId, to: NodeId): number {
  const path = shortestPath(from, to);
  if (!path) throw new Error(`No path between ${from} and ${to}`);
  return path.length - 1;
}

export function edgeKey(a: NodeId, b: NodeId): string {
  if (!isAdjacent(a, b)) throw new Error(`Not an edge: ${a} -> ${b}`);
  return [a, b].sort().join('::');
}

export const mapVersion = mapData.version;
export const mapRoutes: ReadonlyArray<MapRoute> = mapData.routes;
export const mapNodes: ReadonlyArray<MapNode> = mapData.nodes;
