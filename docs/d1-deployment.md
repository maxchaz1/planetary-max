# Planetary-Max Worker and D1 state

The Worker stores its session, SIM, TEC, and universe substrate in the `DB` D1 binding. R2 is not used by the Worker configuration or substrate runtime. Apply the repository migration before deployment:

```sh
npx wrangler d1 migrations apply DB --remote
npm test
npm run check
npx wrangler deploy --dry-run
npx wrangler deploy
```

The D1 migration creates the substrate state table as well as the macro snapshot and telemetry tables. Existing data in a previous R2 bucket is not automatically copied; migrate it separately before removing that bucket if it must be retained.
