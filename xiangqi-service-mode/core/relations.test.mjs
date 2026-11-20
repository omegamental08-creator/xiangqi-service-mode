import test from 'node:test';
import assert from 'node:assert/strict';
import { classicMap, validateMap } from './map.mjs';
import { MAX_ZONES, deriveRelationIndexes, normalizeRelations, validateRelations, computeGeometryDefaults, resolveRelations, toggleRelation, togglePairing, relationVisual, canAddFactionZone, assertFactionZoneLimit, hitTestRegions } from './relations.mjs';

const generals = [{ id: 'G1', bounds: { x: [2, 3], y: [2, 3] } }, { id: 'G2', bounds: { x: [7, 8], y: [7, 8] } }];
const zones = [{ id: 'Z1', bounds: { x: [0, 5], y: [0, 5] } }, { id: 'Z2', bounds: { x: [6, 9], y: [6, 9] } }];

test('relation normalization deduplicates while retaining attributes', () => {
  const relations = normalizeRelations([{ generalId: 'G1', zoneId: 'Z1', weight: 2 }, { generalId: 'G1', zoneId: 'Z1', note: 'duplicate' }]);
  assert.deepEqual(relations, [{ generalId: 'G1', zoneId: 'Z1', weight: 2 }]);
  const indexes = deriveRelationIndexes(relations);
  assert.equal(indexes.byGeneral.get('G1').length, 1);
  assert.equal(indexes.byZone.get('Z1').length, 1);
});

test('validation reports dangling references and orphan zones', () => {
  const result = validateRelations({ generals: [{ id: 'G1' }], factionZones: [{ id: 'Z1' }, { id: 'Z2' }], relations: [{ generalId: 'G1', zoneId: 'missing' }] });
  assert.equal(result.valid, false);
  assert.ok(result.errors.some((message) => message.includes('悬空阵营区引用')));
  assert.ok(result.warnings.some((message) => message.includes('Z1')));
  assert.ok(result.warnings.some((message) => message.includes('Z2')));
});

test('geometry defaults require every general corner inside a zone', () => {
  assert.deepEqual(computeGeometryDefaults(generals, zones), [{ generalId: 'G1', zoneId: 'Z1' }, { generalId: 'G2', zoneId: 'Z2' }]);
});

test('resolution merges geometry and explicit additions and cleans invalid exclusions', () => {
  const result = resolveRelations({ generals, zones, relations: [{ generalId: 'G1', zoneId: 'Z2', note: 'manual' }], patches: { excluded: [{ generalId: 'G1', zoneId: 'Z1' }, { generalId: 'G1', zoneId: 'Z2' }] } });
  assert.deepEqual(result.relations, [{ generalId: 'G2', zoneId: 'Z2' }, { generalId: 'G1', zoneId: 'Z2', note: 'manual' }]);
  assert.deepEqual(result.patches.excluded, [{ generalId: 'G1', zoneId: 'Z1' }]);
});

test('single and cartesian pairing toggles implement all-have-then-remove', () => {
  assert.deepEqual(toggleRelation([], 'G1', 'Z1'), [{ generalId: 'G1', zoneId: 'Z1' }]);
  assert.deepEqual(toggleRelation([{ generalId: 'G1', zoneId: 'Z1' }], 'G1', 'Z1'), []);
  assert.deepEqual(togglePairing([{ generalId: 'G1', zoneId: 'Z1' }], ['G1', 'G2'], ['Z1', 'Z2']), [
    { generalId: 'G1', zoneId: 'Z1' }, { generalId: 'G1', zoneId: 'Z2' }, { generalId: 'G2', zoneId: 'Z1' }, { generalId: 'G2', zoneId: 'Z2' }
  ]);
  assert.deepEqual(togglePairing([{ generalId: 'G1', zoneId: 'Z1' }, { generalId: 'G1', zoneId: 'Z2' }], ['G1'], ['Z1', 'Z2']), []);
});

test('127 visual slots and zone capacity are bounded', () => {
  assert.equal(relationVisual(0).colors.length, 1);
  assert.equal(relationVisual(MAX_ZONES - 1).mask, MAX_ZONES);
  assert.throws(() => relationVisual(MAX_ZONES), RangeError);
  assert.equal(canAddFactionZone(new Array(MAX_ZONES - 1)), true);
  assert.equal(canAddFactionZone(new Array(MAX_ZONES)), false);
  assert.throws(() => assertFactionZoneLimit(new Array(MAX_ZONES)), RangeError);
});

test('hit testing prioritizes generals and returns overlapping zones together', () => {
  assert.equal(hitTestRegions({ x: 2, y: 2 }, generals, zones).type, 'general');
  const hit = hitTestRegions({ x: 4, y: 4 }, [], [{ id: 'Z1', bounds: { x: [0, 5], y: [0, 5] } }, { id: 'Z2', bounds: { x: [3, 6], y: [3, 6] } }]);
  assert.deepEqual(hit.zones.map((zone) => zone.id), ['Z1', 'Z2']);
  assert.equal(hitTestRegions({ x: 20, y: 20 }, [], []).type, null);
});

test('classic map keeps relation fields compatible with 1.0 validation', () => {
  const map = classicMap();
  assert.doesNotThrow(() => validateMap(map));
  assert.deepEqual(map.relations, []);
  assert.deepEqual(map.relationPatches, { added: [], excluded: [] });
});
