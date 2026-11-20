import { relationVisual, togglePairing, toggleRelation, resolveRelations, deriveRelationIndexes, hitTestRegions } from '../core/relations.mjs';

export function createRelationsEditor({ board, matrix, status, map }) {
  let generals = map.generals || [];
  let zones = map.factionZones || [];
  let resolved = resolveRelations({ generals, zones, patches: map.relationPatches || {}, relations: map.relations || [] });
  let primary = { type: null, ids: [] };
  const selection = new Set();
  function choose(type, ids) {
    if (!ids.length) return;
    if (!primary.type) primary = { type, ids: ids.slice() };
    else if (primary.type === type) primary = { type, ids: [...new Set([...primary.ids, ...ids])] };
    else {
      const gs = type === 'general' ? ids : primary.ids;
      const zs = type === 'zone' ? ids : primary.ids;
      resolved.relations = togglePairing(resolved.relations, gs, zs);
      resolved.indexes = deriveRelationIndexes(resolved.relations);
      primary = { type: null, ids: [] };
    }
    selection.clear();
    const prefix = type === 'general' ? 'g:' : 'z:';
    ids.forEach((id) => selection.add(prefix + id));
    ids.forEach((id) => {
      const list = type === 'general' ? resolved.indexes.byGeneral.get(id) : resolved.indexes.byZone.get(id);
      (list || []).forEach((r) => selection.add((type === 'general' ? 'z:' : 'g:') + (type === 'general' ? r.zoneId : r.generalId)));
    });
    status.textContent = primary.type ? '已选择 ' + primary.ids.join('、') + '，请选择另一侧对象' : '关系已更新';
    refresh();
  }
  function renderMatrix() {
    matrix.innerHTML = '';
    const table = document.createElement('table'); table.className = 'relation-matrix';
    const head = document.createElement('tr');
    const corner = document.createElement('th'); corner.textContent = '将军席 / 阵营区'; head.append(corner);
    zones.forEach((z) => { const th = document.createElement('th'); th.dataset.zone = z.id; th.textContent = z.name || z.id; th.onclick = () => choose('zone', [z.id]); head.append(th); });
    table.append(head);
    generals.forEach((g) => { const row = document.createElement('tr'); const th = document.createElement('th'); th.dataset.general = g.id; th.textContent = g.name || g.id; th.onclick = () => choose('general', [g.id]); row.append(th); const relations = resolved.indexes.byGeneral.get(g.id) || []; zones.forEach((z) => { const td = document.createElement('td'); td.dataset.general = g.id; td.dataset.zone = z.id; const bound = relations.some((r) => r.zoneId === z.id); td.textContent = bound ? '●' : ''; if (bound) td.className = 'bound'; td.onclick = () => { resolved.relations = toggleRelation(resolved.relations, g.id, z.id); resolved.indexes = deriveRelationIndexes(resolved.relations); selection.clear(); selection.add('g:' + g.id); selection.add('z:' + z.id); refresh(); }; row.append(td); }); table.append(row); });
    matrix.append(table);
  }
  function refresh() {
    board.querySelectorAll('.map-overlay').forEach((node) => node.remove());
    generals.forEach((g) => { const node = document.createElement('button'); node.type = 'button'; node.className = 'map-overlay general-overlay' + (selection.has('g:' + g.id) ? ' is-related' : ''); node.style.left = (g.bounds.x[0] * 11.11) + '%'; node.style.top = (g.bounds.y[0] * 10) + '%'; node.style.width = ((g.bounds.x[1] - g.bounds.x[0] + 1) * 11.11) + '%'; node.style.height = ((g.bounds.y[1] - g.bounds.y[0] + 1) * 10) + '%'; node.onclick = () => choose('general', [g.id]); board.append(node); });
    zones.forEach((z, i) => { const visual = relationVisual(i); const node = document.createElement('button'); node.type = 'button'; node.className = 'map-overlay zone-overlay' + (selection.has('z:' + z.id) ? ' is-related' : ''); node.style.setProperty('--zone-color', visual.colors[0]); node.style.left = (z.bounds.x[0] * 11.11) + '%'; node.style.top = (z.bounds.y[0] * 10) + '%'; node.style.width = ((z.bounds.x[1] - z.bounds.x[0] + 1) * 11.11) + '%'; node.style.height = ((z.bounds.y[1] - z.bounds.y[0] + 1) * 10) + '%'; node.style.borderStyle = visual.lineStyle; node.onclick = () => choose('zone', [z.id]); board.append(node); });
    renderMatrix();
  }
  board.addEventListener('click', (event) => {
    if (event.target.closest('.map-overlay')) return;
    const cell = event.target.closest('.cell');
    if (!cell) return;
    const cells = [...board.querySelectorAll('.cell')];
    const index = cells.indexOf(cell);
    if (index < 0) return;
    const hit = hitTestRegions({ x: index % 9, y: Math.floor(index / 9) }, generals, zones);
    if (hit.type === 'general') choose('general', hit.generals.map((item) => item.id));
    if (hit.type === 'zone') choose('zone', hit.zones.map((item) => item.id));
  });
  function updateMap(nextMap = {}) {
    generals = nextMap.generals || [];
    zones = nextMap.factionZones || [];
    resolved = resolveRelations({ generals, zones, patches: nextMap.relationPatches || {}, relations: nextMap.relations || resolved.relations });
    primary = { type: null, ids: [] };
    selection.clear();
    refresh();
  }
  refresh();
  return { refresh, choose, updateMap, hitTest: (point) => hitTestRegions(point, generals, zones), getRelations: () => resolved.relations };
}




