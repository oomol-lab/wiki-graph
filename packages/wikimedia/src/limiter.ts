import { randomUUID } from "node:crypto";
import type { RedisClientType } from "redis";

const BUCKET_MS = 15_000;
const STATS_TTL_SECONDS = 600;

export class ClusterLimiter {
  public constructor(
    private readonly redis: RedisClientType,
    private readonly maxPerBucket = 40,
    private readonly leaseMs = 10_000,
    private readonly heartbeatMs = 3_000,
  ) {}

  async acquire(): Promise<() => Promise<void>> {
    const now = Date.now();
    const blocked = await this.redis.get("wg-wikimedia:blocked-until");
    if (blocked !== null && Number(blocked) > now) {
      throw new Error("Wikimedia upstream is cooling down");
    }
    const bucket = Math.floor(now / BUCKET_MS);
    const quota = await this.nextQuota(bucket);
    if (quota === 0) throw new Error("Wikimedia circuit is open");
    const quotaKey = `wg-wikimedia:quota:${bucket}`;
    const used = Number(await this.redis.incr(quotaKey));
    await this.redis.expire(quotaKey, STATS_TTL_SECONDS);
    if (used > quota) {
      await this.redis.decr(quotaKey);
      throw new Error("Wikimedia quota exhausted");
    }

    const token = randomUUID();
    let slot = -1;
    for (let index = 0; index < 3; index += 1) {
      if (
        await this.redis.set(`wg-wikimedia:slot:${index}`, token, {
          NX: true,
          PX: this.leaseMs,
        })
      ) {
        slot = index;
        break;
      }
    }
    if (slot < 0) {
      await this.redis.decr(quotaKey);
      throw new Error("Wikimedia concurrency exhausted");
    }

    const slotKey = `wg-wikimedia:slot:${slot}`;
    const heartbeat = setInterval(() => {
      void this.redis.eval(
        "if redis.call('get',KEYS[1])==ARGV[1] then return redis.call('pexpire',KEYS[1],ARGV[2]) else return 0 end",
        { keys: [slotKey], arguments: [token, String(this.leaseMs)] },
      );
    }, this.heartbeatMs);
    return async () => {
      clearInterval(heartbeat);
      await this.redis.eval(
        "if redis.call('get',KEYS[1])==ARGV[1] then return redis.call('del',KEYS[1]) else return 0 end",
        { keys: [slotKey], arguments: [token] },
      );
    };
  }

  private async nextQuota(bucket: number): Promise<number> {
    const planKey = `wg-wikimedia:quota-plan:${bucket}`;
    const planned = await this.redis.get(planKey);
    if (planned !== null) return Number(planned);

    const configured = Number(
      (await this.redis.get("wg-wikimedia:quota-limit")) ?? this.maxPerBucket,
    );
    const current = Number(
      (await this.redis.get("wg-wikimedia:current-quota")) ?? configured,
    );
    // Read the last bucket only after its five-second maturity allowance.
    const now = Date.now();
    const latestMatureBucket = Math.floor((now - 5_000) / BUCKET_MS);
    const previous =
      latestMatureBucket >= 0
        ? await this.redis.hGetAll(`wg-wikimedia:stats:${latestMatureBucket}`)
        : {};
    const count = (suffix: string): number =>
      Object.entries(previous)
        .filter(([key]) => key.endsWith(suffix))
        .reduce((sum, [, value]) => sum + Number(value), 0);
    const requests = count(":requests");
    const errors = count(":429") + count(":503") + count(":maxlag");
    const errorRate = requests === 0 ? 0 : errors / requests;
    const next =
      errors >= 4 || errorRate > 0.5
        ? 0
        : errors > 0
          ? Math.max(1, Math.floor(current / 2))
          : Math.min(configured, current + 2);
    const claimed = await this.redis.set(planKey, String(next), {
      EX: STATS_TTL_SECONDS,
      NX: true,
    });
    if (claimed !== null) {
      await this.redis.set("wg-wikimedia:current-quota", String(next));
      return next;
    }
    return Number((await this.redis.get(planKey)) ?? next);
  }

  async record(
    instance: string,
    status?: number,
    retryAfterMs?: number,
    kind: "http" | "maxlag" = "http",
  ): Promise<void> {
    const bucket = Math.floor(Date.now() / BUCKET_MS);
    const key = `wg-wikimedia:stats:${bucket}`;
    await this.redis.hIncrBy(key, `${instance}:requests`, 1);
    await this.redis.set(`wg-wikimedia:active:${instance}`, "1", { EX: 45 });
    if (kind === "maxlag") await this.redis.hIncrBy(key, `${instance}:maxlag`, 1);
    else if (status === 429) await this.redis.hIncrBy(key, `${instance}:429`, 1);
    else if (status === 503) await this.redis.hIncrBy(key, `${instance}:503`, 1);
    await this.redis.expire(key, STATS_TTL_SECONDS);

    if (status === 429 || status === 503 || kind === "maxlag") {
      const cooldown = Math.max(5_000, retryAfterMs ?? 0);
      const until = Date.now() + cooldown;
      await this.redis.eval(
        "local old=tonumber(redis.call('get',KEYS[1]) or '0'); local next=tonumber(ARGV[1]); if next>old then redis.call('set',KEYS[1],ARGV[1],'PX',ARGV[2]); return next else return old end",
        {
          keys: ["wg-wikimedia:blocked-until"],
          arguments: [String(until), String(cooldown)],
        },
      );
    }
  }
}

export class LocalScheduler {
  #next = 0;

  public constructor(
    private readonly quota: number,
    private readonly bucketMs = BUCKET_MS,
  ) {}

  async wait(): Promise<void> {
    const now = Date.now();
    if (this.#next <= now) {
      this.#next = now + this.bucketMs / Math.max(1, this.quota);
      return;
    }
    const delay = this.#next - now;
    this.#next += this.bucketMs / Math.max(1, this.quota);
    await new Promise((resolve) => setTimeout(resolve, delay));
  }

  reset(): void {
    this.#next = 0;
  }
}

