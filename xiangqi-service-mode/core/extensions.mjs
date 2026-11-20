import { createExtensionContract } from './contracts.mjs';

export function createExtensionRegistry() {
  const registry = new Map();
  return {
    register(extension) {
      const normalized = extension.name ? extension : createExtensionContract(extension);
      if (registry.has(normalized.name)) throw new Error(`扩展已注册: ${normalized.name}`);
      registry.set(normalized.name, normalized);
      return normalized;
    },
    get(name) { return registry.get(name); },
    list() { return [...registry.values()]; },
    createState() {
      return Object.fromEntries([...registry.values()].map((extension) => [extension.name, extension.createState()]));
    },
    actions(state, context) {
      return [...registry.values()].flatMap((extension) => extension.getActions(state, context));
    },
    apply(state, action, context) {
      const extension = registry.get(action.extension);
      if (!extension) throw new Error(`未找到扩展: ${action.extension}`);
      return extension.applyAction(state, action, context);
    }
  };
}
