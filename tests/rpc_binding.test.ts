import { beforeEach, describe, expect, it } from 'vitest';
import { env } from 'cloudflare:test';

// The Workers Vitest pool provides isolated local D1 and a mocked BEEMAX_CORE
// service binding for each test run. This exercises the bindings without
// contacting production Cloudflare resources or BEEMAX.
describe('Portal-OS 1 and planetary-max binding integration', () => {
  beforeEach(async () => {
    await env.DB.exec(`
      CREATE TABLE IF NOT EXISTS maxx_tracker_entries (
        entry_id INTEGER PRIMARY KEY AUTOINCREMENT,
        input_type TEXT NOT NULL,
        content TEXT NOT NULL,
        shadow_tag TEXT DEFAULT 'I-AGAINST-I',
        created_at TEXT NOT NULL
      );
    `);
  });

  it('writes and reads a shadow-work entry in isolated D1', async () => {
    const createdAt = new Date().toISOString();
    await env.DB.prepare(
      `INSERT INTO maxx_tracker_entries (input_type, content, shadow_tag, created_at)
       VALUES (?, ?, ?, ?)`,
    )
      .bind('INTENT', 'Initial edge telemetry sync', 'I-AGAINST-I', createdAt)
      .run();

    const result = await env.DB.prepare(
      'SELECT content FROM maxx_tracker_entries WHERE shadow_tag = ?',
    )
      .bind('I-AGAINST-I')
      .first<{ content: string }>();

    expect(result?.content).toBe('Initial edge telemetry sync');
  });

  it('calls the mocked BEEMAX_CORE service binding', async () => {
    const request = new Request('https://beemax-internal/api/health', { method: 'GET' });
    const response = await env.BEEMAX_CORE.fetch(request);

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ status: 'ok', service: 'beemax-mock-worker' });
  });
});
