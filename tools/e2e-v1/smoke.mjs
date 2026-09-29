// Headless smoke test: load the built SPA, collect console errors/exceptions,
// read the diagnostics journal from localStorage.
import { spawn } from 'node:child_process';
const port = 9333;
const chrome = spawn('google-chrome', ['--headless=new', `--remote-debugging-port=${port}`, '--no-first-run',
  '--user-data-dir=' + process.cwd() + '/chrome-prof', 'about:blank'], { stdio: 'ignore' });
const sleep = (ms) => new Promise(r => setTimeout(r, ms));
let targets;
for (let i = 0; i < 50; i++) { try { targets = await (await fetch(`http://127.0.0.1:${port}/json`)).json(); break; } catch { await sleep(200); } }
const page = targets.find(t => t.type === 'page');
const ws = new WebSocket(page.webSocketDebuggerUrl);
await new Promise(r => ws.onopen = r);
let id = 0; const pending = new Map(); const errors = [];
ws.onmessage = (m) => {
  const msg = JSON.parse(m.data);
  if (msg.id && pending.has(msg.id)) { pending.get(msg.id)(msg.result); pending.delete(msg.id); }
  if (msg.method === 'Runtime.exceptionThrown') errors.push('EXC ' + JSON.stringify(msg.params.exceptionDetails.exception?.description || msg.params.exceptionDetails.text).slice(0, 300));
  if (msg.method === 'Runtime.consoleAPICalled' && msg.params.type === 'error') errors.push('CONSOLE ' + JSON.stringify(msg.params.args.map(a => a.value ?? a.description)).slice(0, 300));
};
const send = (method, params = {}) => new Promise(r => { const i = ++id; pending.set(i, r); ws.send(JSON.stringify({ id: i, method, params })); });
await send('Runtime.enable');
await send('Page.enable');
await send('Page.navigate', { url: process.argv[2] });
await sleep(6000);
const r = await send('Runtime.evaluate', { expression: `JSON.stringify({journal: localStorage.getItem('musix_playback_diag'), title: document.title, root: document.getElementById('root')?.children.length, sw: !!navigator.serviceWorker?.controller})`, returnByValue: true });
console.log('RESULT', r.result.value);
console.log('ERRORS', errors.length ? errors.join('\n') : 'none');
ws.close(); chrome.kill();
process.exit(0);
