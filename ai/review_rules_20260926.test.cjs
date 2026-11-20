const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const http = require('node:http');
const { spawn } = require('node:child_process');
const { chromium } = require('playwright');

const root = path.resolve(__dirname, '..');
const htmlPath = path.join(root, 'chess_service_final.html');
const html = fs.readFileSync(htmlPath, 'utf8');
const results = [];
const baseline = [];
const exported = ['G', 'canReach', 'getShipAt', 'isShipUnit', 'canPlaceBingAt', 'canProduceAt', 'canPlayerProduce', 'canShipCannonHit', 'executeShipCannon', 'executeAttack', 'resolvePlannedFlight', 'crashFighterAt', 'attachParasite', 'checkPieceRotate', 'eliminatePiece', 'generalsHaveClearSight', 'getAIBridgePlan', 'clearXiangBridge', 'enqueueCommand', 'startDecisionTurn', 'getTurnStepLimit', 'showDiplomacyModal', 'handleGameTap', 'deactivatePiece', 'generateRandomMap', 'getPieceDef', 'checkWinCondition', 'createMultiNationState', 'getShiJumpTargets'];
exported.push('setGamePhase', 'resizeCanvas', 'centerView', 'handlePlaceTap', 'canAILoad', 'addAIMovementActions', 'addAIProductionActions', 'buildAIRouteCandidates', 'isValidFlightPath', 'executeBoardingMove');
const marker = '    window.ChessBarracksGameAPI=Object.freeze({';
assert.equal(html.split(marker).length, 2, 'Test hook requires a unique API marker');
const instrumented = html.replace(marker, `    window.__reviewTest={${exported.join(',')}};\n${marker}`);

function command(args, env = {}) {
  return new Promise(resolve => {
    const child = spawn(process.execPath, args, { cwd: root, env: { ...process.env, ...env }, windowsHide: true });
    let output = '';
    const timer = setTimeout(() => child.kill(), 180000);
    child.stdout.on('data', chunk => { output += chunk; });
    child.stderr.on('data', chunk => { output += chunk; });
    child.on('error', error => { output += error.stack; });
    child.on('close', code => { clearTimeout(timer); resolve({ command: args.join(' '), code, output }); });
  });
}

async function main() {
  const server = http.createServer((request, response) => {
    const pathname = new URL(request.url, 'http://localhost').pathname;
    const files = { '/chess_service_final.html': html, '/ai/chess_barracks_ai.js': fs.readFileSync(path.join(__dirname, 'chess_barracks_ai.js'), 'utf8') };
    if (!(pathname in files)) { response.writeHead(404); response.end(); return; }
    response.setHeader('Content-Type', pathname.endsWith('.html') ? 'text/html; charset=utf-8' : 'text/javascript; charset=utf-8');
    response.end(files[pathname]);
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const url = `http://127.0.0.1:${server.address().port}/chess_service_final.html`;
  let browser;
  try {
    baseline.push(await command(['ai/chess_barracks_ai.test.js']));
    baseline.push(await command(['ai/browser_regression.test.cjs'], { CHESS_GAME_URL: url }));
    const executablePath = [process.env.CHROME_PATH, 'C:/Program Files/Google/Chrome/Application/chrome.exe', 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe'].find(candidate => candidate && fs.existsSync(candidate));
    browser = await chromium.launch({ headless: true, executablePath });
    const context = await browser.newContext();
    await context.route('**/chess_service_final.html', route => route.fulfill({ contentType: 'text/html', body: instrumented }));
    const page = await context.newPage();
    const pageErrors = [];
    page.on('pageerror', error => pageErrors.push(error.message));
    await page.goto(url, { waitUntil: 'networkidle' });
    await page.waitForFunction(() => window.__reviewTest);
    const initial = await page.evaluate(() => JSON.parse(JSON.stringify(window.__reviewTest.G)));

    async function test(id, rule, name, run, expected, interact = null) {
      await page.goto(url, { waitUntil: 'load' });
      await page.waitForFunction(() => window.__reviewTest);
      await page.evaluate(snapshot => {
        const api = window.__reviewTest;
        Object.assign(api.G, JSON.parse(JSON.stringify(snapshot)));
        const state = api.G;
        state.selectedVersion = '4.0';
        state.features = { sea: true, air: true, parasite: true, multiNation: true };
        state.gamePhase = 'gamePlay';
        state.ai.paused = true;
        state.ai.controllers = { A: { type: 'human' }, B: { type: 'human' } };
        state.map = {
          w: 12, h: 12, isClassic: false,
          grid: Array.from({ length: 12 }, () => Array.from({ length: 12 }, () => ({ land: true, connected: true, isRiver: false, isSea: false, bridge: false, bridgeOwner: null }))),
          jiangxi: [{ id: 'palaceA', x0: 0, y0: 0, x1: 1, y1: 1, bindPlayer: 'A', bindZone: 'zoneA' }, { id: 'palaceB', x0: 9, y0: 9, x1: 10, y1: 10, bindPlayer: 'B', bindZone: 'zoneB' }],
          zones: [{ id: 'zoneA', player: 'A', closed: true, points: [{ x: 0, y: 0 }, { x: 11, y: 0 }, { x: 11, y: 11 }, { x: 0, y: 11 }] }, { id: 'zoneB', player: 'B', closed: true, points: [{ x: 8, y: 8 }, { x: 11, y: 8 }, { x: 11, y: 11 }, { x: 8, y: 11 }] }],
        };
        window.reviewPiece = (id, type, player, x, y, extra = {}) => ({ id, type, player, x, y, deploy: false, activated: false, stack: [], parasite: null, ...extra });
        window.reviewWater = () => state.map.grid.forEach(row => row.forEach(cell => Object.assign(cell, { land: false, connected: false, isSea: true, isRiver: false })));
        state.pieces = [window.reviewPiece('generalA', 'jiang', 'A', 1, 1), window.reviewPiece('generalB', 'jiang', 'B', 10, 10)];
        state.prepare = { A: { che: 2, ma: 2, shi: 2, xiang: 2, pao: 2, fang: 2, zhan: 2, tietai: 2, dujie: 2 }, B: { che: 2, ma: 2, tietai: 2, dujie: 2 } };
        state.eliminated = { A: {}, B: {} };
        state.warReady = { A: 5, B: 5 };
        state.multiNation = api.createMultiNationState(['A', 'B']);
        state.turnPlayer = 'A';
        state.stepsLeft = 1;
        state.ruleMode = 'fixedOne';
        state.prepare.A.zhan = 0;
        api.startDecisionTurn();
        window.closeModal();
      }, initial);
      await page.evaluate(({ id }) => {
        window.reviewVersion = id.startsWith('R02-') ? id.slice(4) : '4.0';
        window.reviewType = id.startsWith('R06-') ? id.slice(4) : null;
        window.reviewKind = id.startsWith('R14-') ? id.slice(4) : null;
        window.reviewFirst = id.startsWith('R17-') ? id.slice(4) : null;
        window.reviewActivated = id === 'R19-true';
      }, { id });
      try {
        const prepared = await page.evaluate(run);
        const actual = interact ? await interact(page, prepared) : prepared;
        try { assert.deepEqual(actual, expected); results.push({ id, rule, name, status: 'PASS', expected, actual }); }
        catch { results.push({ id, rule, name, status: 'FAIL', expected, actual }); }
      } catch (error) { results.push({ id, rule, name, status: 'ERROR', error: error.message }); }
      console.log(JSON.stringify(results.at(-1)));
    }

    await test('R01', '4.3', '1.0 空载兵不能进入水域', () => { const api = window.__reviewTest; api.G.selectedVersion = '1.0'; api.G.features = { sea: false, air: false, parasite: false, multiNation: false }; window.reviewWater(); const unit = window.reviewPiece('unit', 'bing', 'A', 4, 4); api.G.pieces.push(unit); return api.canReach(unit, 5, 4); }, false);
    for (const version of ['2.0', '3.0', '4.0']) {
      await test('R02-' + version, '4.3/7.7', version + ' 空载未激活兵可以入水并作为运输载体', () => { const api = window.__reviewTest; api.G.selectedVersion = window.reviewVersion; window.reviewWater(); const unit = window.reviewPiece('unit', 'bing', 'A', 4, 4); api.G.pieces.push(unit); return { move: api.canReach(unit, 5, 4), ship: api.isShipUnit(unit), lookup: api.getShipAt(4, 4)?.id || null }; }, { move: true, ship: true, lookup: 'unit' });
    }
    await test('R03', '4.4', '将位于另一绑定将席时仍可在己方阵营区建设', () => { const api = window.__reviewTest; api.G.pieces[0].x = 9; api.G.pieces[0].y = 9; return api.canPlaceBingAt('A', 4, 4); }, true);
    await test('R04', '4.4', '2.0+ 可在己方阵营区纯水点建设兵营', () => { const api = window.__reviewTest; window.reviewWater(); return api.canPlaceBingAt('A', 4, 4); }, true);
    await test('R05', '4.4', '陆地合法建设及禁止越界和重叠', () => { const api = window.__reviewTest; return [api.canPlaceBingAt('A', 4, 4), api.canPlaceBingAt('A', -1, 4), api.canPlaceBingAt('A', 1, 1)]; }, [true, false, false]);
    for (const type of ['xiang', 'shi', 'fang', 'che']) {
      await test('R06-' + type, '12.1/12.2', type + ' 的水域生产资格', () => { const api = window.__reviewTest; window.reviewWater(); api.G.pieces.push(window.reviewPiece('barracks', 'bing', 'A', 4, 4)); return api.canProduceAt('A', 5, 4, window.reviewType); }, type !== 'che');
    }
    await test('R07', '7.6', '普通炮吃子后进入目标原位置（公开动作接口）', () => { const api = window.__reviewTest; api.G.pieces.push(window.reviewPiece('cannon', 'pao', 'A', 4, 4), window.reviewPiece('screen', 'bing', 'A', 4, 5), window.reviewPiece('target', 'che', 'B', 4, 7)); api.startDecisionTurn(); const action = window.ChessBarracksGameAPI.listLegalActions().find(item => item.pieceId === 'cannon' && item.targetId === 'target'); if (!action) throw new Error('Fixture has no cannon capture'); const submitted = window.ChessBarracksGameAPI.submitAction(action); const cannon = api.G.pieces.find(item => item.id === 'cannon'); return { ok: submitted.ok, position: [cannon.x, cannon.y], targetGone: !api.G.pieces.some(item => item.id === 'target') }; }, { ok: true, position: [4, 7], targetGone: true });
    await test('R08', '10.6', '相邻目标可选择合法舰炮（车作为炮手）', () => { const api = window.__reviewTest; const ship = window.reviewPiece('ship', 'xiang', 'A', 4, 4, { activated: true, stack: [window.reviewPiece('cargo', 'che', 'A', -999, -999)] }); const target = window.reviewPiece('target', 'che', 'B', 5, 4); api.G.pieces.push(ship, target); return api.canShipCannonHit(ship, target); }, true);
    await test('R09', '10.6', '非相邻舰炮消耗炮手且船不移位', () => { const api = window.__reviewTest; const ship = window.reviewPiece('ship', 'xiang', 'A', 4, 4, { activated: true, stack: [window.reviewPiece('cargo', 'che', 'A', -999, -999)] }); const target = window.reviewPiece('target', 'che', 'B', 7, 4); api.G.pieces.push(ship, target); const legal = api.canShipCannonHit(ship, target); api.executeShipCannon(ship, target); return { legal, position: [ship.x, ship.y], cargo: ship.stack.length, targetGone: !api.G.pieces.includes(target) }; }, { legal: true, position: [4, 4], cargo: 0, targetGone: true });
    await test('R10', '13.2', '直升机可飞越棋子但不能停在占用点', () => { const api = window.__reviewTest; const heli = window.reviewPiece('heli', 'zhi', 'A', 4, 4); api.G.pieces.push(heli, window.reviewPiece('blocker', 'che', 'A', 5, 4)); return { over: api.canReach(heli, 7, 4), occupied: api.canReach(heli, 5, 4), diagonal: api.canReach(heli, 5, 5) }; }, { over: true, occupied: false, diagonal: false });
    await test('R11', '13.3', '战机沿途可击毁水性舰船及乘员', () => { const api = window.__reviewTest; const fighter = window.reviewPiece('fighter', 'zhan', 'A', -999, -999); const source = window.reviewPiece('source', 'xiang', 'A', 4, 4, { activated: true, stack: [fighter] }); const target = window.reviewPiece('target', 'xiang', 'B', 5, 4, { stack: [window.reviewPiece('cargo', 'che', 'B', -999, -999)] }); const landing = window.reviewPiece('landing', 'xiang', 'A', 6, 4, { activated: true }); api.G.pieces.push(source, target, landing); const flight = api.resolvePlannedFlight(source, fighter, [{ x: 5, y: 4 }, { x: 6, y: 4 }]); return { kills: flight.kills, targetGone: !api.G.pieces.includes(target), cargoEliminated: api.G.eliminated.B.che || 0, landed: landing.stack.some(item => item.id === 'fighter') }; }, { kills: 1, targetGone: true, cargoEliminated: 1, landed: true });
    await test('R12', '13.3', '两步航线可提交而非强制六点（点击处理与确认）', () => { const api = window.__reviewTest; const fighter = window.reviewPiece('fighter', 'zhan', 'A', -999, -999); const source = window.reviewPiece('source', 'xiang', 'A', 4, 4, { activated: true, stack: [fighter] }); api.G.pieces.push(source, window.reviewPiece('landing', 'xiang', 'A', 6, 4, { activated: true })); api.startDecisionTurn(); api.G.flightRoutePlan = { shipId: 'source', fighterId: 'fighter', path: [] }; api.handleGameTap(5, 4); api.handleGameTap(6, 4); return window.ChessBarracksGameAPI.confirmTurn().ok; }, true);
    await test('R13', '13.3', '坠机只撞击落点友军，不伤邻格', () => { const api = window.__reviewTest; const fighter = window.reviewPiece('fighter', 'zhan', 'A', -999, -999); api.G.pieces.push(window.reviewPiece('target', 'che', 'A', 4, 4), window.reviewPiece('neighbor', 'che', 'B', 5, 4)); api.crashFighterAt(fighter, 4, 4, false); return { targetGone: !api.G.pieces.some(item => item.id === 'target'), neighborAlive: api.G.pieces.some(item => item.id === 'neighbor') }; }, { targetGone: true, neighborAlive: true });
    for (const kind of ['move', 'attack', 'produce', 'placeBarracks', 'flightRoute', 'load', 'unload', 'reorder']) {
      await test('R14-' + kind, '18.5', '威胁响应命令权限：' + kind, () => { const api = window.__reviewTest; api.G.multiNation.response = { active: true, wave: 1, current: { target: 'A' }, queued: [] }; api.startDecisionTurn(); return api.enqueueCommand(window.reviewKind, '审阅测试', api.G.pieces[0], api.G.pieces[0]); }, true);
    }
    await test('R15', '18.2', '响应期间可打开外交入口', () => { const api = window.__reviewTest; api.G.multiNation.response = { active: true, wave: 1, current: { target: 'A' }, queued: [] }; api.showDiplomacyModal(); return !!document.getElementById('diplomacyTarget'); }, true);
    await test('R16', '12.5', '无本方兵营时不能生产寄生棋子（点击处理）', () => { const api = window.__reviewTest; api.G.selectedPrepareType = 'tietai'; api.handleGameTap(1, 1); return { attached: !!api.G.pieces[0].parasite, stock: api.G.prepare.A.tietai }; }, { attached: false, stock: 2 });
    for (const first of ['tietai', 'dujie']) {
      await test('R17-' + first, '12.5/14.3', first + ' 先附着时异类寄生仍相互抵消', () => { const api = window.__reviewTest; const host = api.G.pieces[0]; const first = window.reviewFirst; api.attachParasite(host, first); const outcome = api.attachParasite(host, first === 'tietai' ? 'dujie' : 'tietai'); return { outcome, parasite: host.parasite, hostAlive: api.G.pieces.includes(host), tietai: api.G.eliminated.A.tietai, dujie: api.G.eliminated.A.dujie }; }, { outcome: 'canceled', parasite: null, hostAlive: true, tietai: 1, dujie: 1 });
    }
    await test('R18', '7.1', '将帅照面：陆地畅通、水域阻断、桥连通恢复', () => { const api = window.__reviewTest; const general = api.G.pieces[0], target = api.G.pieces[1]; Object.assign(general, { x: 3, y: 4 }); Object.assign(target, { x: 7, y: 4 }); const land = api.generalsHaveClearSight(general, target); window.reviewWater(); const water = api.generalsHaveClearSight(general, target); api.G.pieces.push(window.reviewPiece('bridge', 'xiang', 'A', 5, 4, { onBridge: true, bridgeEdges: [3, 4, 5, 6].map(x => ({ x, y: 4, orient: 'h' })) })); api.G.pieces.at(-1).y = 4.5; return [land, water, api.generalsHaveClearSight(general, target)]; }, [true, false, true]);
    for (const activated of [false, true]) {
      await test('R19-' + activated, '11.3', '第二象过桥，激活状态 ' + activated, () => { const api = window.__reviewTest; const bridge = window.reviewPiece('bridge', 'xiang', 'A', 4.5, 4, { onBridge: true, bridgeEdges: [3, 4, 5].map(x => ({ x, y: 4, orient: 'h' })) }); const unit = window.reviewPiece('unit', 'xiang', 'A', 3, 4, { activated: window.reviewActivated }); api.G.pieces.push(bridge, unit); const reachable = api.canReach(unit, 6, 4); return { reachable, bridgeStillPresent: bridge.bridgeEdges.length === 3 }; }, { reachable: true, bridgeStillPresent: true });
    }
    await test('R20', '11.1', '无对岸时桥可延伸至有效边界', () => { const api = window.__reviewTest; window.reviewWater(); api.G.map.grid[3][2] = { land: true, connected: true, isSea: false, isRiver: false }; const unit = window.reviewPiece('unit', 'xiang', 'A', 3, 4, { activated: true }); api.G.pieces.push(unit); const plan = api.getAIBridgePlan(unit, 4, 4); return { endX: plan?.endX, endY: plan?.endY, length: plan?.edges.length }; }, { endX: 11, endY: 4, length: 8 });
    await test('R21', '7.8', '士跳子坐标示例及敌方阻挡', () => { const api = window.__reviewTest; const unit = window.reviewPiece('unit', 'che', 'A', 2, 4); api.G.pieces.push(unit, window.reviewPiece('pivot', 'shi', 'A', 4, 4)); const before = api.getShiJumpTargets(unit).some(point => point.x === 6 && point.y === 4); api.G.pieces.push(window.reviewPiece('enemy', 'ma', 'B', 5, 4)); return [before, api.getShiJumpTargets(unit).some(point => point.x === 6 && point.y === 4)]; }, [true, false]);
    await test('R22', '7.5', '车可被装载但不是舰船', () => { const api = window.__reviewTest; return { cargo: api.getPieceDef('che').canBeLoaded, ship: api.isShipUnit(window.reviewPiece('unit', 'che', 'A', 4, 4)) }; }, { cargo: true, ship: false });
    await test('R23', '7.4', '已部署马可解除部署且消耗一步', () => { const api = window.__reviewTest; const unit = window.reviewPiece('unit', 'ma', 'A', 4, 4, { deploy: true }); api.G.pieces.push(unit); api.startDecisionTurn(); return { ok: api.deactivatePiece(unit), deployed: unit.deploy, spent: api.G.decision.spent }; }, { ok: true, deployed: false, spent: 1 });
    await test('R24', '5.3', '清除命令恢复位置和步数', () => { const api = window.__reviewTest; const unit = window.reviewPiece('unit', 'che', 'A', 4, 4); api.G.pieces.push(unit); api.startDecisionTurn(); api.G.selectedPieceId = unit.id; api.handleGameTap(5, 4); const moved = api.G.pieces.find(item => item.id === 'unit').x; window.ChessBarracksGameAPI.clearTurn(); return { moved, restored: api.G.pieces.find(item => item.id === 'unit').x, spent: api.G.decision.spent, commands: api.G.decision.commands.length }; }, { moved: 5, restored: 4, spent: 0, commands: 0 });
    await test('R25', '5.4', '布阵后不能混入攻击', () => { const api = window.__reviewTest; api.G.ruleMode = 'barracksSteps'; api.G.pieces.push(window.reviewPiece('barracks', 'bing', 'A', 4, 4)); api.startDecisionTurn(); return [api.enqueueCommand('move', '布阵', api.G.pieces[0]), api.enqueueCommand('attack', '攻击', api.G.pieces[1])]; }, [true, false]);
    await test('R26', '16.1', '准备耗尽回补普通棋子但不回补将和兵', () => { const api = window.__reviewTest; api.G.prepare.A = {}; api.G.eliminated.A = { ma: 2, jiang: 1, bing: 1 }; api.checkPieceRotate('A'); return { ma: api.G.prepare.A.ma, general: api.G.prepare.A.jiang || 0, barracks: api.G.prepare.A.bing || 0, eliminatedMa: api.G.eliminated.A.ma }; }, { ma: 2, general: 0, barracks: 0, eliminatedMa: 0 });
    await test('R27', '14.1', '普通攻击触发铁幕：宿主活、攻击者和铁幕消失', () => { const api = window.__reviewTest; const attacker = window.reviewPiece('attacker', 'che', 'A', 4, 4); const target = window.reviewPiece('target', 'ma', 'B', 5, 4, { parasite: window.reviewPiece('shield', 'tietai', 'B', -999, -999) }); api.G.pieces.push(attacker, target); api.executeAttack(attacker, target, false); return { targetAlive: api.G.pieces.includes(target), attackerGone: !api.G.pieces.includes(attacker), parasiteGone: target.parasite === null }; }, { targetAlive: true, attackerGone: true, parasiteGone: true });
    await test('R28', '14.1', '舰炮也应触发铁幕抵挡攻击', () => { const api = window.__reviewTest; const attacker = window.reviewPiece('ship', 'xiang', 'A', 4, 4, { stack: [window.reviewPiece('cargo', 'che', 'A', -999, -999)] }); const target = window.reviewPiece('target', 'ma', 'B', 7, 4, { parasite: window.reviewPiece('shield', 'tietai', 'B', -999, -999) }); api.G.pieces.push(attacker, target); api.executeShipCannon(attacker, target); return api.G.pieces.includes(target); }, true);
    await test('R29', '10.7', '普通炮击毁载货兵营时货物也进淘汰区', () => { const api = window.__reviewTest; const attacker = window.reviewPiece('attacker', 'pao', 'A', 4, 4); const target = window.reviewPiece('target', 'bing', 'B', 4, 7, { stack: [window.reviewPiece('cargo', 'ma', 'B', -999, -999)] }); api.G.pieces.push(attacker, window.reviewPiece('screen', 'ma', 'A', 4, 5), target); api.executeAttack(attacker, target, true); return { barracks: api.G.eliminated.B.bing || 0, cargo: api.G.eliminated.B.ma || 0 }; }, { barracks: 1, cargo: 1 });
    await test('R30', '19.3', '随机地图参数组合和种子复现（排除随机标识符及边界饱和）', () => { const api = window.__reviewTest; const options = { width: 30, height: 30, fair: true, seatCount: 4, fragmentation: 50, overlapPercent: 40, zoneSizePercent: 100, seed: 'REVIEW-20260926' }; const first = api.generateRandomMap(options); const second = api.generateRandomMap(options); const geometry = map => JSON.stringify({ grid: map.grid, zones: map.zones.map(zone => zone.points), seats: map.jiangxi.map(seat => [seat.x0, seat.y0, seat.x1, seat.y1, seat.bindPlayer]) }); const maps = [50, 100, 150].map(zoneSizePercent => api.generateRandomMap({ ...options, zoneSizePercent })); const area = zone => Math.abs(zone.points.reduce((sum, point, index) => { const next = zone.points[(index + 1) % zone.points.length]; return sum + point.x * next.y - next.x * point.y; }, 0)) / 2; const areas = maps.map(map => map.zones.reduce((sum, zone) => sum + area(zone), 0)); window.reviewMapAreas = areas; return { deterministic: geometry(first) === geometry(second), seats: first.jiangxi.length, preservedOverlap: maps.every(map => map.generator.options.overlapPercent === 40), nondecreasing: areas[0] <= areas[1] && areas[1] <= areas[2] }; }, { deterministic: true, seats: 4, preservedOverlap: true, nondecreasing: true });
    await test('R31', '23', '4.0 所有阵营退出才整局判平', () => { const api = window.__reviewTest; api.G.pieces = []; api.G.multiNation.status.A.state = 'eliminated'; api.G.multiNation.status.B.state = 'eliminated'; return { ended: api.checkWinCondition(), gameOver: api.G.gameOver }; }, { ended: true, gameOver: true });
    await test('R32', '5.2', '将军+兵营计步与响应固定一步', () => { const api = window.__reviewTest; api.G.ruleMode = 'barracksSteps'; api.G.pieces.push(window.reviewPiece('barracks1', 'bing', 'A', 4, 4), window.reviewPiece('barracks2', 'bing', 'A', 5, 4)); const normal = api.getTurnStepLimit('A'); api.G.multiNation.response = { active: true, current: { target: 'A' } }; return [normal, api.getTurnStepLimit('A')]; }, [3, 1]);


    async function clickPoint(page, x, y) {
      const geometry = await page.evaluate(() => {
        const canvas = document.getElementById('gameCanvas');
        const bounds = canvas.getBoundingClientRect();
        return { left: bounds.left, top: bounds.top, width: bounds.width, height: bounds.height, canvasWidth: canvas.width, canvasHeight: canvas.height, view: window.__reviewTest.G.view };
      });
      await page.mouse.click(geometry.left + (geometry.view.offsetX + x * geometry.view.scale) * geometry.width / geometry.canvasWidth, geometry.top + (geometry.view.offsetY + y * geometry.view.scale) * geometry.height / geometry.canvasHeight);
    }

    await test('E01', '10.2', '未激活空载兵装车；清除恢复船货关系', () => {
      const api = window.__reviewTest;
      const ship = window.reviewPiece('ship', 'bing', 'A', 4, 4);
      const cargo = window.reviewPiece('cargo', 'che', 'A', 3, 4);
      api.G.pieces.push(ship, cargo);
      api.startDecisionTurn();
      api.G.selectedPieceId = cargo.id;
      api.handleGameTap(4, 4);
      const loaded = ship.stack[0]?.id === 'cargo';
      window.ChessBarracksGameAPI.clearTurn();
      return { loaded, restored: api.G.pieces.some(piece => piece.id === 'cargo' && piece.x === 3), cargoCount: api.G.pieces.find(piece => piece.id === 'ship').stack.length };
    }, { loaded: true, restored: true, cargoCount: 0 });

    await test('E02', '10.2/5.3', '非法装载将军不扣步、不加入命令', () => {
      const api = window.__reviewTest;
      api.G.pieces[0].x = 3; api.G.pieces[0].y = 4;
      api.G.pieces.push(window.reviewPiece('ship', 'bing', 'A', 4, 4));
      api.startDecisionTurn(); api.G.selectedPieceId = 'generalA';
      api.handleGameTap(4, 4);
      return { commands: api.G.decision.commands.length, steps: api.G.stepsLeft, generalAlive: api.G.pieces.some(piece => piece.id === 'generalA') };
    }, { commands: 0, steps: 1, generalAlive: true });

    await test('E03', '12.4', '兵运输免激活不放宽战机平台资格', () => {
      const api = window.__reviewTest;
      const ship = window.reviewPiece('ship', 'bing', 'A', 4, 4);
      api.G.pieces.push(ship);
      const inactive = api.canProduceAt('A', 4, 4, 'zhan');
      ship.activated = true;
      return [inactive, api.canProduceAt('A', 4, 4, 'zhan')];
    }, [false, true]);

    await test('E04', '4.4', '未绑定将席不能建设，任意将席许可不扩展到普通生产', () => {
      const api = window.__reviewTest;
      api.G.pieces[0].x = 9; api.G.pieces[0].y = 9;
      api.G.map.zones = api.G.map.zones.filter(zone => zone.player !== 'B');
      const invalidSeat = api.canPlaceBingAt('A', 4, 4);
      api.G.map.zones.push({ id: 'zoneB', player: 'B', closed: true, points: [] });
      api.G.pieces.push(window.reviewPiece('barracks', 'bing', 'A', 4, 4));
      api.G.selectedPrepareType = 'che';
      api.handleGameTap(5, 4);
      return { invalidSeat, commands: api.G.decision.commands.length, stock: api.G.prepare.A.che };
    }, { invalidSeat: false, commands: 0, stock: 2 });

    await test('E05', '12.5', '寄生生产界面与AI同样要求本方兵营', () => {
      const api = window.__reviewTest;
      const before = []; api.addAIProductionActions(before, 'A');
      api.G.pieces.push(window.reviewPiece('barracks', 'bing', 'A', 5, 5));
      const after = []; api.addAIProductionActions(after, 'A');
      api.G.selectedPrepareType = 'tietai'; api.handleGameTap(1, 1);
      return { without: before.some(action => action.type === 'attachParasite'), with: after.some(action => action.type === 'attachParasite'), attached: api.G.pieces[0].parasite?.type, stock: api.G.prepare.A.tietai };
    }, { without: false, with: true, attached: 'tietai', stock: 1 });

    await test('E06', '12.5', '零库存寄生不能附着', () => {
      const api = window.__reviewTest;
      api.G.pieces.push(window.reviewPiece('barracks', 'bing', 'A', 5, 5));
      api.G.prepare.A.tietai = 0; api.G.selectedPrepareType = 'tietai';
      api.handleGameTap(1, 1);
      return [api.G.pieces[0].parasite, api.G.prepare.A.tietai, api.G.decision.commands.length];
    }, [null, 0, 0]);

    await test('E07', '10.6', '真实点击相邻敌军可选舰炮且船不移位', () => {
      const api = window.__reviewTest;
      api.G.pieces.push(window.reviewPiece('ship', 'xiang', 'A', 4, 4, { activated: true, stack: [window.reviewPiece('cargo', 'che', 'A', -999, -999)] }), window.reviewPiece('target', 'che', 'B', 5, 4));
      api.setGamePhase('gamePlay'); api.resizeCanvas(); api.centerView(); api.startDecisionTurn();
    }, { choices: 2, targetGone: true, shipX: 4, cargo: 0, kind: 'attack' }, async page => {
      await clickPoint(page, 4, 4); await clickPoint(page, 5, 4);
      const choices = await page.locator('#modalBox button').filter({ hasText: /^(接舷移动|舰炮攻击)$/ }).count();
      await page.screenshot({ path: path.join(__dirname, 'review_ship_choice.png') });
      await page.getByRole('button', { name: '舰炮攻击', exact: true }).click();
      return page.evaluate(choices => {
        const state = window.__reviewTest.G, ship = state.pieces.find(piece => piece.id === 'ship');
        return { choices, targetGone: !state.pieces.some(piece => piece.id === 'target'), shipX: ship.x, cargo: ship.stack.length, kind: state.decision.turnKind };
      }, choices);
    });

    await test('E08', '10.5', '真实点击相邻敌军可选择接舷移动', () => {
      const api = window.__reviewTest;
      api.G.pieces.push(window.reviewPiece('ship', 'xiang', 'A', 4, 4, { activated: true, stack: [window.reviewPiece('cargo', 'che', 'A', -999, -999)] }), window.reviewPiece('target', 'che', 'B', 5, 4));
      api.setGamePhase('gamePlay'); api.resizeCanvas(); api.centerView(); api.startDecisionTurn();
    }, { shipX: 5, cargo: 1, kind: 'arrange' }, async page => {
      await clickPoint(page, 4, 4); await clickPoint(page, 5, 4);
      await page.getByRole('button', { name: '接舷移动', exact: true }).click();
      return page.evaluate(() => { const state = window.__reviewTest.G, ship = state.pieces.find(piece => piece.id === 'ship'); return { shipX: ship.x, cargo: ship.stack.length, kind: state.decision.turnKind }; });
    });

    await test('E09', '10.6', 'AI同时生成相邻接舷/舰炮及远处舰炮候选', () => {
      const api = window.__reviewTest;
      api.G.pieces.push(window.reviewPiece('ship', 'xiang', 'A', 4, 4, { activated: true, stack: [window.reviewPiece('cargo', 'che', 'A', -999, -999)] }), window.reviewPiece('near', 'che', 'B', 5, 4), window.reviewPiece('far', 'che', 'B', 4, 7));
      const actions = []; api.addAIMovementActions(actions, 'A');
      return ['moveCapture:near', 'shipFire:near', 'shipFire:far'].map(key => actions.some(action => action.type + ':' + action.targetId === key));
    }, [true, true, true]);

    await test('E10', '14.1', '舰炮铁幕反噬只记一次炮手损失', () => {
      const api = window.__reviewTest;
      const ship = window.reviewPiece('ship', 'xiang', 'A', 4, 4, { stack: [window.reviewPiece('cargo', 'che', 'A', -999, -999)] });
      const target = window.reviewPiece('target', 'ma', 'B', 7, 4, { parasite: window.reviewPiece('shield', 'tietai', 'B', -999, -999) });
      api.G.pieces.push(ship, target); api.executeShipCannon(ship, target);
      return { ship: api.G.pieces.includes(ship), target: api.G.pieces.includes(target), projectileLoss: api.G.eliminated.A.che, shieldLoss: api.G.eliminated.B.tietai };
    }, { ship: true, target: true, projectileLoss: 1, shieldLoss: 1 });

    await test('E11', '14.1/10.7', '接舷被铁幕反噬时攻击船及乘员全部消灭', () => {
      const api = window.__reviewTest;
      const ship = window.reviewPiece('ship', 'xiang', 'A', 4, 4, { stack: [window.reviewPiece('cargo', 'che', 'A', -999, -999)] });
      const target = window.reviewPiece('target', 'ma', 'B', 5, 4, { parasite: window.reviewPiece('shield', 'tietai', 'B', -999, -999) });
      api.G.pieces.push(ship, target); api.executeBoardingMove(ship, target);
      return { target: api.G.pieces.includes(target), shipGone: !api.G.pieces.includes(ship), cargoLoss: api.G.eliminated.A.che };
    }, { target: true, shipGone: true, cargoLoss: 1 });

    await test('E12', '13.3', '无平台坠机将战机记入淘汰区且不重复记账', () => {
      const api = window.__reviewTest;
      const fighter = window.reviewPiece('fighter', 'zhan', 'A', -999, -999);
      const source = window.reviewPiece('source', 'xiang', 'A', 4, 4, { activated: true, stack: [fighter] });
      api.G.pieces.push(source);
      const result = api.resolvePlannedFlight(source, fighter, [{ x: 5, y: 4 }]);
      return { lost: result.lost, count: api.G.eliminated.A.zhan, cargo: source.stack.length };
    }, { lost: true, count: 1, cargo: 0 });

    await test('E13', '13.3/14.1', '航线命中铁幕后宿主保留、战机损失', () => {
      const api = window.__reviewTest;
      const fighter = window.reviewPiece('fighter', 'zhan', 'A', -999, -999);
      const source = window.reviewPiece('source', 'xiang', 'A', 4, 4, { activated: true, stack: [fighter] });
      const target = window.reviewPiece('target', 'che', 'B', 5, 4, { parasite: window.reviewPiece('shield', 'tietai', 'B', -999, -999) });
      api.G.pieces.push(source, target);
      const result = api.resolvePlannedFlight(source, fighter, [{ x: 5, y: 4 }]);
      return { lost: result.lost, kills: result.kills, alive: api.G.pieces.includes(target), count: api.G.eliminated.A.zhan };
    }, { lost: true, kills: 0, alive: true, count: 1 });

    await test('E14', '13.3', '空、断裂、越界、超六步航线不改变船货状态', () => {
      const api = window.__reviewTest;
      const fighter = window.reviewPiece('fighter', 'zhan', 'A', -999, -999);
      const source = window.reviewPiece('source', 'xiang', 'A', 4, 4, { activated: true, stack: [fighter] });
      api.G.pieces.push(source);
      const invalid = [[], [{ x: 6, y: 4 }], [{ x: -1, y: 4 }], Array.from({ length: 7 }, (_, index) => ({ x: 5 + index, y: 4 }))];
      return { rejected: invalid.every(route => api.resolvePlannedFlight(source, fighter, route).invalid), cargo: source.stack.length };
    }, { rejected: true, cargo: 1 });

    await test('E15', '13.3', '真实点击战机、敌船、平台和确定，完成两步炸船降落', () => {
      const api = window.__reviewTest;
      api.G.pieces.push(window.reviewPiece('source', 'xiang', 'A', 4, 4, { activated: true, stack: [window.reviewPiece('fighter', 'zhan', 'A', -999, -999)] }), window.reviewPiece('target', 'xiang', 'B', 5, 4, { stack: [window.reviewPiece('cargo', 'ma', 'B', -999, -999)] }), window.reviewPiece('landing', 'xiang', 'A', 6, 4, { activated: true }));
      api.setGamePhase('gamePlay'); api.resizeCanvas(); api.centerView(); api.startDecisionTurn();
    }, { landed: true, targetGone: true, cargoLoss: 1 }, async page => {
      await clickPoint(page, 4, 4);
      await page.locator('#shipBubble .bubble-piece-item[data-idx="0"]').click();
      await clickPoint(page, 5, 4); await clickPoint(page, 6, 4);
      await page.locator('#btnConfirmCommands').click();
      await page.waitForFunction(() => !window.__reviewTest.G.flightPlayback);
      return page.evaluate(() => { const state = window.__reviewTest.G; return { landed: state.pieces.find(piece => piece.id === 'landing').stack.some(piece => piece.id === 'fighter'), targetGone: !state.pieces.some(piece => piece.id === 'target'), cargoLoss: state.eliminated.B.ma }; });
    });

    await test('E16', '13.3', 'AI候选包含少于六步的有效降落航线', () => {
      const api = window.__reviewTest;
      const fighter = window.reviewPiece('fighter', 'zhan', 'A', -999, -999);
      const source = window.reviewPiece('source', 'xiang', 'A', 4, 4, { activated: true, stack: [fighter] });
      api.G.pieces.push(source, window.reviewPiece('target', 'xiang', 'B', 5, 4), window.reviewPiece('landing', 'xiang', 'A', 6, 4, { activated: true }));
      const routes = api.buildAIRouteCandidates(source, fighter);
      return { short: routes.some(route => route.lands && route.path.length < 6), valid: routes.every(route => api.isValidFlightPath(source, route.path)) };
    }, { short: true, valid: true });

    await test('E17', '18.5/4.4', '响应期间实际建设成功且清除可恢复库存', () => {
      const api = window.__reviewTest;
      api.G.multiNation.response = { active: true, wave: 1, current: { target: 'A' }, queued: [] };
      api.startDecisionTurn(); api.G.placingBing = true; api.handleGameTap(4, 4);
      const built = api.G.pieces.some(piece => piece.type === 'bing' && piece.x === 4 && piece.y === 4);
      const spent = api.G.decision.spent;
      window.ChessBarracksGameAPI.clearTurn();
      return { built, spent, stock: api.G.warReady.A, restored: !api.G.pieces.some(piece => piece.type === 'bing') };
    }, { built: true, spent: 1, stock: 5, restored: true });

    await test('E18', '18.5/12.2', '响应期间实际水性生产成功且普通生产本回合已行动', () => {
      const api = window.__reviewTest;
      api.G.multiNation.response = { active: true, wave: 1, current: { target: 'A' }, queued: [] };
      api.G.pieces.push(window.reviewPiece('barracks', 'bing', 'A', 4, 4)); window.reviewWater();
      api.startDecisionTurn(); api.G.selectedPrepareType = 'xiang'; api.handleGameTap(5, 4);
      const produced = api.G.pieces.find(piece => piece.type === 'xiang');
      return { produced: !!produced, stock: api.G.prepare.A.xiang, acted: !!api.G.decision.actedPieces[produced?.id], spent: api.G.decision.spent };
    }, { produced: true, stock: 1, acted: true, spent: 1 });

    await test('E19', '11.3/5.3', '上岸步数不足时不提前拆桥或移动', () => {
      const api = window.__reviewTest;
      const bridge = window.reviewPiece('bridge', 'xiang', 'A', 4.5, 4, { activated: true, onBridge: true, bridgeEdges: [3, 4, 5].map(x => ({ x, y: 4, orient: 'h' })) });
      api.G.pieces.push(bridge); api.startDecisionTurn();
      api.enqueueCommand('produce', '已用步数', null, null);
      api.G.selectedPieceId = 'bridge'; api.G.bridgePlacingXiangId = 'bridge';
      api.handleGameTap(3, 4);
      return { position: [bridge.x, bridge.y], onBridge: bridge.onBridge, edges: bridge.bridgeEdges.length };
    }, { position: [4.5, 4], onBridge: true, edges: 3 });

    await test('E20', '5.4', '被拒绝的首条命令不锁定回合类型', () => {
      const api = window.__reviewTest; api.G.decision.spent = api.getTurnStepLimit('A'); api.G.stepsLeft = 0;
      const accepted = api.enqueueCommand('attack', '失败攻击', api.G.pieces[0]);
      return { accepted, kind: api.G.decision.turnKind, commands: api.G.decision.commands.length };
    }, { accepted: false, kind: null, commands: 0 });

    await test('E21', '3.5', '2.0+ 初始布子可以把兵放在纯水点', () => {
      const api = window.__reviewTest; api.G.gamePhase = 'placePieces'; window.reviewWater();
      api.G.selectedPrepareType = 'bing'; api.handlePlaceTap(4, 4, { x: 4, y: 4 });
      return { placed: api.G.pieces.some(piece => piece.type === 'bing' && piece.x === 4 && piece.y === 4), stock: api.G.warReady.A };
    }, { placed: true, stock: 4 });

    await test('E22', '5.3/10.7', '击毁载货兵营后清除恢复船、货和淘汰计数', () => {
      const api = window.__reviewTest;
      api.G.pieces.push(window.reviewPiece('attacker', 'pao', 'A', 4, 4), window.reviewPiece('screen', 'ma', 'A', 4, 5), window.reviewPiece('target', 'bing', 'B', 4, 7, { stack: [window.reviewPiece('cargo', 'ma', 'B', -999, -999)] }));
      api.startDecisionTurn(); api.G.selectedPieceId = 'attacker'; api.handleGameTap(4, 7);
      window.ChessBarracksGameAPI.clearTurn();
      const target = api.G.pieces.find(piece => piece.id === 'target');
      return { target: !!target, cargo: target?.stack[0]?.id, eliminated: api.G.eliminated.B.ma || 0, cannonY: api.G.pieces.find(piece => piece.id === 'attacker').y };
    }, { target: true, cargo: 'cargo', eliminated: 0, cannonY: 4 });

    await test('F01', '17.3', '狂热生产失将后保留库存并继续棋子轮换和普通生产', () => {
      const api = window.__reviewTest;
      api.G.fanaticProduction = true;
      api.G.prepare.A = { che: 0 };
      api.G.eliminated.A = { che: 1 };
      api.G.pieces.push(window.reviewPiece('barracksA', 'bing', 'A', 4, 4));
      api.eliminatePiece(api.G.pieces.find(piece => piece.id === 'generalA'), 'B');
      api.checkPieceRotate('A');
      return {
        fanatic: api.G.multiNation.status.A.state,
        stock: api.G.prepare.A.che,
        rotatedEliminated: api.G.eliminated.A.che || 0,
        canProduce: api.canPlayerProduce('A'),
        barracksProduction: api.canProduceAt('A', 5, 4, 'che'),
        generalStock: api.G.prepare.A.jiang || 0,
        generalEliminated: api.G.eliminated.A.jiang || 0,
      };
    }, { fanatic: 'fanatic', stock: 1, rotatedEliminated: 0, canProduce: true, barracksProduction: true, generalStock: 0, generalEliminated: 1 });

    await test('F02', '17.3/4.4', '狂热生产失将后仍禁止新增兵营', () => {
      const api = window.__reviewTest;
      api.G.fanaticProduction = true;
      api.eliminatePiece(api.G.pieces.find(piece => piece.id === 'generalA'), 'B');
      return api.canPlaceBingAt('A', 4, 4);
    }, false);

    await test('F03', '17.3/23', '狂热生产仅剩兵营和库存时不提前判负', () => {
      const api = window.__reviewTest;
      api.G.fanaticProduction = true;
      api.G.features = { sea: true, air: true, parasite: true, multiNation: false };
      api.G.selectedVersion = '3.0';
      api.G.placementMode = 'campaign';
      api.G.pieces = [window.reviewPiece('barracksA', 'bing', 'A', 4, 4), window.reviewPiece('generalB', 'jiang', 'B', 10, 10)];
      api.G.prepare = { A: { che: 1 }, B: {} };
      api.G.eliminated = { A: { jiang: 1 }, B: {} };
      api.G.gameOver = false;
      return api.checkWinCondition();
    }, false);

    await test('F04', '16.2/17.3', '未启用狂热生产时失将仍清空库存并停止轮换', () => {
      const api = window.__reviewTest;
      api.G.fanaticProduction = false;
      api.G.prepare.A = { che: 0 };
      api.G.eliminated.A = { che: 1 };
      api.eliminatePiece(api.G.pieces.find(piece => piece.id === 'generalA'), 'B');
      api.checkPieceRotate('A');
      return { stock: api.G.prepare.A.che || 0, eliminated: api.G.eliminated.A.che || 0 };
    }, { stock: 0, eliminated: 1 });

    const summary = { date: '2026-09-26', baseline, results, pageErrors, counts: { pass: results.filter(item => item.status === 'PASS').length, fail: results.filter(item => item.status === 'FAIL').length, error: results.filter(item => item.status === 'ERROR').length }, mainAndTextEqual: fs.readFileSync(htmlPath).equals(fs.readFileSync(path.join(root, '兵营模式.txt'))) };
    fs.writeFileSync(path.join(__dirname, 'review_rules_20260926.results.json'), JSON.stringify(summary, null, 2) + '\n');
    console.log(JSON.stringify({ counts: summary.counts, pageErrors, baseline }, null, 2));
    if (summary.counts.fail || summary.counts.error || pageErrors.length || baseline.some(item => item.code !== 0)) process.exitCode = 1;
  } finally {
    if (browser) await browser.close();
    await new Promise(resolve => server.close(resolve));
  }
}

main().catch(error => { console.error(error); process.exitCode = 1; });
