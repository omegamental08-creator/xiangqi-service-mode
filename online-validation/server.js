import http from 'node:http';
import { readFile } from 'node:fs/promises';
import { extname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { WebSocketServer } from 'ws';
import { classicValidationRuleset } from './rulesets/classic-validation.js';
import { opaqueAirValidationRuleset } from './rulesets/opaque-air-validation.js';

const root = fileURLToPath(new URL('.', import.meta.url));
const port = Number(process.env.PORT || 8080);
const host = process.env.HOST || '0.0.0.0';
const disconnectGraceMs = Number(process.env.DISCONNECT_GRACE_MS || 60_000);
const airWindowMs = Number(process.env.AIR_WINDOW_MS || 30_000);
const rooms = new Map();
const rulesets = new Map([[classicValidationRuleset.id, classicValidationRuleset], [opaqueAirValidationRuleset.id, opaqueAirValidationRuleset]]);

function json(ws, message) { if (ws?.readyState === 1) ws.send(JSON.stringify(message)); }
function publicRoom(room) {
  return { roomId: room.id, roomName: room.name, hostPlayerId: room.hostPlayerId, phase: room.phase, locked: room.locked, requiredPlayers: room.requiredPlayers, rulesetId: room.ruleset.id, rulesetHash: room.ruleset.hash, revision: room.revision, airWindow: room.airWindow ? { stage: room.airWindow.stage, initiatorPlayerId: room.airWindow.initiatorPlayerId, deadlineAt: room.airWindow.deadlineAt, confirmedPlayerIds: [...room.airWindow.confirmed] } : null, players: room.players.map(player => ({ playerId: player.playerId, name: player.name, participation: player.participation, defeated: player.defeated, connected: Boolean(player.ws && player.ws.readyState === 1) })), state: room.state };
}
function broadcast(room, message) { for (const player of room.players) json(player.ws, message); }
function broadcastLobby(room) { broadcast(room, { type: 'lobby_state', ...publicRoom(room), chat: room.chat }); }
function allocatePlayerId(room) { for (let code = 65; code <= 72; code += 1) { const id = String.fromCharCode(code); if (!room.players.some(player => player.playerId === id)) return id; } return null; }
function uniqueRoomId(base) { let id = base; while (rooms.has(id)) id = `${base}_${Math.random().toString(36).slice(2, 6).toUpperCase()}`; return id; }
function createRoom(roomId, roomName = roomId, rulesetId = classicValidationRuleset.id) { const ruleset = rulesets.get(rulesetId) || classicValidationRuleset; const room = { id: roomId, name: roomName, hostPlayerId: null, phase: 'lobby', locked: false, requiredPlayers: 2, ruleset, revision: 0, players: [], chat: [], state: ruleset.createInitialState(), log: [], airWindow: null, airWindowTimer: null }; rooms.set(roomId, room); return room; }
function sendRoomList(ws) {
  const list = [...rooms.values()].filter(room => room.phase === 'lobby' && !room.locked).map(room => ({ roomId: room.id, roomName: room.name, rulesetId: room.ruleset.id, requiredPlayers: room.requiredPlayers, players: room.players.length, participating: room.players.filter(player => player.participation).length }));
  json(ws, { type: 'room_list', rooms: list });
}
function addOrReconnectPlayer(room, ws, message) {
  const clientId = String(message.clientId || '').trim();
  if (!clientId) { json(ws, { type: 'error', code: 'CLIENT_ID_REQUIRED', message: '客户端身份无效，请刷新页面重试' }); return null; }
  let player = room.players.find(item => item.clientId === clientId);
  if (!player) {
    if (room.phase !== 'lobby') { json(ws, { type: 'error', code: 'GAME_ALREADY_STARTED', message: '对局已开始，只能使用原客户端身份重连' }); return null; }
    if (room.players.length >= 8) { json(ws, { type: 'error', code: 'ROOM_FULL', message: '房间已满' }); return null; }
    const playerId = allocatePlayerId(room);
    player = { playerId, clientId, name: String(message.name || '').trim() || `玩家${playerId}`, participation: false, defeated: false, ws };
    room.players.push(player);
    if (!room.hostPlayerId) room.hostPlayerId = playerId;
  } else { if (player.reconnectTimer) clearTimeout(player.reconnectTimer); if (player.ws && player.ws !== ws) player.ws.close(); player.ws = ws; player.name = String(message.name || '').trim() || player.name; }
  ws.binding = { room, playerId: player.playerId };
  json(ws, { type: 'welcome', playerId: player.playerId, rulesetId: room.ruleset.id });
  if (room.phase === 'game') {
    json(ws, { type: 'game_resumed', ...publicRoom(room), chat: room.chat });
    if (room.airWindow?.submissions[player.playerId]) json(ws, { type: 'air_private_state', tasks: room.airWindow.submissions[player.playerId] });
    if (room.airPlan?.playerId === player.playerId) json(ws, { type: 'air_private_state', tasks: room.airPlan.routes });
  }
  broadcastLobby(room);
  return player;
}
function removePlayer(room, playerId) {
  const leaving = room.players.find(player => player.playerId === playerId);
  if (leaving?.reconnectTimer) clearTimeout(leaving.reconnectTimer);
  room.players = room.players.filter(player => player.playerId !== playerId);
  if (room.hostPlayerId === playerId) room.hostPlayerId = room.players[0]?.playerId || null;
  if (room.players.length === 0) rooms.delete(room.id);
}
function nextActivePlayerAfter(room, playerId) {
  const order = room.players.map(player => player.playerId), start = Math.max(0, order.indexOf(playerId));
  for (let offset = 1; offset <= order.length; offset += 1) { const candidate = room.players.find(player => player.playerId === order[(start + offset) % order.length]); if (candidate?.participation && !candidate.defeated) return candidate.playerId; }
  return null;
}
function finishGame(room, winnerPlayerId, reason) {
  if (room.airWindowTimer) clearTimeout(room.airWindowTimer);
  room.airWindowTimer = null; room.airWindow = null;
  room.phase = 'lobby'; room.locked = false; room.revision += 1;
  broadcast(room, { type: 'game_over', winnerPlayerId, reason, revision: room.revision, state: room.state });
  for (const player of room.players) { player.participation = false; player.defeated = false; }
  room.state = room.ruleset.createInitialState(); room.state.activePlayerId = null;
  broadcastLobby(room);
}
function forfeit(room, player) {
  if (room.phase !== 'game' || !player.participation || player.defeated) return;
  player.defeated = true; player.participation = false;
  room.state.pieces = room.state.pieces.filter(piece => piece.playerId !== player.playerId);
  if (room.state.activePlayerId === player.playerId) room.state.activePlayerId = nextActivePlayerAfter(room, player.playerId);
  room.revision += 1;
  const active = room.players.filter(item => item.participation && !item.defeated).map(item => item.playerId);
  broadcast(room, { type: 'player_forfeited', playerId: player.playerId, name: player.name, revision: room.revision, state: room.state, remainingPlayerIds: active });
  if (active.length <= 1) finishGame(room, active[0] || null, '其他参与玩家均已失败');
}
function leaveBoundPlayer(ws, permanent = false) {
  const binding = ws.binding; if (!binding) return;
  const { room, playerId } = binding; const player = room.players.find(item => item.playerId === playerId);
  if (!player || player.ws !== ws) return;
  ws.binding = null; player.ws = null;
  if (permanent) {
    forfeit(room, player); removePlayer(room, playerId);
    if (rooms.has(room.id)) { broadcast(room, { type: 'player_left', playerId }); broadcastLobby(room); }
    return;
  }
  player.disconnectedAt = Date.now();
  player.reconnectTimer = setTimeout(() => {
    if (player.ws || !rooms.has(room.id)) return;
    forfeit(room, player);
    removePlayer(room, playerId);
    if (rooms.has(room.id)) { broadcast(room, { type: 'player_left', playerId, reason: 'reconnect_timeout' }); broadcastLobby(room); }
  }, disconnectGraceMs);
  player.reconnectTimer.unref?.();
  broadcast(room, { type: 'player_disconnected', playerId, graceMs: disconnectGraceMs });
  broadcastLobby(room);
}
function requireHost(ws) { const binding = ws.binding; if (!binding) return null; if (binding.playerId !== binding.room.hostPlayerId) { json(ws, { type: 'error', code: 'NOT_HOST', message: '只有房主可以执行此操作' }); return null; } return binding.room; }

function handleCreate(ws, message) {
  const requested = String(message.roomId || '').trim().slice(0, 40) || '房间'; const actual = uniqueRoomId(requested); const room = createRoom(actual, String(message.roomName || requested).trim().slice(0, 60) || requested, message.rulesetId);
  addOrReconnectPlayer(room, ws, message);
  json(ws, { type: 'room_created', requestedRoomId: requested, roomId: actual, renamed: actual !== requested });
}
function handleJoin(ws, message) {
  const roomId = String(message.roomId || '').trim(); const room = rooms.get(roomId);
  if (!room) return json(ws, { type: 'error', code: 'ROOM_NOT_FOUND', message: '此房间不存在' });
  const existing = room.players.some(player => player.clientId === String(message.clientId || '').trim());
  if (room.locked && !existing) return json(ws, { type: 'error', code: 'ROOM_LOCKED', message: '本房间已锁定' });
  addOrReconnectPlayer(room, ws, message);
}
function handleParticipation(ws, message) { const binding = ws.binding; if (!binding || binding.room.phase !== 'lobby') return; const player = binding.room.players.find(item => item.playerId === binding.playerId); if (!player) return; player.participation = Boolean(message.participation); broadcastLobby(binding.room); }
function handleRequiredPlayers(ws, message) { const room = requireHost(ws); if (!room) return; if (room.phase !== 'lobby') return json(ws, { type: 'error', code: 'GAME_ALREADY_STARTED', message: '游戏开始后不能修改人数' }); const count = Number(message.count); const maximum = room.ruleset.mode === 'opaque-air' ? 2 : 8; if (!Number.isInteger(count) || count < 2 || count > maximum) return json(ws, { type: 'error', code: 'INVALID_PLAYER_COUNT', message: `本规则模式人数必须在 2 到 ${maximum} 人之间` }); if (count < room.players.filter(player => player.participation).length) return json(ws, { type: 'error', code: 'PARTICIPANTS_EXCEED_COUNT', message: '本局人数不能少于已确认参与的人数' }); room.requiredPlayers = count; broadcastLobby(room); }
function handleLock(ws, message) { const room = requireHost(ws); if (!room) return; if (room.phase !== 'lobby') return json(ws, { type: 'error', code: 'GAME_ALREADY_STARTED', message: '对局中不能修改房间锁定状态' }); room.locked = Boolean(message.locked); broadcastLobby(room); }
function handleEndRoom(ws) { const room = requireHost(ws); if (!room) return; broadcast(room, { type: 'room_closed', message: '房主已结束房间' }); for (const player of room.players) { if (player.reconnectTimer) clearTimeout(player.reconnectTimer); if (player.ws) { player.ws.binding = null; player.ws.close(); } } rooms.delete(room.id); }
function handleChat(ws, message) { const binding = ws.binding; if (!binding) return; const text = String(message.text || '').trim().slice(0, 300); if (!text) return; const item = { playerId: binding.playerId, name: binding.room.players.find(player => player.playerId === binding.playerId)?.name, text, at: Date.now() }; binding.room.chat.push(item); if (binding.room.chat.length > 100) binding.room.chat.shift(); broadcast(binding.room, { type: 'chat_message', ...item }); }
function handleStart(ws) { const room = requireHost(ws); if (!room) return; const participants = room.players.filter(player => player.participation && !player.defeated); if (participants.length < room.requiredPlayers) return json(ws, { type: 'error', code: 'NOT_ENOUGH_PLAYERS', message: `参与人数不够：需要 ${room.requiredPlayers} 人，当前 ${participants.length} 人。` }); if (participants.length > room.requiredPlayers) return json(ws, { type: 'error', code: 'TOO_MANY_PLAYERS', message: `参与人数过多：需要 ${room.requiredPlayers} 人，当前 ${participants.length} 人。` }); if (participants.some(player => !player.ws || player.ws.readyState !== 1)) return json(ws, { type: 'error', code: 'PLAYER_DISCONNECTED', message: '有参与玩家暂时断开连接，请等待其重连或移除席位' }); room.phase = 'game'; room.locked = true; room.state = room.ruleset.createInitialState(participants.map(player => player.playerId)); room.state.activePlayerId = participants[0].playerId; room.revision += 1; broadcast(room, { type: 'game_started', ...publicRoom(room) }); }
function handleSubmit(ws, message) {
  const binding = ws.binding; if (!binding) return json(ws, { type: 'error', code: 'NOT_JOINED', message: '请先加入房间' }); const { room, playerId } = binding;
  if (room.phase !== 'game') return json(ws, { type: 'command_rejected', code: 'LOBBY_NOT_STARTED', message: '房主尚未开始游戏' });
  if (room.airWindow) return json(ws, { type: 'command_rejected', code: 'AIR_WINDOW_ACTIVE', message: '空战反应窗口期间不能下达普通棋子命令' });
  const player = room.players.find(item => item.playerId === playerId); if (!player?.participation || player.defeated) return json(ws, { type: 'command_rejected', code: 'SPECTATOR_CANNOT_PLAY', message: '观战或失败玩家不能提交命令' });
  if (room.state.activePlayerId !== playerId) return json(ws, { type: 'command_rejected', code: 'NOT_YOUR_TURN', message: `当前是玩家 ${room.state.activePlayerId} 的回合` });
  if (message.baseRevision !== room.revision) return json(ws, { type: 'command_rejected', code: 'STALE_REVISION', message: '棋局已更新，请重新获取状态', ...publicRoom(room) });
  const commands = Array.isArray(message.commands) ? message.commands : []; if (!commands.length) return json(ws, { type: 'command_rejected', code: 'EMPTY_COMMANDS', message: '没有可提交的命令' });
  const results = []; for (const command of commands) { const check = room.ruleset.validateCommand(room.state, command, playerId); if (!check.ok) { results.push({ commandId: command.commandId, status: 'skipped', code: check.code, message: check.message }); continue; } const result = room.ruleset.executeCommand(room.state, command); results.push({ commandId: command.commandId, status: 'applied', effects: result.effects || [] }); room.state.stepsLeft -= 1; if (room.state.stepsLeft <= 0) break; }
  if (!results.some(result => result.status === 'applied')) return json(ws, { type: 'command_rejected', code: 'NO_COMMAND_APPLIED', message: '本次没有任何命令成功执行，回合不会推进', results, ...publicRoom(room) });
  const newlyDefeated = room.players.filter(item => item.participation && !item.defeated && !room.state.pieces.some(piece => piece.playerId === item.playerId && piece.type === 'jiang'));
  for (const defeated of newlyDefeated) { defeated.defeated = true; defeated.participation = false; room.state.pieces = room.state.pieces.filter(piece => piece.playerId !== defeated.playerId); broadcast(room, { type: 'player_defeated', playerId: defeated.playerId, name: defeated.name, state: room.state }); }
  room.ruleset.finishTurn(room.state, room.players.filter(item => item.participation && !item.defeated).map(item => item.playerId)); room.revision += 1;
  const event = { revision: room.revision, turnNumber: room.state.turnNumber, playerId, requestId: message.requestId, results, state: room.state }; room.log.push(event); broadcast(room, { type: 'turn_result', ...event });
  const alive = room.players.filter(item => item.participation && !item.defeated && room.state.pieces.some(piece => piece.playerId === item.playerId && piece.type === 'jiang'));
  if (alive.length <= 1) finishGame(room, alive[0]?.playerId || null, '其他参与玩家的将军已被消灭');
}

function activeParticipants(room) { return room.players.filter(player => player.participation && !player.defeated); }
function clearAirWindow(room) { if (room.airWindowTimer) clearTimeout(room.airWindowTimer); room.airWindowTimer = null; room.airWindow = null; }
function resolveAirWindow(room, cause) {
  const windowState = room.airWindow;
  if (!windowState || room.phase !== 'game') return;
  const participants = activeParticipants(room).map(player => player.playerId);
  const result = room.ruleset.settleAirWindow(room.state, windowState.submissions, participants);
  clearAirWindow(room);
  if (participants.includes(room.state.activePlayerId)) room.ruleset.finishTurn(room.state, participants);
  else room.state.activePlayerId = participants[0] || null;
  room.revision += 1;
  const newlyDefeated = room.players.filter(player => player.participation && !player.defeated && !room.state.pieces.some(piece => piece.playerId === player.playerId && piece.type === 'jiang'));
  for (const defeated of newlyDefeated) { defeated.defeated = true; defeated.participation = false; }
  const alive = activeParticipants(room).filter(player => room.state.pieces.some(piece => piece.playerId === player.playerId && piece.type === 'jiang'));
  const event = { type: 'air_window_resolved', cause, revision: room.revision, turnNumber: room.state.turnNumber, results: result.events, state: room.state };
  room.log.push(event); broadcast(room, event);
  if (alive.length <= 1) finishGame(room, alive[0]?.playerId || null, '其他参与玩家的将军已被消灭');
}
function airPlayer(ws) {
  const binding = ws.binding;
  if (!binding) { json(ws, { type: 'error', code: 'NOT_JOINED', message: '请先加入房间' }); return null; }
  if (binding.room.phase !== 'game' || binding.room.ruleset.mode !== 'opaque-air') { json(ws, { type: 'error', code: 'AIR_MODE_REQUIRED', message: '当前房间未启用不透明空战验证规则' }); return null; }
  const player = binding.room.players.find(item => item.playerId === binding.playerId);
  if (!player?.participation || player.defeated) { json(ws, { type: 'error', code: 'SPECTATOR_CANNOT_PLAY', message: '观战或失败玩家不能下达空军命令' }); return null; }
  return { room: binding.room, player };
}
function handleLaunchAircraft(ws, message) {
  const binding = airPlayer(ws); if (!binding) return;
  const { room, player } = binding;
  if (room.airWindow) return json(ws, { type: 'error', code: 'AIR_WINDOW_ACTIVE', message: '当前已有空战反应窗口' });
  if (room.state.activePlayerId !== player.playerId) return json(ws, { type: 'error', code: 'NOT_YOUR_TURN', message: '只有当前回合玩家可以开启空军回合' });
  if (!Array.isArray(message.routes) || message.routes.length < 1) return json(ws, { type: 'error', code: 'EMPTY_AIR_ROUTES', message: '至少要规划一架飞机的完整航线' });
  const routes = [];
  for (const route of message.routes) {
    const checked = room.ruleset.validateRoute(room.state, player.playerId, route);
    if (!checked.ok) return json(ws, { type: 'error', ...checked });
    routes.push({ kind: 'route', unitId: route.unitId, path: route.path.map(point => ({ x: point.x, y: point.y })) });
  }
  room.airPlan = { playerId: player.playerId, routes };
  json(ws, { type: 'air_plan_saved', unitIds: routes.map(task => task.unitId) });
}
function handleConfirmAirPlan(ws) {
  const binding = airPlayer(ws); if (!binding) return;
  const { room, player } = binding;
  if (room.airWindow) return json(ws, { type: 'error', code: 'AIR_WINDOW_ACTIVE', message: '当前已有空战反应窗口' });
  if (room.state.activePlayerId !== player.playerId) return json(ws, { type: 'error', code: 'NOT_YOUR_TURN', message: '只有当前回合玩家可以开启空军回合' });
  if (room.airPlan?.playerId !== player.playerId) return json(ws, { type: 'error', code: 'AIR_PLAN_REQUIRED', message: '请先规划完整航线' });
  const deadlineAt = Date.now() + airWindowMs;
  room.airWindow = { stage: 'response', initiatorPlayerId: player.playerId, deadlineAt, submissions: { [player.playerId]: room.airPlan.routes }, confirmed: new Set([player.playerId]) };
  room.airPlan = null;
  room.airWindowTimer = setTimeout(() => resolveAirWindow(room, 'deadline'), airWindowMs);
  room.airWindowTimer.unref?.();
  json(ws, { type: 'air_private_state', tasks: room.airWindow.submissions[player.playerId] });
  broadcast(room, { type: 'air_window_opened', initiatorPlayerId: player.playerId, deadlineAt, durationMs: airWindowMs, confirmedPlayerIds: [player.playerId] });
}
function handleSubmitAirActions(ws, message) {
  const binding = airPlayer(ws); if (!binding) return;
  const { room, player } = binding, windowState = room.airWindow;
  if (!windowState) return json(ws, { type: 'error', code: 'NO_AIR_WINDOW', message: '当前没有空战反应窗口' });
  if (Date.now() >= windowState.deadlineAt) return resolveAirWindow(room, 'deadline');
  if (windowState.confirmed.has(player.playerId)) return json(ws, { type: 'error', code: 'AIR_WINDOW_CONFIRMED', message: '你已确认空战行动，不能再修改' });
  const submitted = windowState.submissions[player.playerId] || [];
  const checked = room.ruleset.validateAirTasks(room.state, player.playerId, message.tasks, new Set(submitted.map(task => task.unitId)));
  if (!checked.ok) return json(ws, { type: 'error', ...checked });
  const tasks = message.tasks.map(task => task.kind === 'move'
    ? { kind: 'move', unitId: task.unitId, target: { x: task.target.x, y: task.target.y } }
    : { kind: 'route', unitId: task.unitId, path: task.path.map(point => ({ x: point.x, y: point.y })) });
  windowState.submissions[player.playerId] = [...submitted, ...tasks];
  json(ws, { type: 'air_actions_saved', unitIds: tasks.map(task => task.unitId) });
}
function handleConfirmAirWindow(ws) {
  const binding = airPlayer(ws); if (!binding) return;
  const { room, player } = binding, windowState = room.airWindow;
  if (!windowState) return json(ws, { type: 'error', code: 'NO_AIR_WINDOW', message: '当前没有空战反应窗口' });
  if (Date.now() >= windowState.deadlineAt) return resolveAirWindow(room, 'deadline');
  if (windowState.confirmed.has(player.playerId)) return json(ws, { type: 'error', code: 'AIR_WINDOW_CONFIRMED', message: '你已确认空战行动，不能再修改' });
  windowState.confirmed.add(player.playerId);
  const confirmedPlayerIds = [...windowState.confirmed];
  broadcast(room, { type: 'air_confirmation', playerId: player.playerId, confirmedPlayerIds, deadlineAt: windowState.deadlineAt });
  const participants = activeParticipants(room);
  if (participants.every(item => windowState.confirmed.has(item.playerId))) resolveAirWindow(room, 'all_confirmed');
}

const server = http.createServer(async (req, res) => { const path = req.url === '/' ? '/client.html' : req.url; if (!path.startsWith('/client')) { res.writeHead(404); return res.end('Not found'); } try { const content = await readFile(join(root, path.slice(1))); res.writeHead(200, { 'Content-Type': extname(path) === '.js' ? 'text/javascript; charset=utf-8' : 'text/html; charset=utf-8', 'Cache-Control': 'no-store, no-cache, must-revalidate' }); res.end(content); } catch { res.writeHead(404); res.end('Not found'); } });
const wss = new WebSocketServer({ server });
wss.on('connection', ws => { ws.on('message', raw => { try { const message = JSON.parse(raw.toString()); const handlers = { list_rooms: () => sendRoomList(ws), create_room: handleCreate, join_room: handleJoin, set_participation: handleParticipation, set_required_players: handleRequiredPlayers, set_room_lock: handleLock, end_room: handleEndRoom, chat: handleChat, start_game: handleStart, launch_aircraft: handleLaunchAircraft, confirm_air_plan: handleConfirmAirPlan, submit_air_actions: handleSubmitAirActions, confirm_air_window: handleConfirmAirWindow, leave_room: socket => { leaveBoundPlayer(socket, true); json(socket, { type: 'left_room' }); }, submit_commands: handleSubmit }; const handler = handlers[message.type]; if (handler) handler(ws, message); else json(ws, { type: 'error', code: 'UNKNOWN_MESSAGE', message: '未知消息' }); } catch { json(ws, { type: 'error', code: 'INVALID_JSON', message: '消息格式错误' }); } }); ws.on('close', () => leaveBoundPlayer(ws)); });
server.listen(port, host, () => console.log(`Online validation server: http://${host}:${port}`));
