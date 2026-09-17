import { beforeEach, describe, expect, it } from 'vitest';
import { cached, clearCache, invalidate } from './cache.js';

describe('TTL-кэш', () => {
  beforeEach(clearCache);

  it('второй вызов не обращается к источнику', async () => {
    let calls = 0;
    const load = async () => {
      calls += 1;
      return 'value';
    };
    expect(await cached('k', 1000, load)).toBe('value');
    expect(await cached('k', 1000, load)).toBe('value');
    expect(calls).toBe(1);
  });

  it('после истечения TTL данные перезапрашиваются', async () => {
    let calls = 0;
    const load = async () => {
      calls += 1;
      return calls;
    };
    expect(await cached('k', 0, load)).toBe(1);
    await new Promise((r) => setTimeout(r, 2));
    expect(await cached('k', 0, load)).toBe(2);
  });

  it('invalidate сбрасывает по префиксу', async () => {
    await cached('buckets:1', 10_000, async () => 'a');
    await cached('users:1', 10_000, async () => 'b');
    invalidate('buckets:');
    let reloaded = false;
    await cached('buckets:1', 10_000, async () => {
      reloaded = true;
      return 'c';
    });
    expect(reloaded).toBe(true);
    let userReloaded = false;
    await cached('users:1', 10_000, async () => {
      userReloaded = true;
      return 'd';
    });
    expect(userReloaded).toBe(false);
  });

  it('ключи независимы', async () => {
    expect(await cached('a', 1000, async () => 1)).toBe(1);
    expect(await cached('b', 1000, async () => 2)).toBe(2);
  });
});
