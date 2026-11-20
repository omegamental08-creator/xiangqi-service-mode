// Minimal Chrome DevTools Protocol driver (no deps beyond ws)
// Usage: import { launchChrome } from './cdp.mjs'
import { spawn } from 'node:child_process';
import { createRequire } from 'node:module';

const require = createRequire('C:/Users/mentalOmega/Desktop/chess-bd/online-validation/');
const WebSocket = require('ws');

const CHROME = 'C:/Program Files/Google/Chrome/Application/chrome.exe';

export async function launchChrome(opts = {}) {
  const port = opts.port || 9333;
  const userDataDir = opts.userDataDir || 'C:/Users/mentalOmega/Desktop/chess-bd/match/.chrome-profile';
  const args = [
    '--headless=new',
    `--remote-debugging-port=${port}`,
    `--user-data-dir=${userDataDir}`,
    '--no-first-run', '--no-default-browser-check',
    '--disable-gpu', '--disable-dev-shm-usage',
    '--window-size=1600,1000',
    '--allow-file-access-from-files',
    'about:blank'
  ];
  const proc = spawn(CHROME, args, { stdio: 'ignore', detached: false });

  let version = null;
  for (let i = 0; i < 100; i++) {
    try {
      const res = await fetch(`http://127.0.0.1:${port}/json/version`);
      version = await res.json();
      break;
    } catch { await sleep(150); }
  }
  if (!version) throw new Error('Chrome 启动失败：拿不到 /json/version');

  const ws = new WebSocket(version.webSocketDebuggerUrl, { perMessageDeflate: false, maxPayload: 256 * 1024 * 1024 });
  await new Promise((resolve, reject) => { ws.once('open', resolve); ws.once('error', reject); });

  let id = 0;
  const pending = new Map();
  ws.on('message', raw => {
    let msg; try { msg = JSON.parse(raw.toString()); } catch { return; }
    if (msg.id && pending.has(msg.id)) {
      const { resolve, reject } = pending.get(msg.id);
      pending.delete(msg.id);
      if (msg.error) reject(new Error(msg.error.message + ' ' + JSON.stringify(msg.error.data || '')));
      else resolve(msg.result);
    }
  });

  const send = (method, params = {}, sessionId) => new Promise((resolve, reject) => {
    const msgId = ++id;
    pending.set(msgId, { resolve, reject });
    const payload = { id: msgId, method, params };
    if (sessionId) payload.sessionId = sessionId;
    ws.send(JSON.stringify(payload));
    setTimeout(() => { if (pending.has(msgId)) { pending.delete(msgId); reject(new Error('CDP 超时: ' + method)); } }, 60000);
  });

  async function newPage(url) {
    const { targetId } = await send('Target.createTarget', { url: 'about:blank' });
    const { sessionId } = await send('Target.attachToTarget', { targetId, flatten: true });
    await send('Page.enable', {}, sessionId);
    await send('Runtime.enable', {}, sessionId);
    await send('Log.enable', {}, sessionId).catch(() => {});
    await send('Page.navigate', { url }, sessionId);
    return { targetId, sessionId };
  }

  async function evaluate(sessionId, expression, awaitPromise = true) {
    const r = await send('Runtime.evaluate', {
      expression, awaitPromise, returnByValue: true, userGesture: true
    }, sessionId);
    if (r.exceptionDetails) {
      const d = r.exceptionDetails;
      throw new Error('页面 JS 异常: ' + (d.exception?.description || d.text));
    }
    return r.result?.value;
  }

  async function close() {
    try { await send('Browser.close'); } catch {}
    try { ws.close(); } catch {}
    try { proc.kill(); } catch {}
  }

  return { send, newPage, evaluate, close, port, version };
}

export const sleep = ms => new Promise(r => setTimeout(r, ms));
