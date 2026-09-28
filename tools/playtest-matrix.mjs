import { mkdir, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Worker, isMainThread, parentPort, workerData } from 'node:worker_threads';
import { createInitialGame } from '../packages/rules/src/state.ts';
import { applyCommand, startGame } from '../packages/rules/src/engine.ts';
import { legalActions, decisionActor } from '../packages/rules/src/actions.ts';
import { chooseBotCommand } from '../packages/rules/src/bot.ts';
import cardsData from '../content/cards.v1.json' with { type: 'json' };
import balance from '../content/balance.v1.json' with { type: 'json' };

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const outputDir = resolve(root, 'docs/playtest');
const samplesPerCell = 20;
const raceRoundCap = 120;
const cardById = new Map(cardsData.cards.map((card) => [card.id, card]));
const factions = ['smuggler', 'officer'];
const modes = ['race', 'fixedRounds'];
const matchups = [
  { id: 'baseline-mirror', name: '基准策略镜像', smuggler: 'baseline', officer: 'baseline' },
  { id: 'delivery-vs-interdict', name: '稳健交金 vs 官兵截查', smuggler: 'secure', officer: 'inspector' },
  { id: 'raider-vs-baseline', name: '走私突袭 vs 基准官兵', smuggler: 'raider', officer: 'baseline' },
];

if (!isMainThread) {
  const results = [];
  for (const job of workerData.jobs) {
    results.push(playOne(job));
    parentPort.postMessage({ progress: 1 });
  }
  parentPort.postMessage({ results });
}

function choose(state, factionStrategy, actions) {
  const actorId = decisionActor(state);
  const actor = state.characters.find((item) => item.id === actorId);
  const base = chooseBotCommand(state, actions);
  if (!actor || !base) return base;
  const byType = (type) => actions.filter((item) => item.command.type === type);
  if (actor.faction === 'officer' && factionStrategy === 'inspector') {
    const searches = [...byType('INSPECT'), ...byType('MINE_SEARCH')]
      .filter(({ command }) => (state.characters.find((item) => item.id === command.targetId)?.gold ?? 0) > 0);
    if (searches.length) return searches[0].command;
  }
  if (actor.faction === 'smuggler' && factionStrategy === 'raider') {
    const attacks = byType('PLAY_TACTIC').filter(({ command }) => ['T_ROAD_ROBBERY', 'T_PRIVATE_SEARCH'].includes(command.cardId));
    if (attacks.length) return attacks[0].command;
  }
  if (actor.faction === 'smuggler' && factionStrategy === 'secure') {
    const deposit = byType('EXCHANGE');
    if (deposit.length && actor.gold > 0) return deposit[0].command;
    const lockbox = actions.filter(({ command }) => command.type === 'USE_EQUIPMENT' && command.cardId === 'E_LOCKBOX'
      && command.direction === 'deposit' && command.resource === 'gold');
    if (lockbox.length && actor.gold > 1) return lockbox[0].command;
  }
  return base;
}

function newMetrics() {
  const metrics = {};
  for (const faction of factions) metrics[faction] = {
    exchanges: 0, goldExchanged: 0, inspections: 0, mineSearches: 0,
    inspectionGold: 0, mineSearchGold: 0, tactics: {}, equipmentUses: {}, ownTurns: 0,
  };
  return metrics;
}

function factionOf(state, actorId) { return state.characters.find((item) => item.id === actorId)?.faction; }

function playOne({ seed, mode, startingFaction, matchup }) {
  let state = startGame(createInitialGame(seed, mode, startingFaction));
  const metrics = newMetrics();
  let openSearch = null;
  let actionCount = 0;
  while (state.phase !== 'finished' && state.round <= (mode === 'race' ? raceRoundCap : balance.fixedRoundLimit)) {
    const actions = legalActions(state);
    if (!actions.length) throw new Error(`No legal actions at seed=${seed}, round=${state.round}, phase=${state.phase}`);
    const actorId = decisionActor(state);
    const faction = factionOf(state, actorId);
    const strategy = faction === 'smuggler' ? matchup.smuggler : matchup.officer;
    const command = choose(state, strategy, actions);
    if (!command) throw new Error(`No command at seed=${seed}`);
    const before = state;
    const actorBefore = before.characters.find((item) => item.id === command.actorId);
    if (command.type === 'INSPECT') metrics.officer.inspections++;
    if (command.type === 'MINE_SEARCH') metrics.officer.mineSearches++;
    if (command.type === 'EXCHANGE') {
      const actingFaction = factionOf(before, command.actorId);
      metrics[actingFaction].exchanges++;
      metrics[actingFaction].goldExchanged += command.amount;
    }
    if (command.type === 'PLAY_TACTIC') {
      const use = metrics[factionOf(before, command.actorId)].tactics;
      use[command.cardId] = (use[command.cardId] ?? 0) + 1;
    }
    if (command.type === 'USE_EQUIPMENT' && command.cardId !== 'E_TIME_GONG') {
      const use = metrics[factionOf(before, command.actorId)].equipmentUses;
      use[command.cardId] = (use[command.cardId] ?? 0) + 1;
    }
    if (command.type === 'END_TURN' && actorBefore) metrics[actorBefore.faction].ownTurns++;
    if (command.type === 'INSPECT' || command.type === 'MINE_SEARCH') {
      openSearch = { kind: command.type === 'INSPECT' ? 'inspection' : 'mineSearch', sourceId: command.actorId,
        sourceGold: actorBefore?.gold ?? 0, reputation: before.reputation.officer };
    }
    state = applyCommand(state, command);
    if (openSearch && !state.pendingDecision) {
      const source = state.characters.find((item) => item.id === openSearch.sourceId);
      const gained = Math.max(0, (source?.gold ?? openSearch.sourceGold) - openSearch.sourceGold);
      metrics.officer[openSearch.kind === 'inspection' ? 'inspectionGold' : 'mineSearchGold'] += gained;
      openSearch = null;
    }
    actionCount++;
    if (actionCount > 100000) throw new Error(`Action cap exceeded at seed=${seed}`);
  }
  const capped = state.phase !== 'finished';
  return {
    seed, mode, startingFaction, openingCharacter: state.startingFaction === 'officer' ? 'OFFICER_1' : 'SMUGGLER_1',
    matchup: matchup.id, strategies: { smuggler: matchup.smuggler, officer: matchup.officer },
    winner: capped ? null : state.winner, capped, rounds: capped ? raceRoundCap : state.round,
    reputation: { ...state.reputation }, metrics,
  };
}

function sum(items, selector) { return items.reduce((total, item) => total + selector(item), 0); }
function avg(items, selector) { return items.length ? sum(items, selector) / items.length : 0; }
function pct(n, d) { return d ? 100 * n / d : 0; }
function chineseFaction(f) { return f === 'smuggler' ? '走私者' : '官兵'; }

function summarizeCell(games) {
  const completed = games.filter((game) => !game.capped);
  const wins = Object.fromEntries(factions.map((f) => [f, games.filter((game) => game.winner === f).length]));
  const result = {
    games: games.length, completed: completed.length, capped: games.length - completed.length,
    wins, draws: games.filter((game) => game.winner === 'draw').length,
    winRatesAll: Object.fromEntries(factions.map((f) => [f, pct(wins[f], games.length)])),
    avgRoundsAll: avg(games, (game) => game.rounds), avgRoundsCompleted: avg(completed, (game) => game.rounds),
    factions: {},
  };
  for (const faction of factions) {
    const rows = games.map((game) => game.metrics[faction]);
    const totalOwnTurns = sum(rows, (row) => row.ownTurns);
    const tactics = {};
    for (const row of rows) for (const [id, count] of Object.entries(row.tactics)) tactics[id] = (tactics[id] ?? 0) + count;
    const equipmentUses = {};
    for (const row of rows) for (const [id, count] of Object.entries(row.equipmentUses)) equipmentUses[id] = (equipmentUses[id] ?? 0) + count;
    result.factions[faction] = {
      exchanges: sum(rows, (row) => row.exchanges), goldExchanged: sum(rows, (row) => row.goldExchanged),
      avgExchangesPerGame: avg(rows, (row) => row.exchanges), avgGoldExchangedPerGame: avg(rows, (row) => row.goldExchanged),
      inspectionAttempts: sum(rows, (row) => row.inspections), mineSearchAttempts: sum(rows, (row) => row.mineSearches),
      inspectionGold: sum(rows, (row) => row.inspectionGold), mineSearchGold: sum(rows, (row) => row.mineSearchGold),
      avgInspectionGoldPerAttempt: sum(rows, (row) => row.inspectionGold) / Math.max(1, sum(rows, (row) => row.inspections)),
      tacticsPlayed: tactics, tacticsPer100OwnTurns: Object.fromEntries(Object.entries(tactics).map(([id, count]) => [id, pct(count, totalOwnTurns)])),
      equipmentUses, ownTurns: totalOwnTurns,
    };
  }
  return result;
}

function makeMarkdown(groups, games, startedAt, elapsedSeconds) {
  const lines = [
    '# 规则平衡试玩报告（规则调整前）', '',
    `- 基线：已提交推送的 1.1.0 规则；余额配置 ${balance.version}。`,
    `- 对局数：${games.length} 局；每场景 ${samplesPerCell} 局；开始时间 ${startedAt}；耗时 ${elapsedSeconds.toFixed(1)} 秒。`,
    `- 场景：竞速 / 30 轮 × 先手阵营 × 3 组策略，共 ${groups.length} 格。`,
    `- 竞速单局上限：${raceRoundCap} 轮；到达上限的局记为“未结束/删失”，胜率分母仍包含这些局。`,
    '- 指标：交金即兑换碎金（次数及数量）；稽查收益为成功结算时官兵实际拿到的碎金；卡牌率按每 100 个本阵营角色回合计算战术牌发动次数。',
    '- 试玩策略：基准 AI；稳健交金（到兑换点有金就兑换，并优先存入钱柜）；官兵截查（合法且目标携金时优先搜查）；走私突袭（优先发动劫道/私搜）。策略均基于规则引擎合法动作。',
    '', '| 模式 | 先手 | 策略组合 | 局数 | 走私胜率 | 官兵胜率 | 平局 | 未结束 | 平均轮数 | 交金次数/局（走私/官兵） | 交金数量/局（走私/官兵） | 稽查/金矿搜寻收益（官兵） |',
    '|---|---|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|',
  ];
  for (const group of groups) {
    const s = group.summary;
    lines.push(`| ${group.mode === 'race' ? '竞速' : '30轮'} | ${chineseFaction(group.startingFaction)} | ${group.matchup.name} | ${s.games} | ${s.winRatesAll.smuggler.toFixed(1)}% | ${s.winRatesAll.officer.toFixed(1)}% | ${s.draws} | ${s.capped} | ${s.avgRoundsAll.toFixed(1)} | ${s.factions.smuggler.avgExchangesPerGame.toFixed(2)} / ${s.factions.officer.avgExchangesPerGame.toFixed(2)} | ${s.factions.smuggler.avgGoldExchangedPerGame.toFixed(2)} / ${s.factions.officer.avgGoldExchangedPerGame.toFixed(2)} | ${s.factions.officer.inspectionGold} (${s.factions.officer.inspectionAttempts} 次稽查，${s.factions.officer.mineSearchGold} 金矿搜寻) |`);
  }
  lines.push('', '## 卡牌使用汇总', '', '按模式/先手/策略格分别记录在 JSON；以下列出全部 240 局合并后的每 100 个本阵营角色回合发动率。', '');
  for (const faction of factions) {
    const rows = games.map((game) => game.metrics[faction]);
    const turns = sum(rows, (row) => row.ownTurns);
    const counts = {};
    for (const row of rows) for (const [id, count] of Object.entries(row.tactics)) counts[id] = (counts[id] ?? 0) + count;
    lines.push(`### ${chineseFaction(faction)}`, '', '| 战术牌 | 发动次数 | 每100角色回合 |', '|---|---:|---:|');
    for (const [id, count] of Object.entries(counts).sort((a, b) => b[1] - a[1])) lines.push(`| ${cardById.get(id)?.name ?? id} (${id}) | ${count} | ${pct(count, turns).toFixed(2)} |`);
    lines.push('');
  }
  lines.push('## 口径与解释', '', '- 战术牌使用率不是持有率：分母是实际结束的角色回合数，表示每 100 回合发动次数；同一回合可发动多张牌。', '- 装备主动使用次数、各局种子、逐局声望和完整卡牌计数请查阅同目录 `playtest-prebalance.json`。', '- 胜率受 AI 策略限制，反映规则与当前 AI 的共同表现，不等同于真人对局胜率。', '- 本报告只描述调整前基线；平衡改动后的复测会另建报告，不覆盖此文件。', '');
  return lines.join('\n');
}

const startedAt = new Date().toISOString();
const wallStart = Date.now();
const jobs = [];
for (const mode of modes) for (const startingFaction of factions) for (const matchup of matchups)
  for (let i = 0; i < samplesPerCell; i++) jobs.push({ seed: 2026092801 + i, mode, startingFaction, matchup });
const workerCount = Math.min(4, jobs.length);
const chunks = Array.from({ length: workerCount }, () => []);
jobs.forEach((job, index) => chunks[index % workerCount].push(job));
let completed = 0;
const resultsByWorker = await Promise.all(chunks.map((workerJobs) => new Promise((resolvePromise, reject) => {
  const worker = new Worker(fileURLToPath(import.meta.url), { workerData: { jobs: workerJobs } });
  worker.on('message', (message) => {
    if (message.progress) {
      completed++;
      if (completed % 10 === 0) console.log(`completed ${completed}/${jobs.length}`);
    } else if (message.results) {
      resolvePromise(message.results);
      void worker.terminate();
    }
  });
  worker.once('error', reject);
  worker.once('exit', (code) => { if (code !== 0) reject(new Error(`Playtest worker exited with ${code}`)); });
})));
const games = resultsByWorker.flat();
const groups = [];
for (const mode of modes) for (const startingFaction of factions) for (const matchup of matchups) {
  const cell = games.filter((game) => game.mode === mode && game.startingFaction === startingFaction && game.matchup === matchup.id);
  groups.push({ mode, startingFaction, matchup, summary: summarizeCell(cell) });
}
console.log(`completed ${games.length}/${jobs.length}`);
const elapsedSeconds = (Date.now() - wallStart) / 1000;
const report = {
  title: '规则平衡试玩报告（规则调整前）', baseline: { rulesVersion: '1.1.0', balanceVersion: balance.version },
  startedAt, generatedAt: new Date().toISOString(), samplesPerCell, raceRoundCap,
  methodology: { modes, startingFactions: factions, matchups, cells: groups, games },
};
await mkdir(outputDir, { recursive: true });
await writeFile(resolve(outputDir, 'playtest-prebalance.json'), JSON.stringify(report, null, 2) + '\n', 'utf8');
await writeFile(resolve(outputDir, 'playtest-prebalance.md'), makeMarkdown(groups, games, startedAt, elapsedSeconds), 'utf8');
console.log(`Wrote ${games.length} games to ${outputDir}`);
