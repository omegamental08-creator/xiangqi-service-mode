import { createRelationsEditor } from './relations-editor.mjs';
import {
  initialState, legalActions, pieceAt, applyAction, SIDES,
  deployBarrack, applyProduction, productionActions, canDeploy
} from '../core/rules.mjs';

const labels = {
  general: '将', advisor: '士', elephant: '象', horse: '马',
  rook: '车', cannon: '炮', barrack: '营'
};

let state = initialState();
let selected = null;
let selectedActions = [];
let deployMode = false;
const relationMap = { generals: [{ id: 'G1', name: '将席一', bounds: { x: [3, 4], y: [7, 8] } }, { id: 'G2', name: '将席二', bounds: { x: [5, 6], y: [1, 2] } }], factionZones: [{ id: 'Z1', name: '红阵营区', bounds: { x: [0, 8], y: [5, 9] } }, { id: 'Z2', name: '黑阵营区', bounds: { x: [0, 8], y: [0, 4] } }], relations: [{ generalId: 'G1', zoneId: 'Z1' }, { generalId: 'G2', zoneId: 'Z2' }] };
let relationsEditor;
const $ = (id) => document.getElementById(id);

function actionText(action) {
  const names = { move: '移动', attack: '攻击', bridge: '搭桥', deployHorse: '部署马', detonate: '引爆' };
  if (action.type === 'produce' && action.produceType === 'horse' && action.deployed) return '生产部署马';
  return names[action.type] || `生产${labels[action.produceType] || action.produceType}`;
}

function render() {
  $('turn').textContent = state.winner
    ? `${state.winner === SIDES.RED ? '红方' : '黑方'}获胜`
    : `${state.turn === SIDES.RED ? '红方' : '黑方'}回合`;
  $('status').textContent = state.winner
    ? '将军已被吃掉，本局结束'
    : selected ? '选择一个行动目标' : '选择一个棋子查看行动';
  $('winner').textContent = state.winner ? 'GAME OVER' : '';
  $('move').textContent = state.move;
  $('bridges').textContent = state.bridges.length;
  $('red-barracks').textContent = `${state.barracks.red.length} / 5`;
  $('black-barracks').textContent = `${state.barracks.black.length} / 5`;
  $('red-pool').textContent = state.pools.red.production.map((type) => labels[type]).join(' · ') || '生产区为空';
  $('black-pool').textContent = state.pools.black.production.map((type) => labels[type]).join(' · ') || '生产区为空';

  const board = $('board');
  board.innerHTML = '';
  for (let y = 0; y < 10; y += 1) {
    for (let x = 0; x < 9; x += 1) {
      const cell = document.createElement('div');
      cell.className = `cell ${y === 4 || y === 5 ? 'river' : ''}`;
      const action = selectedActions.find((item) => item.to?.x === x && item.to?.y === y);
      if (action) {
        cell.classList.add('legal');
        if (pieceAt(state, x, y)) cell.classList.add('attack');
      }
      const piece = pieceAt(state, x, y);
      if (piece) {
        const el = document.createElement('div');
        el.className = `piece ${piece.side} ${piece.deployed ? 'deployed' : ''} ${piece.type === 'barrack' ? 'barrack' : ''}`;
        el.textContent = labels[piece.type];
        el.title = `${piece.side === 'red' ? '红' : '黑'}方${labels[piece.type]}`;
        cell.append(el);
      }
      cell.addEventListener('click', () => clickCell(x, y));
      board.append(cell);
    }
  }

  $('selected').textContent = selected
    ? `${selected.side === 'red' ? '红' : '黑'}方${labels[selected.type]}（${selected.x + 1},${selected.y + 1}）`
    : '未选择';
  const canPlace = canDeploy(state, state.turn) && state.barrackInventory[state.turn] > 0;
  $('deploy-barrack').disabled = !canPlace;
  $('deploy-barrack').textContent = deployMode ? '请点击阵营区空点' : '部署兵营到阵营区';
  const actions = $('actions');
  actions.innerHTML = '';
  selectedActions.forEach((item) => {
    const button = document.createElement('button');
    button.className = 'action';
    button.textContent = actionText(item);
    button.addEventListener('click', () => run(item));
    actions.append(button);
  });
  $('log').innerHTML = state.log.slice(-8).reverse().map((item) => `<li>${item}</li>`).join('');
}

function clickCell(x, y) {
  if (deployMode) {
    try {
      state = deployBarrack(state, x, y);
      deployMode = false;
      selected = null;
      selectedActions = [];
      render();
    } catch (error) {
      $('status').textContent = error.message;
    }
    return;
  }
  const action = selectedActions.find((item) => item.to?.x === x && item.to?.y === y);
  if (action) { run(action); return; }
  const piece = pieceAt(state, x, y);
  if (piece?.side === state.turn) {
    selected = piece;
    selectedActions = [...legalActions(state, piece.id), ...productionActions(state, piece.id)];
  } else {
    selected = null;
    selectedActions = [];
  }
  render();
}

function run(action) {
  try {
    state = action.type === 'produce' ? applyProduction(state, action) : applyAction(state, action);
    selected = null;
    selectedActions = [];
    render();
  } catch (error) {
    $('status').textContent = error.message;
  }
}

$('new-game').onclick = () => {
  state = initialState();
  selected = null;
  selectedActions = [];
  deployMode = false;
  render();
};
$('rules').onclick = () => $('rules-dialog').showModal();
$('deploy-barrack').onclick = () => { deployMode = !deployMode; render(); };
render();



relationsEditor = createRelationsEditor({ board: document.getElementById('board'), matrix: document.getElementById('relation-matrix'), status: document.getElementById('relation-status'), map: relationMap });



