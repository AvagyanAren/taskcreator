/**
 * Tiny TTL cache kept in the module scope. On Vercel a warm function reuses
 * the same process, so repeated requests skip EdgeFocus round-trips — which
 * matters because the serverless execution budget is limited.
 */
interface Entry<T> {
  value: T;
  expiresAt: number;
}

const store = new Map<string, Entry<unknown>>();

export async function cached<T>(key: string, ttlMs: number, load: () => Promise<T>): Promise<T> {
  const hit = store.get(key);
  if (hit && hit.expiresAt > Date.now()) return hit.value as T;
  const value = await load();
  store.set(key, { value, expiresAt: Date.now() + ttlMs });
  return value;
}

export function invalidate(prefix: string): void {
  for (const key of [...store.keys()]) {
    if (key.startsWith(prefix)) store.delete(key);
  }
}

/** Test helper. */
export function clearCache(): void {
  store.clear();
}

export const TTL = {
  /** Columns are renamed very rarely. */
  buckets: 5 * 60_000,
  /** View settings (done_bucket_id) change even less often. */
  view: 30 * 60_000,
  /** A person's id never changes; the lookup is the expensive part. */
  user: 30 * 60_000
};
