import { DurableObject } from "cloudflare:workers";
import { evaluateLoginAttempt, type RateRecord } from "./security";

interface AuthStateEnv {}

interface AttemptResult {
  allowed: boolean;
  retryAfterSeconds: number;
}

export class AuthState extends DurableObject<AuthStateEnv> {
  constructor(ctx: DurableObjectState, env: AuthStateEnv) {
    super(ctx, env);
    this.ctx.storage.sql.exec(`
      CREATE TABLE IF NOT EXISTS sessions (
        token_hash TEXT PRIMARY KEY,
        expires_at INTEGER NOT NULL
      );
      CREATE TABLE IF NOT EXISTS failures (
        ip_hash TEXT PRIMARY KEY,
        count INTEGER NOT NULL,
        window_started INTEGER NOT NULL,
        blocked_until INTEGER NOT NULL
      );
    `);
  }

  async attemptLogin(ipHash: string, isCorrect: boolean, now: number): Promise<AttemptResult> {
    const rows = this.ctx.storage.sql
      .exec<{
        count: number;
        window_started: number;
        blocked_until: number;
      }>(
        "SELECT count, window_started, blocked_until FROM failures WHERE ip_hash = ?",
        ipHash,
      )
      .toArray();

    const row = rows[0];
    const current: RateRecord | null = row
      ? {
          count: row.count,
          windowStarted: row.window_started,
          blockedUntil: row.blocked_until,
        }
      : null;
    const decision = evaluateLoginAttempt(current, isCorrect, now);

    if (!decision.record) {
      this.ctx.storage.sql.exec("DELETE FROM failures WHERE ip_hash = ?", ipHash);
    } else {
      this.ctx.storage.sql.exec(
        `INSERT INTO failures (ip_hash, count, window_started, blocked_until)
         VALUES (?, ?, ?, ?)
         ON CONFLICT(ip_hash) DO UPDATE SET
           count = excluded.count,
           window_started = excluded.window_started,
           blocked_until = excluded.blocked_until`,
        ipHash,
        decision.record.count,
        decision.record.windowStarted,
        decision.record.blockedUntil,
      );
    }

    return {
      allowed: decision.allowed,
      retryAfterSeconds: decision.retryAfterSeconds,
    };
  }

  async createSession(tokenHash: string, expiresAt: number): Promise<void> {
    this.ctx.storage.sql.exec("DELETE FROM sessions WHERE expires_at <= ?", Date.now());
    this.ctx.storage.sql.exec(
      "INSERT OR REPLACE INTO sessions (token_hash, expires_at) VALUES (?, ?)",
      tokenHash,
      expiresAt,
    );
  }

  async validateSession(tokenHash: string, now: number): Promise<number | null> {
    this.ctx.storage.sql.exec("DELETE FROM sessions WHERE expires_at <= ?", now);
    const rows = this.ctx.storage.sql
      .exec<{ expires_at: number }>(
        "SELECT expires_at FROM sessions WHERE token_hash = ?",
        tokenHash,
      )
      .toArray();
    return rows[0]?.expires_at ?? null;
  }

  async deleteSession(tokenHash: string): Promise<void> {
    this.ctx.storage.sql.exec("DELETE FROM sessions WHERE token_hash = ?", tokenHash);
  }
}
