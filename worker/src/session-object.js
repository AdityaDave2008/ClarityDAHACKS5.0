/**
 * Durable session state.
 *
 * Worker isolates do not share memory and are created and destroyed freely, so sessions held
 * in a module-level map disappeared between requests. Measured against the first deployment,
 * roughly three in five frame uploads failed with SESSION_NOT_FOUND.
 *
 * A Durable Object gives every session one addressable instance with its own storage, so
 * preferences, sequence numbers, and the alert streak survive across requests and isolates.
 */

import { ApiError, createAlertPolicy, validatePreferences } from './sessions.js';

const DEFAULT_TTL_MS = 1_800_000;

export class SessionObject {
  constructor(state, env) {
    this.state = state;
    this.env = env;
    this.ttlMs = Number(env.SESSION_TTL_MS) || DEFAULT_TTL_MS;
    // The alert policy keeps a short confirmation streak. It is rebuilt from storage when an
    // instance restarts, so a restart costs at most one confirmation rather than an alert.
    this.policy = null;
    this.policyRevision = -1;
  }

  async load() {
    const record = await this.state.storage.get('session');
    if (!record || record.expiresAt <= Date.now()) {
      if (record) await this.state.storage.deleteAll();
      return null;
    }
    return record;
  }

  async save(record) {
    record.expiresAt = Date.now() + this.ttlMs;
    await this.state.storage.put('session', record);
    return record;
  }

  policyFor(record) {
    if (!this.policy || this.policyRevision !== record.revision) {
      this.policy = createAlertPolicy(record.preferences);
      this.policyRevision = record.revision;
    }
    return this.policy;
  }

  async fetch(request) {
    const url = new URL(request.url);
    const action = url.pathname.slice(1);

    if (action === 'create') {
      const { preset, preferences } = await request.json();
      const record = {
        sessionId: this.state.id.toString(),
        preset,
        preferences: {
          alertModes: preset === 'accessibility' ? ['speech'] : ['sound'],
          confidenceThreshold: 0.6,
          cooldownMs: 3000,
          ...preferences,
        },
        revision: 0,
        lastSequence: 0,
        expiresAt: 0,
      };
      this.policy = null;
      await this.save(record);
      return Response.json(record);
    }

    const record = await this.load();
    if (!record) {
      return Response.json({ error: 'SESSION_NOT_FOUND' }, { status: 404 });
    }

    if (action === 'read') {
      return Response.json(await this.save(record));
    }

    if (action === 'update') {
      const changes = await request.json();
      record.preferences = { ...record.preferences, ...changes };
      record.revision += 1;
      return Response.json(await this.save(record));
    }

    if (action === 'delete') {
      await this.state.storage.deleteAll();
      return new Response(null, { status: 204 });
    }

    if (action === 'frame') {
      const { sequence, detections } = await request.json();
      if (sequence <= record.lastSequence) {
        return Response.json({ error: 'STALE_FRAME' }, { status: 409 });
      }
      record.lastSequence = sequence;
      const alert = this.policyFor(record).update(detections, Date.now());
      if (alert.triggered) alert.modalities = [...record.preferences.alertModes];
      await this.save(record);
      return Response.json({ alert, preferences: record.preferences });
    }

    if (action === 'break-streak') {
      this.policyFor(record).breakStreak();
      return new Response(null, { status: 204 });
    }

    return Response.json({ error: 'NOT_FOUND' }, { status: 404 });
  }
}

/** Thin client so the Worker's request handler reads the same as before. */
export class SessionClient {
  constructor(namespace) {
    if (!namespace) throw new ApiError(503, 'SESSIONS_UNAVAILABLE', 'Session storage is not bound to this Worker.');
    this.namespace = namespace;
  }

  stub(id) {
    return this.namespace.get(this.namespace.idFromString(id));
  }

  /** Session IDs must be opaque to clients, and an invalid one is simply not found. */
  safeStub(id) {
    try {
      return this.stub(id);
    } catch {
      throw new ApiError(404, 'SESSION_NOT_FOUND', 'Session is missing or expired. Create a new session.');
    }
  }

  async create(preset, preferences) {
    const id = this.namespace.newUniqueId();
    const response = await this.namespace.get(id).fetch('https://session/create', {
      method: 'POST',
      body: JSON.stringify({ preset, preferences }),
    });
    const record = await response.json();
    return { ...record, sessionId: id.toString() };
  }

  async call(id, action, body) {
    const response = await this.safeStub(id).fetch(`https://session/${action}`, {
      method: 'POST',
      body: JSON.stringify(body ?? {}),
    });
    if (response.status === 404) {
      throw new ApiError(404, 'SESSION_NOT_FOUND', 'Session is missing or expired. Create a new session.');
    }
    if (response.status === 409) {
      throw new ApiError(409, 'STALE_FRAME', 'Use a new frame with a higher sequence number.');
    }
    if (response.status === 204) return null;
    return response.json();
  }
}

export function publicSession(record) {
  return {
    sessionId: record.sessionId,
    preset: record.preset,
    preferences: { ...record.preferences, alertModes: [...record.preferences.alertModes] },
    expiresAt: new Date(record.expiresAt).toISOString(),
  };
}

export { validatePreferences };
