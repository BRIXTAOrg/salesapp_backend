process.env.BRIXTA_BACKEND_EDITION =
  process.env.BRIXTA_BACKEND_EDITION ??
  "qr-voucher-rewards";

process.env.BRIXTA_INTEGRATION_WORKER =
  process.env.BRIXTA_INTEGRATION_WORKER ??
  "1";

await import(
  "./start-production.mjs"
);
