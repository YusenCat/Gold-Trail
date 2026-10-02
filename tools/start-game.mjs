import { spawn } from 'node:child_process';
import { createConnection } from 'node:net';
import { fileURLToPath } from 'node:url';
import { lanAddresses } from '../apps/server/network-info.ts';

process.chdir(fileURLToPath(new URL('../', import.meta.url)));
const port = Number(process.env.PORT || 4173);
const noBrowser = process.argv.includes('--no-browser');
const lan = !process.argv.includes('--local-only');
const addressOption = process.argv.find((arg) => arg.startsWith('--address='))?.slice(10);
const addresses = lanAddresses();
if (addressOption && !addresses.some((entry) => entry.address === addressOption)) {
  console.error('启动失败：--address 必须是本机网卡的 IPv4 地址。'); process.exit(1);
}
process.env.GAME_LAN = lan ? '1' : '0';
if (!Number.isInteger(port) || port < 1 || port > 65535) {
  console.error('启动失败：PORT 必须是 1 至 65535 之间的端口号。');
  process.exit(1);
}
const url = `http://127.0.0.1:${port}`;

async function isGameRunning() {
  try {
    const response = await fetch(`${url}/api/game`, { signal: AbortSignal.timeout(1200) });
    const data = await response.json();
    if (!(response.ok && data.game?.rulesVersion && Array.isArray(data.actions))) return false;
    const session = await (await fetch(`${url}/api/session`, { signal: AbortSignal.timeout(1200) })).json();
    if (session.entry !== 'unified') throw new Error('当前运行的是旧版服务。请先在原启动窗口按 Ctrl+C 关闭，再运行“启动游戏.cmd”。');
    if (lan && !session.lan) throw new Error('当前运行的是本地服务。请先在原启动窗口按 Ctrl+C 关闭，再运行“启动游戏.cmd”进入统一大厅。');
    return true;
  } catch (error) { if (error.message?.startsWith('当前运行的是')) throw error; return false; }
}

function portOccupied() {
  return new Promise(resolve => {
    const socket = createConnection({ host: '127.0.0.1', port });
    const finish = result => { socket.destroy(); resolve(result); };
    socket.once('connect', () => finish(true));
    socket.once('error', () => finish(false));
    socket.setTimeout(1200, () => finish(true));
  });
}

function openGame() {
  const browserUrl = addressOption ? `${url}/?network=${addressOption}` : url;
  console.log(`游戏地址：${browserUrl}`);
  if (lan) {
    for (const entry of addresses) console.log(`候选地址（${entry.name}）：http://${entry.address}:${port}`);
    console.log('主机在同一个大厅选择人机、同屏或联机。联机房间会生成所选网卡的邀请链接。朋友打开邀请链接即可入席。');
    if (addresses.length > 1) console.log('多网卡可在大厅切换邀请地址，或启动时指定 node tools/start-game.mjs --address=你的IPv4地址。主机可保持本机大厅，朋友使用所选邀请地址。');
    if (!addresses.length) console.log('未找到可用局域网网卡，请连接 Wi-Fi 或有线网络后重启。');
  }
  if (noBrowser) return;
  const browser = spawn('powershell.exe', [
    '-NoProfile', '-Command', `Start-Process '${browserUrl}'`,
  ], { windowsHide: true, stdio: 'ignore' });
  browser.on('error', () => console.log('未能自动打开浏览器，请手动打开上面的游戏地址。'));
  browser.on('exit', code => {
    if (code) console.log('未能自动打开浏览器，请手动打开上面的游戏地址。');
  });
}

try {
  console.log('二十二驿 · 黄金邮道');
  if (await isGameRunning()) {
    console.log('游戏已经运行，正在打开现有对局。');
    openGame();
  } else {
    if (await portOccupied()) throw new Error(`端口 ${port} 已被其他程序占用，请关闭占用程序后再启动，或设置 PORT 使用其他端口。`);
    process.env.PORT = String(port);
    await import('../apps/server/server.ts');
    let ready = false;
    for (let attempt = 0; attempt < 40; attempt++) {
      if (await isGameRunning()) { ready = true; break; }
      await new Promise(resolve => setTimeout(resolve, 250));
    }
    if (!ready) throw new Error('服务未能就绪，请将窗口里的错误信息反馈给开发者。');
    console.log(lan ? '启动成功！人机与联机服务已就绪，请在驿站大厅选择对战方式。' : '启动成功！请选择“本地人机”或“同屏对局”，然后点击“开始征程”。');
    console.log(lan ? '请保留本窗口。操作自动同步，每步自动保留；断线或服务重启后，由全员使用原浏览器回来，再由房主继续。可另行“保存行程”建立命名存档。' : '游玩期间请保留本窗口。退出前先在游戏中“保存行程”，再按 Ctrl+C 停止服务。');
    openGame();
  }
} catch (error) {
  console.error(`启动失败：${error.message}`);
  process.exit(1);
}
