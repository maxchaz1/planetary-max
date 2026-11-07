import { defineWorkersConfig } from '@cloudflare/vitest-pool-workers/config';

export default defineWorkersConfig({
  test: {
    poolOptions: {
      workers: {
        wrangler: { configPath: './wrangler.toml' },
        miniflare: {
          d1Databases: ['DB'],
          serviceBindings: {
            BEEMAX_CORE: async (request: Request) => {
              const url = new URL(request.url);
              if (url.pathname === '/api/health' && request.method === 'GET') {
                return Response.json({ status: 'ok', service: 'beemax-mock-worker' });
              }
              return Response.json({ error: 'Not found' }, { status: 404 });
            },
          },
        },
      },
    },
  },
});
