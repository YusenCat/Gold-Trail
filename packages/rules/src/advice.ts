import {isSafeNode} from './map.ts';
import type {GameState,CharacterState} from './state.ts';
/** Next event is unknown: expose ordinary supply separately from possible event hunger. */
export function foodAdvice(game:GameState,characters:CharacterState[]) {
 return characters.filter(c=>c.deadUntilRound===null).map(c=>({characterId:c.id,food:c.food,ordinaryCost:isSafeNode(c.nodeId)?0:1,risk:c.food===0&&!isSafeNode(c.nodeId)?'urgent':c.food<=1?'low':'safe'}));
}
