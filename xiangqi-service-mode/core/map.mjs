// Map abstraction. The 9x10 classic board is only one map implementation.

export const MAP_KINDS = Object.freeze({ CLASSIC: 'classic', CUSTOM: 'custom' });

export function classicMap() {
  return {
    id: 'classic-9x10-land',
    kind: MAP_KINDS.CLASSIC,
    version: 1,
    width: 9,
    height: 10,
    terrain: { riverRows: [4, 5] },
    zones: {
      redCamp: { x: [0, 8], y: [5, 9] },
      blackCamp: { x: [0, 8], y: [0, 4] },
      redPalace: { x: [3, 5], y: [7, 9] },
      blackPalace: { x: [3, 5], y: [0, 2] }
    },
    // Custom-map relation data lives beside zones. Empty arrays preserve 1.0 maps.
    generals: [],
    factionZones: [],
    relations: [],
    relationPatches: { added: [], excluded: [] },
    bridges: []
  };
}

export function validateMap(map) {
  if (!map?.id || !map?.kind || !Number.isInteger(map.width) || !Number.isInteger(map.height)) {
    throw new Error('地图描述缺少 id、kind、width 或 height');
  }
  if (!map.terrain || !map.zones) throw new Error('地图描述缺少地形或区域');
  if (map.generals !== undefined && !Array.isArray(map.generals)) throw new Error('将军席必须是数组');
  if (map.factionZones !== undefined && !Array.isArray(map.factionZones)) throw new Error('阵营区必须是数组');
  if (map.relations !== undefined && !Array.isArray(map.relations)) throw new Error('地图关系必须是数组');
  if (map.relations?.some((relation) => !relation?.generalId || !relation?.zoneId)) throw new Error('地图关系缺少 generalId 或 zoneId');
  if (map.relationPatches !== undefined) {
    if (!map.relationPatches || !Array.isArray(map.relationPatches.added) || !Array.isArray(map.relationPatches.excluded)) {
      throw new Error('关系补丁必须包含 added 和 excluded 数组');
    }
  }
  if ((map.factionZones || []).length > 127) throw new Error('阵营区数量不能超过 127');
  return true;
}
