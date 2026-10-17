/**
 * Alert decisions and session state for the Worker.
 *
 * The policy matches the Node backend's behavior: an object must be confirmed across two
 * frames before it alerts, and a cooldown prevents repeated alerts for the same object.
 *
 * Sessions live in the isolate's memory. Cloudflare may evict or relocate an isolate at any
 * time, so a session can disappear between requests. Clients already handle a 404 by
 * creating a new session, which is why this is acceptable for a demo but not durable state.
 */

/**
 * Decides whether two sightings are the same object.
 *
 * With a bounding box, nearby centers of the same label match. This deployment has no box,
 * so the coarse region is the only positional evidence available and an unknown region
 * falls back to the label alone.
 */
function sameObject(item, previous) {
  if (item.label !== previous.label) return false;
  if (item.bbox && previous.bbox) {
    const a = { x: item.bbox.x + item.bbox.width / 2, y: item.bbox.y + item.bbox.height / 2 };
    const b = { x: previous.bbox.x + previous.bbox.width / 2, y: previous.bbox.y + previous.bbox.height / 2 };
    return Math.hypot(a.x - b.x, a.y - b.y) < 0.18;
  }
  if (item.region && previous.region) {
    const unknown = item.region.horizontal === 'unknown' || previous.region.horizontal === 'unknown';
    return unknown || item.region.horizontal === previous.region.horizontal;
  }
  return true;
}

export function createAlertPolicy({ cooldownMs = 3000, maxGapMs = 2500, confirmations = 2 } = {}) {
  let candidate = null;
  let lastAlertAt = -Infinity;
  return {
    reset() { candidate = null; lastAlertAt = -Infinity; },
    breakStreak() { candidate = null; },
    update(detections, now) {
      const cooldownRemainingMs = Math.max(0, Math.ceil(cooldownMs - (now - lastAlertAt)));
      const result = (reason, triggered = false) => ({
        triggered,
        reason,
        modalities: [],
        message: triggered ? 'Object in camera zone. Check your surroundings.' : null,
        cooldownRemainingMs: triggered ? cooldownMs : cooldownRemainingMs,
      });
      const items = detections.filter((item) => item.inZone).sort((a, b) => b.confidence - a.confidence);
      const match = candidate && now - candidate.seenAt <= maxGapMs
        ? items.find((item) => sameObject(item, candidate.item))
        : null;
      const next = match || items[0];
      if (!next) { candidate = null; return result('no_candidate'); }
      candidate = { item: next, seenAt: now, count: match ? candidate.count + 1 : 1 };
      if (candidate.count < confirmations) return result('confirming');
      if (cooldownRemainingMs > 0) return result('cooldown');
      lastAlertAt = now;
      return result('triggered', true);
    },
  };
}

export class ApiError extends Error {
  constructor(statusCode, code, message) {
    super(message);
    this.name = 'ApiError';
    this.statusCode = statusCode;
    this.code = code;
  }
}

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
    if (this.items.size >= this.maxSessions) {
      throw new ApiError(429, 'SESSION_CAPACITY', 'Session capacity reached. Try again later.');
    }
    const preferences = {
      alertModes: preset === 'accessibility' ? ['speech'] : ['sound'],
      confidenceThreshold: 0.6,
      cooldownMs: 3000,
      ...overrides,
    };
    const session = {
      sessionId: crypto.randomUUID(),
      preset,
      preferences,
      expiresAt: this.clock() + this.ttlMs,
      revision: 0,
      lastSequence: 0,
      busy: false,
      policy: createAlertPolicy(preferences),
    };
    this.items.set(session.sessionId, session);
    return session;
  }

  get(id, touch = true) {
    const session = this.items.get(id);
    if (!session || session.expiresAt <= this.clock()) {
      this.items.delete(id);
      throw new ApiError(404, 'SESSION_NOT_FOUND', 'Session is missing or expired. Create a new session.');
    }
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

  public(session) {
    return {
      sessionId: session.sessionId,
      preset: session.preset,
      preferences: { ...session.preferences, alertModes: [...session.preferences.alertModes] },
      expiresAt: new Date(session.expiresAt).toISOString(),
    };
  }
}

const ALERT_MODES = ['sound', 'vibration', 'speech'];

/** Validates preference fields against the documented API contract. */
export function validatePreferences(input, { partial = false } = {}) {
  if (input === undefined) return {};
  if (input === null || typeof input !== 'object' || Array.isArray(input)) {
    throw new ApiError(400, 'VALIDATION_ERROR', 'Preferences must be an object.');
  }
  const allowed = ['alertModes', 'confidenceThreshold', 'cooldownMs'];
  for (const key of Object.keys(input)) {
    if (!allowed.includes(key)) {
      throw new ApiError(400, 'VALIDATION_ERROR', `Unknown preference field: ${key}.`);
    }
  }
  if (partial && Object.keys(input).length === 0) {
    throw new ApiError(400, 'VALIDATION_ERROR', 'Send at least one preference field.');
  }
  const result = {};
  if (input.alertModes !== undefined) {
    const modes = input.alertModes;
    if (!Array.isArray(modes) || modes.length > 3 || new Set(modes).size !== modes.length
      || !modes.every((mode) => ALERT_MODES.includes(mode))) {
      throw new ApiError(400, 'VALIDATION_ERROR', 'alertModes must be unique values from sound, vibration, speech.');
    }
    result.alertModes = [...modes];
  }
  if (input.confidenceThreshold !== undefined) {
    const value = input.confidenceThreshold;
    if (typeof value !== 'number' || !Number.isFinite(value) || value < 0.4 || value > 0.95) {
      throw new ApiError(400, 'VALIDATION_ERROR', 'confidenceThreshold must be between 0.4 and 0.95.');
    }
    result.confidenceThreshold = value;
  }
  if (input.cooldownMs !== undefined) {
    const value = input.cooldownMs;
    if (!Number.isInteger(value) || value < 1000 || value > 10000) {
      throw new ApiError(400, 'VALIDATION_ERROR', 'cooldownMs must be an integer between 1000 and 10000.');
    }
    result.cooldownMs = value;
  }
  return result;
}
