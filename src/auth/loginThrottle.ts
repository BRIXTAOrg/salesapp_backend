// BRIXTA_LOGIN_THROTTLE_V1
//
// Slows down password guessing on the sales-app login. Counts failures per
// account and per client address inside a time window. In-memory per
// server process: no database change, and a restart forgets the counters.

type Bucket = {
  count: number;
  resetAt: number;
};

export type ThrottleRule = {
  key: string;
  limit: number;
  windowMs: number;
};

const buckets =
  new Map<string, Bucket>();

const MAX_BUCKETS =
  50_000;

const MINUTE =
  60_000;

function sweep(
  now: number,
) {
  if (buckets.size < MAX_BUCKETS) {
    return;
  }

  for (const [key, bucket] of buckets) {
    if (bucket.resetAt <= now) {
      buckets.delete(key);
    }
  }

  if (buckets.size >= MAX_BUCKETS) {
    let drop =
      Math.floor(
        buckets.size / 2,
      );

    for (const key of buckets.keys()) {
      buckets.delete(key);
      drop -= 1;

      if (drop <= 0) {
        break;
      }
    }
  }
}

export function loginRules(input: {
  scope: string;
  address: string;
  account: string;
}): ThrottleRule[] {
  const account =
    input.account
      .trim()
      .toLowerCase();

  return [
    {
      key: `${input.scope}:acct:${account}`,
      limit: 8,
      windowMs: 15 * MINUTE,
    },
    {
      key: `${input.scope}:ip:${input.address}`,
      limit: 40,
      windowMs: 15 * MINUTE,
    },
  ];
}

/** Seconds to wait if any rule is exhausted, otherwise 0. */
export function throttleWait(
  rules: ThrottleRule[],
) {
  const now =
    Date.now();

  let wait = 0;

  for (const rule of rules) {
    const bucket =
      buckets.get(rule.key);

    if (
      !bucket ||
      bucket.resetAt <= now
    ) {
      continue;
    }

    if (bucket.count >= rule.limit) {
      wait =
        Math.max(
          wait,
          Math.ceil(
            (bucket.resetAt - now) /
              1000,
          ),
        );
    }
  }

  return wait;
}

export function recordFailure(
  rules: ThrottleRule[],
) {
  const now =
    Date.now();

  sweep(now);

  for (const rule of rules) {
    const bucket =
      buckets.get(rule.key);

    if (
      !bucket ||
      bucket.resetAt <= now
    ) {
      buckets.set(rule.key, {
        count: 1,
        resetAt:
          now + rule.windowMs,
      });
    } else {
      bucket.count += 1;
    }
  }
}

export function clearAccountFailures(
  rules: ThrottleRule[],
) {
  for (const rule of rules) {
    if (rule.key.includes(":acct:")) {
      buckets.delete(rule.key);
    }
  }
}

export function tooManyAttemptsMessage(
  waitSeconds: number,
) {
  const minutes =
    Math.max(
      1,
      Math.ceil(waitSeconds / 60),
    );

  return `Too many attempts. Try again in ${minutes} minute${minutes === 1 ? "" : "s"}.`;
}
