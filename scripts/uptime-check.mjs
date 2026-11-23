#!/usr/bin/env node
// External uptime check. Needs Node 22+ for the built-in WebSocket. Exits 1 if the mesh is down.
// Alerts only when the state changes, using the state file as memory between runs.
import { readFileSync, writeFileSync } from 'node:fs';

const API = process.env.MESH_API_URL || 'https://mesh.mudvault.org/api/v1';
const WS = process.env.MESH_WS_URL || 'wss://mesh.mudvault.org/ws';
const WEBHOOK = process.env.DISCORD_WEBHOOK_URL || '';
const STATE_FILE = process.env.UPTIME_STATE_FILE || '.uptime-state.json';
const FAILURES_TO_ALERT = Number(process.env.FAILURES_TO_ALERT || 2);
const RETRY_MS = Number(process.env.RETRY_MS || 20000);
const TIMEOUT_MS = 10000;

async function checkHttp() {
  const reply = await fetch(`${API}/health`, {
    headers: { 'User-Agent': 'Mozilla/5.0' },
    signal: AbortSignal.timeout(TIMEOUT_MS)
  });
  const body = await reply.json().catch(() => ({}));
  if (!reply.ok || body.status !== 'healthy') {
    throw new Error(`health returned HTTP ${reply.status}${body.redis === false ? ' (Redis is down)' : ''}`);
  }
}

// A login with no token must be refused. That proves the gateway process is really answering.
function checkWebSocket() {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(WS);
    const timer = setTimeout(() => {
      ws.close();
      reject(new Error('WebSocket did not answer in time'));
    }, TIMEOUT_MS);
    const finish = (error) => {
      clearTimeout(timer);
      ws.close();
      error ? reject(error) : resolve();
    };
    ws.onopen = () => ws.send('{}');
    ws.onmessage = (event) => {
      try {
        finish(JSON.parse(event.data).type === 'error' ? undefined : new Error('unexpected WebSocket reply'));
      } catch {
        finish(new Error('WebSocket reply was not JSON'));
      }
    };
    ws.onerror = () => finish(new Error('WebSocket connection failed'));
  });
}

async function probe() {
  const results = await Promise.allSettled([checkHttp(), checkWebSocket()]);
  return results.filter(r => r.status === 'rejected').map(r => r.reason?.message || 'unknown error');
}

async function alert(title, description, color) {
  if (!WEBHOOK) {
    console.log(`[no webhook] ${title}: ${description}`);
    return;
  }
  const reply = await fetch(WEBHOOK, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'User-Agent': 'Mozilla/5.0' },
    body: JSON.stringify({
      allowed_mentions: { parse: [] },
      embeds: [{ title, description, color, timestamp: new Date().toISOString() }]
    }),
    signal: AbortSignal.timeout(TIMEOUT_MS)
  });
  if (!reply.ok) {
    throw new Error(`Discord webhook returned HTTP ${reply.status}`);
  }
}

function loadState() {
  try {
    return JSON.parse(readFileSync(STATE_FILE, 'utf8'));
  } catch {
    return { down: false, since: null };
  }
}

let problems = await probe();
for (let attempt = 1; problems.length > 0 && attempt < FAILURES_TO_ALERT; attempt++) {
  await new Promise(resolve => setTimeout(resolve, RETRY_MS));
  problems = await probe();
}

const state = loadState();
const now = new Date().toISOString();
if (problems.length > 0 && !state.down) {
  await alert('🔴 MudVault Mesh is down', problems.join('\n').slice(0, 1800), 0xcc241d);
  state.down = true;
  state.since = now;
} else if (problems.length === 0 && state.down) {
  const minutes = Math.round((Date.now() - Date.parse(state.since)) / 60000);
  await alert('🟢 MudVault Mesh is back', `Down for about ${minutes} minute${minutes === 1 ? '' : 's'}.`, 0x98971a);
  state.down = false;
  state.since = null;
}
writeFileSync(STATE_FILE, JSON.stringify(state));

console.log(problems.length ? `DOWN: ${problems.join('; ')}` : 'UP');
process.exitCode = problems.length ? 1 : 0;
