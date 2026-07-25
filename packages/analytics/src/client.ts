import type { Campus, EventName, PropsFor, TrackedEvent } from './events';

const FLUSH_INTERVAL_MS = 3000;
const MAX_BUFFER = 20;
const MAX_BATCH_PER_REQUEST = 100;
const MAX_RETRIES = 3;
const INGEST_PATH = '/api/events';

function isBrowser(): boolean {
  return typeof window !== 'undefined';
}

function uuidv4(): string {
  const cryptoObj = globalThis.crypto;
  if (cryptoObj?.randomUUID) return cryptoObj.randomUUID();
  // RFC 4122 v4 fallback for environments without crypto.randomUUID.
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
    const r = (Math.random() * 16) | 0;
    const v = c === 'x' ? r : (r & 0x3) | 0x8;
    return v.toString(16);
  });
}

function readOrCreate(storage: Storage, key: string): string {
  const existing = storage.getItem(key);
  if (existing) return existing;
  const next = uuidv4();
  storage.setItem(key, next);
  return next;
}

let serverAnonymousId: string | null = null;
let serverSessionId: string | null = null;

function anonymousId(): string {
  if (isBrowser()) return readOrCreate(window.localStorage, 'kamel_anonymous_id');
  serverAnonymousId ??= uuidv4();
  return serverAnonymousId;
}

function sessionId(): string {
  if (isBrowser()) return readOrCreate(window.sessionStorage, 'kamel_session_id');
  serverSessionId ??= uuidv4();
  return serverSessionId;
}

let identity: { userId: string | null; campus: Campus | null } = {
  userId: null,
  campus: null,
};

/** Associates subsequent track() calls with a signed-in user and campus. */
export function identify(userId: string | null, campus: Campus | null = null): void {
  identity = { userId, campus };
}

const queue: TrackedEvent[] = [];
let flushTimer: ReturnType<typeof setTimeout> | null = null;
let beaconAttached = false;

function scheduleFlush(): void {
  if (flushTimer) return;
  flushTimer = setTimeout(() => {
    flushTimer = null;
    void flush();
  }, FLUSH_INTERVAL_MS);
}

function attachBeacon(): void {
  if (beaconAttached || !isBrowser()) return;
  beaconAttached = true;
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'hidden' && queue.length > 0) {
      flushWithBeacon();
    }
  });
}

/**
 * Queues an event. `properties` is narrowed to exactly the shape declared
 * for `eventName` in events.ts, so passing the wrong fields (or the
 * fields for a different event) fails to build.
 */
export function track<E extends EventName>(
  eventName: E,
  properties: PropsFor<E>,
  overrides: { userId?: string | null; campus?: Campus | null } = {}
): void {
  const event = {
    event_id: uuidv4(),
    user_id: overrides.userId !== undefined ? overrides.userId : identity.userId,
    anonymous_id: anonymousId(),
    session_id: sessionId(),
    occurred_at: new Date().toISOString(),
    campus: overrides.campus !== undefined ? overrides.campus : identity.campus,
    schema_version: 1,
    event_name: eventName,
    properties,
  } as TrackedEvent;

  queue.push(event);
  attachBeacon();

  if (queue.length >= MAX_BUFFER) {
    void flush();
  } else {
    scheduleFlush();
  }
}

function flushWithBeacon(): void {
  if (typeof navigator === 'undefined' || typeof navigator.sendBeacon !== 'function') {
    void flush();
    return;
  }
  const batch = queue.splice(0, queue.length);
  const blob = new Blob([JSON.stringify(batch)], { type: 'application/json' });
  const accepted = navigator.sendBeacon(INGEST_PATH, blob);
  if (!accepted) {
    queue.unshift(...batch);
    void flush();
  }
}

function backoff(attempt: number): Promise<void> {
  const delayMs = 2 ** attempt * 250; // 500ms, 1000ms, 2000ms
  return new Promise((resolve) => setTimeout(resolve, delayMs));
}

async function postBatch(batch: TrackedEvent[], attempt = 1): Promise<void> {
  try {
    const res = await fetch(INGEST_PATH, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(batch),
      keepalive: isBrowser(),
    });
    if (!res.ok && res.status >= 500 && attempt < MAX_RETRIES) {
      await backoff(attempt);
      return postBatch(batch, attempt + 1);
    }
    if (!res.ok) {
      console.warn(
        `[kamel-analytics] dropped ${batch.length} event(s): ${res.status} ${res.statusText}`
      );
    }
  } catch (err) {
    if (attempt < MAX_RETRIES) {
      await backoff(attempt);
      return postBatch(batch, attempt + 1);
    }
    console.warn(
      `[kamel-analytics] dropped ${batch.length} event(s) after ${MAX_RETRIES} attempts`,
      err
    );
  }
}

/** Sends everything currently queued. Safe to call manually (e.g. before unload). */
export async function flush(): Promise<void> {
  if (flushTimer) {
    clearTimeout(flushTimer);
    flushTimer = null;
  }
  if (queue.length === 0) return;
  const batch = queue.splice(0, Math.min(queue.length, MAX_BATCH_PER_REQUEST));
  await postBatch(batch);
  if (queue.length > 0) await flush();
}
