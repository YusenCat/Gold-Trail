import { mkdir, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Worker, isMainThread, parentPort, workerData } from 'node:worker_threads';
import { createInitialGame } from '../packages/rules/src/state.ts';
import { applyCommand, startGame } from '../packages/rules/src/engine.ts';
import { decisionActor, legalActions } from '../packages/rules/src/actions.ts';
import { chooseBotCommand as chooseOld } from '../packages/rules/src/bot-baseline.ts';
import { chooseBotCommand as chooseNew } from '../packages/rules/src/bot.ts';
import balance from '../content/balance.v1.json' with { type: 'json' };

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const output = resolve(root, 'docs/playtest');
const sampleCount = Number(process.env.BOT_COMPARE_SAMPLES ?? 20);
const raceRoundCap = 120;
const factions = ['smuggler', 'officer'];
const modes = ['race', 'fixedRounds'];
if (!Number.isInteger(sampleCount) || sampleCount < 1) throw new Error('BOT_COMPARE_SAMPLES must be a positive integer');

function metricsTemplate() {
  return Object.fromEntries(factions.map((faction) => [faction, {
    exchanges: 0, goldExchanged: 0, inspections: 0, inspectionGold: 0, mineSearches: 0, mineSearchGold: 0,
    starvationDeaths: 0, backtracks: 0, unusedActionPoints: 0, ownTurns: 0, moveSteps: 0,
    cardOpportunities: {}, cardUsedTurns: {}, cardPlays: {},
  }]));
}

function playOne(seed, mode, startingFaction, improvedFaction) {
  let state = startGame(createInitialGame(seed, mode, startingFaction));
  const metrics = metricsTemplate();
  const opportunities = new Set(), cardUsed = new Set();
  const visited = new Map();
  let openSearch = null, actionsTaken = 0;
  while (state.phase !== 'finished' && state.round <= (mode === 'race' ? raceRoundCap : balance.fixedRoundLimit)) {
    const actions = legalActions(state);
    const id = decisionActor(state);
    const actor = state.characters.find((character) => character.id === id);
    if (!actions.length || !actor) throw new Error(`No legal decision: ${seed} ${mode} round ${state.round}`);
    const row = metrics[actor.faction];
    const key = `${state.round}:${id}`;
    for (const cardId of new Set(actions.filter((action) => action.command.type === 'PLAY_TACTIC').map((action) => action.command.cardId))) {
      const opportunityKey = `${key}:${cardId}`;
      if (!opportunities.has(opportunityKey)) {
        opportunities.add(opportunityKey);
        row.cardOpportunities[cardId] = (row.cardOpportunities[cardId] ?? 0) + 1;
      }
    }
    const command = actor.faction === improvedFaction ? chooseNew(state, actions) : chooseOld(state, actions);
    if (!command) throw new Error(`No command: ${seed} ${mode} round ${state.round}`);
    if (command.type === 'EXCHANGE') { row.exchanges++; row.goldExchanged += command.amount; }
    if (command.type === 'INSPECT') row.inspections++;
    if (command.type === 'MINE_SEARCH') row.mineSearches++;
    if (command.type === 'PLAY_TACTIC') {
      row.cardPlays[command.cardId] = (row.cardPlays[command.cardId] ?? 0) + 1;
      const usedKey = `${key}:${command.cardId}`;
      if (!cardUsed.has(usedKey)) {
        cardUsed.add(usedKey);
        row.cardUsedTurns[command.cardId] = (row.cardUsedTurns[command.cardId] ?? 0) + 1;
      }
    }
    if (command.type === 'END_TURN') { row.ownTurns++; row.unusedActionPoints += actor.actionPoints; }
    if (['MOVE','FREE_MOVE','PRE_EVENT_MOVE'].includes(command.type)) {
      const stops = visited.get(key) ?? new Set([actor.nodeId]);
      const end = command.path.at(-1);
      if (stops.has(end)) row.backtracks++;
      stops.add(end); visited.set(key, stops);
      row.moveSteps += command.path.length;
    }
    if (command.type === 'INSPECT' || command.type === 'MINE_SEARCH') {
      openSearch = { kind: command.type, sourceId: id, sourceGold: actor.gold };
    }
    const before = state;
    state = applyCommand(state, command);
    for (const current of state.characters) {
      const previous = before.characters.find((character) => character.id === current.id);
      if (!previous.deadUntilRound && current.deadUntilRound) metrics[current.faction].starvationDeaths++;
    }
    if (openSearch && !state.pendingDecision) {
      const source = state.characters.find((character) => character.id === openSearch.sourceId);
      const gained = Math.max(0, (source?.gold ?? openSearch.sourceGold) - openSearch.sourceGold);
      metrics.officer[openSearch.kind === 'INSPECT' ? 'inspectionGold' : 'mineSearchGold'] += gained;
      openSearch = null;
    }
    if (++actionsTaken > 100000) throw new Error(`Action cap: ${seed} ${mode}`);
  }
  const capped = state.phase !== 'finished';
  return { seed, mode, startingFaction, improvedFaction, winner: capped ? null : state.winner,
    capped, rounds: capped ? raceRoundCap : state.round, reputation: state.reputation, metrics };
}

if (!isMainThread) {
  const results = [];
  for (const job of workerData.jobs) {
    const baseline = playOne(job.seed, job.mode, job.startingFaction, null);
    const smuggler = playOne(job.seed, job.mode, job.startingFaction, 'smuggler');
    const officer = playOne(job.seed, job.mode, job.startingFaction, 'officer');
    results.push({ seed: job.seed, mode: job.mode, startingFaction: job.startingFaction, baseline, smuggler, officer });
    parentPort.postMessage({ progress: 1 });
  }
  parentPort.postMessage({ results });
} else {
  const jobs = [];
  for (const mode of modes) for (const startingFaction of factions)
    for (let index = 0; index < sampleCount; index++) jobs.push({ seed: 2026092801 + index, mode, startingFaction });
  const chunks = Array.from({ length: Math.min(4, jobs.length) }, () => []);
  jobs.forEach((job, index) => chunks[index % chunks.length].push(job));
  const start = Date.now();
  let completed = 0;
  const results = (await Promise.all(chunks.map((workerJobs) => new Promise((resolveWorker, rejectWorker) => {
    const worker = new Worker(fileURLToPath(import.meta.url), { workerData: { jobs: workerJobs } });
    worker.on('message', (message) => {
      if (message.progress) {
        completed++;
        if (completed % 5 === 0) console.log(`paired seeds ${completed}/${jobs.length}`);
      } else if (message.results) resolveWorker(message.results);
    });
    worker.once('error', rejectWorker);
    worker.once('exit', (code) => { if (code !== 0) rejectWorker(new Error(`Worker exited with ${code}`)); });
  })))).flat();
  const average = (rows, select) => rows.reduce((sum, row) => sum + select(row), 0) / Math.max(1, rows.length);
  const total = (rows, select) => rows.reduce((sum, row) => sum + select(row), 0);
  const cells = [];
  for (const mode of modes) for (const startingFaction of factions) for (const focus of factions) {
    const seeds = results.filter((result) => result.mode === mode && result.startingFaction === startingFaction);
    const baseline = seeds.map((result) => result.baseline);
    const improved = seeds.map((result) => result[focus]);
    const oldRows = baseline.map((game) => game.metrics[focus]);
    const newRows = improved.map((game) => game.metrics[focus]);
    const newWins = improved.filter((game) => game.winner === focus).length;
    const oldWins = baseline.filter((game) => game.winner === focus).length;
    cells.push({ mode, startingFaction, focus, games: seeds.length, oldWins, newWins,
      improvedOnlyWins: seeds.filter((result) => result.baseline.winner !== focus && result[focus].winner === focus).length,
      baselineOnlyWins: seeds.filter((result) => result.baseline.winner === focus && result[focus].winner !== focus).length,
      oldCapped: baseline.filter((game) => game.capped).length, newCapped: improved.filter((game) => game.capped).length,
      avgRoundsOld: average(baseline, (game) => game.rounds), avgRoundsNew: average(improved, (game) => game.rounds),
      old: { exchanges: average(oldRows, (row) => row.exchanges), goldExchanged: average(oldRows, (row) => row.goldExchanged),
        inspectionGold: total(oldRows, (row) => row.inspectionGold), inspectionAttempts: total(oldRows, (row) => row.inspections),
        starvationDeaths: total(oldRows, (row) => row.starvationDeaths), backtracks: total(oldRows, (row) => row.backtracks),
        unusedActionPoints: total(oldRows, (row) => row.unusedActionPoints) },
      new: { exchanges: average(newRows, (row) => row.exchanges), goldExchanged: average(newRows, (row) => row.goldExchanged),
        inspectionGold: total(newRows, (row) => row.inspectionGold), inspectionAttempts: total(newRows, (row) => row.inspections),
        starvationDeaths: total(newRows, (row) => row.starvationDeaths), backtracks: total(newRows, (row) => row.backtracks),
        unusedActionPoints: total(newRows, (row) => row.unusedActionPoints) },
    });
  }
  const cardRates = {};
  for (const focus of factions) {
    const oldRows = results.flatMap((result) => [result.baseline.metrics[focus]]);
    const newRows = results.map((result) => result[focus].metrics[focus]);
    const ids = new Set([...oldRows, ...newRows].flatMap((row) => Object.keys(row.cardOpportunities)));
    cardRates[focus] = Object.fromEntries([...ids].sort().map((id) => [id, {
      oldOpportunities: total(oldRows, (row) => row.cardOpportunities[id] ?? 0),
      oldUsedTurns: total(oldRows, (row) => row.cardUsedTurns[id] ?? 0),
      newOpportunities: total(newRows, (row) => row.cardOpportunities[id] ?? 0),
      newUsedTurns: total(newRows, (row) => row.cardUsedTurns[id] ?? 0),
    }]));
  }
  const report = { generatedAt: new Date().toISOString(), samplesPerCell: sampleCount,
    methodology: 'Same seed, mode and first faction; old mirror is shared baseline, improved policy plays one faction against old policy. Dynamic draws may diverge after different actions.',
    gamesPlayed: results.length * 3, elapsedSeconds: (Date.now() - start) / 1000, cells, cardRates, games: results };
  await mkdir(output, { recursive: true });
  await writeFile(resolve(output, 'bot-policy-compare.json'), JSON.stringify(report, null, 2) + '\n');
  const label = (faction) => faction === 'smuggler' ? '走私者' : '官兵';
  const lines = ['# 人机策略同种子对照', '', `- 每格 ${sampleCount} 组相同种子；合计 ${results.length} 组、${report.gamesPlayed} 局。`,
    '- 对照：旧策略镜像；新策略只控制表中阵营，对手继续使用旧策略。相同种子可配对比较，动作不同会使后续抽牌与掷骰序列分叉。',
    '- “回头路”指同一角色同一轮的移动终点重复，属于无效移动的保守代理指标；剩余行动点按主动结束回合计。',
    '- 卡牌条件使用率 = 有合法出牌机会的角色轮次中实际出牌的轮次；每张卡每角色每轮只计一次。', '',
    '| 模式 | 先手 | 新策略阵营 | 旧胜/新胜 | 改善/退步种子 | 旧/新平均轮数 | 旧/新交金次数 | 旧/新交金量 | 旧/新稽查获金 | 旧/新断粮 | 旧/新回头路 | 旧/新剩余AP |',
    '|---|---|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|'];
  for (const cell of cells) lines.push(`| ${cell.mode === 'race' ? '竞速' : '30轮'} | ${label(cell.startingFaction)} | ${label(cell.focus)} | ${cell.oldWins}/${cell.newWins} | ${cell.improvedOnlyWins}/${cell.baselineOnlyWins} | ${cell.avgRoundsOld.toFixed(1)}/${cell.avgRoundsNew.toFixed(1)} | ${cell.old.exchanges.toFixed(2)}/${cell.new.exchanges.toFixed(2)} | ${cell.old.goldExchanged.toFixed(2)}/${cell.new.goldExchanged.toFixed(2)} | ${cell.old.inspectionGold}/${cell.new.inspectionGold} | ${cell.old.starvationDeaths}/${cell.new.starvationDeaths} | ${cell.old.backtracks}/${cell.new.backtracks} | ${cell.old.unusedActionPoints}/${cell.new.unusedActionPoints} |`);
  for (const faction of factions) {
    lines.push('', `## ${label(faction)}卡牌条件使用率`, '', '| 卡牌 | 旧机会/出牌/率 | 新机会/出牌/率 |', '|---|---:|---:|');
    for (const [id, row] of Object.entries(cardRates[faction])) {
      const oldRate = row.oldOpportunities ? 100 * row.oldUsedTurns / row.oldOpportunities : 0;
      const newRate = row.newOpportunities ? 100 * row.newUsedTurns / row.newOpportunities : 0;
      lines.push(`| ${id} | ${row.oldOpportunities}/${row.oldUsedTurns}/${oldRate.toFixed(1)}% | ${row.newOpportunities}/${row.newUsedTurns}/${newRate.toFixed(1)}% |`);
    }
  }
  lines.push('', '## 解读边界', '', '- 胜率同时受双方策略和随机事件影响；旧版与新版的差额不是规则平衡结论。', '- 条件使用率只说明出牌积极程度，需结合胜负、交金和角色生存判断收益。', '');
  await writeFile(resolve(output, 'bot-policy-compare.md'), lines.join('\n'));
  console.log(`Wrote ${report.gamesPlayed} games to ${output}`);
}
