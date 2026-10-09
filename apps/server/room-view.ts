import balance from '../../content/balance.v1.json' with { type: 'json' };
import {foodAdvice} from '../../packages/rules/src/advice.ts';
import { publicView, legalMoveTargets } from '../../packages/rules/src/index.ts';
import { decisionActor, legalActions } from '../../packages/rules/src/actions.ts';
import { memberFaction, ownedCharacters, type Room, type RoomMember } from './room-store.ts';

/** All LAN response paths share this filter. Never return raw room.game. */
export function roomView(room: Room, member: RoomMember) {
  const faction = memberFaction(room, member);
  const owned = ownedCharacters(room, member);
  const actorId = room.status === 'lobby' ? null : decisionActor(room.game);
  const canAct = room.status === 'playing' && !!actorId && owned.includes(actorId);
  const game = faction && room.status !== 'lobby' ? publicView(room.game, faction) : null;
  if (game) {
    for (const character of game.characters) {
      if (character.faction !== faction) {
        character.blackMarketDrawnCardId = null;
        character.blackMarketRedrawAvailable = false;
      }
    }
  }
  return {
    room: {
      id: room.id, code: room.code, capacity: room.capacity, mode: room.mode,
      visibility:room.visibility??'private',inviteToken:room.inviteToken,
      status: room.status, revision: room.revision, hostId: room.hostId, epoch: room.epoch, pauseReason: room.pauseReason,
      members: room.members.map((m) => ({ playerId: m.playerId, nickname: m.nickname, seat: m.seat, ready: m.ready, online: m.online, characterIds: ownedCharacters(room, m) })),
    },
    me: { playerId: member.playerId, faction, characterIds: owned },
    game, canAct, decisionActorId: actorId,
    foodAdvice:game?foodAdvice(game,game.characters.filter(c=>c.faction===faction)):[],
    decisionPlayerId: room.members.find((m) => ownedCharacters(room, m).includes(actorId ?? ''))?.playerId ?? null,
    actions: canAct ? legalActions(room.game) : [],
    legalMoves: canAct && room.game.activeCharacterId === actorId ? legalMoveTargets(room.game, actorId!) : [],
    botPending: false,
    balance: {
      mineActionsPerTurn: balance.mineActionsPerCharacterTurn,
      mineFactionOutputLimit: balance.mineFactionOutputPerRound,
      openingMarketDiscount: balance.openingMarketDiscount,
      blackMarketBlindDrawPrice: balance.blackMarketBlindDrawPrice,
    },
  };
}
