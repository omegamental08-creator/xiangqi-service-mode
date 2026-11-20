// Stable contracts shared by the rule engine, web client, desktop shell and future modes.

export const GAME_VERSION = '1.0';
export const SAVE_FORMAT = 'xiangqi-service-mode-save';
export const ACTION_TYPES = Object.freeze({
  MOVE: 'move',
  ATTACK: 'attack',
  PRODUCE: 'produce',
  PRODUCE_ADVISOR: 'produceAdvisor',
  DEPLOY_BARRACK: 'deployBarrack',
  DEPLOY_HORSE: 'deployHorse',
  DETONATE: 'detonate',
  BRIDGE: 'bridge',
  CUSTOM: 'custom'
});

export function createActionEnvelope(action, metadata = {}) {
  return {
    schema: 1,
    type: action.type,
    action,
    metadata: { ...metadata }
  };
}

export function createSaveFile(state, history = []) {
  return {
    format: SAVE_FORMAT,
    formatVersion: 1,
    rulesVersion: state.version,
    mode: state.mode,
    state: structuredClone(state),
    history: structuredClone(history)
  };
}

export function validateSaveFile(save) {
  if (!save || save.format !== SAVE_FORMAT || save.formatVersion !== 1) {
    throw new Error('不支持的存档格式');
  }
  if (!save.state || !save.rulesVersion || !save.mode) {
    throw new Error('存档缺少必要字段');
  }
  return true;
}

// Extension contract: extensions add state and actions at boundaries; core owns turn,
// attack-limit and base victory transitions unless an explicit mode replaces them.
export function createExtensionContract({ name, version = 1, createState, getActions, applyAction }) {
  if (!name || typeof createState !== 'function' || typeof getActions !== 'function' || typeof applyAction !== 'function') {
    throw new Error('扩展必须提供 name、createState、getActions、applyAction');
  }
  return Object.freeze({ name, version, createState, getActions, applyAction });
}
