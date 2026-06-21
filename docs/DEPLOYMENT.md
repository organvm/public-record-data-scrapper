# Deployment Gate

This checklist covers the security-hardening prerequisites from PR #234 / issue #235.
Run it before promoting a production deploy.

## Required Sequence

1. Provision production secrets in the deployment secret store:
   - `JWT_SECRET`
   - `DATABASE_URL`
   - `CORS_ORIGIN`
   - `STRIPE_WEBHOOK_SECRET`
   - `TWILIO_AUTH_TOKEN`
   - `SENDGRID_WEBHOOK_VERIFICATION_KEY`
   - `PLAID_CLIENT_ID`
   - `PLAID_SECRET`
2. Configure Auth0/access-token issuance so tokens include an `org_id` claim.
   Namespaced claims ending in `/org_id` or `/orgId` are supported. Set
   `JWT_ORG_CLAIM` only when the direct claim name differs from `org_id`.
3. Confirm the product mapping from `organizations.subscription_tier` to the app
   data tier. Current code maps `free` to `free-tier`; `starter`,
   `professional`, and `enterprise` map to `starter-tier`.
4. Run database migrations `014` through `019` with a migration/owner role:

   ```bash
   DATABASE_URL="$MIGRATION_DATABASE_URL" npm run db:migrate
   ```

5. Run the app with a dedicated non-owner Postgres role. RLS from migration
   `018` only protects tenant rows when the app role is not the table owner and
   does not have `BYPASSRLS`.
6. Verify the deploy gate with the app role's production environment:

   ```bash
   JWT_ORG_CLAIM_CONFIRMED=true \
   DATA_TIER_MAPPING_CONFIRMED=true \
   DATABASE_URL="$APP_DATABASE_URL" \
   npm run deploy:verify
   ```

   Instead of `JWT_ORG_CLAIM_CONFIRMED=true`, you may provide
   `DEPLOY_PREREQ_ACCESS_TOKEN` containing a representative access token; the
   verifier decodes it and checks for an `org_id`/`orgId` claim shape.

## Notes

- `PLAID_WEBHOOK_SECRET` is intentionally not required. Plaid webhooks are
  verified with ES256 JWT signatures by fetching JWKs through `PLAID_CLIENT_ID`
  and `PLAID_SECRET`.
- Run `deploy:verify` after migrations, because it checks the database state:
  hardening migrations, RLS helper/policies, and whether the app DB role would
  bypass RLS as an owner, superuser, or `BYPASSRLS` role.
- `TRUST_PROXY=1` means trust one proxy hop. Avoid `TRUST_PROXY=true` unless the
  network path is fully controlled.
