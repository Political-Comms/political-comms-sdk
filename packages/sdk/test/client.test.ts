import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { PoliticalCommsClient, PoliticalCommsError } from '../src/index';

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function jsonResponse(status: number, body: unknown, headers: Record<string, string> = {}): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json', ...headers },
  });
}

function okResponse(data: unknown = [], headers: Record<string, string> = {}): Response {
  return jsonResponse(200, { success: true, data }, headers);
}

function errorResponse(status: number, code: string, headers: Record<string, string> = {}): Response {
  return jsonResponse(status, { success: false, error: `error: ${code}`, code, statusCode: status }, headers);
}

function makeClient(fetchMock: typeof fetch, maxRetries?: number): PoliticalCommsClient {
  return new PoliticalCommsClient({ apiKey: 'pc_live_test', fetch: fetchMock, maxRetries });
}

describe('constructor', () => {
  it('throws a clear error when no API key is available', () => {
    const saved = process.env.POLITICAL_COMMS_API_KEY;
    delete process.env.POLITICAL_COMMS_API_KEY;
    try {
      expect(() => new PoliticalCommsClient()).toThrowError(/POLITICAL_COMMS_API_KEY/);
    } finally {
      if (saved !== undefined) process.env.POLITICAL_COMMS_API_KEY = saved;
    }
  });

  it('falls back to the POLITICAL_COMMS_API_KEY environment variable', async () => {
    const saved = process.env.POLITICAL_COMMS_API_KEY;
    process.env.POLITICAL_COMMS_API_KEY = 'pc_live_from_env';
    try {
      const fetchMock = vi.fn(async () => okResponse());
      const client = new PoliticalCommsClient({ fetch: fetchMock as unknown as typeof fetch });
      await client.listOrganizations();
      const [, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
      expect((init.headers as Record<string, string>)['X-API-Key']).toBe('pc_live_from_env');
    } finally {
      if (saved !== undefined) process.env.POLITICAL_COMMS_API_KEY = saved;
      else delete process.env.POLITICAL_COMMS_API_KEY;
    }
  });
});

describe('auth and headers', () => {
  it('sends the API key in the X-API-Key header', async () => {
    const fetchMock = vi.fn(async () => okResponse());
    const client = makeClient(fetchMock as unknown as typeof fetch);
    await client.listOrganizations();
    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe('https://api.politicalcomms.com/v1/organizations');
    expect((init.headers as Record<string, string>)['X-API-Key']).toBe('pc_live_test');
  });

  it('does not send an Idempotency-Key on GET requests', async () => {
    const fetchMock = vi.fn(async () => okResponse());
    const client = makeClient(fetchMock as unknown as typeof fetch);
    await client.listBrands();
    const [, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect((init.headers as Record<string, string>)['Idempotency-Key']).toBeUndefined();
  });
});

describe('idempotency keys', () => {
  it('auto-generates a UUID Idempotency-Key on POST', async () => {
    const fetchMock = vi.fn(async () => okResponse({}));
    const client = makeClient(fetchMock as unknown as typeof fetch);
    await client.createProject({
      organization_id: 'org_1',
      phone_number_ids: ['pn_1'],
      name: 'Turnout wave 1',
      protocol: 'sms',
      contact_list_ids: ['cl_1'],
      message_text: 'Hello',
    });
    const [, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect((init.headers as Record<string, string>)['Idempotency-Key']).toMatch(UUID_RE);
  });

  it('uses the caller-provided idempotency key on PATCH', async () => {
    const fetchMock = vi.fn(async () => okResponse({}));
    const client = makeClient(fetchMock as unknown as typeof fetch);
    await client.updateProject('proj_1', { name: 'Renamed' }, { idempotencyKey: 'my-key-1' });
    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe('https://api.politicalcomms.com/v1/projects/proj_1');
    expect(init.method).toBe('PATCH');
    expect((init.headers as Record<string, string>)['Idempotency-Key']).toBe('my-key-1');
  });

  it('replays the same auto-generated key across retries', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(errorResponse(503, 'UPSTREAM_UNAVAILABLE'))
      .mockResolvedValueOnce(okResponse({}));
    vi.useFakeTimers();
    try {
      const client = makeClient(fetchMock as unknown as typeof fetch);
      const promise = client.testProject('proj_1', { test_contacts: [{ phone: '+15555550100' }] });
      await vi.advanceTimersByTimeAsync(2_000);
      await promise;
      const keys = fetchMock.mock.calls.map(
        (call) => ((call as unknown as [string, RequestInit])[1].headers as Record<string, string>)['Idempotency-Key'],
      );
      expect(keys[0]).toMatch(UUID_RE);
      expect(keys[1]).toBe(keys[0]);
    } finally {
      vi.useRealTimers();
    }
  });
});

describe('error mapping', () => {
  it('maps API error bodies to PoliticalCommsError without retrying 4xx', async () => {
    const fetchMock = vi.fn(async () =>
      jsonResponse(404, { success: false, error: 'Project not found', code: 'NOT_FOUND', statusCode: 404 }),
    );
    const client = makeClient(fetchMock as unknown as typeof fetch);
    const err = await client.getProject('missing').catch((e: unknown) => e);
    expect(err).toBeInstanceOf(PoliticalCommsError);
    const pcErr = err as PoliticalCommsError;
    expect(pcErr.message).toBe('Project not found');
    expect(pcErr.code).toBe('NOT_FOUND');
    expect(pcErr.statusCode).toBe(404);
    expect(pcErr.body).toEqual({ success: false, error: 'Project not found', code: 'NOT_FOUND', statusCode: 404 });
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it.each([400, 401, 403])('never retries %i responses', async (status) => {
    const fetchMock = vi.fn(async () => errorResponse(status, 'NO_RETRY'));
    const client = makeClient(fetchMock as unknown as typeof fetch);
    await expect(client.listOrganizations()).rejects.toMatchObject({ statusCode: status });
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('wraps non-JSON error bodies with a fallback code and message', async () => {
    const fetchMock = vi.fn(async () => new Response('Bad gateway', { status: 502 }));
    const client = makeClient(fetchMock as unknown as typeof fetch, 0);
    const err = (await client.listOrganizations().catch((e: unknown) => e)) as PoliticalCommsError;
    expect(err.code).toBe('HTTP_502');
    expect(err.statusCode).toBe(502);
    expect(err.body).toBe('Bad gateway');
  });

  it('wraps network failures as NETWORK_ERROR with statusCode 0', async () => {
    const fetchMock = vi.fn(async () => {
      throw new TypeError('fetch failed');
    });
    const client = makeClient(fetchMock as unknown as typeof fetch);
    const err = (await client.listOrganizations().catch((e: unknown) => e)) as PoliticalCommsError;
    expect(err).toBeInstanceOf(PoliticalCommsError);
    expect(err.code).toBe('NETWORK_ERROR');
    expect(err.statusCode).toBe(0);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});

describe('rate limiting', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-01-01T00:00:00Z'));
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it('waits until X-RateLimit-Reset before retrying a 429', async () => {
    const resetAt = Math.floor(Date.now() / 1_000) + 30;
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(
        errorResponse(429, 'RATE_LIMIT_EXCEEDED', {
          'X-RateLimit-Limit': '100',
          'X-RateLimit-Remaining': '0',
          'X-RateLimit-Reset': String(resetAt),
        }),
      )
      .mockResolvedValueOnce(
        okResponse([], {
          'X-RateLimit-Limit': '100',
          'X-RateLimit-Remaining': '99',
          'X-RateLimit-Reset': String(resetAt + 3_600),
        }),
      );
    const client = makeClient(fetchMock as unknown as typeof fetch);

    const promise = client.listOrganizations();
    // Attach handlers up front so an early rejection cannot go unhandled.
    const settled = promise.then((r) => r);

    await vi.advanceTimersByTimeAsync(29_000);
    expect(fetchMock).toHaveBeenCalledTimes(1);

    await vi.advanceTimersByTimeAsync(2_000);
    const result = await settled;
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(result.success).toBe(true);
    expect(client.lastRateLimit).toEqual({ limit: 100, remaining: 99, reset: resetAt + 3_600 });
  });

  it('exposes rate limit headers on lastRateLimit after every response', async () => {
    const fetchMock = vi.fn(async () =>
      okResponse([], {
        'X-RateLimit-Limit': '100',
        'X-RateLimit-Remaining': '42',
        'X-RateLimit-Reset': '1767225600',
      }),
    );
    const client = makeClient(fetchMock as unknown as typeof fetch);
    expect(client.lastRateLimit).toBeNull();
    await client.listOrganizations();
    expect(client.lastRateLimit).toEqual({ limit: 100, remaining: 42, reset: 1767225600 });
  });
});

describe('5xx backoff', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it('retries 500/502/503 with backoff and eventually succeeds', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(errorResponse(500, 'INTERNAL_ERROR'))
      .mockResolvedValueOnce(errorResponse(502, 'BAD_GATEWAY'))
      .mockResolvedValueOnce(errorResponse(503, 'UPSTREAM_UNAVAILABLE'))
      .mockResolvedValueOnce(okResponse([{ id: 'org_1' }]));
    const client = makeClient(fetchMock as unknown as typeof fetch);

    const promise = client.listOrganizations();
    // Delays are jittered but bounded by 1s + 2s + 4s.
    await vi.advanceTimersByTimeAsync(8_000);
    const result = await promise;
    expect(fetchMock).toHaveBeenCalledTimes(4);
    expect(result.data).toEqual([{ id: 'org_1' }]);
  });

  it('gives up after maxRetries and throws the last error', async () => {
    const fetchMock = vi.fn(async () => errorResponse(500, 'INTERNAL_ERROR'));
    const client = makeClient(fetchMock as unknown as typeof fetch, 2);

    const outcome = client.listOrganizations().then(
      () => 'resolved',
      (e: unknown) => e,
    );
    await vi.advanceTimersByTimeAsync(10_000);
    const err = (await outcome) as PoliticalCommsError;
    expect(err).toBeInstanceOf(PoliticalCommsError);
    expect(err.statusCode).toBe(500);
    expect(fetchMock).toHaveBeenCalledTimes(3);
  });
});

describe('endpoint serialization', () => {
  it('serializes query params for getAllProjectStats and omits undefined ones', async () => {
    const fetchMock = vi.fn(async () => okResponse({}));
    const client = makeClient(fetchMock as unknown as typeof fetch);
    await client.getAllProjectStats({
      startDate: '2026-06-01',
      endDate: '2026-06-30',
      organizationId: 'org_1',
      status: 'active',
    });
    const [url] = fetchMock.mock.calls[0] as unknown as [string];
    const parsed = new URL(url);
    expect(parsed.pathname).toBe('/v1/projects/stats');
    expect(parsed.searchParams.get('startDate')).toBe('2026-06-01');
    expect(parsed.searchParams.get('endDate')).toBe('2026-06-30');
    expect(parsed.searchParams.get('organizationId')).toBe('org_1');
    expect(parsed.searchParams.get('status')).toBe('active');
    expect(parsed.searchParams.has('brandId')).toBe(false);
    expect(parsed.searchParams.has('campaignId')).toBe(false);
  });

  it('uses spec query names for listPhoneNumbers (snake_case)', async () => {
    const fetchMock = vi.fn(async () => okResponse([]));
    const client = makeClient(fetchMock as unknown as typeof fetch);
    await client.listPhoneNumbers({ organization_id: 'org_1', channel: 'toll-free', owner_type: 'unassigned' });
    const parsed = new URL((fetchMock.mock.calls[0] as unknown as [string])[0]);
    expect(parsed.pathname).toBe('/v1/phone-numbers');
    expect(parsed.searchParams.get('organization_id')).toBe('org_1');
    expect(parsed.searchParams.get('channel')).toBe('toll-free');
    expect(parsed.searchParams.get('owner_type')).toBe('unassigned');
  });

  it('encodes path params and serializes JSON bodies for scheduleProject', async () => {
    const fetchMock = vi.fn(async () => okResponse({}));
    const client = makeClient(fetchMock as unknown as typeof fetch);
    await client.scheduleProject('proj/1', {
      scheduled_at: '2026-07-04T09:00:00Z',
      scheduled_timezone: 'America/New_York',
    });
    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe('https://api.politicalcomms.com/v1/projects/proj%2F1/schedule');
    expect(init.method).toBe('POST');
    expect((init.headers as Record<string, string>)['Content-Type']).toBe('application/json');
    expect(JSON.parse(init.body as string)).toEqual({
      scheduled_at: '2026-07-04T09:00:00Z',
      scheduled_timezone: 'America/New_York',
    });
  });

  it('sends POST without a body for unscheduleProject', async () => {
    const fetchMock = vi.fn(async () => okResponse({}));
    const client = makeClient(fetchMock as unknown as typeof fetch);
    await client.unscheduleProject('proj_1');
    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe('https://api.politicalcomms.com/v1/projects/proj_1/unschedule');
    expect(init.method).toBe('POST');
    expect(init.body).toBeUndefined();
    expect((init.headers as Record<string, string>)['Idempotency-Key']).toMatch(UUID_RE);
  });

  it('respects a custom baseUrl', async () => {
    const fetchMock = vi.fn(async () => okResponse([]));
    const client = new PoliticalCommsClient({
      apiKey: 'pc_live_test',
      baseUrl: 'https://staging.example.com/v1/',
      fetch: fetchMock as unknown as typeof fetch,
    });
    await client.listOrganizations();
    expect((fetchMock.mock.calls[0] as unknown as [string])[0]).toBe(
      'https://staging.example.com/v1/organizations',
    );
  });
});

describe('media', () => {
  const MEDIA_URL =
    'https://media.politicalcomms.com/org-1/brand-1/rally-photo_image_5d2b8f4a.jpg';

  it('surfaces url and the stored-file metadata on the list', async () => {
    const fetchMock = vi.fn(async () =>
      okResponse([
        {
          id: 'media_1',
          name: 'rally-photo.jpg',
          org_id: 'org-1',
          created_at: '2026-07-27T00:00:00.000Z',
          url: MEDIA_URL,
          storage_key: 'org-1/brand-1/rally-photo_image_5d2b8f4a.jpg',
          file_size_bytes: 482133,
          content_type: 'image/jpeg',
          status: 'ready',
          uploaded_via_api: true,
        },
      ]),
    );
    const client = makeClient(fetchMock as unknown as typeof fetch);
    const res = await client.listMedia();

    expect((fetchMock.mock.calls[0] as unknown as [string])[0]).toBe(
      'https://api.politicalcomms.com/v1/media',
    );
    // Typed access, not an index-signature `unknown` escape hatch.
    const file = res.data[0]!;
    expect(file.url).toBe(MEDIA_URL);
    expect(file.status).toBe('ready');
    expect(file.content_type).toBe('image/jpeg');
    expect(file.file_size_bytes).toBe(482133);
  });

  it('models a null url while the file is still optimizing', async () => {
    const fetchMock = vi.fn(async () =>
      okResponse([{ id: 'media_2', name: 'clip.mov', url: null, status: 'optimizing' }]),
    );
    const client = makeClient(fetchMock as unknown as typeof fetch);
    const file = (await client.listMedia()).data[0]!;

    expect(file.url).toBeNull();
    expect(file.status).toBe('optimizing');
  });

  it('exposes url on the single-media read too', async () => {
    const fetchMock = vi.fn(async () =>
      okResponse({ media_id: 'media_1', status: 'ready', url: MEDIA_URL }),
    );
    const client = makeClient(fetchMock as unknown as typeof fetch);
    const res = await client.getMedia('media_1');

    expect((fetchMock.mock.calls[0] as unknown as [string])[0]).toBe(
      'https://api.politicalcomms.com/v1/media/media_1',
    );
    expect(res.data.url).toBe(MEDIA_URL);
  });

  it('forwards the organization and brand filters', async () => {
    const fetchMock = vi.fn(async () => okResponse([]));
    const client = makeClient(fetchMock as unknown as typeof fetch);
    await client.listMedia({ organization_id: 'org-1', brand_id: 'brand-1' });

    const [url] = fetchMock.mock.calls[0] as unknown as [string];
    expect(url).toContain('organization_id=org-1');
    expect(url).toContain('brand_id=brand-1');
  });
});

describe('deletes', () => {
  it('deleteContactList issues DELETE and unwraps the response', async () => {
    const fetchMock = vi.fn(async () =>
      okResponse({ list_id: 'cl_1', name: 'Voters', deleted: true }),
    );
    const client = makeClient(fetchMock as unknown as typeof fetch);
    const res = await client.deleteContactList('cl_1');

    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe('https://api.politicalcomms.com/v1/contact-lists/cl_1');
    expect(init.method).toBe('DELETE');
    expect(init.body).toBeUndefined();
    expect(res.data.deleted).toBe(true);
    expect(res.data.list_id).toBe('cl_1');
  });

  it('deleteMedia issues DELETE and unwraps the response', async () => {
    const fetchMock = vi.fn(async () =>
      okResponse({ media_id: 'media_1', name: 'rally-photo.jpg', deleted: true }),
    );
    const client = makeClient(fetchMock as unknown as typeof fetch);
    const res = await client.deleteMedia('media_1');

    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe('https://api.politicalcomms.com/v1/media/media_1');
    expect(init.method).toBe('DELETE');
    expect(res.data.media_id).toBe('media_1');
    expect(res.data.deleted).toBe(true);
  });

  it('sends a caller-provided Idempotency-Key on DELETE', async () => {
    const fetchMock = vi.fn(async () => okResponse({ list_id: 'cl_1', deleted: true }));
    const client = makeClient(fetchMock as unknown as typeof fetch);
    await client.deleteContactList('cl_1', { idempotencyKey: 'delete-key-1' });
    const [, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect((init.headers as Record<string, string>)['Idempotency-Key']).toBe('delete-key-1');
  });

  it('does not auto-generate an Idempotency-Key on DELETE', async () => {
    const fetchMock = vi.fn(async () => okResponse({ media_id: 'media_1', deleted: true }));
    const client = makeClient(fetchMock as unknown as typeof fetch);
    await client.deleteMedia('media_1');
    const [, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect((init.headers as Record<string, string>)['Idempotency-Key']).toBeUndefined();
  });

  it('surfaces 409 in-use conflicts as PoliticalCommsError with the details body', async () => {
    const body = {
      success: false,
      error: 'Contact list is in use',
      code: 'CONTACT_LIST_IN_USE',
      statusCode: 409,
      details: { projects: [{ id: 'proj_1', name: 'GOTV', status: 'draft' }] },
    };
    const fetchMock = vi.fn(async () => jsonResponse(409, body));
    const client = makeClient(fetchMock as unknown as typeof fetch);
    const err = (await client.deleteContactList('cl_1').catch((e: unknown) => e)) as PoliticalCommsError;
    expect(err).toBeInstanceOf(PoliticalCommsError);
    expect(err.code).toBe('CONTACT_LIST_IN_USE');
    expect(err.statusCode).toBe(409);
    expect(err.body).toEqual(body);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});

describe('project copy and archive', () => {
  it('copyProject POSTs with no body and unwraps the draft copy', async () => {
    const fetchMock = vi.fn(async () =>
      jsonResponse(201, {
        success: true,
        data: {
          project_id: 'proj_2',
          name: 'GOTV_v2',
          type: 'broadcast',
          status: 'draft',
          channel: '10dlc',
          created_via_api: true,
          estimated_cost_cents: 0,
          total_recipients: 0,
          completeness: { has_list: false, has_message: true, has_phone_number: true, ready_to_test: false },
        },
      }),
    );
    const client = makeClient(fetchMock as unknown as typeof fetch);
    const res = await client.copyProject('proj_1');

    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe('https://api.politicalcomms.com/v1/projects/proj_1/copy');
    expect(init.method).toBe('POST');
    expect(init.body).toBeUndefined();
    expect((init.headers as Record<string, string>)['Idempotency-Key']).toMatch(UUID_RE);
    expect(res.data.name).toBe('GOTV_v2');
    expect(res.data.status).toBe('draft');
    expect(res.data.completeness?.has_list).toBe(false);
  });

  it('archiveProject POSTs with no body and unwraps the archived state', async () => {
    const fetchMock = vi.fn(async () =>
      okResponse({ project_id: 'proj_1', status: 'archived', archived_at: '2026-07-29T00:00:00.000Z' }),
    );
    const client = makeClient(fetchMock as unknown as typeof fetch);
    const res = await client.archiveProject('proj_1');

    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe('https://api.politicalcomms.com/v1/projects/proj_1/archive');
    expect(init.method).toBe('POST');
    expect(init.body).toBeUndefined();
    expect(res.data.status).toBe('archived');
    expect(res.data.archived_at).toBe('2026-07-29T00:00:00.000Z');
  });
});

describe('projects list and create options', () => {
  it('serializes archived as the strings true and false', async () => {
    const fetchMock = vi.fn(async () => okResponse([]));
    const client = makeClient(fetchMock as unknown as typeof fetch);

    await client.listProjects({ archived: true });
    await client.listProjects({ archived: false });
    await client.listProjects({});

    const urls = fetchMock.mock.calls.map((call) => new URL((call as unknown as [string])[0]));
    expect(urls[0]!.searchParams.get('archived')).toBe('true');
    expect(urls[1]!.searchParams.get('archived')).toBe('false');
    expect(urls[2]!.searchParams.has('archived')).toBe(false);
  });

  it('serializes the type filter and omits it when not set', async () => {
    const fetchMock = vi.fn(async () => okResponse([]));
    const client = makeClient(fetchMock as unknown as typeof fetch);

    await client.listProjects({ type: 'survey' });
    await client.listProjects({});

    const urls = fetchMock.mock.calls.map((call) => new URL((call as unknown as [string])[0]));
    expect(urls[0]!.searchParams.get('type')).toBe('survey');
    expect(urls[1]!.searchParams.has('type')).toBe(false);
  });

  it('accepts createProject without contact_list_ids', async () => {
    const fetchMock = vi.fn(async () => okResponse({ project_id: 'proj_9', status: 'draft' }));
    const client = makeClient(fetchMock as unknown as typeof fetch);
    await client.createProject({
      organization_id: 'org_1',
      phone_number_ids: ['pn_1'],
      name: 'List attached later',
      protocol: 'sms',
      message_text: 'Hello',
    });
    const [, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(JSON.parse(init.body as string)).not.toHaveProperty('contact_list_ids');
  });
});
