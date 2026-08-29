import {
  evaluateConditionGroup,
  readPath,
} from "../src/platform/kernel/evaluator";

const world: any = {
  responsibilityId: 1,
  actorUserId: 1,
  subjectUserId: 1,
  context: {},
  state: {},
  objects: {},
  actors: {},
  captures: {},
  queries: {},
  computed: {},
  history: {},
};

function metric(
  kind: string,
  size: number,
  fn: () => unknown,
) {
  const before =
    process.memoryUsage().rss;

  const started =
    performance.now();

  let ok = true;

  try {
    fn();
  } catch {
    ok = false;
  }

  const elapsed =
    performance.now() - started;

  const after =
    process.memoryUsage().rss;

  console.log(
    "BRIXTA_KERNEL_METRIC " +
      JSON.stringify({
        kind,
        size,
        ok,
        elapsedMs:
          Math.round(elapsed * 100) / 100,
        rssDeltaMb:
          Math.round(
            ((after - before) /
              1024 /
              1024) *
              100,
          ) / 100,
      }),
  );
}

for (
  const size of
  [256, 1000, 10000, 100000]
) {
  const conditions =
    Array.from(
      { length: size },
      () => ({
        left: {
          kind: "literal",
          value: 1,
        },
        operator: "eq",
        right: {
          kind: "literal",
          value: 1,
        },
      }),
    );

  metric(
    "condition_group",
    size,
    () =>
      evaluateConditionGroup(
        world,
        {
          mode: "all",
          conditions,
        } as any,
      ),
  );
}

for (
  const segments of
  [64, 512, 5000, 50000]
) {
  const path =
    Array.from(
      { length: segments },
      () => "x",
    ).join(".");

  metric(
    "path_segments",
    segments,
    () =>
      readPath(
        { x: 1 },
        path,
      ),
  );
}
