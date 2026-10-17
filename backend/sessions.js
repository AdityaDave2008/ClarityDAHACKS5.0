import { randomUUID } from 'node:crypto';
import { ApiError } from './errors.js';
import { createAlertPolicy } from './alerts.js';

export class SessionStore {
  constructor({ ttlMs = 1_800_000, maxSessions = 200, clock = Date.now } = {}) {
    this.items = new Map();
    this.ttlMs = ttlMs;
    this.maxSessions = maxSessions;
    this.clock = clock;
  }
  sweep() {
    const now = this.clock();
    for (const [id, session] of this.items) if (session.expiresAt <= now) this.items.delete(id);
  }
  create(preset = 'standard', overrides = {}) {
    this.sweep();
    if (this.items.size >= this.maxSessions) throw new ApiError(429, 'SESSION_CAPACITY', 'Session capacity reached. Try again later.');
    const preferences = { alertModes: preset === 'accessibility' ? ['speech'] : ['sound'], confidenceThreshold: 0.6, cooldownMs: 3000, ...overrides };
    const session = { sessionId: randomUUID(), preset, preferences, expiresAt: this.clock() + this.ttlMs, revision: 0, lastSequence: 0, busy: false, surface: null, policy: createAlertPolicy(preferences) };
    this.items.set(session.sessionId, session);
    return session;
  }
  get(id, touch = true) {
    const session = this.items.get(id);
    if (!session || session.expiresAt <= this.clock()) { this.items.delete(id); throw new ApiError(404, 'SESSION_NOT_FOUND', 'Session is missing or expired. Create a new session.'); }
    if (touch) session.expiresAt = this.clock() + this.ttlMs;
    return session;
  }
  update(id, changes) {
    const session = this.get(id);
    session.preferences = { ...session.preferences, ...changes };
    session.policy = createAlertPolicy(session.preferences);
    session.revision += 1;
    return session;
  }
  delete(id) { this.get(id, false); this.items.delete(id); }
  clear() { this.items.clear(); }
  public(session) {
    return { sessionId: session.sessionId, preset: session.preset, preferences: { ...session.preferences, alertModes: [...session.preferences.alertModes] }, expiresAt: new Date(session.expiresAt).toISOString() };
  }
}
