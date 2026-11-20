// Pure data helpers for the General Seat <-> Faction Zone relation editor.

export const MAX_ZONES = 127;
export const RELATION_COLORS = Object.freeze(['#d84a4a', '#e28a32', '#d6b52f', '#4f9b62', '#4c7fc4', '#6559a8', '#a34f9c']);
export const RELATION_LINE_STYLES = Object.freeze(['solid', 'dashed', 'dotted', 'wavy']);

const keyOf = (generalId, zoneId) => `${String(generalId)}\u0000${String(zoneId)}`;
const asArray = (value) => Array.isArray(value) ? value : [];

export function relationKey(generalId, zoneId) { return keyOf(generalId, zoneId); }

export function normalizeRelations(relations = []) {
  const seen = new Set();
  const result = [];
  for (const relation of asArray(relations)) {
    if (!relation || relation.generalId == null || relation.zoneId == null) continue;
    const generalId = String(relation.generalId);
    const zoneId = String(relation.zoneId);
    const key = keyOf(generalId, zoneId);
    if (seen.has(key)) continue;
    seen.add(key);
    result.push({
      generalId,
      zoneId,
      ...(relation.weight === undefined ? {} : { weight: relation.weight }),
      ...(relation.note === undefined ? {} : { note: relation.note })
    });
  }
  return result;
}

export function deriveRelationIndexes(relations = []) {
  const byGeneral = new Map();
  const byZone = new Map();
  for (const relation of normalizeRelations(relations)) {
    if (!byGeneral.has(relation.generalId)) byGeneral.set(relation.generalId, []);
    if (!byZone.has(relation.zoneId)) byZone.set(relation.zoneId, []);
    byGeneral.get(relation.generalId).push(relation);
    byZone.get(relation.zoneId).push(relation);
  }
  return { byGeneral, byZone };
}

function mapZones(map) {
  if (Array.isArray(map?.factionZones)) return map.factionZones;
  if (Array.isArray(map?.zonesList)) return map.zonesList;
  return [];
}

export function validateRelations(map = {}) {
  const generals = new Set(asArray(map.generals).map((item) => item?.id).filter(Boolean));
  const zones = mapZones(map);
  const zoneIds = new Set(zones.map((item) => item?.id).filter(Boolean));
  const relations = normalizeRelations(map.relations);
  const errors = [];
  const warnings = [];
  for (const relation of relations) {
    if (!generals.has(relation.generalId)) errors.push(`悬空将军席引用: ${relation.generalId}`);
    if (!zoneIds.has(relation.zoneId)) errors.push(`悬空阵营区引用: ${relation.zoneId}`);
  }
  for (const zoneId of zoneIds) {
    if (!relations.some((relation) => relation.zoneId === zoneId)) warnings.push(`阵营区无绑定: ${zoneId}`);
  }
  if (zones.length > MAX_ZONES) errors.push(`阵营区数量不能超过 ${MAX_ZONES}`);
  return { errors, warnings, relations, valid: errors.length === 0 };
}

function contains(bounds, point) {
  return !!bounds && Array.isArray(bounds.x) && Array.isArray(bounds.y)
    && point.x >= bounds.x[0] && point.x <= bounds.x[1]
    && point.y >= bounds.y[0] && point.y <= bounds.y[1];
}

export function computeGeometryDefaults(generals = [], zones = []) {
  const result = [];
  for (const general of asArray(generals)) {
    const bounds = general?.bounds;
    if (!general?.id || !bounds?.x || !bounds?.y) continue;
    const corners = [
      { x: bounds.x[0], y: bounds.y[0] },
      { x: bounds.x[1], y: bounds.y[0] },
      { x: bounds.x[0], y: bounds.y[1] },
      { x: bounds.x[1], y: bounds.y[1] }
    ];
    for (const zone of asArray(zones)) {
      if (zone?.id && corners.every((point) => contains(zone.bounds, point))) {
        result.push({ generalId: String(general.id), zoneId: String(zone.id) });
      }
    }
  }
  return normalizeRelations(result);
}

export function resolveRelations({ generals = [], zones = [], patches = {}, relations = [] } = {}) {
  const geometryDefaults = computeGeometryDefaults(generals, zones);
  const geometryKeys = new Set(geometryDefaults.map((relation) => keyOf(relation.generalId, relation.zoneId)));
  const added = normalizeRelations([...(asArray(relations)), ...asArray(patches.added)]);
  const excluded = normalizeRelations(patches.excluded).filter((relation) => geometryKeys.has(keyOf(relation.generalId, relation.zoneId)));
  const final = new Map(geometryDefaults.map((relation) => [keyOf(relation.generalId, relation.zoneId), relation]));
  for (const relation of added) final.set(keyOf(relation.generalId, relation.zoneId), relation);
  for (const relation of excluded) final.delete(keyOf(relation.generalId, relation.zoneId));
  const resolved = [...final.values()];
  return { relations: resolved, geometryDefaults, patches: { added, excluded }, indexes: deriveRelationIndexes(resolved) };
}

export function toggleRelation(relations, generalId, zoneId) {
  const next = normalizeRelations(relations);
  const index = next.findIndex((relation) => relation.generalId === String(generalId) && relation.zoneId === String(zoneId));
  if (index >= 0) next.splice(index, 1); else next.push({ generalId: String(generalId), zoneId: String(zoneId) });
  return next;
}

export function togglePairing(relations, generalIds = [], zoneIds = []) {
  const generals = [...new Set(generalIds.map(String))];
  const zones = [...new Set(zoneIds.map(String))];
  const pairs = generals.flatMap((generalId) => zones.map((zoneId) => ({ generalId, zoneId })));
  if (!pairs.length) return normalizeRelations(relations);
  const current = normalizeRelations(relations);
  const existing = new Set(current.map((relation) => keyOf(relation.generalId, relation.zoneId)));
  const allBound = pairs.every((pair) => existing.has(keyOf(pair.generalId, pair.zoneId)));
  const pairKeys = new Set(pairs.map((pair) => keyOf(pair.generalId, pair.zoneId)));
  const next = current.filter((relation) => !allBound || !pairKeys.has(keyOf(relation.generalId, relation.zoneId)));
  if (!allBound) for (const pair of pairs) if (!existing.has(keyOf(pair.generalId, pair.zoneId))) next.push(pair);
  return normalizeRelations(next);
}

export function relationVisual(index) {
  if (!Number.isInteger(index) || index < 0 || index >= MAX_ZONES) throw new RangeError(`关系视觉索引必须在 0-${MAX_ZONES - 1}`);
  const mask = index + 1;
  return { mask, colors: RELATION_COLORS.filter((_, bit) => mask & (1 << bit)), lineStyle: RELATION_LINE_STYLES[index % RELATION_LINE_STYLES.length] };
}

export function canAddFactionZone(zones = []) { return asArray(zones).length < MAX_ZONES; }
export function assertFactionZoneLimit(zones = []) { if (!canAddFactionZone(zones)) throw new RangeError(`阵营区数量不能超过 ${MAX_ZONES}`); return true; }


// Uniform grid index for pointer hit testing. Buckets hold candidates; exact bounds checks remain in hitTestRegions.
export function buildSpatialIndex(items = [], cellSize = 1) {
  if (!(cellSize > 0)) throw new RangeError('网格尺寸必须大于 0');
  const buckets = new Map();
  const bucketKey = (x, y) => `${x},${y}`;
  for (const item of asArray(items)) {
    const bounds = item?.bounds;
    if (!bounds?.x || !bounds?.y) continue;
    const minX = Math.floor(bounds.x[0] / cellSize), maxX = Math.floor(bounds.x[1] / cellSize);
    const minY = Math.floor(bounds.y[0] / cellSize), maxY = Math.floor(bounds.y[1] / cellSize);
    for (let x = minX; x <= maxX; x += 1) for (let y = minY; y <= maxY; y += 1) {
      const key = bucketKey(x, y);
      if (!buckets.has(key)) buckets.set(key, []);
      buckets.get(key).push(item);
    }
  }
  return { cellSize, buckets };
}

export function querySpatialIndex(index, point) {
  if (!index || !(index.cellSize > 0) || !point) return [];
  return index.buckets.get(`${Math.floor(point.x / index.cellSize)},${Math.floor(point.y / index.cellSize)}`) || [];
}

export const createSpatialIndex = buildSpatialIndex;
export function hitTestRegions(point, generals = [], zones = []) {
  const hitGenerals = asArray(generals).filter((item) => contains(item?.bounds, point));
  if (hitGenerals.length) return { type: 'general', items: hitGenerals, generals: hitGenerals, zones: [] };
  const hitZones = asArray(zones).filter((item) => contains(item?.bounds, point));
  return hitZones.length ? { type: 'zone', items: hitZones, generals: [], zones: hitZones } : { type: null, items: [], generals: [], zones: [] };
}


