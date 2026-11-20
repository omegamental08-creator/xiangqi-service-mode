export const classicValidationRuleset = {
  id: 'classic-validation-0.1',
  hash: 'classic-validation-0.1',
  createInitialState() {
    return {
      turnNumber: 1,
      activePlayerId: null,
      stepsLeft: 1,
      pieces: [
        { id: 'A-general', type: 'jiang', playerId: 'A', x: 4, y: 1 },
        { id: 'B-general', type: 'jiang', playerId: 'B', x: 4, y: 8 }
      ],
      history: []
    };
  },
  validateCommand(state, command, playerId) {
    if (command.kind !== 'move') return { ok: false, code: 'UNSUPPORTED_COMMAND', message: '验证版只支持移动命令' };
    const piece = state.pieces.find(item => item.id === command.pieceId);
    if (!piece) return { ok: false, code: 'PIECE_NOT_FOUND', message: '棋子不存在' };
    if (piece.playerId !== playerId) return { ok: false, code: 'NOT_OWNER', message: '不能操作对方棋子' };
    if (state.activePlayerId !== playerId) return { ok: false, code: 'NOT_YOUR_TURN', message: '还没有轮到你' };
    const target = command.target;
    if (!target || !Number.isInteger(target.x) || !Number.isInteger(target.y)) return { ok: false, code: 'INVALID_TARGET', message: '目标位置无效' };
    if (target.x < 0 || target.x > 8 || target.y < 0 || target.y > 9) return { ok: false, code: 'OUT_OF_BOUNDS', message: '目标超出棋盘' };
    if (Math.abs(target.x - piece.x) + Math.abs(target.y - piece.y) !== 1) return { ok: false, code: 'INVALID_MOVE', message: '验证版只允许移动相邻一格' };
    if (state.pieces.some(item => item.x === target.x && item.y === target.y && item.playerId === playerId)) return { ok: false, code: 'OCCUPIED', message: '目标位置已有己方棋子' };
    return { ok: true };
  },
  executeCommand(state, command) {
    const piece = state.pieces.find(item => item.id === command.pieceId);
    const target = command.target;
    const captured = state.pieces.find(item => item.x === target.x && item.y === target.y && item.playerId !== piece.playerId);
    if (captured) state.pieces = state.pieces.filter(item => item.id !== captured.id);
    piece.x = target.x;
    piece.y = target.y;
    return { effects: [{ type: 'move', pieceId: piece.id, target }, ...(captured ? [{ type: 'eliminate', pieceId: captured.id }] : [])] };
  },
  finishTurn(state, playerIds) {
    const currentIndex = playerIds.indexOf(state.activePlayerId);
    state.activePlayerId = playerIds[(currentIndex + 1) % playerIds.length];
    state.turnNumber += 1;
    state.stepsLeft = 1;
  }
};
