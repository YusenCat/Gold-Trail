import {readFile} from 'node:fs/promises';
import {extname,join,normalize} from 'node:path';
import type {IncomingMessage,ServerResponse} from 'node:http';
import {mapNodes,mapRoutes} from '../../packages/rules/src/index.ts';
import cardsData from '../../content/cards.v1.json' with {type:'json'};
import {json} from './http-utils.ts';
import {renderRulebook} from '../../packages/rules/src/rulebook.ts';
const mimeByExtension: Record<string, string> = {
  '.css': 'text/css; charset=utf-8',
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.jpg': 'image/jpeg',
  '.png': 'image/png',
  '.webp': 'image/webp',
  '.svg': 'image/svg+xml; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
};


export function createStaticHttp(root:string) {
const webRoot=join(root,'apps','web');
async function staticFile(response: ServerResponse, path: string): Promise<void> {
  const normalized = normalize(path).replace(/^([.][.][\\/])+/, '');
  const filePath = join(webRoot, normalized);
  const contents = await readFile(filePath);
  response.writeHead(200, { 'content-type': mimeByExtension[extname(filePath)] ?? 'application/octet-stream' });
  response.end(contents);
}


return async(request:IncomingMessage,response:ServerResponse,url:URL)=>{
 const method=request.method;
 if(method!=='GET')return false;
 if(url.pathname==='/api/map'){json(response,200,{nodes:mapNodes,routes:mapRoutes});return true;}
 if(url.pathname==='/api/cards'){json(response,200,{cards:cardsData.cards});return true;}
 if(url.pathname==='/api/rules'){json(response,200,{text:renderRulebook()});return true;}
    if (method === 'GET' && url.pathname === '/') return serve(response, 'index.html');
    if (method === 'GET' && /^\/(?:app\.js|styles\.css|expedition\.css|modules\/[a-z-]+\.js)$/.test(url.pathname)) return serve(response, url.pathname.slice(1));
    if (method === 'GET' && /^\/assets\/(?:cards\/[A-Z0-9_]+\.png|ui\/(?:card-frame|action-seals|hero-road|world-backdrop|hand-mat|action-panel|intel-ledger|mode-(?:solo|hotseat|guide)|expedition-world-v2|expedition-portraits-v2)\.webp|board-map\.png|board-background\.jpg|board-illustration\.svg)$/.test(url.pathname)) return serve(response, url.pathname.slice(1));

return false;
};
async function serve(response:ServerResponse,path:string){await staticFile(response,path);return true;}
}
