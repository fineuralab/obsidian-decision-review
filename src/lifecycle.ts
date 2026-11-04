import { DecisionError } from './domain';
import { t } from './i18n';

export function stoppedError(): DecisionError {
  return new DecisionError(t('插件已停用，旧表单不能保存。输入已保留；请复制输入，重新启用后再打开表单。', 'The plugin was disabled and this old form cannot save. Your input is preserved; copy it, re-enable the plugin and open a new form.'));
}

// Keep settings writes ordered even when the plugin module is loaded again.
// Different App objects (vaults) have independent queues and can be collected.
const SETTINGS_WRITES = Symbol.for('decision-review.settings-write-queues');
type QueueScope = typeof globalThis & { [SETTINGS_WRITES]?: WeakMap<object, Promise<void>> };
const queues = (globalThis as QueueScope)[SETTINGS_WRITES] ??= new WeakMap<object, Promise<void>>();

export function serializeSettingsWrite<T>(owner: object, work: () => Promise<T>): Promise<T> {
  const task = (queues.get(owner) ?? Promise.resolve()).then(work, work);
  queues.set(owner, task.then(() => undefined, () => undefined));
  return task;
}

export async function settleSettingsWrites(owner: object): Promise<void> {
  for (;;) {
    const pending = queues.get(owner); if (!pending) return;
    await pending; if (pending === queues.get(owner)) return;
  }
}
