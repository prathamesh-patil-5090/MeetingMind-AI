export type GroqRequestLane = 'whisper' | 'chat' | 'extract' | 'vision' | 'general';

/**
 * Round-robin + cooldown pool with per-lane primary keys for request segregation.
 * Example with 5 keys:
 *   whisper → key[0], chat → key[1], extract → key[2], vision → key[3], general → key[4]
 * Rate-limited keys cool down; requests fail over to the next available key.
 */
export class ApiKeyPool {
  private readonly keys: string[];
  private readonly lanePrimary = new Map<GroqRequestLane, number>();
  private readonly laneCursor = new Map<GroqRequestLane, number>();
  private readonly cooldownUntil = new Map<string, number>();
  private rrIndex = 0;

  constructor(keys: string[], laneOverrides?: Partial<Record<GroqRequestLane, number>>) {
    const unique = [...new Set(keys.map((k) => k.trim()).filter(Boolean))];
    if (!unique.length) {
      throw new Error('ApiKeyPool requires at least one API key');
    }
    this.keys = unique;
    this.assignDefaultLanes(laneOverrides);
  }

  get size(): number {
    return this.keys.length;
  }

  laneMap(): Record<GroqRequestLane, number> {
    return {
      whisper: this.lanePrimary.get('whisper') ?? 0,
      chat: this.lanePrimary.get('chat') ?? 0,
      extract: this.lanePrimary.get('extract') ?? 0,
      vision: this.lanePrimary.get('vision') ?? 0,
      general: this.lanePrimary.get('general') ?? 0,
    };
  }

  /** Acquire a key for a segregated request lane. */
  acquire(lane: GroqRequestLane = 'general'): string {
    const primaryIdx = this.lanePrimary.get(lane) ?? 0;
    const primary = this.keys[primaryIdx % this.keys.length]!;
    if (!this.isCoolingDown(primary)) {
      return primary;
    }

    // Fail over: walk from lane cursor, then full pool.
    const start = this.laneCursor.get(lane) ?? primaryIdx;
    for (let i = 0; i < this.keys.length; i += 1) {
      const idx = (start + i) % this.keys.length;
      const key = this.keys[idx]!;
      if (!this.isCoolingDown(key)) {
        this.laneCursor.set(lane, idx);
        return key;
      }
    }

    return this.soonestAvailable() ?? primary;
  }

  /** Fingerprint for logs — never log the full secret. */
  fingerprint(key: string): string {
    if (key.length <= 8) return '****';
    return `${key.slice(0, 4)}…${key.slice(-4)}`;
  }

  /** Mark key rate-limited and return next key for the same lane. */
  markRateLimited(key: string, lane: GroqRequestLane, retryAfterSec = 60): string {
    const until = Date.now() + Math.max(1, retryAfterSec) * 1000;
    this.cooldownUntil.set(key, until);
    return this.acquire(lane);
  }

  /** After success, nudge lane cursor so parallel extract/chat can share load. */
  advanceLane(lane: GroqRequestLane): void {
    if (this.keys.length <= 1) return;
    // Keep sticky primary when healthy — only advance cursor for failover stickiness reset.
    const primaryIdx = this.lanePrimary.get(lane) ?? 0;
    const primary = this.keys[primaryIdx]!;
    if (!this.isCoolingDown(primary)) {
      this.laneCursor.set(lane, primaryIdx);
      return;
    }
    const cur = this.laneCursor.get(lane) ?? primaryIdx;
    this.laneCursor.set(lane, (cur + 1) % this.keys.length);
  }

  /** Global round-robin pick (unused lanes / overflow). */
  acquireRoundRobin(): string {
    for (let i = 0; i < this.keys.length; i += 1) {
      const idx = (this.rrIndex + i) % this.keys.length;
      const key = this.keys[idx]!;
      if (!this.isCoolingDown(key)) {
        this.rrIndex = (idx + 1) % this.keys.length;
        return key;
      }
    }
    return this.keys[this.rrIndex % this.keys.length]!;
  }

  private assignDefaultLanes(
    overrides?: Partial<Record<GroqRequestLane, number>>,
  ): void {
    const n = this.keys.length;
    const clamp = (i: number) => ((i % n) + n) % n;

    const defaults: Record<GroqRequestLane, number> =
      n === 1
        ? { whisper: 0, chat: 0, extract: 0, vision: 0, general: 0 }
        : n === 2
          ? { whisper: 0, chat: 1, extract: 1, vision: 0, general: 1 }
          : n === 3
            ? { whisper: 0, chat: 1, extract: 2, vision: 1, general: 2 }
            : n === 4
              ? { whisper: 0, chat: 1, extract: 2, vision: 3, general: 3 }
              : { whisper: 0, chat: 1, extract: 2, vision: 3, general: 4 };

    for (const lane of Object.keys(defaults) as GroqRequestLane[]) {
      const override = overrides?.[lane];
      const idx = override != null ? clamp(override) : defaults[lane];
      this.lanePrimary.set(lane, idx);
      this.laneCursor.set(lane, idx);
    }
  }

  private soonestAvailable(): string | null {
    let best: string | null = null;
    let bestUntil = Infinity;
    for (const key of this.keys) {
      const until = this.cooldownUntil.get(key) ?? 0;
      if (until < bestUntil) {
        best = key;
        bestUntil = until;
      }
    }
    return best;
  }

  private isCoolingDown(key: string): boolean {
    const until = this.cooldownUntil.get(key);
    if (!until) return false;
    if (Date.now() >= until) {
      this.cooldownUntil.delete(key);
      return false;
    }
    return true;
  }
}

/** Split comma / semicolon / newline lists into unique keys. */
export function parseApiKeyList(...sources: Array<string | undefined | null>): string[] {
  const out: string[] = [];
  for (const source of sources) {
    if (!source) continue;
    for (const part of source.split(/[\n,;]+/)) {
      const key = part.trim();
      if (key && !out.includes(key)) {
        out.push(key);
      }
    }
  }
  return out;
}

export function parseLaneOverrides(
  env: Record<string, string | undefined>,
): Partial<Record<GroqRequestLane, number>> {
  const read = (name: string): number | undefined => {
    const raw = env[name];
    if (raw == null || raw.trim() === '') return undefined;
    const n = Number(raw);
    return Number.isFinite(n) ? n : undefined;
  };
  return {
    whisper: read('GROQ_LANE_WHISPER'),
    chat: read('GROQ_LANE_CHAT'),
    extract: read('GROQ_LANE_EXTRACT'),
    vision: read('GROQ_LANE_VISION'),
    general: read('GROQ_LANE_GENERAL'),
  };
}
