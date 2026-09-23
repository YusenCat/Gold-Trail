import balanceData from '../../../content/balance.v1.json' with { type: 'json' };
import cardsData from '../../../content/cards.v1.json' with { type: 'json' };
import { mapVersion, type NodeId } from './map.ts';
import { RandomStream } from './random.ts';

export type Faction = 'smuggler' | 'officer';
export type Mode = 'race' | 'fixedRounds';
export type Phase = 'preEvent' | 'eventReveal' | 'supply' | 'characterTurn' | 'roundEnd' | 'finished';
export type SearchQuestion = 'aMoreThanB' | 'aEmpty' | 'bAtLeast2' | 'equal';
export type PendingDecision =
  | {
    kind: 'response';
    sourceId: string;
    targetId: string;
    responseTo: 'search' | 'robbery';
    sourceKind: 'inspection' | 'mineSearch' | 'privateSearch';
  }
  | {
    kind: 'splitGold';
    sourceId: string;
    targetId: string;
    sourceKind: 'inspection' | 'mineSearch' | 'privateSearch';
  }
  | {
    kind: 'askSearchQuestion';
    sourceId: string;
    targetId: string;
    sourceKind: 'inspection' | 'mineSearch' | 'privateSearch';
    boxA: number;
    boxB: number;
    interrogationUsed: boolean;
    askedQuestions: SearchQuestion[];
    answers?: Array<{ question: SearchQuestion; answer: boolean }>;
  }
  | {
    kind: 'chooseSearchBox';
    sourceId: string;
    targetId: string;
    sourceKind: 'inspection' | 'mineSearch' | 'privateSearch';
    boxA: number;
    boxB: number;
    question: SearchQuestion;
    answer: boolean;
    questionsRemaining: number;
    askedQuestions: SearchQuestion[];
    answers?: Array<{ question: SearchQuestion; answer: boolean }>;
  };

export interface GameLogEntry {
  id: number;
  round: number;
  type: string;
  message: string;
  visibility: 'public' | string[];
}

export interface DroppedItems {
  gold: number;
  silver: number;
  hand: string[];
  equipment: string[];
}

export interface CharacterState {
  id: string;
  faction: Faction;
  seat: number;
  nodeId: NodeId;
  food: number;
  gold: number;
  silver: number;
  actionPoints: number;
  actionRoll: number | null;
  siteVisitsThisTurn: NodeId[];
  hand: string[];
  equipped: Record<string, string>;
  mountId: string | null;
  mountTurnsRemaining: number;
  deadUntilRound: number | null;
  successiveSuccessfulInspections: number;
  nextTurnApPenalty: number;
  noTacticsNextTurn: boolean;
  tacticsBlockedThisTurn: boolean;
  diluSteps: number | null;
  contractCollectedThisTurn: boolean;
  tavernUsedThisTurn: boolean;
  mineSearchedThisTurn: boolean;
  exchangedThisTurn: boolean;
  soldThisTurn: boolean;
  refilledThisTurn: boolean;
  searchProtectedUntilRound: number | null;
  sealedGold: number;
  lockbox: { gold: number; silver: number };
  firstMoveUsedThisTurn: boolean;
  enteredNodesThisTurn: number;
  tacticsPlayedThisTurn: number;
  mineActionsThisTurn: number;
  inspectedThisTurn: boolean;
  marketBoughtThisTurn: boolean;
  blackMarketBoughtThisTurn: boolean;
  blackMarketRedrawAvailable: boolean;
  blackMarketDrawnCardId: string | null;
  pickedUpThisTurn: boolean;
  marketRefreshedThisTurn: boolean;
  freeMoveAvailableThisTurn: boolean;
  hubEntryBanTurns: number;
  controlledMovementAp: number;
  controlledById: string | null;
  contractGold: number;
  untargetableThisTurn: boolean;
}

export interface GameState {
  schemaVersion: '1.0.0';
  rulesVersion: '1.1.0';
  mapVersion: string;
  cardVersion: string;
  balanceVersion: string;
  mode: Mode;
  session: { kind: 'hotseat' | 'solo'; humanFaction: Faction };
  revision: number;
  round: number;
  phase: Phase;
  activeCharacterId: string | null;
  turnOrder: string[];
  turnIndex: number;
  preEventQueue: string[];
  pendingDecision: PendingDecision | null;
  rngState: number;
  characters: CharacterState[];
  reputation: Record<Faction, number>;
  mineOutputRemaining: number;
  mineOutputByFaction: Record<Faction, number>;
  marketSlots: Array<string | null>;
  marketDeck: string[];
  marketDiscard: string[];
  blackMarketDeck: string[];
  blackMarketDiscard: string[];
  eventDeck: string[];
  eventDiscard: string[];
  activeEventId: string | null;
  eventRoadAtReveal: string[];
  eventMountedAtReveal: string[];
  blockedEdges: string[];
  droppedItems: Record<NodeId, DroppedItems>;
  winner: Faction | 'draw' | null;
  log: GameLogEntry[];
}

function copies(kind: string, count: number): string[] {
  return cardsData.cards.filter((card) => card.kind === kind).flatMap((card) => Array(count).fill(card.id));
}

export function initialTurnOrder(round: number): string[] {
  if (!Number.isInteger(round) || round < 1) throw new Error('round must be a positive integer');
  return round % 2 === 1
    ? ['SMUGGLER_1', 'OFFICER_1', 'SMUGGLER_2', 'OFFICER_2']
    : ['OFFICER_1', 'SMUGGLER_1', 'OFFICER_2', 'SMUGGLER_2'];
}

export function createInitialGame(seed: number, mode: Mode = 'race'): GameState {
  if (mode !== 'race' && mode !== 'fixedRounds') throw new Error(`unsupported mode: ${mode}`);
  const rng = new RandomStream(seed);
  const marketDeck = rng.shuffle([
    ...copies('tactic', cardsData.rules.marketTacticCopiesEach),
    ...copies('equipment', cardsData.rules.marketEquipmentCopiesEach),
  ]);
  const marketSlots = marketDeck.splice(0, balanceData.marketSlots);
  const blackMarketDeck = rng.shuffle(copies('tactic', cardsData.rules.blackMarketTacticCopiesEach));
  const eventDeck = rng.shuffle(copies('event', cardsData.rules.eventCopiesEach));

  const characters: CharacterState[] = initialTurnOrder(1).map((id, seat) => ({
    id,
    faction: id.startsWith('SMUGGLER') ? 'smuggler' : 'officer',
    seat,
    nodeId: 'HUB',
    food: balanceData.startingFood,
    gold: 0,
    silver: balanceData.startingSilver,
    actionPoints: 0,
    actionRoll: null,
    siteVisitsThisTurn: [],
    hand: [],
    equipped: {},
    mountId: null,
    mountTurnsRemaining: 0,
    deadUntilRound: null,
    successiveSuccessfulInspections: 0,
    nextTurnApPenalty: 0,
    noTacticsNextTurn: false,
    tacticsBlockedThisTurn: false,
    diluSteps: null,
    contractCollectedThisTurn: false,
    tavernUsedThisTurn: false,
    mineSearchedThisTurn: false,
    exchangedThisTurn: false,
    soldThisTurn: false,
    refilledThisTurn: false,
    searchProtectedUntilRound: null,
    sealedGold: 0,
    lockbox: { gold: 0, silver: 0 },
    firstMoveUsedThisTurn: false,
    enteredNodesThisTurn: 0,
    tacticsPlayedThisTurn: 0,
    mineActionsThisTurn: 0,
    inspectedThisTurn: false,
    marketBoughtThisTurn: false,
    blackMarketBoughtThisTurn: false,
    blackMarketRedrawAvailable: false,
    blackMarketDrawnCardId: null,
    pickedUpThisTurn: false,
    marketRefreshedThisTurn: false,
    freeMoveAvailableThisTurn: false,
    hubEntryBanTurns: 0,
    controlledMovementAp: 0,
    controlledById: null,
    contractGold: 0,
    untargetableThisTurn: false,
  }));

  return {
    schemaVersion: '1.0.0',
    rulesVersion: '1.1.0',
    mapVersion,
    cardVersion: cardsData.version,
    balanceVersion: balanceData.version,
    mode,
    session: { kind: 'hotseat', humanFaction: 'smuggler' },
    revision: 0,
    round: 1,
    phase: 'preEvent',
    activeCharacterId: null,
    turnOrder: initialTurnOrder(1),
    turnIndex: 0,
    preEventQueue: [],
    pendingDecision: null,
    rngState: rng.getState(),
    characters,
    reputation: { smuggler: 0, officer: 0 },
    mineOutputRemaining: balanceData.miningGlobalOutputPerCharacterPerRound * characters.length,
    mineOutputByFaction: { smuggler: 0, officer: 0 },
    marketSlots,
    marketDeck,
    marketDiscard: [],
    blackMarketDeck,
    blackMarketDiscard: [],
    eventDeck,
    eventDiscard: [],
    activeEventId: null,
    eventRoadAtReveal: [],
    eventMountedAtReveal: [],
    blockedEdges: [],
    droppedItems: {},
    winner: null,
    log: [],
  };
}
