# BRIXTA Sales App Backend

BRIXTA Responsibility Runtime and QR Rewards backend.

## Security

Never commit credentials to this repository.

Runtime secrets must be supplied through the deployment environment or
approved secret manager.

Required core environment variables include:

- DATABASE_URL
- JWT_SECRET
- SUPABASE_URL
- SUPABASE_ANON_KEY
- SUPABASE_SERVICE_ROLE_KEY
- SUPABASE_BUCKET_NAME
- ADMIN_SERVICE_SECRET

QR Rewards / Integration Runtime additionally uses:

- BRIXTA_INTEGRATION_SECRET_KEY
- BRIXTA_EXTERNAL_SESSION_SECRET
- BRIXTA_CLAIMANT_HASH_KEY
- BRIXTA_PII_SECRET_KEY

For the QR Rewards edition:

- BRIXTA_BACKEND_EDITION=qr-voucher-rewards
- BRIXTA_INTEGRATION_WORKER=1
- BRIXTA_PAYOUT_PROVIDER=sandbox

Set BRIXTA_PAYOUT_PROVIDER=integration only after a published payout
Integration has passed sandbox certification.
