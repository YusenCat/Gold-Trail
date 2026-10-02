import { networkInterfaces } from 'node:os';
export function lanAddresses() {
  return Object.entries(networkInterfaces()).flatMap(([name, entries]) => (entries ?? [])
    .filter(entry => entry.family === 'IPv4' && !entry.internal)
    .map(entry => ({ name, address:entry.address })))
    .sort((a,b) => Number(/virtual|vmware|hyper-v|vethernet|vpn|tap|tun|loopback/i.test(a.name)) - Number(/virtual|vmware|hyper-v|vethernet|vpn|tap|tun|loopback/i.test(b.name)));
}
export function sessionCapabilities(local: boolean, lan: boolean, port: number, heartbeatMs: number, timeoutMs: number) {
  return {local, lan, stage:4, heartbeatMs, timeoutMs, entry:'unified', modes:{solo:local,hotseat:local,lan},
    lanAddresses:local && lan ? lanAddresses().map(entry => ({...entry,url:`http://${entry.address}:${port}`})) : []};
}
