export const BOARD = { width: 9, height: 10, riverRows: [4, 5] };
export const TYPES = {
  GENERAL: 'general', ADVISOR: 'advisor', ELEPHANT: 'elephant', HORSE: 'horse',
  ROOK: 'rook', CANNON: 'cannon', BARRACK: 'barrack'
};
export const SIDES = { RED: 'red', BLACK: 'black' };
export const POOL_TYPES = [TYPES.ROOK, TYPES.HORSE, TYPES.ELEPHANT, TYPES.CANNON];
const other = (side) => side === SIDES.RED ? SIDES.BLACK : SIDES.RED;
const inside = (x, y) => x >= 0 && x < BOARD.width && y >= 0 && y < BOARD.height;
const river = (y) => BOARD.riverRows.includes(y);
const edge = (a, b) => a.x === b.x && ((a.y === 4 && b.y === 5) || (a.y === 5 && b.y === 4));
const palace = (side, x, y) => x >= 3 && x <= 5 && (side === SIDES.RED ? y >= 7 : y <= 2);
const center = (side, x, y) => x === 4 && (side === SIDES.RED ? y === 8 : y === 1);
const waterType = (type) => [TYPES.GENERAL, TYPES.ELEPHANT, TYPES.ADVISOR, TYPES.BARRACK].includes(type);
const id = (side, type, n) => `${side}-${type}-${n}`;

export function initialState() {
  const pieces = [
    { id: id('red', TYPES.GENERAL, 0), side: SIDES.RED, type: TYPES.GENERAL, x: 4, y: 8 },
    { id: id('red', TYPES.ADVISOR, 0), side: SIDES.RED, type: TYPES.ADVISOR, x: 3, y: 8 },
    { id: id('red', TYPES.ADVISOR, 1), side: SIDES.RED, type: TYPES.ADVISOR, x: 5, y: 8 },
    { id: id('black', TYPES.GENERAL, 0), side: SIDES.BLACK, type: TYPES.GENERAL, x: 4, y: 1 },
    { id: id('black', TYPES.ADVISOR, 0), side: SIDES.BLACK, type: TYPES.ADVISOR, x: 3, y: 1 },
    { id: id('black', TYPES.ADVISOR, 1), side: SIDES.BLACK, type: TYPES.ADVISOR, x: 5, y: 1 }
  ];
  const pool = () => ({ production: [...POOL_TYPES], eliminated: [] });
  return {
    version: '1.0', mode: 'land', turn: SIDES.RED, move: 1, attackUsed: false,
    pieces, bridges: [], barracks: { red: [], black: [] },
    barrackInventory: { red: 5, black: 5 }, pools: { red: pool(), black: pool() },
    winner: null, log: [], extensions: { naval: null, aerial: null, parasites: null }
  };
}

export function pieceAt(state, x, y) { return state.pieces.find((p) => p.x === x && p.y === y); }
export function getPiece(state, pieceId) { return state.pieces.find((p) => p.id === pieceId); }
export function hasBridge(state, x) { return state.bridges.includes(x); }
export function isRiverCrossing(a, b) { return edge(a, b); }
function clone(state) { return structuredClone(state); }
function blocked(state, p, to) {
  return state.pieces.some((q) => q.id !== p.id && ((p.x === to.x && q.x === p.x && q.y > Math.min(p.y, to.y) && q.y < Math.max(p.y, to.y)) || (p.y === to.y && q.y === p.y && q.x > Math.min(p.x, to.x) && q.x < Math.max(p.x, to.x))));
}
function reachable(state, p, to, { bridge = false } = {}) {
  if (!inside(to.x, to.y) || pieceAt(state, to.x, to.y)?.side === p.side) return false;
  const crossesRiver = (p.y < 4 && to.y > 5) || (p.y > 5 && to.y < 4);
  if ((river(to.y) || crossesRiver) && !waterType(p.type) && !(bridge || hasBridge(state, p.x))) return false;
  return true;
}
function addAction(state, p, x, y, actions, type = 'move', note = '') {
  const to = { x, y }; if (!reachable(state, p, to)) return;
  const target = pieceAt(state, x, y); const attack = Boolean(target && target.side !== p.side);
  if (attack && state.attackUsed) return;
  actions.push({ type: attack ? 'attack' : type, pieceId: p.id, from: { x: p.x, y: p.y }, to, targetId: target?.id, attack, cost: 1, note });
}
function addLine(state, p, actions, cannon = false) {
  for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
    let x = p.x + dx; let y = p.y + dy; let jumped = false;
    while (inside(x, y)) {
      const target = pieceAt(state, x, y);
      if (target) {
        if (cannon && !jumped) { jumped = true; x += dx; y += dy; continue; }
        if (target.side !== p.side && (!cannon || jumped)) addAction(state, p, x, y, actions, 'attack');
        break;
      }
      if (!jumped) addAction(state, p, x, y, actions);
      x += dx; y += dy;
    }
  }
}
function addAdvisorJumpActions(state, p, actions) {
  state.pieces.filter((q) => q.side === p.side && q.id !== p.id && (q.x === p.x || q.y === p.y)).forEach((axis) => {
    const dx = axis.x === p.x ? 0 : Math.sign(axis.x - p.x);
    const dy = axis.y === p.y ? 0 : Math.sign(axis.y - p.y);
    const to = { x: p.x - dx * Math.abs(axis.x - p.x || axis.y - p.y), y: p.y - dy * Math.abs(axis.x - p.x || axis.y - p.y) };
    if (!inside(to.x, to.y) || pieceAt(state, to.x, to.y)?.side === p.side) return;
    const between = state.pieces.some((q) => q.side !== p.side && q.id !== axis.id && ((dx && q.y === p.y && q.x > Math.min(p.x, axis.x) && q.x < Math.max(p.x, axis.x)) || (dy && q.x === p.x && q.y > Math.min(p.y, axis.y) && q.y < Math.max(p.y, axis.y))));
    if (between || (river(to.y) && !waterType(p.type))) return;
    const target = pieceAt(state, to.x, to.y);
    if (target && state.attackUsed) return;
    actions.push({ type: target ? 'attack' : 'advisorJump', pieceId: p.id, from: { x: p.x, y: p.y }, to, targetId: target?.id, attack: Boolean(target), cost: 1, note: '士跳子' });
  });
}

export function legalActions(state, pieceId) {
  const p = getPiece(state, pieceId); if (!p || p.side !== state.turn || state.winner) return [];
  const actions = [];
  if (p.type === TYPES.GENERAL) {
    [[1, 0], [-1, 0], [0, 1], [0, -1]].forEach(([dx, dy]) => addAction(state, p, p.x + dx, p.y + dy, actions));
    if (center(p.side, p.x, p.y)) {
      [[1, 0], [-1, 0], [0, 1], [0, -1]].forEach(([dx, dy]) => {
        const x = p.x + dx; const y = p.y + dy;
        if (inside(x, y) && !pieceAt(state, x, y)) actions.push({ type: 'produceAdvisor', pieceId: p.id, from: { x: p.x, y: p.y }, to: { x, y }, cost: 1, attack: false, note: '将军生产士' });
      });
    }
    return actions;
  }
  if (p.type === TYPES.ADVISOR || p.type === TYPES.ELEPHANT || p.type === TYPES.BARRACK) {
    [[1, 0], [-1, 0], [0, 1], [0, -1]].forEach(([dx, dy]) => addAction(state, p, p.x + dx, p.y + dy, actions));
    if (p.type === TYPES.ADVISOR) {
      if (palace(p.side, p.x, p.y)) [[1, 1], [1, -1], [-1, 1], [-1, -1]].forEach(([dx, dy]) => addAction(state, p, p.x + dx, p.y + dy, actions));
      addAdvisorJumpActions(state, p, actions);
    }
    if (p.type === TYPES.ELEPHANT && (p.y === 3 || p.y === 6)) actions.push({ type: 'bridge', pieceId: p.id, from: { x: p.x, y: p.y }, to: { x: p.x, y: p.y }, bridgeX: p.x, cost: 1, attack: false, note: '搭建桥梁' });
    return actions;
  }
  if (p.type === TYPES.HORSE) {
    [[1, 2], [2, 1], [-1, 2], [-2, 1], [1, -2], [2, -1], [-1, -2], [-2, -1]].forEach(([dx, dy]) => {
      const leg = Math.abs(dx) === 2 ? { x: p.x + Math.sign(dx), y: p.y } : { x: p.x, y: p.y + Math.sign(dy) };
      if (!pieceAt(state, leg.x, leg.y) && (reachable(state, p, { x: p.x + dx, y: p.y + dy }) || hasBridge(state, p.x))) addAction(state, p, p.x + dx, p.y + dy, actions);
    });
    actions.push(p.deployed
      ? { type: 'detonate', pieceId: p.id, from: { x: p.x, y: p.y }, to: { x: p.x, y: p.y }, cost: 1, attack: true, note: '引爆部署马' }
      : { type: 'deployHorse', pieceId: p.id, from: { x: p.x, y: p.y }, to: { x: p.x, y: p.y }, cost: 1, attack: false, note: '部署马' });
    return actions;
  }
  if (p.type === TYPES.ROOK) addLine(state, p, actions);
  if (p.type === TYPES.CANNON) addLine(state, p, actions, true);
  return actions;
}

export function allActions(state) { return state.pieces.filter((p) => p.side === state.turn).flatMap((p) => legalActions(state, p.id)); }
function capture(next, target) {
  if (!target) return;
  if (target.type === TYPES.GENERAL) { next.winner = other(target.side); next.pieces = next.pieces.filter((p) => p.id !== target.id); return; }
  next.pools[target.side].eliminated.push(target.type); next.pieces = next.pieces.filter((p) => p.id !== target.id);
}
function removePieceToPool(next, piece) {
  if (!piece) return;
  if (piece.type !== TYPES.GENERAL) next.pools[piece.side].eliminated.push(piece.type);
  next.pieces = next.pieces.filter((p) => p.id !== piece.id);
}
function finish(next, side, text) { next.log.push(`${side}: ${text}`); next.move += 1; next.turn = other(side); next.attackUsed = false; }
function sameAction(a, b) {
  return a.type === b.type && a.pieceId === b.pieceId &&
    a.to?.x === b.to?.x && a.to?.y === b.to?.y &&
    (a.targetId ?? null) === (b.targetId ?? null) &&
    (a.produceType ?? null) === (b.produceType ?? null) &&
    (a.deployed ?? false) === (b.deployed ?? false) &&
    (a.bridgeX ?? null) === (b.bridgeX ?? null);
}
function findExact(state, action) { return legalActions(state, action.pieceId).find((candidate) => sameAction(candidate, action)); }

export function applyAction(state, action) {
  const exact = findExact(state, action); if (!exact) throw new Error('非法行动');
  const next = clone(state); const p = getPiece(next, action.pieceId);
  if (action.type === 'bridge') { if (!next.bridges.includes(action.bridgeX)) next.bridges.push(action.bridgeX); finish(next, state.turn, '搭建桥梁'); return next; }
  if (action.type === 'produceAdvisor') {
    next.pieces.push({ id: id(state.turn, TYPES.ADVISOR, next.pieces.length), side: state.turn, type: TYPES.ADVISOR, x: action.to.x, y: action.to.y });
    finish(next, state.turn, '将军生产士'); return next;
  }
  if (action.type === 'deployHorse') { p.deployed = true; finish(next, state.turn, '部署马'); return next; }
  if (action.type === 'detonate') {
    const victims = next.pieces.filter((q) => q.side !== p.side && Math.abs(q.x - p.x) <= 1 && Math.abs(q.y - p.y) <= 1);
    victims.forEach((q) => capture(next, q)); next.pieces = next.pieces.filter((q) => q.id !== p.id); next.pools[p.side].eliminated.push(TYPES.HORSE); finish(next, state.turn, '引爆部署马'); return next;
  }
  const target = action.targetId ? getPiece(next, action.targetId) : null;
  if (target?.type === TYPES.HORSE && target.deployed) {
    removePieceToPool(next, p);
    removePieceToPool(next, target);
    next.attackUsed = true;
    finish(next, state.turn, '攻击部署马，双方同归于尽');
    return next;
  }
  p.x = action.to.x; p.y = action.to.y; p.deployed = false; capture(next, target); next.attackUsed = Boolean(action.attack); finish(next, state.turn, action.note || action.type); return next;
}

export function canDeploy(state, side) { const g = state.pieces.find((p) => p.side === side && p.type === TYPES.GENERAL); return Boolean(g && palace(side, g.x, g.y)); }
export function deployBarrack(state, x, y, side = state.turn) {
  if (side !== state.turn || !canDeploy(state, side) || !inside(x, y) || river(y) || pieceAt(state, x, y) || state.barrackInventory[side] <= 0) throw new Error('兵营不能部署在此处');
  const next = clone(state); const n = next.barracks[side].length; next.pieces.push({ id: id(side, TYPES.BARRACK, n), side, type: TYPES.BARRACK, x, y }); next.barracks[side].push(id(side, TYPES.BARRACK, n)); next.barrackInventory[side] -= 1; finish(next, side, '部署兵营'); return next;
}
export function deployHorses(state, pieceIds) {
  if (!Array.isArray(pieceIds) || pieceIds.length === 0 || state.winner) throw new Error('没有可部署的马');
  const horses = pieceIds.map((pieceId) => getPiece(state, pieceId));
  if (horses.some((p) => !p || p.side !== state.turn || p.type !== TYPES.HORSE || p.deployed)) throw new Error('只能部署当前方的常规马');
  const next = clone(state); horses.forEach((horse) => { getPiece(next, horse.id).deployed = true; });
  finish(next, state.turn, `部署${horses.length}匹马`);
  return next;
}
export function productionActions(state, barrackId) {
  const b = getPiece(state, barrackId); if (!b || b.side !== state.turn || b.type !== TYPES.BARRACK || !canDeploy(state, b.side)) return [];
  const actions = []; [[1, 0], [-1, 0], [0, 1], [0, -1]].forEach(([dx, dy]) => { const x = b.x + dx; const y = b.y + dy; if (!inside(x, y) || river(y) || pieceAt(state, x, y)) return; state.pools[b.side].production.forEach((type, index) => {
    actions.push({ type: 'produce', pieceId: b.id, from: { x: b.x, y: b.y }, to: { x, y }, produceType: type, poolIndex: index, deployed: false, cost: 1, attack: false });
    if (type === TYPES.HORSE) actions.push({ type: 'produce', pieceId: b.id, from: { x: b.x, y: b.y }, to: { x, y }, produceType: type, poolIndex: index, deployed: true, cost: 1, attack: false, note: '生产部署马' });
  }); }); return actions;
}
export function applyProduction(state, action) {
  const legal = productionActions(state, action.pieceId).find((a) => a.produceType === action.produceType && a.to.x === action.to.x && a.to.y === action.to.y && a.deployed === Boolean(action.deployed)); if (!legal) throw new Error('非法生产');
  const next = clone(state); const pool = next.pools[state.turn].production; const index = pool.indexOf(action.produceType); pool.splice(index, 1); const serial = next.pieces.length + state.move; next.pieces.push({ id: id(state.turn, action.produceType, serial), side: state.turn, type: action.produceType, x: action.to.x, y: action.to.y, deployed: action.produceType === TYPES.HORSE && action.deployed === true }); finish(next, state.turn, `生产${action.produceType}`); return next;
}
export function rotatePools(state, side = state.turn) { const next = clone(state); if (next.pools[side].production.length !== 0) throw new Error('生产区尚未清空'); next.pools[side].production = next.pools[side].eliminated.splice(0); return next; }
export function registerModeExtension(state, name, extension) { if (!name || !extension) throw new Error('扩展必须有名称和定义'); state.extensions[name] = extension; return state; }
