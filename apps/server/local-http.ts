import type {IncomingMessage,ServerResponse} from 'node:http';
import type {GameCommand} from '../../packages/rules/src/index.ts';
import type {LocalGameService} from './local-game-service.ts';
import {json,requestBody} from './http-utils.ts';
export async function handleLocalHttp(request:IncomingMessage,response:ServerResponse,path:string,service:LocalGameService) {
  if(request.method==='GET') {
    if(path==='/api/game'){json(response,200,service.view());return true;}
    if(path==='/api/saves'){json(response,200,await service.listSaves());return true;}
  }
  if(request.method!=='POST')return false;
  const handlers:Record<string,{status:number,run:(body:Record<string,unknown>)=>Promise<unknown>}>= {
    '/api/game/new':{status:201,run:body=>service.create(body)},
    '/api/game/start':{status:200,run:()=>service.start()},
    '/api/game/command':{status:200,run:body=>service.command(body as unknown as GameCommand)},
    '/api/game/bot-step':{status:200,run:body=>service.botStep(body)},
    '/api/saves':{status:201,run:body=>service.save(body)},
    '/api/saves/load':{status:200,run:body=>service.load(body)},
  };
  const handler=handlers[path];if(!handler)return false;
  json(response,handler.status,await handler.run(await requestBody(request)));return true;
}
