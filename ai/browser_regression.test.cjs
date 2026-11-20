const assert = require('node:assert/strict');
const fs = require('node:fs');
const { chromium } = require('playwright');

const gameUrl = process.env.CHESS_GAME_URL || 'http://127.0.0.1:8090/chess_service_final.html';
const browserCandidates = [
  process.env.CHROME_PATH,
  'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
  'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
].filter(Boolean);
const executablePath = browserCandidates.find(candidate => fs.existsSync(candidate));

function makePiece(id, type, player, x, y, extra = {}) {
  return {
    id,
    type,
    player,
    x,
    y,
    deploy: false,
    activated: false,
    stack: [],
    parasite: null,
    ...extra,
  };
}

function testPieces() {
  return [
    makePiece('aGeneral', 'jiang', 'A', 0, 0),
    makePiece('aHorse', 'ma', 'A', 1, 1),
    makePiece('aDummy', 'shi', 'A', 7, 8),
    makePiece('aFang', 'fang', 'A', 2, 12),
    makePiece('aZhi', 'zhi', 'A', 14, 12),
    makePiece('aChe', 'che', 'A', 10, 13),
    makePiece('aCarrier', 'xiang', 'A', 8, 13, {
      activated: true,
      stack: [makePiece('aCargo', 'ma', 'A', -999, -999)],
      parasite: makePiece('aDujie', 'dujie', 'A', -999, -999),
    }),
    makePiece('bGeneral', 'jiang', 'B', 16, 0),
    makePiece('bHorse', 'ma', 'B', 11, 10),
    makePiece('bFangTarget', 'ma', 'B', 3, 12),
    makePiece('bZhiTarget', 'zhi', 'B', 14, 14),
    makePiece('bBarracks', 'bing', 'B', 5, 3),
    makePiece('cGeneral', 'jiang', 'C', 5, 1),
    makePiece('cCannon', 'pao', 'C', 7, 14),
    makePiece('cScreen', 'bing', 'C', 7, 12),
    makePiece('dGeneral', 'jiang', 'D', 4, 4),
  ];
}

async function clickModalButton(page, text) {
  await page.locator('#modalBox button').filter({ hasText: text }).click();
}

async function dismissStartupSummary(page) {
  const button = page.getByRole('button', { name: '知道了' });
  if (await button.isVisible().catch(() => false)) await button.click();
}

async function createGame(page, scenarioName) {
  await page.goto(gameUrl, { waitUntil: 'networkidle' });
  await dismissStartupSummary(page);
  await page.locator('button[data-ver="4.0"]').click();
  await page.locator('#btnToggleMenuTools').click();
  await page.locator('#btnRandomMap').click();
  await page.locator('#randomMapVersion').selectOption('4.0');
  await page.locator('#randomMapSeats').fill('4');
  await page.locator('#randomMapSeed').fill('LAYERED-THREAT-REGRESSION');
  await clickModalButton(page, '生成、保存并编辑');

  await page.locator('#toolZoomIn').waitFor({ state: 'visible' });
  await page.locator('#toolZoomIn').click();
  await page.locator('#toolZoomOut').click();
  assert.equal(await page.locator('#editHint').isVisible(), true);

  const mapName = '回归测试-' + scenarioName;
  await page.evaluate(({ mapName, pieces }) => {
    const maps = JSON.parse(localStorage.getItem('bingyi_chess_maps') || '[]');
    const map = maps[maps.length - 1];
    map.name = mapName;
    map.gameVersion = '4.0';
    map.grid = Array.from({ length: map.h }, () => Array.from({ length: map.w }, () => ({
      land: true,
      connected: true,
      isRiver: false,
      isSea: false,
      bridge: false,
      bridgeOwner: null,
    })));
    const prepare = {};
    const warReady = {};
    for (const player of ['A', 'B', 'C', 'D']) {
      prepare[player] = { shi: 0, xiang: 0, ma: 0, che: 0, pao: 0, fang: 0, zhan: 0, zhi: 0, tietai: 0, dujie: 0 };
      warReady[player] = 0;
    }
    map.initialSetup = { pieces, prepare, warReady, placementMode: 'campaign' };
    localStorage.setItem('bingyi_chess_maps', JSON.stringify([map]));
  }, { mapName, pieces: testPieces() });

  await page.reload({ waitUntil: 'networkidle' });
  await dismissStartupSummary(page);
  await page.locator('button[data-ver="4.0"]').click();
  await page.locator('#btnStartGame').click();
  await clickModalButton(page, '加载已保存地图');
  await page.locator('#modalBox button').filter({ hasText: mapName }).click();
  await page.locator('#toolFinishMap').click();
  await clickModalButton(page, '使用默认');
  await clickModalButton(page, '确认数量');
  await clickModalButton(page, '不保存，直接布子');
  for (let index = 0; index < 4; index += 1) await page.locator('#btnFinishPlace').click();
  await clickModalButton(page, '不保存，开始游戏');
  await page.locator('#bottomPanel').waitFor({ state: 'visible' });

  const state = await getState(page);
  assert.deepEqual(state.players, ['A', 'B', 'C', 'D']);
  assert.equal(state.turnPlayer, 'A');
  assert.equal(state.pieces.some(piece => piece.id === 'bBarracks'), true);
}

async function getState(page) {
  return page.evaluate(() => window.ChessBarracksGameAPI.getState());
}

async function getDiagnostics(page) {
  return page.locator('#aiStatus').evaluate(element => JSON.parse(element.dataset.diagnostics || '{}'));
}

async function legalActions(page) {
  return page.evaluate(() => window.ChessBarracksGameAPI.listLegalActions());
}

async function submitAction(page, action) {
  assert.ok(action, 'Expected a legal action but none matched');
  const result = await page.evaluate(selected => window.ChessBarracksGameAPI.submitAction(selected), action);
  assert.equal(result.ok, true, result.error || 'Action was rejected');
}

async function confirmTurn(page) {
  const result = await page.evaluate(() => window.ChessBarracksGameAPI.confirmTurn());
  assert.equal(result.ok, true, result.error || 'Turn confirmation failed');
}

async function endTurn(page) {
  const result = await page.evaluate(() => window.ChessBarracksGameAPI.endTurn());
  assert.equal(result.ok, true, result.error || 'Turn ending failed');
}

async function startLayeredThreat(page) {
  const initialActions = await legalActions(page);
  assert.equal(initialActions.some(action => action.pieceId === 'aFang' && action.targetId === 'bFangTarget'), false);
  assert.equal(initialActions.some(action => action.pieceId === 'aZhi' && action.targetId === 'bZhiTarget'), false);
  assert.equal(initialActions.some(action => action.pieceId === 'aZhi' && action.x === 13 && action.y === 13), false);

  await clickBoardPoint(page, 14, 12);
  await clickBoardPoint(page, 13, 12);
  let state = await getState(page);
  assert.equal(state.pieces.find(piece => piece.id === 'aZhi').x, 13);
  assert.equal(state.pieces.find(piece => piece.id === 'aZhi').y, 12);
  await page.evaluate(() => window.ChessBarracksGameAPI.clearTurn());

  await clickBoardPoint(page, 14, 12);
  await clickBoardPoint(page, 14, 14);
  state = await getState(page);
  assert.equal(state.commands.length, 0);
  assert.equal(state.pieces.find(piece => piece.id === 'aZhi').x, 14);
  assert.equal(state.pieces.find(piece => piece.id === 'aZhi').y, 12);
  assert.equal(state.pieces.some(piece => piece.id === 'bZhiTarget'), true);
  await page.evaluate(() => window.ChessBarracksGameAPI.clearTurn());

  await clickBoardPoint(page, 2, 12);
  await clickBoardPoint(page, 3, 12);
  state = await getState(page);
  assert.equal(state.commands.length, 0);
  assert.equal(state.pieces.some(piece => piece.id === 'bFangTarget'), true);
  await page.evaluate(() => window.ChessBarracksGameAPI.clearTurn());

  await clickBoardPoint(page, 1, 1);
  await clickBoardPoint(page, 3, 2);
  state = await getState(page);
  assert.equal(state.commands.length, 1);
  assert.equal(state.pieces.find(piece => piece.id === 'aHorse').x, 3);
  assert.equal(state.pieces.find(piece => piece.id === 'aHorse').y, 2);
  await confirmTurn(page);

  state = await getState(page);
  let diagnostics = await getDiagnostics(page);
  assert.equal(state.turnPlayer, 'B');
  assert.equal(diagnostics.response.wave, 1);
  assert.equal(diagnostics.response.current.target, 'B');
  assert.deepEqual(diagnostics.response.queued.map(item => item.target), ['C', 'D']);

  await clickBoardPoint(page, 11, 10);
  await clickBoardPoint(page, 9, 9);
  state = await getState(page);
  assert.equal(state.commands.length, 1);
  assert.equal(state.pieces.find(piece => piece.id === 'bHorse').x, 9);
  assert.equal(state.pieces.find(piece => piece.id === 'bHorse').y, 9);
  await confirmTurn(page);

  state = await getState(page);
  diagnostics = await getDiagnostics(page);
  assert.equal(state.turnPlayer, 'C');
  assert.equal(diagnostics.response.wave, 1);
  assert.equal(diagnostics.response.current.target, 'C');
  assert.deepEqual(diagnostics.response.queued.map(item => item.target), ['D']);
}

async function clickBoardPoint(page, x, y) {
  const state = await getState(page);
  const canvas = page.locator('#gameCanvas');
  const box = await canvas.boundingBox();
  const size = await canvas.evaluate(element => ({ width: element.width, height: element.height }));
  const scale = 26;
  const offsetX = Math.max(scale, (size.width - state.map.w * scale) / 2);
  const offsetY = Math.max(scale, (size.height - state.map.h * scale) / 2);
  await page.mouse.click(
    box.x + (offsetX + x * scale) * box.width / size.width,
    box.y + (offsetY + y * scale) * box.height / size.height,
  );
}

async function testPersistentThreatAndUI(browser) {
  const context = await browser.newContext({ viewport: { width: 1280, height: 900 } });
  const page = await context.newPage();
  const pageErrors = [];
  page.on('pageerror', error => pageErrors.push(error.message));
  await createGame(page, '威胁保留');
  await startLayeredThreat(page);

  await endTurn(page);
  assert.equal((await getState(page)).turnPlayer, 'D');
  await endTurn(page);

  let state = await getState(page);
  let diagnostics = await getDiagnostics(page);
  assert.equal(state.turnPlayer, 'A');
  assert.equal(diagnostics.response.wave, 2);
  assert.equal(diagnostics.response.current.target, 'A');
  assert.deepEqual(diagnostics.response.current.sources, ['B']);
  await endTurn(page);

  state = await getState(page);
  diagnostics = await getDiagnostics(page);
  assert.equal(state.turnPlayer, 'B');
  assert.equal(diagnostics.response, null);

  await page.evaluate(() => {
    window.ChessBarracksGameAPI.pauseAI();
    window.ChessBarracksGameAPI.configureController('B', { type: 'rule' });
  });
  await clickBoardPoint(page, 10, 13);
  assert.match(await page.locator('#shipBubble').innerText(), /玩家A · 车/);
  assert.doesNotMatch(await page.locator('#shipBubble').innerText(), /搭载棋子/);
  await clickBoardPoint(page, 8, 13);
  const carrierText = await page.locator('#shipBubble').innerText();
  assert.match(carrierText, /玩家A · 象/);
  assert.match(carrierText, /渡劫/);
  assert.match(carrierText, /搭载棋子/);
  assert.match(carrierText, /马/);
  await clickBoardPoint(page, 16, 10);
  assert.equal(await page.locator('#shipBubble').isVisible(), true);

  await page.locator('.warready-player-row[data-player="A"]').click();
  let intelText = await page.locator('#playerIntelPanel').innerText();
  assert.match(intelText, /场上兵力/);
  assert.match(intelText, /生产准备区/);
  assert.match(intelText, /淘汰区/);
  assert.match(intelText, /渡劫 ×1/);
  await page.locator('.warready-player-row[data-player="A"]').click();
  assert.equal(await page.locator('#playerIntelPanel').isVisible(), false);
  await page.locator('.warready-player-row[data-player="A"]').click();
  await page.locator('#playerIntelPanel [data-action="collapse"]').click();
  assert.equal(await page.locator('#playerIntelPanel .player-intel-body').isVisible(), false);

  await page.locator('#btnZoomIn').click();
  await page.locator('#btnZoomOut').click();
  await page.locator('#btnPanBoard').click();
  assert.equal(await page.locator('#btnPanBoard').evaluate(element => element.classList.contains('active')), true);
  await page.locator('#btnOpenEliminated').click();
  assert.equal(await page.locator('#eliminatedSidebar').evaluate(element => element.classList.contains('open')), true);
  await page.locator('#btnRebuildBridge').click();
  assert.equal(await page.locator('#btnRebuildBridge').evaluate(element => element.classList.contains('active')), false);
  await page.locator('#btnTogglePanel').click();
  assert.equal(await page.locator('#bottomPanel').evaluate(element => element.classList.contains('panel-collapsed')), true);
  await page.locator('#btnEndTurn').click();
  assert.equal((await getState(page)).turnPlayer, 'C');
  await page.locator('.warready-player-row[data-player="A"]').click();
  assert.equal(await page.locator('#playerIntelPanel').isVisible(), false);

  await endTurn(page);
  await endTurn(page);
  assert.equal((await getState(page)).turnPlayer, 'A');
  await clickBoardPoint(page, 3, 2);
  await clickBoardPoint(page, 5, 3);
  assert.equal((await getState(page)).commands.length, 1);
  assert.match(await page.locator('.warready-player-row[data-player="B"]').innerText(), /场上 0/);
  await page.locator('.warready-player-row[data-player="B"]').click();
  intelText = await page.locator('#playerIntelPanel').innerText();
  assert.match(intelText, /淘汰区/);
  assert.match(intelText, /兵 ×1/);
  assert.equal((await getState(page)).pieces.some(piece => piece.id === 'bBarracks'), false);
  await confirmTurn(page);

  const screenshot = await page.screenshot(process.env.BROWSER_REGRESSION_SCREENSHOT
    ? { path: process.env.BROWSER_REGRESSION_SCREENSHOT, fullPage: true }
    : {});
  assert.ok(screenshot.length > 1000);
  assert.deepEqual(pageErrors, []);
  await context.close();
}

async function testVanishedThreat(browser) {
  const context = await browser.newContext({ viewport: { width: 1280, height: 900 } });
  const page = await context.newPage();
  const pageErrors = [];
  page.on('pageerror', error => pageErrors.push(error.message));
  await createGame(page, '威胁消失');
  await startLayeredThreat(page);

  await clickBoardPoint(page, 7, 14);
  await clickBoardPoint(page, 7, 8);
  assert.equal((await getState(page)).commands.length, 1);
  await confirmTurn(page);
  assert.equal((await getState(page)).turnPlayer, 'D');
  await endTurn(page);

  let state = await getState(page);
  let diagnostics = await getDiagnostics(page);
  assert.equal(state.turnPlayer, 'C');
  assert.equal(diagnostics.response.wave, 2);
  assert.equal(diagnostics.response.current.target, 'C');
  assert.equal(state.pieces.some(piece => piece.id === 'aDummy'), false);
  assert.deepEqual([state.pieces.find(piece => piece.id === 'cCannon').x, state.pieces.find(piece => piece.id === 'cCannon').y], [7, 8]);
  await endTurn(page);
  state = await getState(page);
  diagnostics = await getDiagnostics(page);
  assert.equal(state.turnPlayer, 'B');
  assert.equal(diagnostics.response, null);
  assert.deepEqual(pageErrors, []);
  await context.close();
}

(async () => {
  assert.ok(executablePath, 'Chrome or Edge executable was not found');
  const browser = await chromium.launch({ headless: true, executablePath });
  try {
    await testPersistentThreatAndUI(browser);
    await testVanishedThreat(browser);
    console.log('Browser regression tests passed');
  } finally {
    await browser.close();
  }
})().catch(error => {
  console.error(error);
  process.exit(1);
});
