import WebSocket from 'ws';

function waitFor(ws, type) { return new Promise((resolve, reject) => { const timer = setTimeout(() => reject(new Error(`Timeout: ${type}`)), 3000); const handler = raw => { const message = JSON.parse(raw.toString()); if (message.type === type) { clearTimeout(timer); ws.off('message', handler); resolve(message); } }; ws.on('message', handler); }); }
const port = Number(process.env.PORT || 8080);
function open() { return new Promise((resolve, reject) => { const ws = new WebSocket(`ws://127.0.0.1:${port}`); ws.on('open', () => resolve(ws)); ws.on('error', reject); }); }
async function sendAndWait(ws, type, payload, expected) { const pending = waitFor(ws, expected); ws.send(JSON.stringify({ type, ...payload })); return pending; }

const roomName = `smoke-${Date.now()}`;
const host = await open();
const rooms = await sendAndWait(host, 'list_rooms', {}, 'room_list');
if (!Array.isArray(rooms.rooms)) throw new Error('Room browser did not return a room list');
const created = await sendAndWait(host, 'create_room', { roomId: roomName, roomName: '烟测大厅', name: '房主', clientId: `smoke-host-${Date.now()}` }, 'room_created');
const guest = await open();
const guestId = `smoke-guest-${Date.now()}`;
const joined = await sendAndWait(guest, 'join_room', { roomId: created.roomId, name: '玩家B', clientId: guestId }, 'lobby_state');
if (joined.players.length !== 2 || joined.roomName !== '烟测大厅') throw new Error('Room lobby state is incomplete');
const chatEcho = waitFor(guest, 'chat_message'); host.send(JSON.stringify({ type: 'chat', text: '大厅消息' }));
if ((await chatEcho).text !== '大厅消息') throw new Error('Lobby chat was not broadcast');
const hostOnly = await sendAndWait(guest, 'set_required_players', { count: 3 }, 'error');
if (hostOnly.code !== 'NOT_HOST') throw new Error('Non-host changed the player count');
const invalidCount = await sendAndWait(host, 'set_required_players', { count: 1 }, 'error');
if (invalidCount.code !== 'INVALID_PLAYER_COUNT') throw new Error('Invalid player count was accepted');
await sendAndWait(host, 'set_required_players', { count: 2 }, 'lobby_state');
await sendAndWait(host, 'set_participation', { participation: true }, 'lobby_state');
await sendAndWait(guest, 'set_participation', { participation: true }, 'lobby_state');
const started = waitFor(guest, 'game_started'); host.send(JSON.stringify({ type: 'start_game' })); const game = await started;
if (!game.locked) throw new Error('Room did not lock on start');
const blocked = await open();
const lockedError = await sendAndWait(blocked, 'join_room', { roomId: created.roomId, name: '迟到玩家', clientId: 'smoke-late' }, 'error');
if (lockedError.code !== 'ROOM_LOCKED') throw new Error('Locked room accepted player');
const hostLobby = waitFor(host, 'lobby_state'); guest.close();
const disconnected = await hostLobby;
if (disconnected.players.find(player => player.playerId === 'B')?.connected !== false) throw new Error('Disconnected seat was not retained');
const reconnected = await open();
const resumed = await sendAndWait(reconnected, 'join_room', { roomId: created.roomId, name: '玩家B', clientId: guestId }, 'game_resumed');
if (resumed.phase !== 'game' || resumed.state.activePlayerId !== game.state.activePlayerId) throw new Error('Reconnect did not resume current game state');
console.log('INTEGRATION_OK', created.roomId, 'room-list, host-guard, chat, lock, reconnect');
host.close(); reconnected.close(); blocked.close();

const airRoomName = `air-smoke-${Date.now()}`;
const airHost = await open();
const airRoom = await sendAndWait(airHost, 'create_room', { roomId: airRoomName, roomName: '空战验证', name: '空战A', clientId: `${airRoomName}-A`, rulesetId: 'opaque-air-validation-0.1' }, 'room_created');
const airGuest = await open();
await sendAndWait(airGuest, 'join_room', { roomId: airRoom.roomId, name: '空战B', clientId: `${airRoomName}-B` }, 'lobby_state');
const countError = await sendAndWait(airHost, 'set_required_players', { count: 3 }, 'error');
if (countError.code !== 'INVALID_PLAYER_COUNT') throw new Error('Opaque air room accepted more than two players');
await sendAndWait(airHost, 'set_participation', { participation: true }, 'lobby_state');
await sendAndWait(airGuest, 'set_participation', { participation: true }, 'lobby_state');
const airStarted = waitFor(airGuest, 'game_started'); airHost.send(JSON.stringify({ type: 'start_game' })); const airGame = await airStarted;
if (airGame.rulesetId !== 'opaque-air-validation-0.1' || airGame.state.aircraft.filter(unit => unit.playerId === 'A' && unit.type === 'zhan').length !== 4) throw new Error('Opaque air room did not initialize its air roster');
const route = [{ unitId: 'A-zhan-1', path: [{ x: 1, y: 1 }] }];
const leaked = waitFor(airGuest, 'air_private_state').then(() => true, () => false);
const privatePlan = await sendAndWait(airHost, 'launch_aircraft', { routes: route }, 'air_plan_saved');
if (!privatePlan.unitIds.includes('A-zhan-1')) throw new Error('Air route plan was not privately saved');
if (await Promise.race([leaked, new Promise(resolve => setTimeout(() => resolve(false), 100))])) throw new Error('Air route was leaked to the opponent before the response window');
const planOpened = waitFor(airGuest, 'air_window_opened'); airHost.send(JSON.stringify({ type: 'confirm_air_plan' })); const opened = await planOpened;
if (!opened.deadlineAt || opened.initiatorPlayerId !== 'A') throw new Error('Air response window did not open');
const guestConfirmed = waitFor(airHost, 'air_confirmation'); airGuest.send(JSON.stringify({ type: 'confirm_air_window' })); await guestConfirmed;
const resolved = await waitFor(airHost, 'air_window_resolved');
if (resolved.cause !== 'all_confirmed' || !resolved.results.some(event => event.type === 'flight_result' && event.aircraftId === 'A-zhan-1' && event.landed)) throw new Error('Air plan did not resolve into a landing result');
console.log('OPAQUE_AIR_INTEGRATION_OK', airRoom.roomId, 'private-route, response-window, confirmation, settlement');
airHost.close(); airGuest.close();
