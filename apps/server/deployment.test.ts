import test from 'node:test';
import assert from 'node:assert/strict';
import type {IncomingMessage} from 'node:http';
import {deployment} from './deployment.ts';
const request=(headers:Record<string,string>,peer='127.0.0.1')=>({headers,socket:{remoteAddress:peer}} as IncomingMessage);
test('public deployment requires an explicit HTTPS origin and never grants loopback local access',()=>{
  for(const value of ['', 'http://game.example', 'https://user:pass@game.example','https://game.example/path','https://game.example/?key=x'])assert.throws(()=>deployment({GAME_MODE:'public',GAME_PUBLIC_ORIGIN:value}));
  const host=deployment({GAME_MODE:'public',GAME_PUBLIC_ORIGIN:'https://game.example'});
  assert.equal(host.local(request({host:'game.example'})),false);
  assert.equal(host.requestBase(request({host:'game.example','x-forwarded-proto':'http','x-forwarded-host':'evil.example'})).origin,'https://game.example');
  for(const value of ['evil.example','game.example:8080','game.example@evil.example','game.example/'])assert.throws(()=>host.requestBase(request({host:value})));
});
test('LAN keeps IP/localhost access while only configured proxy peers affect rate-limit addresses',()=>{
  const lan=deployment({});assert.equal(lan.local(request({})),true);assert.equal(lan.local(request({},'192.168.1.2')),false);
  assert.equal(lan.requestBase(request({host:'192.168.1.2:4173'})).origin,'http://192.168.1.2:4173');
  assert.throws(()=>lan.requestBase(request({host:'game.example'})));
  assert.equal(lan.clientAddress(request({'x-forwarded-for':'8.8.8.8'})),'127.0.0.1');
  const trusted=deployment({GAME_TRUSTED_PROXIES:'127.0.0.1'});
  assert.equal(trusted.clientAddress(request({'x-forwarded-for':'fake, 192.168.1.2'})),'192.168.1.2');
  assert.equal(trusted.clientAddress(request({'x-forwarded-for':'8.8.8.8'},'192.168.1.3')),'192.168.1.3');
  assert.equal(trusted.clientAddress(request({'x-forwarded-for':'invalid'})),'127.0.0.1');
});
