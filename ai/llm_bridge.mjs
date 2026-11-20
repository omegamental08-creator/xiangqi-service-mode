/**
 * 象棋兵役模式 —— 小模型（LLM）桥接服务
 * ---------------------------------------------------------------
 * 作用：把游戏里的「外部AI接口」接到本地小模型上。
 *  游戏 (chess_service_final.html)  --POST-->  本服务  --HTTP-->  Ollama (本地小模型)
 *  请求: { protocol:'chess-barracks-ai/v1', player, state, legalActions, requestId }
 *  响应: { action: <从 legalActions 里挑出的那一个> }
 *
 * 运行：
 *   node ai/llm_bridge.mjs                 # 默认 127.0.0.1:8091，模型见 OLLAMA_MODEL
 *   $env:MOCK='1'; node ai/llm_bridge.mjs  # 不出模型，随机挑一步（只测链路）
 * 环境变量：
 *   PORT=8091  OLLAMA_URL=http://127.0.0.1:11434  OLLAMA_MODEL=qwen3:4b
 *   TIMEOUT_MS=25000  TEMP=0.2  LOG=ai/logs/llm-decisions.jsonl  MOCK=0
 *
 * 注意：游戏是网页，跨域访问本服务，因此这里必须带 CORS 头并处理 OPTIONS 预检。
 */
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const PORT = Number(process.env.PORT || 8091);
const OLLAMA_URL = process.env.OLLAMA_URL || 'http://127.0.0.1:11434';
const MODEL = process.env.OLLAMA_MODEL || 'qwen3:4b';
const TIMEOUT_MS = Number(process.env.TIMEOUT_MS || 25000);
const TEMP = Number(process.env.TEMP ?? 0.2);
const MOCK = process.env.MOCK === '1';
const LOG_FILE = process.env.LOG || path.join(HERE, 'logs', 'llm-decisions.jsonl');
const DUMP_DIR = process.env.DUMP_DIR || path.join(HERE, 'logs', 'payloads');

fs.mkdirSync(path.dirname(LOG_FILE), { recursive: true });

/* ------------------------------------------------------------ 日志 */
function logLine(obj) {
  try { fs.appendFileSync(LOG_FILE, JSON.stringify(obj) + '\n'); } catch { /* ignore */ }
}

/* ------------------------------------------------- 局面 → 紧凑文本 */
const MAX_STATE_CHARS = 4000;

function compactState(state) {
  if (!state || typeof state !== 'object') return String(state ?? '');
  const bits = [];
  const scalars = ['turn', 'round', 'phase', 'currentPlayer', 'activePlayer', 'winner', 'status', 'moveCount'];
  for (const k of scalars) if (state[k] !== undefined && typeof state[k] !== 'object') bits.push(`${k}=${state[k]}`);
  for (const k of ['resources', 'pools', 'supply', 'score']) {
    if (state[k] && typeof state[k] === 'object') bits.push(`${k}=${JSON.stringify(state[k])}`);
  }
  // 棋盘：常见字段名逐个试，渲染成文本网格
  const boardKey = ['board', 'grid', 'cells', 'map', 'tiles'].find((k) => Array.isArray(state[k]));
  if (boardKey) {
    const rows = state[boardKey];
    if (Array.isArray(rows[0])) {
      bits.push(`board(${boardKey} ${rows.length}x${rows[0].length}):`);
      for (const row of rows) {
        bits.push('  ' + row.map((c) => {
          if (c == null) return '.';
          if (typeof c === 'string') return c.slice(0, 3);
          return String(c.type || c.kind || c.piece || c.name || '?').slice(0, 3);
        }).join(' '));
      }
    }
  }
  let text = bits.join('\n');
  if (text.length < 40) text = JSON.stringify(state);
  if (text.length > MAX_STATE_CHARS) text = text.slice(0, MAX_STATE_CHARS) + '\n...(截断)';
  return text;
}

function describeAction(a, i) {
  if (!a || typeof a !== 'object') return `${i}. ${String(a)}`;
  const from = a.from ? `(${a.from.x},${a.from.y})` : (a.x !== undefined ? `(${a.x},${a.y})` : '');
  const to = a.to ? `->(${a.to.x},${a.to.y})` : (a.toX !== undefined ? `->(${a.toX},${a.toY})` : '');
  const parts = [a.type, a.pieceType || a.produceType, from + to].filter(Boolean);
  const extra = [];
  if (a.targetType) extra.push('目标=' + a.targetType);
  if (a.baseScore != null) extra.push('基础分=' + a.baseScore);
  if (a.progress != null) extra.push('推进=' + a.progress);
  if (a.risk != null) extra.push('风险=' + a.risk);
  return `${i}. ${parts.join(' ')}${extra.length ? ' [' + extra.join(' ') + ']' : ''}`;
}

function buildPrompt(payload) {
  const actions = Array.isArray(payload.legalActions) ? payload.legalActions : [];
  const lines = actions.slice(0, 120).map(describeAction);
  const system = [
    '你是「象棋兵役模式」的对局 AI。你只能从给定的合法行动里挑一个，绝不能发明新行动。',
    '目标是赢：吃掉对方将军（jiang）即胜；同时注意自己将军的安全、保持兵力与生产。',
    '只输出 JSON，格式：{"index": 编号, "reason": "一句话理由"}，index 必须是候选列表里的编号。',
  ].join('\n');
  const user = [
    `我方: ${payload.player ?? '?'}`,
    '当前局面:',
    compactState(payload.state),
    '',
    '合法行动（挑一个）:',
    lines.join('\n'),
  ].join('\n');
  return { system, user, count: actions.length };
}

/* ------------------------------------------------------- 调 Ollama */
const RESPONSE_SCHEMA = {
  type: 'object',
  properties: { index: { type: 'integer' }, reason: { type: 'string' } },
  required: ['index'],
};

async function askModel(prompt, timeoutMs) {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const res = await fetch(`${OLLAMA_URL}/api/chat`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      signal: ctrl.signal,
      body: JSON.stringify({
        model: MODEL,
        stream: false,
        format: RESPONSE_SCHEMA,          // 结构化输出：只允许这个 JSON 形状
        options: { temperature: TEMP, num_predict: 96, top_p: 0.9 },
        messages: [
          { role: 'system', content: prompt.system },
          { role: 'user', content: prompt.user },
        ],
      }),
    });
    if (!res.ok) throw new Error('ollama HTTP ' + res.status + ' ' + (await res.text()).slice(0, 200));
    const data = await res.json();
    const text = data?.message?.content ?? '';
    const parsed = JSON.parse(text);
    return { index: Number(parsed.index), reason: String(parsed.reason || ''), raw: text };
  } finally {
    clearTimeout(t);
  }
}

/* ----------------------------------------------------------- 服务 */
function pickByIndex(actions, index) {
  if (!Number.isInteger(index)) return null;
  if (actions[index - 1] !== undefined) return actions[index - 1]; // 1-based
  if (actions[index] !== undefined) return actions[index];         // 0-based 兜底
  return null;
}

function send(res, code, body, extra = {}) {
  const data = typeof body === 'string' ? body : JSON.stringify(body);
  res.writeHead(code, {
    'Content-Type': 'application/json; charset=utf-8',
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': '*',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Cache-Control': 'no-store',
    ...extra,
  });
  res.end(data);
}

const server = http.createServer(async (req, res) => {
  if (req.method === 'OPTIONS') return send(res, 204, '');
  if (req.method === 'GET') return send(res, 200, { ok: true, model: MOCK ? 'mock' : MODEL, protocol: 'chess-barracks-ai/v1', mock: MOCK });
  if (req.method !== 'POST') return send(res, 405, { error: 'method not allowed' });

  let raw = '';
  for await (const chunk of req) raw += chunk;
  const t0 = Date.now();
  let payload;
  try { payload = JSON.parse(raw); } catch { return send(res, 400, { error: 'bad json' }); }

  const actions = Array.isArray(payload.legalActions) ? payload.legalActions : [];
  if (!actions.length) return send(res, 200, { action: null, note: 'no legal actions' });

  // 首次见到真实请求时留档，方便按真实 schema 调整压缩逻辑
  try {
    const f = path.join(DUMP_DIR, `payload-${Date.now()}.json`);
    fs.mkdirSync(DUMP_DIR, { recursive: true });
    if (!fs.existsSync(path.join(DUMP_DIR, '.once'))) {
      fs.writeFileSync(f, JSON.stringify(payload, null, 1));
      fs.writeFileSync(path.join(DUMP_DIR, '.once'), String(f));
    }
  } catch { /* ignore */ }

  const prompt = buildPrompt(payload);
  let chosen = null, note = '', reason = '';
  try {
    if (MOCK) {
      const idx = 1 + Math.floor(Math.random() * actions.length);
      chosen = actions[idx - 1];
      note = 'mock';
      reason = 'mock 模式：随机挑一步（用于验证链路）';
    } else {
      const out = await askModel(prompt, TIMEOUT_MS);
      reason = out.reason;
      chosen = pickByIndex(actions, out.index);
      if (!chosen) { note = 'model index out of range: ' + out.index; }
    }
  } catch (err) {
    note = 'LLM 失败，回退脚本 AI: ' + (err?.message || err);
  }

  const latency = Date.now() - t0;
  logLine({
    t: new Date().toISOString(), requestId: payload.requestId, player: payload.player,
    candidates: actions.length, chosenType: chosen?.type ?? null, chosenIndex: actions.indexOf(chosen) + 1,
    reason, note, latencyMs: latency, model: MOCK ? 'mock' : MODEL,
  });

  if (!chosen) return send(res, 200, { action: null, note: note || 'no choice', reason });
  return send(res, 200, { action: chosen, reason, meta: { model: MOCK ? 'mock' : MODEL, latencyMs: latency, candidates: actions.length, note } });
});

server.listen(PORT, '127.0.0.1', () => {
  console.log(`[llm_bridge] listening on http://127.0.0.1:${PORT}/move  model=${MOCK ? 'MOCK' : MODEL}  ollama=${OLLAMA_URL}`);
  console.log(`[llm_bridge] 日志: ${LOG_FILE}`);
});
