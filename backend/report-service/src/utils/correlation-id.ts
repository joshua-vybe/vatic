import { AsyncLocalStorage } from 'async_hooks';
import { v4 as uuidv4 } from 'uuid';

const correlationIdStorage = new AsyncLocalStorage<string>();

export function getCorrelationId(): string {
  return correlationIdStorage.getStore() || 'unknown';
}

export function setCorrelationId(id: string): void {
  correlationIdStorage.enterWith(id);
}

export function generateCorrelationId(): string {
  return uuidv4();
}

export function runWithCorrelationId<T>(id: string, fn: () => T): T {
  return correlationIdStorage.run(id, fn);
}
