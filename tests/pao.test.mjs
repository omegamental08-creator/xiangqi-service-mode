import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

const html = fs.readFileSync(new URL('../chess_service_final.html', import.meta.url), 'utf8');
const script = html.match(/<script>\s*([\s\S]*?)<\/script>/)[1];
function extractFunction(name) {
  const start = script.indexOf(`function ${name}(`);
  assert.notEqual(start, -1, `missing ${name}`);
  let brace = script.indexOf('{', start), depth = 0;
  for (let i = brace; i < script.length; i++) {
    if (script[i] === '{') depth++;
    if (script[i] === '}' && --depth === 0) return script.slice(start, i + 1);
  }
  throw new Error(`unterminated ${name}`);
}

const context = {
  G: { selectedVersion: '1.0', map: { w: 9, h: 10, grid: [] }, pieces: [], features: { sea: true } },
  inBounds: (x, y) => Number.isInteger(x) && x >= 0 && x < 9 && Number.isInteger(y) && y >= 0 && y < 10,
  isOnBoardPiece: piece => !!piece && Number.isInteger(piece.x) && Number.isInteger(piece.y),
  getPieceAt: (x, y) => context.G.pieces.find(piece => piece.x === x && piece.y === y),
  getCellAt: () => ({ isSea: false, isRiver: false }),
  getPieceDef: () => ({ category: 'land' }),
  isWaterType: () => false,
  isAirType: () => false,
  getShiJumpTargets: () => [],
  isShipUnit: () => false,
  isBridgeCrossMove: () => false,
  hasBridgeEdgeBetween: () => false,
  maPathHasBridge: () => false,
  maPathCrossesRiver: () => false,
  hasDujieWater: () => false,
  isLandPoint: () => true,
  isRiverEdgeBetween: () => false,
  hasBridgeEdgeBetween: () => false,
  isAlly: (a, b) => a === b,
  isClassicPalace: () => true,
  generalsHaveClearSight: () => false,
  classicPathCount: (x1, y1, x2, y2) => {
    if (x1 !== x2 && y1 !== y2) return -1;
    const dx = Math.sign(x2 - x1), dy = Math.sign(y2 - y1);
    let x = x1 + dx, y = y1 + dy, count = 0;
    while (x !== x2 || y !== y2) { if (context.getPieceAt(x, y)) count++; x += dx; y += dy; }
    return count;
  }
};
const needed = ['paoPathCount', 'canPaoMoveTo', 'canPaoCapture', 'canReachPureClassicBasic', 'classicGeneralInCheck', 'canReachPureClassic', 'canReach'];
vm.runInNewContext(needed.map(extractFunction).join(String.fromCharCode(10)), context);
function reset(version = '1.0') {
  context.G.selectedVersion = version;
  context.G.pieces = [];
}
function piece(type, x, y, player = 'A') { return { id: `${type}-${x}-${y}-${player}`, type, x, y, player }; }
function assertMove(ok, message) { assert.equal(context.canReach(context.G.pieces[0], 4, 0), ok, message); }

reset(); context.G.pieces.push(piece('pao', 0, 0)); assertMove(true, 'empty straight move');
reset(); context.G.pieces.push(piece('pao', 0, 0), piece('bing', 2, 0, 'A')); assertMove(false, 'piece blocks empty move');
reset(); context.G.pieces.push(piece('pao', 0, 0), piece('bing', 4, 0, 'B')); assert.equal(context.canPaoCapture(context.G.pieces[0], context.G.pieces[1]), false, 'capture without screen');
reset(); context.G.pieces.push(piece('pao', 0, 0), piece('bing', 2, 0, 'A'), piece('bing', 4, 0, 'B')); assert.equal(context.canPaoCapture(context.G.pieces[0], context.G.pieces[2]), true, 'capture with one screen');
reset(); context.G.pieces.push(piece('pao', 0, 0), piece('bing', 1, 0, 'A'), piece('bing', 2, 0, 'A'), piece('bing', 4, 0, 'B')); assert.equal(context.canPaoCapture(context.G.pieces[0], context.G.pieces[3]), false, 'two screens');
reset(); context.G.pieces.push(piece('che', 0, 0), piece('bing', 2, 0, 'A')); assert.equal(context.canReach(context.G.pieces[0], 4, 0), false, 'che cannot cross own piece');
reset(); context.G.pieces.push(piece('che', 0, 0, 'A'), piece('bing', 2, 0, 'B')); assert.equal(context.canReach(context.G.pieces[0], 4, 0), false, 'che cannot cross allied piece');
reset(); context.G.pieces.push(piece('pao', 0, 0), piece('bing', 2, 0, 'A'), piece('bing', 4, 0, 'B')); assert.equal(context.canReach(context.G.pieces[0], 4, 0), false, 'pao capture is not canReach');
reset(); context.G.pieces.push(piece('pao', 0, 0)); context.getCellAt = () => ({ isSea: true, isRiver: false }); context.isLandPoint = () => false; assert.equal(context.canReach(context.G.pieces[0], 4, 0), false, 'pao movement over water without bridge');
reset('0.0'); context.G.pieces.push(piece('jiang', 8, 9, 'A')); context.getCellAt = () => ({ isSea: false, isRiver: false }); context.isLandPoint = () => true; context.G.pieces.push(piece('pao', 0, 0), piece('bing', 2, 0, 'A'), piece('bing', 4, 0, 'B')); assert.equal(context.canReachPureClassic(context.G.pieces[1], 4, 0), true, 'classic cannon capture screens=1');
reset('0.0'); context.G.pieces.push(piece('jiang', 8, 9, 'A')); context.G.pieces.push(piece('pao', 0, 0)); assert.equal(context.canReachPureClassic(context.G.pieces[1], 4, 0), true, 'classic cannon move screens=0');

console.log('pao tests passed: 10 cases');



