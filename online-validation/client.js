let socket, playerId, currentRoom, state, selectedPieceId, reconnectTimer;
let revision = 0, commands = [], roomPhase = 'disconnected', leavingRoom = false;
let airWindow = null, privateAirTasks = [], pendingAirTasks = [], plannedRoute = [], airDeadlineTimer = null;
const clientId = sessionStorage.getItem('onlineValidationClientId') || crypto.randomUUID();
sessionStorage.setItem('onlineValidationClientId', clientId);
const $ = id => document.getElementById(id);

function log(message) { $('log').textContent = `${message}\n${$('log').textContent}`; }
function send(type, payload = {}) { if (socket?.readyState === WebSocket.OPEN) socket.send(JSON.stringify({ type, ...payload })); }
function appendChat(message) { for (const id of ['chatLog', 'gameChatLog']) { const box = $(id); box.textContent += `${box.textContent ? '\n' : ''}${message.name}: ${message.text}`; box.scrollTop = box.scrollHeight; } }
function setDisconnected() { socket = null; playerId = null; if (leavingRoom) currentRoom = null; roomPhase = 'disconnected'; $('status').textContent = '未连接'; $('lobby').classList.add('hidden'); $('game').classList.add('hidden'); $('roomBrowser').classList.remove('hidden'); }
function connect(action) {
  if (roomPhase === 'game' && action !== 'join_room') return requestLeave();
  if (socket?.readyState === WebSocket.OPEN) { send(action, requestPayload(action)); return; }
  if (socket?.readyState === WebSocket.CONNECTING) return;
  socket = new WebSocket(`ws://${location.host}`);
  socket.onopen = () => { $('status').textContent = '已连接'; send(action, requestPayload(action)); };
  socket.onmessage = event => handleMessage(JSON.parse(event.data));
  socket.onerror = () => { $('status').textContent = '连接失败'; };
  socket.onclose = () => {
    socket = null;
    if (leavingRoom || roomPhase === 'closed') { clearReconnect(); localStorage.removeItem('onlineValidationRoomId'); setDisconnected(); return; }
    if (currentRoom?.roomId) { $('status').textContent = '连接中断，正在尝试重连'; scheduleReconnect(); }
    else setDisconnected();
  };
}
function requestPayload(action) { return { roomId: $('room').value.trim(), roomName: $('roomNameInput').value.trim(), name: $('name').value.trim(), clientId, rulesetId: $('ruleset').value }; }
function clearReconnect() { if (reconnectTimer) clearTimeout(reconnectTimer); reconnectTimer = null; }
function scheduleReconnect() { clearReconnect(); reconnectTimer = setTimeout(() => connect('join_room'), 1200); }
function setRoomStatus(message) { $('status').textContent = message; }
function renderRooms(rooms = []) {
  const list = $('roomList'); list.replaceChildren();
  if (!rooms.length) { list.textContent = '当前没有开放房间'; return; }
  rooms.forEach(room => {
    const row = document.createElement('div'); row.className = 'room-row';
    const title = document.createElement('b'); title.textContent = room.roomName || room.roomId;
    const id = document.createElement('span'); id.className = 'muted'; id.textContent = room.roomId;
    const status = document.createElement('span'); status.textContent = `${room.players}/${room.requiredPlayers} 席，${room.participating} 人已确认 · ${room.rulesetId === 'opaque-air-validation-0.1' ? '不透明空战' : '普通验证'}`;
    const join = document.createElement('button'); join.textContent = '加入'; join.onclick = () => { $('room').value = room.roomId; connect('join_room'); };
    row.append(title, id, status, join); list.append(row);
  });
}
function renderLobby(room, chat = []) {
  currentRoom = room; roomPhase = room.phase || 'lobby';
  localStorage.setItem('onlineValidationRoomId', room.roomId); $('room').value = room.roomId; clearReconnect();
  if (room.phase === 'game') { $('lobby').classList.add('hidden'); $('game').classList.remove('hidden'); }
  else { $('lobby').classList.remove('hidden'); $('game').classList.add('hidden'); }
  const isHost = playerId === room.hostPlayerId, host = room.players.find(player => player.playerId === room.hostPlayerId);
  const count = room.players.filter(player => player.participation && !player.defeated).length;
  $('roomName').textContent = room.roomName || room.roomId; $('hostName').textContent = host?.name || room.hostPlayerId; $('lockStatus').textContent = room.phase === 'game' ? '对局中' : (room.locked ? '已锁定' : '开放');
  $('requiredPlayers').value = room.requiredPlayers; $('requiredPlayers').disabled = !isHost; $('setRequiredPlayers').disabled = !isHost;
  $('requiredPlayers').max = room.rulesetId === 'opaque-air-validation-0.1' ? 2 : 8;
  $('playerCountStatus').textContent = `计划参与 ${room.requiredPlayers} 人，当前参与 ${count} 人；观战人数不计入`;
  const players = $('players'); players.replaceChildren();
  room.players.forEach(player => {
    const row = document.createElement('div'); row.className = 'player-row';
    const seat = document.createElement('b'); seat.textContent = player.playerId;
    const name = document.createElement('span'); name.textContent = `${player.name}${player.playerId === room.hostPlayerId ? '（房主）' : ''}`;
    const presence = document.createElement('span'); presence.className = player.connected === false ? 'status-offline' : 'status-online'; presence.textContent = player.connected === false ? '断线，等待重连' : '在线';
    const role = document.createElement('span'); role.textContent = player.defeated ? '已失败' : (player.participation ? '参与' : '观战');
    row.append(seat, name, presence, role); players.append(row);
  });
  $('startGame').disabled = !isHost || count !== room.requiredPlayers || room.phase !== 'lobby'; $('startGame').classList.toggle('host-only-warning', !isHost);
  $('lockRoom').disabled = !isHost || room.locked; $('unlockRoom').disabled = !isHost || !room.locked || room.phase === 'game'; $('endRoom').disabled = !isHost;
  $('participate').disabled = room.phase !== 'lobby'; $('spectate').disabled = room.phase !== 'lobby';
  $('roomBrowser').classList.add('hidden'); $('status').textContent = `房间 ${room.roomId} · ${isHost ? '房主' : '玩家 '+playerId}`;
  if (chat.length) { const text = chat.map(item => `${item.name}: ${item.text}`).join('\n'); $('chatLog').textContent = text; $('gameChatLog').textContent = text; }
}
function renderGame() {
  if (!state) return;
  const airMode = currentRoom?.rulesetId === 'opaque-air-validation-0.1';
  $('airControls').classList.toggle('hidden', !airMode);
  $('classicHelp').classList.toggle('hidden', airMode);
  $('submit').classList.toggle('hidden', airMode); $('clear').classList.toggle('hidden', airMode);
  $('turn').textContent = `你是 ${playerId || '?'} | 当前回合：${state.activePlayerId} | revision：${revision} | 待提交命令：${commands.length}${airMode ? ' | 空战棋子独立轮换池：防 8 / 战 4 / 直 4' : ''}`;
  const grid = $('grid'); grid.innerHTML = '';
  for (let y = 0; y < 10; y += 1) for (let x = 0; x < 9; x += 1) {
    const cell = document.createElement('button'); cell.className = 'cell'; const piece = state.pieces.find(item => item.x === x && item.y === y);
    const pad = state.pads?.find(item => item.x === x && item.y === y);
    if (pad) cell.classList.add('platform-cell');
    if (piece) { cell.textContent = piece.type === 'jiang' ? '将' : piece.type; cell.classList.add(piece.playerId === 'A' ? 'piece-a' : 'piece-b'); cell.onclick = () => clickPiece(piece); }
    else if (pad) { cell.textContent = '坪'; cell.onclick = () => addRoutePoint(x, y); }
    else cell.onclick = () => clickTarget(x, y); grid.appendChild(cell);
  }
  if (airMode) renderAirControls();
}
function renderAirControls() {
  const aircraft = state.aircraft || [];
  const ownAircraft = aircraft.filter(item => item.playerId === playerId && item.status === 'docked');
  const aircraftSelect = $('aircraftSelect'); aircraftSelect.replaceChildren();
  for (const item of ownAircraft) { const option = document.createElement('option'); option.value = item.id; option.textContent = `${item.type} ${item.id} (${item.padId})`; aircraftSelect.append(option); }
  const destination = $('destinationPad'); destination.replaceChildren();
  for (const item of state.pads.filter(pad => pad.playerId === playerId && pad.id !== state.aircraft.find(unit => unit.id === aircraftSelect.value)?.padId)) { const option = document.createElement('option'); option.value = item.id; option.textContent = `${item.id} (${item.x},${item.y})`; destination.append(option); }
  const units = state.pieces.filter(item => item.playerId === playerId && ['fang', 'zhi'].includes(item.type));
  const unitSelect = $('airUnitSelect'); unitSelect.replaceChildren();
  for (const item of units) { const option = document.createElement('option'); option.value = item.id; option.textContent = `${item.type} ${item.id} (${item.x},${item.y})`; unitSelect.append(option); }
  $('airStatus').textContent = airWindow ? `反应窗口剩余 ${Math.max(0, Math.ceil((airWindow.deadlineAt - Date.now()) / 1000))} 秒；待提交任务 ${pendingAirTasks.length}` : `航线航点 ${plannedRoute.length}；未起飞飞机不会执行。`;
  $('launchPlan').disabled = !plannedRoute.length || state.activePlayerId !== playerId || Boolean(airWindow);
  $('saveRoute').disabled = !plannedRoute.length || Boolean(airWindow);
  $('addWaypoint').disabled = !ownAircraft.length || Boolean(airWindow);
  $('queueAirMove').disabled = !airWindow;
  $('submitAirTasks').disabled = !airWindow || !pendingAirTasks.length;
  $('confirmAir').disabled = !airWindow;
}
function addRoutePoint(x, y) { if (!currentRoom?.rulesetId?.startsWith('opaque-air') || airWindow) return; const last = plannedRoute.at(-1); if (last && Math.abs(last.x - x) + Math.abs(last.y - y) !== 1) return log('航线必须逐格相邻'); plannedRoute.push({ x, y }); renderGame(); }
function scheduleAirTick() { clearInterval(airDeadlineTimer); airDeadlineTimer = setInterval(() => { if (!airWindow) return clearInterval(airDeadlineTimer); renderGame(); }, 1000); }
function rejectOutOfTurn() { if (state?.activePlayerId === playerId) return false; selectedPieceId = null; commands = []; renderGame(); log(`当前是玩家 ${state?.activePlayerId} 的回合，不能下令；未提交命令已清除`); return true; }
function clickPiece(piece) { if (rejectOutOfTurn()) return; if (piece.playerId === playerId) { selectedPieceId = piece.id; log(`已选中 ${piece.id}`); } else clickTarget(piece.x, piece.y); }
function clickTarget(x, y) { if (rejectOutOfTurn() || !selectedPieceId) return; commands.push({ commandId: `${Date.now()}-${commands.length}`, kind: 'move', pieceId: selectedPieceId, target: { x, y } }); log(`已加入命令：${selectedPieceId} → (${x},${y})`); selectedPieceId = null; renderGame(); }
function requestLeave() { if (!confirm(roomPhase === 'game' ? '离开将自动判负并清除己方棋子。是否离开房间？' : '是否离开房间？')) return; leavingRoom = true; clearReconnect(); send('leave_room'); roomPhase = 'leaving'; }
function showDefeat() { $('defeatDialog').classList.remove('hidden'); }
function handleMessage(message) {
  if (message.type === 'welcome') { playerId = message.playerId; }
  if (message.type === 'room_list') renderRooms(message.rooms);
  if (message.type === 'room_created') { $('room').value = message.roomId; if (message.renamed) alert(`房间名已存在，已创建为：${message.roomId}`); }
  if (message.type === 'lobby_state') renderLobby(message, message.chat);
  if (message.type === 'chat_message') appendChat(message);
  if (message.type === 'game_started' || message.type === 'game_resumed') { currentRoom = message; roomPhase = 'game'; $('lobby').classList.add('hidden'); $('roomBrowser').classList.add('hidden'); $('game').classList.remove('hidden'); state = message.state; revision = message.revision; commands = []; airWindow = message.airWindow; if (message.chat) { const text = message.chat.map(item => `${item.name}: ${item.text}`).join('\n'); $('chatLog').textContent = text; $('gameChatLog').textContent = text; } renderGame(); }
  if (message.type === 'turn_result') { state = message.state; revision = message.revision; commands = []; log(`服务器完成回合 ${message.turnNumber}`); renderGame(); }
  if (message.type === 'player_forfeited') { state = message.state; revision = message.revision; log(`${message.name} 已判负，其棋子已清除`); renderGame(); if (message.playerId === playerId) showDefeat(); }
  if (message.type === 'player_defeated') { state = message.state; log(`${message.name} 已失败，其棋子已清除`); renderGame(); if (message.playerId === playerId) showDefeat(); }
  if (message.type === 'game_over') { state = message.state; revision = message.revision; log(`游戏结束，胜者：${message.winnerPlayerId || '无'}`); renderGame(); }
  if (message.type === 'air_plan_saved') { privateAirTasks = [{ kind: 'route', unitId: $('aircraftSelect').value, path: plannedRoute.map(point => ({ ...point })) }]; log('航线已私密保存；点击确认后才开启反应窗口'); }
  if (message.type === 'air_private_state') { privateAirTasks = message.tasks || []; const route = privateAirTasks.find(task => task.kind === 'route'); if (route) plannedRoute = route.path.map(point => ({ ...point })); }
  if (message.type === 'air_actions_saved') { log(`空军任务已保存：${message.unitIds.join('、')}`); pendingAirTasks = []; renderGame(); }
  if (message.type === 'air_window_opened') { airWindow = { ...message, stage: 'response' }; plannedRoute = []; pendingAirTasks = []; scheduleAirTick(); renderGame(); }
  if (message.type === 'air_confirmation') { airWindow = { ...airWindow, confirmedPlayerIds: message.confirmedPlayerIds, deadlineAt: message.deadlineAt }; renderGame(); }
  if (message.type === 'air_window_resolved') { airWindow = null; clearInterval(airDeadlineTimer); state = message.state; revision = message.revision; plannedRoute = []; pendingAirTasks = []; log(`空战窗口已结算（${message.cause}），逐格事件 ${message.results.length} 项`); renderGame(); }
  if (message.type === 'player_disconnected') log(`玩家 ${message.playerId} 断线，等待重连`);
  if (message.type === 'left_room') { leavingRoom = true; localStorage.removeItem('onlineValidationRoomId'); if (socket) socket.close(); else setDisconnected(); }
  if (message.type === 'room_closed') { alert(message.message); roomPhase = 'closed'; leavingRoom = true; }
  if (message.type === 'command_rejected') { commands = []; selectedPieceId = null; log(`提交被拒绝：${message.message}`); renderGame(); }
  if (message.type === 'error') { $('status').textContent = message.message; log(message.message); if (message.code === 'ROOM_NOT_FOUND' || message.code === 'ROOM_LOCKED' || message.code === 'ROOM_FULL') { currentRoom = null; roomPhase = 'disconnected'; localStorage.removeItem('onlineValidationRoomId'); $('roomBrowser').classList.remove('hidden'); } }
}

$('createRoom').onclick = () => { leavingRoom = false; connect('create_room'); };
$('joinRoom').onclick = () => { leavingRoom = false; connect('join_room'); };
$('refreshRooms').onclick = () => { leavingRoom = false; if (socket?.readyState === WebSocket.OPEN) send('list_rooms'); else connect('list_rooms'); };
$('participate').onclick = () => send('set_participation', { participation: true });
$('spectate').onclick = () => send('set_participation', { participation: false });
$('startGame').onclick = () => send('start_game');
$('setRequiredPlayers').onclick = () => send('set_required_players', { count: Number($('requiredPlayers').value) });
$('lockRoom').onclick = () => send('set_room_lock', { locked: true });
$('unlockRoom').onclick = () => send('set_room_lock', { locked: false });
$('endRoom').onclick = () => { if (confirm('结束房间会断开所有玩家，是否继续？')) send('end_room'); };
$('leaveLobby').onclick = requestLeave;
$('leaveGame').onclick = requestLeave;
$('sendChat').onclick = () => { const text = $('chatInput').value.trim(); if (text) { send('chat', { text }); $('chatInput').value = ''; } };
$('sendGameChat').onclick = () => { const text = $('gameChatInput').value.trim(); if (text) { send('chat', { text }); $('gameChatInput').value = ''; } };
$('submit').onclick = () => { if (state?.activePlayerId !== playerId) return log(`当前是玩家 ${state?.activePlayerId} 的回合，不能提交`); if (!commands.length) return log('没有待提交命令'); send('submit_commands', { requestId: `${Date.now()}`, baseRevision: revision, commands }); };
$('clear').onclick = () => { commands = []; selectedPieceId = null; renderGame(); log('已清除待提交命令'); };
$('addWaypoint').onclick = () => { log('请在棋盘上点击起飞平台相邻的首个航点'); };
$('finishRoute').onclick = () => { const pad = state.pads.find(item => item.id === $('destinationPad').value); if (!pad) return; const last = plannedRoute.at(-1); if (!last) return log('请先点击棋盘选择航线起点'); const dx = Math.sign(pad.x - last.x), dy = Math.sign(pad.y - last.y); if (Math.abs(pad.x - last.x) + Math.abs(pad.y - last.y) !== 1) return log('终点平台须与最后一个航点相邻'); plannedRoute.push({ x: pad.x, y: pad.y }); renderGame(); };
$('saveRoute').onclick = () => { const unitId = $('aircraftSelect').value; send('launch_aircraft', { routes: [{ unitId, path: plannedRoute }] }); };
$('launchPlan').onclick = () => send('confirm_air_plan');
$('queueAirMove').onclick = () => { const [x, y] = $('airTarget').value.split(',').map(Number); if (!Number.isInteger(x) || !Number.isInteger(y)) return log('目标坐标格式应为 x,y'); pendingAirTasks.push({ kind: 'move', unitId: $('airUnitSelect').value, target: { x, y } }); renderGame(); };
$('submitAirTasks').onclick = () => send('submit_air_actions', { tasks: pendingAirTasks });
$('confirmAir').onclick = () => send('confirm_air_window');
$('ruleset').onchange = () => { $('requiredPlayers').max = $('ruleset').value.startsWith('opaque-air') ? 2 : 8; };
$('watchAfterDefeat').onclick = () => { $('defeatDialog').classList.add('hidden'); $('game').classList.remove('hidden'); };
$('returnLobbyAfterDefeat').onclick = () => { $('defeatDialog').classList.add('hidden'); $('game').classList.add('hidden'); $('lobby').classList.remove('hidden'); if (currentRoom) renderLobby(currentRoom); };

const savedRoomId = localStorage.getItem('onlineValidationRoomId');
if (savedRoomId) { $('room').value = savedRoomId; leavingRoom = false; connect('join_room'); }
else connect('list_rooms');
