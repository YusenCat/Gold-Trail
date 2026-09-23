import { spawn } from 'node:child_process';
import { createConnection } from 'node:net';
import { fileURLToPath } from 'node:url';

process.chdir(fileURLToPath(new URL('../', import.meta.url)));
const port = Number(process.env.PORT || 4173);
const noBrowser = process.argv.includes('--no-browser');
if (!Number.isInteger(port) || port < 1 || port > 65535) {
  console.error('启动失败：PORT 必须是 1 至 65535 之间的端口号。');
  process.exit(1);
}
const url = `http://127.0.0.1:${port}`;

async function isGameRunning() {
  try {
    const response = await fetch(`${url}/api/game`, { signal: AbortSignal.timeout(1200) });
    const data = await response.json();
    return response.ok && data.game?.rulesVersion && Array.isArray(data.actions);
  } catch { return false; }
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
  console.log(`游戏地址：${url}`);
  if (noBrowser) return;
  const browser = spawn('powershell.exe', [
    '-NoProfile', '-Command', `Start-Process '${url}'`,
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
    console.log('启动成功！请选择“本地人机”或“同屏对局”，然后点击“开始征程”。');
    console.log('游玩期间请保留本窗口。退出前先在游戏中“保存行程”，再按 Ctrl+C 停止服务。');
    openGame();
  }
} catch (error) {
  console.error(`启动失败：${error.message}`);
  process.exit(1);
}
