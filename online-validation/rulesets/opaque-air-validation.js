const WIDTH = 9;
const HEIGHT = 10;
const MAX_FLIGHT_STEPS = 6;
const AIR_TYPES = new Set(['zhan', 'hong']);
const OCCUPYING_AIR_TYPES = new Set(['fang', 'zhi']);

const key = (x, y) => `${x},${y}`;
const inBounds = ({ x, y }) => Number.isInteger(x) && Number.isInteger(y) && x >= 0 && x < WIDTH && y >= 0 && y < HEIGHT;
const manhattan = (a, b) => Math.abs(a.x - b.x) + Math.abs(a.y - b.y);

function addSide(state, playerId, side) {
  const homeY = side === 'A' ? 1 : 8;
  const groundRows = side === 'A' ? [2, 4] : [5, 7];
  const supportY = side === 'A' ? 3 : 6;
  for (let index = 0; index < 6; index += 1) {
    const x = [0, 1, 2, 6, 7, 8][index];
    state.pads.push({ id: `${playerId}-pad-${index + 1}`, playerId, x, y: homeY, type: 'platform' });
  }
  state.pieces.push({ id: `${playerId}-general`, playerId, type: 'jiang', pool: 'regular', x: 4, y: side === 'A' ? 3 : 6 });
  for (const row of groundRows) for (const x of [0, 2, 4, 6]) state.pieces.push({ id: `${playerId}-fang-${row}-${x}`, playerId, type: 'fang', pool: 'air', x, y: row });
  for (const x of [0, 2, 6, 8]) state.pieces.push({ id: `${playerId}-zhi-${x}`, playerId, type: 'zhi', pool: 'air', x, y: supportY });
  for (let index = 0; index < 4; index += 1) {
    state.aircraft.push({ id: `${playerId}-zhan-${index + 1}`, playerId, type: 'zhan', pool: 'air', padId: `${playerId}-pad-${index + 1}`, status: 'docked' });
  }
  for (let index = 0; index < 2; index += 1) {
    state.aircraft.push({ id: `${playerId}-hong-${index + 1}`, playerId, type: 'hong', pool: 'air', padId: `${playerId}-pad-${index + 5}`, status: 'docked' });
  }
}

function routeError(state, playerId, aircraft, path) {
  if (!AIR_TYPES.has(aircraft?.type) || aircraft.playerId !== playerId) return '飞机不存在或不属于你';
  if (aircraft.status !== 'docked') return '该飞机当前不能起飞';
  if (!Array.isArray(path) || path.length < 1 || path.length > MAX_FLIGHT_STEPS || path.some(point => !inBounds(point))) return '航线必须由 1 至 6 个棋盘内航点组成';
  const source = state.pads.find(pad => pad.id === aircraft.padId);
  if (!source || source.playerId !== playerId || manhattan(source, path[0]) !== 1) return '航线必须从飞机所在停机坪的相邻点起步';
  for (let index = 1; index < path.length; index += 1) if (manhattan(path[index - 1], path[index]) !== 1) return '航线必须逐格连续移动';
  const destination = state.pads.find(pad => pad.playerId === playerId && pad.x === path.at(-1).x && pad.y === path.at(-1).y);
  if (!destination || destination.id === source.id) return '航线必须以另一座己方停机坪结束';
  return null;
}

function taskError(state, playerId, task) {
  const piece = state.pieces.find(item => item.id === task?.unitId);
  if (!piece || piece.playerId !== playerId || !OCCUPYING_AIR_TYPES.has(piece.type)) return '只能操作己方防空炮或直升机';
  if (task.kind !== 'move' || !inBounds(task.target) || manhattan(piece, task.target) !== 1) return '防空炮和直升机每个窗口只能移动一格';
  return null;
}

function isEnemy(playerA, playerB) { return playerA !== playerB; }
function inDefenseZone(piece, point) {
  if (piece.type === 'fang') return Math.max(Math.abs(piece.x - point.x), Math.abs(piece.y - point.y)) <= 1;
  return piece.type === 'zhi' && manhattan(piece, point) === 1;
}
function isOnPlatform(state, piece) { return state.pads.some(pad => pad.x === piece.x && pad.y === piece.y); }
function recordAirEliminations(state, pieces) {
  for (const piece of pieces) {
    if (!OCCUPYING_AIR_TYPES.has(piece.type) || !state.pools[piece.playerId]) continue;
    state.pools[piece.playerId].air.eliminated[piece.type] += 1;
  }
}

function settle(state, submissions, playerIds) {
  const events = [];
  const routes = [];
  const moves = [];
  for (const playerId of playerIds) for (const task of submissions[playerId] || []) {
    if (task.kind === 'move') moves.push({ playerId, pieceId: task.unitId, target: task.target });
    else routes.push({ playerId, aircraftId: task.unitId, path: task.path.map(point => ({ ...point })) });
  }

  for (const move of moves) {
    const piece = state.pieces.find(item => item.id === move.pieceId);
    if (piece) { piece.x = move.target.x; piece.y = move.target.y; events.push({ type: 'air_unit_moved', playerId: move.playerId, pieceId: piece.id, target: move.target }); }
  }
  const occupiedGroups = new Map();
  state.pieces.filter(piece => OCCUPYING_AIR_TYPES.has(piece.type)).forEach(piece => {
    const position = key(piece.x, piece.y);
    occupiedGroups.set(position, [...(occupiedGroups.get(position) || []), piece]);
  });
  const occupancyDeaths = new Set();
  for (const group of occupiedGroups.values()) if (group.length > 1) group.forEach(piece => occupancyDeaths.add(piece.id));
  if (occupancyDeaths.size) {
    recordAirEliminations(state, state.pieces.filter(piece => occupancyDeaths.has(piece.id)));
    state.pieces = state.pieces.filter(piece => !occupancyDeaths.has(piece.id));
    events.push({ type: 'occupancy_collision', pieceIds: [...occupancyDeaths] });
  }

  const flights = routes.map(route => {
    const aircraft = state.aircraft.find(item => item.id === route.aircraftId);
    return { ...route, aircraft, alive: Boolean(aircraft), landed: false, crashReason: null };
  }).filter(flight => flight.aircraft);
  const maximumTick = Math.max(0, ...flights.map(flight => flight.path.length));
  const marks = new Map();
  const bombs = [];
  for (let tick = 0; tick < maximumTick; tick += 1) {
    const arrivals = flights.filter(flight => flight.alive && flight.path[tick]);
    const byPoint = new Map();
    arrivals.forEach(flight => {
      const point = flight.path[tick], pointKey = key(point.x, point.y);
      byPoint.set(pointKey, [...(byPoint.get(pointKey) || []), flight]);
    });
    const newlyMarked = new Set();
    for (const [pointKey, group] of byPoint) {
      if (group.length > 1) {
        group.forEach(flight => { flight.alive = false; flight.crashReason = 'same_tick_collision'; });
        const earlier = marks.get(pointKey);
        const earlierFlight = flights.find(flight => flight.aircraft.id === earlier?.aircraftId);
        if (earlierFlight?.alive) { earlierFlight.alive = false; earlierFlight.crashReason = 'same_point_collision'; }
      } else {
        const earlier = marks.get(pointKey);
        const earlierFlight = flights.find(flight => flight.aircraft.id === earlier?.aircraftId);
        if (earlierFlight?.alive && earlierFlight !== group[0]) { earlierFlight.alive = false; earlierFlight.crashReason = 'intercepted_by_later_flight'; }
        newlyMarked.add(pointKey);
      }
    }

    const interceptedByDefense = new Set();
    for (const flight of arrivals) {
      if (!flight.alive) continue;
      const point = flight.path[tick];
      const defender = state.pieces.find(piece => isEnemy(piece.playerId, flight.playerId) && inDefenseZone(piece, point));
      if (defender) { flight.alive = false; flight.crashReason = `anti_air:${defender.id}`; interceptedByDefense.add(flight.aircraft.id); }
    }
    for (const pointKey of newlyMarked) {
      const flight = byPoint.get(pointKey)?.[0];
      if (flight?.alive) marks.set(pointKey, { aircraftId: flight.aircraft.id, tick });
    }
    for (const flight of arrivals) {
      if (flight.aircraft.type !== 'hong') continue;
      if (flight.alive || interceptedByDefense.has(flight.aircraft.id)) bombs.push({ playerId: flight.playerId, aircraftId: flight.aircraft.id, x: flight.path[tick].x, y: flight.path[tick].y, tick });
    }
    const bombed = new Set();
    for (const bomb of bombs.filter(item => item.tick === tick)) {
      for (const piece of state.pieces) {
        if (piece.type === 'platform' || isOnPlatform(state, piece)) continue;
        if (Math.max(Math.abs(piece.x - bomb.x), Math.abs(piece.y - bomb.y)) <= 1) bombed.add(piece.id);
      }
    }
    if (bombed.size) {
      recordAirEliminations(state, state.pieces.filter(piece => bombed.has(piece.id)));
      state.pieces = state.pieces.filter(piece => !bombed.has(piece.id));
      events.push({ type: 'bomb_impact', tick, pieceIds: [...bombed] });
    }
    for (const flight of arrivals) {
      if (!flight.alive || tick !== flight.path.length - 1) continue;
      const destination = state.pads.find(pad => pad.playerId === flight.playerId && pad.x === flight.path[tick].x && pad.y === flight.path[tick].y);
      if (destination) { flight.aircraft.padId = destination.id; flight.landed = true; flight.alive = false; }
    }
  }
  for (const flight of flights) {
    if (!flight.landed && flight.crashReason) {
      flight.aircraft.status = 'lost';
      const pool = state.pools[flight.playerId].air;
      pool.eliminated[flight.aircraft.type] += 1;
      events.push({ type: 'aircraft_eliminated', playerId: flight.playerId, aircraftId: flight.aircraft.id, aircraftType: flight.aircraft.type, pool: 'air' });
    }
    else if (flight.landed) flight.aircraft.status = 'docked';
    events.push({ type: 'flight_result', playerId: flight.playerId, aircraftId: flight.aircraft.id, path: flight.path, landed: flight.landed, crashReason: flight.crashReason });
  }
  state.revision += 1;
  state.lastAirEvents = events;
  return { events };
}

export const opaqueAirValidationRuleset = {
  id: 'opaque-air-validation-0.1',
  hash: 'opaque-air-validation-0.1',
  mode: 'opaque-air',
  createInitialState(playerIds = ['A', 'B']) {
    if (!Array.isArray(playerIds) || playerIds.length !== 2) throw new Error('不透明空战验证模式目前只支持双方对局');
    const state = { turnNumber: 1, activePlayerId: null, stepsLeft: 1, width: WIDTH, height: HEIGHT, revision: 0, pieces: [], pads: [], aircraft: [], pools: {}, lastAirEvents: [] };
    addSide(state, playerIds[0], 'A'); addSide(state, playerIds[1], 'B');
    for (const playerId of playerIds) state.pools[playerId] = { regular: { ready: [], eliminated: [] }, air: { ready: { fang: 0, zhan: 0, zhi: 0 }, fielded: { fang: 8, zhan: 4, zhi: 4 }, eliminated: { fang: 0, zhan: 0, zhi: 0 } } };
    return state;
  },
  validateCommand(state, command, playerId) {
    if (command.kind !== 'move') return { ok: false, code: 'UNSUPPORTED_COMMAND', message: '空战验证模式的普通回合只支持一步移动' };
    const piece = state.pieces.find(item => item.id === command.pieceId);
    if (!piece) return { ok: false, code: 'PIECE_NOT_FOUND', message: '棋子不存在' };
    if (piece.playerId !== playerId) return { ok: false, code: 'NOT_OWNER', message: '不能操作对方棋子' };
    if (state.activePlayerId !== playerId) return { ok: false, code: 'NOT_YOUR_TURN', message: '还没有轮到你' };
    if (!inBounds(command.target) || manhattan(piece, command.target) !== 1) return { ok: false, code: 'INVALID_MOVE', message: '验证模式只允许移动相邻一格' };
    return { ok: true };
  },
  executeCommand(state, command) {
    const piece = state.pieces.find(item => item.id === command.pieceId);
    const captured = state.pieces.find(item => item.x === command.target.x && item.y === command.target.y && item.playerId !== piece.playerId);
    if (captured) state.pieces = state.pieces.filter(item => item.id !== captured.id);
    piece.x = command.target.x; piece.y = command.target.y;
    return { effects: [{ type: 'move', pieceId: piece.id, target: command.target }, ...(captured ? [{ type: 'eliminate', pieceId: captured.id }] : [])] };
  },
  eliminateAirUnit(state, pieceId) {
    const piece = state.pieces.find(item => item.id === pieceId);
    if (piece) recordAirEliminations(state, [piece]);
  },
  validateRoutes(state, playerId, routes) {
    if (!Array.isArray(routes) || routes.length < 1) return { ok: false, code: 'EMPTY_AIR_ROUTES', message: '至少要确认一架飞机的完整航线' };
    const seen = new Set();
    for (const route of routes) {
      if (seen.has(route?.unitId)) return { ok: false, code: 'DUPLICATE_AIRCRAFT', message: '同一架飞机只能规划一条航线' };
      seen.add(route?.unitId);
      const aircraft = state.aircraft.find(item => item.id === route?.unitId);
      const error = routeError(state, playerId, aircraft, route?.path);
      if (error) return { ok: false, code: 'INVALID_AIR_ROUTE', message: error };
    }
    return { ok: true };
  },
  validateRoute(state, playerId, route) {
    const error = routeError(state, playerId, state.aircraft.find(item => item.id === route?.unitId), route?.path);
    return error ? { ok: false, code: 'INVALID_AIR_ROUTE', message: error } : { ok: true };
  },
  validateAirTasks(state, playerId, tasks, alreadyUsed = new Set()) {
    if (!Array.isArray(tasks)) return { ok: false, code: 'INVALID_AIR_TASKS', message: '空军命令格式无效' };
    const seen = new Set(alreadyUsed);
    for (const task of tasks) {
      if (seen.has(task?.unitId)) return { ok: false, code: 'AIR_UNIT_ALREADY_ACTED', message: '每架空军棋子本窗口只能执行一项任务' };
      const piece = state.pieces.find(item => item.id === task?.unitId);
      if (piece) {
        const error = taskError(state, playerId, task);
        if (error) return { ok: false, code: 'INVALID_AIR_TASK', message: error };
      } else {
        const aircraft = state.aircraft.find(item => item.id === task?.unitId);
        const error = routeError(state, playerId, aircraft, task?.path);
        if (task?.kind !== 'route' || error) return { ok: false, code: 'INVALID_AIR_TASK', message: error || '未知空军棋子' };
      }
      seen.add(task.unitId);
    }
    return { ok: true, unitIds: [...seen] };
  },
  settleAirWindow(state, submissions, playerIds) { return settle(state, submissions, playerIds); },
  rotateAirPool(state, playerId) {
    const pool = state.pools[playerId]?.air;
    if (!pool || Object.values(pool.ready).some(count => count > 0) || !Object.values(pool.eliminated).some(count => count > 0)) return { rotated: false };
    pool.ready = { ...pool.eliminated };
    pool.eliminated = { fang: 0, zhan: 0, zhi: 0 };
    return { rotated: true, ready: { ...pool.ready } };
  },
  finishTurn(state, playerIds) {
    const currentIndex = playerIds.indexOf(state.activePlayerId);
    state.activePlayerId = playerIds[(currentIndex + 1) % playerIds.length];
    state.turnNumber += 1; state.stepsLeft = 1;
  }
};
