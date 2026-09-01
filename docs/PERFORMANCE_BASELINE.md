# BRIXTA Performance Baseline

Generated: `2026-09-01T06:56:02.875617+00:00`

This is a local production-mode baseline captured through the real HTTP stack.
It includes authentication, tenant database resolution, bootstrap/workspace
resolution, and Kernel runtime where an assigned Responsibility was available.

| Path | p50 | p95 | p99 | Samples |
| --- | ---: | ---: | ---: | ---: |
| Raw Express / | 0.12 ms | 0.16 ms | 0.18 ms | 50 |
| Login + DB write | 491.41 ms | 497.35 ms | 497.35 ms | 5 |
| Bootstrap + DB write | 3139.88 ms | 3316.78 ms | 3316.78 ms | 12 |
| Sync state | 373.33 ms | 382.21 ms | 382.21 ms | 20 |
| My work | 158.06 ms | 163.92 ms | 163.92 ms | 15 |
| Published manifest | 376.21 ms | 386.72 ms | 386.72 ms | 15 |
| Kernel runtime | 1762.94 ms | 1784.15 ms | 1784.15 ms | 20 |

Responsibility used for Kernel runtime: `leave`.

## Mutation / Pixel Logic

Not executed automatically. A real Kernel mutation requires explicit `BRIXTA_PERF_ALLOW_MUTATION=1`.

The benchmark deliberately never invents or auto-executes a business mutation.
That prevents attendance, approvals, financial effects, or other real business
actions from being changed merely for a benchmark.

## Reproduce

```bash
npm run build
npm run perf:e2e
```

Credentials are prompted locally and are not written to this file.
