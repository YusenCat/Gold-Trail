import { applyCommand, createInitialGame, legalMoveTargets, publicView, RuleError, startGame, type GameCommand, type GameState } from '../../packages/rules/src/index.ts';
import { decisionActor, legalActions } from '../../packages/rules/src/actions.ts';
import { chooseBotCommand, isBotTurn } from '../../packages/rules/src/bot.ts';
import balance from '../../content/balance.v1.json' with { type:'json' };
import { SaveStore } from './save-store.ts';

// Owns the host's local match. LAN rooms have their own RoomService and storage.
export class LocalGameService {
  private game: GameState = createInitialGame(20260922, 'race');
  private saves: SaveStore;
  constructor(saves: SaveStore) { this.saves=saves; }
  async initialize() { this.game = (await this.saves.loadRecovery()) ?? this.game; }
  get phase() { return this.game.phase; }
  view() {
    const game = this.game, botPending = isBotTurn(game);
    return {game:publicView(game,game.session.kind === 'solo' ? game.session.humanFaction : undefined),
      legalMoves:!botPending && game.activeCharacterId ? legalMoveTargets(game,game.activeCharacterId) : [],
      actions:botPending ? [] : legalActions(game), decisionActorId:decisionActor(game), botPending,
      balance:{mineActionsPerTurn:balance.mineActionsPerCharacterTurn,mineFactionOutputLimit:balance.mineFactionOutputPerRound,
        openingMarketDiscount:balance.openingMarketDiscount,blackMarketBlindDrawPrice:balance.blackMarketBlindDrawPrice}};
  }
  private async commit(next: GameState) { await this.saves.saveRecovery(next); this.game=next; return this.view(); }
  async create(body: Record<string,unknown>) {
    const seed = Number.isInteger(body.seed) ? body.seed as number : Date.now();
    const next = createInitialGame(seed,body.mode === 'fixedRounds' ? 'fixedRounds' : 'race');
    next.revision = this.game.revision + 1;
    next.session = {kind:body.kind === 'solo' ? 'solo' : 'hotseat',humanFaction:body.humanFaction === 'officer' ? 'officer' : 'smuggler'};
    return this.commit(body.start ? startGame(next) : next);
  }
  start() { return this.commit(startGame(this.game)); }
  async command(body: GameCommand & {revision?:number}) {
    this.checkRevision(body.revision);
    if (isBotTurn(this.game)) throw new RuleError('当前由人机决策');
    if (this.game.session.kind === 'solo' && this.game.characters.find(c=>c.id===body.actorId)?.faction !== this.game.session.humanFaction) throw new RuleError('只能操控自己阵营的角色');
    return this.commit(applyCommand(this.game,body));
  }
  async botStep(body: Record<string,unknown>) {
    this.checkRevision(body.revision);
    if (!isBotTurn(this.game)) return this.view();
    const command = chooseBotCommand(this.game);
    if (!command) throw new RuleError('人机没有可用动作，请保存局面以便排查');
    return this.commit(applyCommand(this.game,command));
  }
  private checkRevision(revision:unknown) { if(revision!==this.game.revision)throw new RuleError('局面已更新，请刷新后重试'); }
  async listSaves() { return {saves:await this.saves.list()}; }
  async save(body:Record<string,unknown>) {
    if(typeof body.name!=='string')throw new RuleError('请提供存档名');
    if(body.overwrite!==undefined&&typeof body.overwrite!=='boolean')throw new RuleError('覆盖选项无效');
    return {save:await this.saves.save(body.name,this.game,body.overwrite===true)};
  }
  async load(body:Record<string,unknown>) {
    if(typeof body.id!=='string')throw new RuleError('请提供存档编号');
    const loaded=await this.saves.load(body.id); loaded.revision=Math.max(loaded.revision,this.game.revision)+1;
    return this.commit(loaded);
  }
}
