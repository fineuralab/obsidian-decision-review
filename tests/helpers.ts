import { ConflictError, newDecision, RecordSnapshot, Decision } from '../src/domain';
import { StoragePort } from '../src/store';
export const record = (patch: Partial<RecordSnapshot> = {}): RecordSnapshot => ({ title: '先做完整流程', decisionDate: '2026-01-01', reason: '验证是否可以反复使用', expected: '完成三次真实回访', references: [], ...patch });
export const decision = (patch: Partial<RecordSnapshot> = {}): Decision => newDecision(record(patch), '2026-01-31');
export class MemoryPort implements StoragePort {
  files = new Map<string, string>(); trashed: string[] = []; writes = 0;
  failWrite: ((path: string) => boolean) | undefined; failNextList = false;
  async list(folder: string): Promise<string[]> { if (this.failNextList) { this.failNextList = false; throw new Error('list unavailable'); } return [...this.files.keys()].filter(path => path.startsWith(`${folder}/`)); }
  async read(path: string): Promise<string> { if (!this.files.has(path)) throw new Error(`missing ${path}`); return this.files.get(path)!; }
  async write(path: string, source: string, expected: string | null): Promise<void> {
    if (this.failWrite?.(path)) throw new Error(`write denied: ${path}`);
    if (expected === null ? this.files.has(path) : this.files.get(path) !== expected) throw new ConflictError();
    this.files.set(path, source); this.writes++;
  }
  async trash(path: string, expected: string): Promise<void> { if (this.files.get(path) !== expected) throw new ConflictError(); this.files.delete(path); this.trashed.push(path); }
}
