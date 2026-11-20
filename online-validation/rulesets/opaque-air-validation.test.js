import assert from 'node:assert/strict';
import { opaqueAirValidationRuleset as rules } from './opaque-air-validation.js';

const state = rules.createInitialState(['A', 'B']);
assert.equal(state.pieces.filter(p => p.playerId === 'A' && p.type === 'fang').length, 8);
assert.equal(state.pieces.filter(p => p.playerId === 'A' && p.type === 'zhi').length, 4);
assert.equal(state.aircraft.filter(p => p.playerId === 'A' && p.type === 'zhan').length, 4);
assert.deepEqual(state.pools.A.air.fielded, { fang: 8, zhan: 4, zhi: 4 });
assert.deepEqual(state.pools.A.air.ready, { fang: 0, zhan: 0, zhi: 0 });
assert.equal(rules.rotateAirPool(state, 'A').rotated, false);

const valid = { unitId: 'A-zhan-1', path: [{ x: 1, y: 1 }] };
assert.equal(rules.validateRoute(state, 'A', valid).ok, true);
assert.equal(rules.validateRoute(state, 'B', valid).ok, false);
assert.equal(rules.validateRoute(state, 'A', { unitId: 'A-zhan-1', path: [{ x: 1, y: 3 }] }).ok, false);

const occupied = rules.createInitialState(['A', 'B']);
const a = occupied.pieces.find(p => p.id === 'A-fang-2-0');
const b = occupied.pieces.find(p => p.id === 'B-fang-5-0');
a.x = b.x = 3; a.y = b.y = 3;
rules.settleAirWindow(occupied, { A: [{ kind: 'move', unitId: a.id, target: { x: 3, y: 3 } }], B: [{ kind: 'move', unitId: b.id, target: { x: 3, y: 3 } }] }, ['A', 'B']);
assert.equal(occupied.pieces.some(p => p.id === a.id || p.id === b.id), false);

const collision = rules.createInitialState(['A', 'B']);
const result = rules.settleAirWindow(collision, { A: [valid], B: [{ unitId: 'B-zhan-1', path: [{ x: 1, y: 8 }] }] }, ['A', 'B']);
assert.equal(result.events.filter(e => e.type === 'flight_result').length, 2);

const samePoint = rules.createInitialState(['A', 'B']);
samePoint.pieces = samePoint.pieces.filter(piece => piece.type !== 'fang' && piece.type !== 'zhi');
samePoint.pads = samePoint.pads.filter(pad => !((pad.playerId === 'A' && pad.x === 0) || (pad.playerId === 'B' && pad.x === 8)));
const samePointResult = rules.settleAirWindow(samePoint, {
  A: [{ unitId: 'A-zhan-1', path: [{ x: 1, y: 2 }, { x: 2, y: 2 }, { x: 3, y: 2 }, { x: 4, y: 2 }, { x: 5, y: 2 }, { x: 6, y: 2 }] }],
  B: [{ unitId: 'B-zhan-1', path: [{ x: 7, y: 7 }, { x: 6, y: 7 }, { x: 3, y: 2 }, { x: 4, y: 2 }, { x: 5, y: 2 }, { x: 6, y: 2 }, { x: 2, y: 6 }] }]
}, ['A', 'B']);
assert.equal(samePointResult.events.filter(e => e.type === 'flight_result' && e.crashReason === 'same_tick_collision').length, 2);

const defense = rules.createInitialState(['A', 'B']);
const defenseUnit = defense.pieces.find(p => p.id === 'B-fang-5-0');
defenseUnit.x = 1; defenseUnit.y = 2;
const defenseResult = rules.settleAirWindow(defense, { A: [{ unitId: 'A-hong-1', path: [{ x: 1, y: 1 }] }] }, ['A', 'B']);
assert.ok(defenseResult.events.some(e => e.type === 'flight_result' && e.crashReason?.startsWith('anti_air:')));
assert.ok(defenseResult.events.some(e => e.type === 'bomb_impact' && e.pieceIds.includes(defenseUnit.id)));

const platformImmunity = rules.createInitialState(['A', 'B']);
const platformUnit = platformImmunity.pieces.find(p => p.id === 'B-fang-5-0');
platformUnit.x = 0; platformUnit.y = 1;
rules.settleAirWindow(platformImmunity, { A: [{ unitId: 'A-hong-1', path: [{ x: 1, y: 1 }] }] }, ['A', 'B']);
assert.ok(platformImmunity.pieces.some(p => p.id === platformUnit.id), 'Unit on a platform should be immune to bomb impact');

const rotation = rules.createInitialState(['A', 'B']);
const lostUnit = rotation.pieces.find(p => p.id === 'A-fang-2-0');
rules.eliminateAirUnit(rotation, lostUnit.id);
rotation.pieces = rotation.pieces.filter(p => p.id !== lostUnit.id);
rotation.pools.A.air.ready = { fang: 0, zhan: 0, zhi: 0 };
assert.equal(rules.rotateAirPool(rotation, 'A').rotated, true);
assert.equal(rotation.pools.A.air.ready.fang, 1);
assert.deepEqual(rotation.pools.A.regular, { ready: [], eliminated: [] });
console.log('OPAQUE_AIR_RULES_OK');
