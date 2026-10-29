export function objectValue(value: unknown): Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) throw Error('Invalid response object');
  return value as Record<string, unknown>;
}
export function parseObject(text: string): Record<string, unknown> {
  const value: unknown = JSON.parse(text);
  return objectValue(value);
}
export function stringValue(value: unknown): string {
  if (typeof value !== 'string') throw Error('Invalid response string');
  return value;
}
export function booleanValue(value: unknown): boolean {
  if (typeof value !== 'boolean') throw Error('Invalid response boolean');
  return value;
}
export function integerValue(value: unknown): number {
  if (typeof value !== 'number' || !Number.isSafeInteger(value)) throw Error('Invalid response integer');
  return value;
}
export function arrayValue(value: unknown): unknown[] {
  if (!Array.isArray(value)) throw Error('Invalid response array');
  return value;
}
export function nullableString(value: unknown): string | null {return value === null ? null : stringValue(value);}
export function responseError(value: unknown, fallback: string): string {
  if (typeof value !== 'object' || value === null || !('error' in value)) return fallback;
  const error = value.error;
  return typeof error === 'object' && error !== null && 'message' in error && typeof error.message === 'string' ? error.message : fallback;
}
