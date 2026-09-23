import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import { readFile } from 'node:fs/promises';
import { extname, join, normalize } from 'node:path';
import { fileURLToPath } from 'node:url';
import { applyCommand, createInitialGame, legalMoveTargets, publicView, RuleError, startGame, type GameCommand, type GameState, mapNodes, mapRoutes } from '../../packages/rules/src/index.ts';
import { SaveConflictError, SaveNotFoundError, SaveStore } from './save-store.ts';
import cardsData from '../../content/cards.v1.json' with { type: 'json' };
import balanceData from '../../content/balance.v1.json' with { type: 'json' };
import { decisionActor, legalActions } from '../../packages/rules/src/actions.ts';
import { chooseBotCommand, isBotTurn } from '../../packages/rules/src/bot.ts';

const root = fileURLToPath(new URL('../../', import.meta.url));
const webRoot = join(root, 'apps', 'web');
const port = Number(process.env.PORT ?? 4173);

const saves = new SaveStore(process.env.GAME_SAVE_DIR ?? join(root, 'data', 'saves'));
let game: GameState = (await saves.loadRecovery()) ?? createInitialGame(20260922, 'race');

const mimeByExtension: Record<string, string> = {
  '.css': 'text/css; charset=utf-8',
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.jpg': 'image/jpeg',
  '.png': 'image/png',
  '.svg': 'image/svg+xml; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
};

function json(response: ServerResponse, status: number, body: unknown): void {
  response.writeHead(status, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' });
  response.end(JSON.stringify(body));
}

async function requestBody(request: IncomingMessage): Promise<unknown> {
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of request) {
    size += chunk.length;
    if (size > 65536) throw new RuleError('请求内容过大');
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  }
  const text = Buffer.concat(chunks).toString('utf8');
  if (!text) return {};
  try {
    const body = JSON.parse(text);
    if (!body || typeof body !== 'object' || Array.isArray(body)) throw new Error('invalid body');
    return body;
  } catch {
    throw new RuleError('请求体必须为 JSON');
  }
}

function view(): unknown {
  const botPending = isBotTurn(game);
  return {
    game: publicView(game, game.session.kind === 'solo' ? game.session.humanFaction : undefined),
    legalMoves: !botPending && game.activeCharacterId ? legalMoveTargets(game, game.activeCharacterId) : [],
    actions: botPending ? [] : legalActions(game),
    decisionActorId: decisionActor(game),
    botPending,
    balance: {
      mineActionsPerTurn: balanceData.mineActionsPerCharacterTurn,
      mineFactionOutputLimit: balanceData.mineFactionOutputPerRound,
      openingMarketDiscount: balanceData.openingMarketDiscount,
      blackMarketBlindDrawPrice: balanceData.blackMarketBlindDrawPrice,
    },
  };
}

async function checkpoint(): Promise<void> { await saves.saveRecovery(game); }

async function staticFile(response: ServerResponse, path: string): Promise<void> {
  const normalized = normalize(path).replace(/^([.][.][\\/])+/, '');
  const filePath = join(webRoot, normalized);
  const contents = await readFile(filePath);
  response.writeHead(200, { 'content-type': mimeByExtension[extname(filePath)] ?? 'application/octet-stream' });
  response.end(contents);
}

async function handleRequest(request: IncomingMessage, response: ServerResponse) {
  const method = request.method ?? 'GET';
  const url = new URL(request.url ?? '/', `http://${request.headers.host ?? 'localhost'}`);
  try {
    if (method === 'GET' && url.pathname === '/api/health') return json(response, 200, { ok: true, state: game.phase });
    if (method === 'GET' && url.pathname === '/api/game') return json(response, 200, view());
    if (method === 'GET' && url.pathname === '/api/map') return json(response, 200, { nodes: mapNodes, routes: mapRoutes });
    if (method === 'GET' && url.pathname === '/api/cards') return json(response, 200, { cards: cardsData.cards });
    if (method === 'GET' && url.pathname === '/api/rules') return json(response, 200, { text: await readFile(join(root, 'docs', 'RULEBOOK_V1.md'), 'utf8') });
    if (method === 'GET' && url.pathname === '/api/saves') return json(response, 200, { saves: await saves.list() });
    if (method === 'POST' && url.pathname === '/api/saves') {
      const body = await requestBody(request) as { name?: string; overwrite?: boolean };
      if (typeof body.name !== 'string') throw new RuleError('请提供存档名');
      if (body.overwrite !== undefined && typeof body.overwrite !== 'boolean') throw new RuleError('覆盖选项无效');
      return json(response, 201, { save: await saves.save(body.name, game, body.overwrite === true) });
    }
    if (method === 'POST' && url.pathname === '/api/saves/load') {
      const body = await requestBody(request) as { id?: string };
      if (typeof body.id !== 'string') throw new RuleError('请提供存档编号');
      const loaded = await saves.load(body.id);
      loaded.revision = Math.max(loaded.revision, game.revision) + 1;
      await saves.saveRecovery(loaded);
      game = loaded;
      return json(response, 200, view());
    }
    if (method === 'POST' && url.pathname === '/api/game/new') {
      const body = await requestBody(request) as { seed?: number; mode?: 'race' | 'fixedRounds'; kind?: 'solo' | 'hotseat'; humanFaction?: 'smuggler' | 'officer'; start?: boolean };
      const seed = Number.isInteger(body.seed) ? body.seed! : Date.now();
      const mode = body.mode === 'fixedRounds' ? 'fixedRounds' : 'race';
      const created = createInitialGame(seed, mode);
      created.revision = game.revision + 1;
      created.session = { kind: body.kind === 'solo' ? 'solo' : 'hotseat', humanFaction: body.humanFaction === 'officer' ? 'officer' : 'smuggler' };
      game = body.start ? startGame(created) : created;
      await checkpoint();
      return json(response, 201, view());
    }
    if (method === 'POST' && url.pathname === '/api/game/start') {
      game = startGame(game);
      await checkpoint();
      return json(response, 200, view());
    }
    if (method === 'POST' && url.pathname === '/api/game/command') {
      const body = await requestBody(request) as GameCommand & { revision?: number };
      if (body.revision !== game.revision) throw new RuleError('局面已更新，请刷新后重试');
      if (isBotTurn(game)) throw new RuleError('当前由人机决策');
      if (game.session.kind === 'solo' && game.characters.find((c) => c.id === body.actorId)?.faction !== game.session.humanFaction) throw new RuleError('只能操控自己阵营的角色');
      game = applyCommand(game, body);
      await checkpoint();
      return json(response, 200, view());
    }
    if (method === 'POST' && url.pathname === '/api/game/bot-step') {
      const body = await requestBody(request) as { revision?: number };
      if (body.revision !== game.revision) throw new RuleError('局面已更新，请刷新后重试');
      if (isBotTurn(game)) {
        const command = chooseBotCommand(game);
        if (!command) throw new RuleError('人机没有可用动作，请保存局面以便排查');
        game = applyCommand(game, command);
        await checkpoint();
      }
      return json(response, 200, view());
    }
    if (method === 'GET' && url.pathname === '/') return staticFile(response, 'index.html');
    if (method === 'GET' && /^\/(app\.js|styles\.css)$/.test(url.pathname)) return staticFile(response, url.pathname.slice(1));
    if (method === 'GET' && /^\/assets\/(?:cards\/[A-Z0-9_]+\.png|board-map\.png|board-background\.jpg|board-illustration\.svg)$/.test(url.pathname)) return staticFile(response, url.pathname.slice(1));
    json(response, 404, { error: 'not_found' });
  } catch (error) {
    const status = error instanceof SaveConflictError ? 409 : error instanceof SaveNotFoundError ? 404 : error instanceof RuleError ? 400 : 500;
    json(response, status, error instanceof SaveConflictError
      ? { error: error.message, conflict: error.existing }
      : { error: error instanceof Error ? error.message : 'unknown_error' });
  }
}

// Serialize local mutations, including asynchronous load/save, so an old response cannot replace a newer turn.
let requestQueue = Promise.resolve();
const server = createServer((request, response) => {
  requestQueue = requestQueue.then(() => handleRequest(request, response)).catch(() => {
    if (!response.headersSent) json(response, 500, { error: '服务处理失败，请重试' });
  });
});

server.listen(port, '127.0.0.1', () => {
  const address = server.address();
  console.log(`黄金邮道开发服务器已启动：http://127.0.0.1:${typeof address === 'object' && address ? address.port : port}`);
});
