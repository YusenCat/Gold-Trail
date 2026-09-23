import { mkdir, readFile, readdir, rename, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import type { GameState } from '../../packages/rules/src/index.ts';
import { mapVersion } from '../../packages/rules/src/map.ts';
import balance from '../../content/balance.v1.json' with { type: 'json' };

export interface SaveSummary {
  id: string;
  name: string;
  savedAt: string;
  round: number;
  phase: GameState['phase'];
  mode: GameState['mode'];
  kind?: GameState['session']['kind'];
  faction?: GameState['session']['humanFaction'];
}

interface SaveFile {
  schemaVersion: 1;
  summary: SaveSummary;
  game: GameState;
}

function safeId(value: string): string {
  const id = value.trim();
  if (!/^[\p{L}\p{N}_-]{1,48}$/u.test(id) || /^(con|prn|aux|nul|com[1-9]|lpt[1-9])$/i.test(id)) throw new Error('存档名请使用一至四十八个汉字、字母、数字或短横线');
  return id;
}

function safeName(value: string): string {
  const name = value.trim().normalize('NFC');
  if (!name || [...name].length > 48 || /[\u0000-\u001f\u007f/\\:*?"<>|]/u.test(name) || /[. ]$/u.test(name)) {
    throw new Error('存档名需为一至四十八个字符，不能包含路径符号或控制字符');
  }
  if (/^(con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/i.test(name)) throw new Error('这个名称不能用于存档');
  return name;
}

function idForName(name: string): string {
  // Keep existing simple-name save paths stable; encode other human-readable names as safe filenames.
  if (/^[\p{L}\p{N}_-]{1,48}$/u.test(name) && !/^(con|prn|aux|nul|com[1-9]|lpt[1-9])$/i.test(name)) return name;
  return `n_${Buffer.from(name, 'utf8').toString('base64url')}`;
}

export class SaveConflictError extends Error {
  readonly existing: SaveSummary;

  constructor(existing: SaveSummary) {
    super('同名存档已存在');
    this.name = 'SaveConflictError';
    this.existing = existing;
  }
}

export class SaveNotFoundError extends Error {
  constructor() {
    super('没有找到这个存档，它可能已被移走或删除。');
    this.name = 'SaveNotFoundError';
  }
}

export class SaveStore {
  private readonly directory: string;

  constructor(directory: string) {
    this.directory = directory;
  }

  private pathFor(id: string): string {
    return join(this.directory, `${safeId(id)}.json`);
  }

  async list(): Promise<SaveSummary[]> {
    await mkdir(this.directory, { recursive: true });
    const files = await readdir(this.directory, { withFileTypes: true });
    const saves: SaveSummary[] = [];
    for (const file of files) {
      if (!file.isFile() || !file.name.endsWith('.json')) continue;
      try {
        const parsed = JSON.parse(await readFile(join(this.directory, file.name), 'utf8')) as SaveFile;
        if (parsed.schemaVersion === 1 && parsed.summary && parsed.summary.id !== '_recovery') saves.push(parsed.summary);
      } catch { /* A malformed file is ignored rather than preventing other saves from loading. */ }
    }
    return saves.sort((a, b) => b.savedAt.localeCompare(a.savedAt));
  }

  async save(rawName: string, game: GameState, overwrite = false): Promise<SaveSummary> {
    await mkdir(this.directory, { recursive: true });
    const name = safeName(rawName);
    const id = idForName(name);
    const target = this.pathFor(id);
    if (!overwrite) {
      try {
        let parsed: SaveFile;
        try { parsed = JSON.parse(await readFile(target, 'utf8')) as SaveFile; }
        catch (error) {
          if (error instanceof SyntaxError) throw new SaveConflictError({ id, name, savedAt: '', round: 0, phase: game.phase, mode: game.mode });
          throw error;
        }
        throw new SaveConflictError(parsed.summary ?? { id, name, savedAt: '', round: 0, phase: game.phase, mode: game.mode });
      } catch (error) {
        if (error instanceof SaveConflictError) throw error;
        if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
      }
    }
    const summary: SaveSummary = { id, name, savedAt: new Date().toISOString(), round: game.round, phase: game.phase, mode: game.mode, kind: game.session.kind, faction: game.session.humanFaction };
    const payload: SaveFile = { schemaVersion: 1, summary, game };
    const temporary = `${target}.tmp`;
    await writeFile(temporary, JSON.stringify(payload, null, 2), 'utf8');
    await rename(temporary, target);
    return summary;
  }

  async load(id: string): Promise<GameState> {
    let contents: string;
    try { contents = await readFile(this.pathFor(id), 'utf8'); }
    catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') throw new SaveNotFoundError();
      throw error;
    }
    const parsed = JSON.parse(contents) as SaveFile;
    if (parsed.schemaVersion !== 1 || !parsed.game || parsed.game.schemaVersion !== '1.0.0') throw new Error('存档版本不受支持或文件已损坏');
    if (parsed.game.rulesVersion !== '1.1.0') throw new Error('这是旧规则试玩存档，原文件仍保留。当前采用一一点零规则，请新建对局。');
    const game = parsed.game;
    if (!['race','fixedRounds'].includes(game.mode) || !['hotseat','solo'].includes(game.session?.kind) || !['smuggler','officer'].includes(game.session?.humanFaction) || !Array.isArray(game.characters) || game.characters.length !== 4 || !Number.isInteger(game.round) || game.round < 1 || !Array.isArray(game.log)) throw new Error('存档结构不完整');
    // 1.3.0 added a per-faction mine ledger. Older 1.x saves retain their
    // position and resources, and begin the current round with an empty ledger.
    game.mineOutputByFaction ??= { smuggler: 0, officer: 0 };
    // New map encounters and action dice are additive fields on existing 1.1 saves.
    for (const actor of game.characters) {
      actor.actionRoll ??= null;
      actor.siteVisitsThisTurn ??= [];
    }
    game.mapVersion = mapVersion;
    game.balanceVersion = balance.version;
    for (const actor of game.characters) {
      if (![actor.gold,actor.silver,actor.food,actor.actionPoints,actor.lockbox?.gold,actor.lockbox?.silver].every((n) => Number.isInteger(n) && n >= 0) || !Array.isArray(actor.hand) || actor.hand.length > 5) throw new Error('存档角色数据无效');
    }
    return parsed.game;
  }

  async saveRecovery(game: GameState): Promise<void> {
    await mkdir(this.directory, { recursive: true });
    const payload: SaveFile = { schemaVersion: 1, summary: { id: '_recovery', name: '自动恢复', savedAt: new Date().toISOString(), round: game.round, phase: game.phase, mode: game.mode, kind: game.session.kind, faction: game.session.humanFaction }, game };
    const target = join(this.directory, '_recovery.json');
    await writeFile(`${target}.tmp`, JSON.stringify(payload), 'utf8');
    await rename(`${target}.tmp`, target);
  }

  async loadRecovery(): Promise<GameState | null> {
    try { return await this.load('_recovery'); }
    catch { return null; }
  }
}
