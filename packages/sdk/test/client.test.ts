import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { PoliticalCommsClient, PoliticalCommsError } from '../src/index';
import type { ProjectFollowUps } from '../src/index';

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

describe('contact list download', () => {
  it('GETs the download endpoint with the type and returns the CSV text', async () => {
    const csv = 'Phone Number,Original Row\n+15555550100,1\n';
    const fetchMock = vi.fn(async () => new Response(csv, { status: 200, headers: { 'Content-Type': 'text/csv' } }));
    const client = makeClient(fetchMock as unknown as typeof fetch);
    const text = await client.downloadContactList('cl_1', 'original');
    expect(text).toBe(csv);
    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe('https://api.politicalcomms.com/v1/contact-lists/cl_1/download?type=original');
    const headers = init.headers as Record<string, string>;
    expect(headers.Accept).toBe('text/csv');
    expect(headers['Idempotency-Key']).toBeUndefined();
  });

  it('maps a 409 ANALYSIS_NOT_COMPLETE to PoliticalCommsError', async () => {
    const fetchMock = vi.fn(async () => errorResponse(409, 'ANALYSIS_NOT_COMPLETE'));
    const client = makeClient(fetchMock as unknown as typeof fetch);
    await expect(client.downloadContactList('cl_1', 'analyzed')).rejects.toMatchObject({
      code: 'ANALYSIS_NOT_COMPLETE',
      statusCode: 409,
    });
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

  it('sends the sending-setup fields on PATCH', async () => {
    const fetchMock = vi.fn(async () => okResponse({}));
    const client = makeClient(fetchMock as unknown as typeof fetch);
    await client.updateProject('proj_1', {
      channel: 'toll-free',
      toll_free_verification_id: 'tfv_1',
      phone_number_ids: ['pn_1'],
    });
    const [, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(JSON.parse(init.body as string)).toEqual({
      channel: 'toll-free',
      toll_free_verification_id: 'tfv_1',
      phone_number_ids: ['pn_1'],
    });
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

  it('prefers Retry-After over X-RateLimit-Reset on a 429', async () => {
    const resetAt = Math.floor(Date.now() / 1_000) + 30; // a skewed or stale Reset
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(
        errorResponse(429, 'RATE_LIMIT_EXCEEDED', {
          'Retry-After': '3',
          'X-RateLimit-Limit': '600',
          'X-RateLimit-Remaining': '0',
          'X-RateLimit-Reset': String(resetAt),
        }),
      )
      .mockResolvedValueOnce(okResponse([], { 'X-RateLimit-Limit': '600', 'X-RateLimit-Remaining': '599' }));
    const client = makeClient(fetchMock as unknown as typeof fetch);

    const settled = client.listOrganizations().then((r) => r);

    await vi.advanceTimersByTimeAsync(2_500);
    expect(fetchMock).toHaveBeenCalledTimes(1);

    await vi.advanceTimersByTimeAsync(1_000);
    const result = await settled;
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(result.success).toBe(true);
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
  it('getProjectSurveyResults GETs the survey-results path and returns the parsed data', async () => {
    const data = {
      project_id: 'proj_1',
      name: 'Voter survey',
      status: 'completed',
      total_recipients: 1000,
      completion_rate: 62.5,
      dropoff_rate: 37.5,
      results: [
        {
          question_id: 'q_1',
          sequence: 1,
          question_text: 'Will you vote?',
          question_type: 'multiple_choice',
          total_responses: 400,
          option_results: [
            { value: 1, label: 'Yes', count: 300, percentage: 75 },
            { value: 2, label: 'No', count: 60, percentage: 15 },
          ],
          other_count: 40,
          other_percentage: 10,
        },
      ],
    };
    const fetchMock = vi.fn(async () => okResponse(data));
    const client = makeClient(fetchMock as unknown as typeof fetch);
    const result = await client.getProjectSurveyResults('proj_1');
    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(new URL(url).pathname).toBe('/v1/projects/proj_1/survey-results');
    expect(init.method).toBe('GET');
    expect(result.data).toEqual(data);
  });

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

  it('encodes ids and hits the throughput paths', async () => {
    const fetchMock = vi.fn(async () => okResponse({}));
    const client = makeClient(fetchMock as unknown as typeof fetch);
    await client.getCampaignThroughput('camp/1');
    await client.getProjectThroughput('proj/1');
    const urls = fetchMock.mock.calls.map((c) => (c as unknown as [string])[0]);
    expect(urls[0]).toBe('https://api.politicalcomms.com/v1/campaigns/camp%2F1/throughput');
    expect(urls[1]).toBe('https://api.politicalcomms.com/v1/projects/proj%2F1/throughput');
    expect((fetchMock.mock.calls[0] as unknown as [string, RequestInit])[1].method).toBe('GET');
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

  it('sends daily_cap_bypass only when the caller sets it', async () => {
    // Opt-in to running past the brand's T-Mobile daily cap. Omitted means the
    // project pauses at the cap, which is the safe default - the SDK must not
    // invent the field.
    const fetchMock = vi.fn(async () => okResponse({}));
    const client = makeClient(fetchMock as unknown as typeof fetch);
    await client.scheduleProject('p1', {
      scheduled_at: '2026-07-04T09:00:00Z',
      scheduled_timezone: 'America/New_York',
      daily_cap_bypass: true,
    });
    const [, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(JSON.parse(init.body as string)).toEqual({
      scheduled_at: '2026-07-04T09:00:00Z',
      scheduled_timezone: 'America/New_York',
      daily_cap_bypass: true,
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

  it('sends POST without a body for pauseProject by default', async () => {
    const fetchMock = vi.fn(async () => okResponse({}));
    const client = makeClient(fetchMock as unknown as typeof fetch);
    await client.pauseProject('proj_1');
    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe('https://api.politicalcomms.com/v1/projects/proj_1/pause');
    expect(init.method).toBe('POST');
    expect(init.body).toBeUndefined();
    expect((init.headers as Record<string, string>)['Idempotency-Key']).toMatch(UUID_RE);
  });

  it('sends the reason as the body for pauseProject when given', async () => {
    const fetchMock = vi.fn(async () => okResponse({}));
    const client = makeClient(fetchMock as unknown as typeof fetch);
    await client.pauseProject('proj_1', { reason: 'Holding until the debate ends' });
    const [, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(JSON.parse(init.body as string)).toEqual({ reason: 'Holding until the debate ends' });
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

describe('contact list import', () => {
  it('posts an email-and-phone import with consent and an Idempotency-Key', async () => {
    const fetchMock = vi.fn(async () =>
      jsonResponse(202, {
        success: true,
        data: {
          list_id: 'cl_1',
          name: 'Donors',
          status: 'processing',
          total_rows: null,
          imported_via_api: true,
          purpose: 'audience',
          channels: ['text', 'email'],
          email_import: { id: 'imp_1', status: 'queued' },
        },
      }),
    );
    const client = makeClient(fetchMock as unknown as typeof fetch);
    const body = {
      source_url: 'https://example.com/donors.csv',
      list_name: 'Donors',
      phone_column: 'Phone',
      email_column: 'Email',
      consent: { source: 'donation_form' as const },
      email_domain_id: null,
    };
    const res = await client.importContactList(body);

    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe('https://api.politicalcomms.com/v1/contact-lists/import');
    expect(init.method).toBe('POST');
    expect(JSON.parse(init.body as string)).toEqual(body);
    expect((init.headers as Record<string, string>)['Idempotency-Key']).toMatch(UUID_RE);
    expect(res.data.purpose).toBe('audience');
    if (res.data.purpose === 'audience') expect(res.data.email_import?.id).toBe('imp_1');
  });

  it('returns no list id for a do_not_contact import', async () => {
    const fetchMock = vi.fn(async () =>
      jsonResponse(202, {
        success: true,
        data: { purpose: 'do_not_contact', name: 'DNC', status: 'processing', total_rows: 3, channels: ['email'] },
      }),
    );
    const client = makeClient(fetchMock as unknown as typeof fetch);
    const res = await client.importContactList({
      source_url: 'https://example.com/dnc.csv',
      list_name: 'DNC',
      purpose: 'do_not_contact',
      email_column: 'Email',
    });
    expect(res.data.purpose).toBe('do_not_contact');
    expect(res.data).not.toHaveProperty('list_id');
  });

  it('forwards the channel filter on listContactLists', async () => {
    const fetchMock = vi.fn(async () => okResponse([]));
    const client = makeClient(fetchMock as unknown as typeof fetch);
    await client.listContactLists({ channel: 'all' });
    const [url] = fetchMock.mock.calls[0] as unknown as [string];
    expect(url).toBe('https://api.politicalcomms.com/v1/contact-lists?channel=all');
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

describe('project copy', () => {
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
});

describe('projects list and create options', () => {
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

  it('passes a whole-URL link tracking destination and its fallback through unchanged', async () => {
    const fetchMock = vi.fn(async () => okResponse({ project_id: 'proj_10', status: 'awaiting_test' }));
    const client = makeClient(fetchMock as unknown as typeof fetch);
    await client.createProject({
      organization_id: 'org_1',
      phone_number_ids: ['pn_1'],
      name: 'Per-recipient links',
      protocol: 'sms',
      contact_list_ids: ['cl_1'],
      message_text: 'Hello {tracking_url}',
      link_tracking_enabled: true,
      link_tracking_domain_id: 'td_1',
      link_tracking_param_field: 'custom_url',
      link_tracking_destination_url: 'https://{custom_url}',
      link_tracking_fallback_url: 'https://example.com/fallback',
    });
    const [, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    const body = JSON.parse(init.body as string);
    expect(body.link_tracking_destination_url).toBe('https://{custom_url}');
    expect(body.link_tracking_fallback_url).toBe('https://example.com/fallback');
  });
});

describe('email templates', () => {
  it('serializes the list query and unwraps the cursor page', async () => {
    const fetchMock = vi.fn(async () =>
      okResponse({
        data: [{ id: 'tpl_1', name: 'GOTV', description: null, thumbnail_url: null }],
        has_more: true,
        next_cursor: 'cursor_2',
      }),
    );
    const client = makeClient(fetchMock as unknown as typeof fetch);
    const res = await client.listEmailTemplates({ limit: 100, cursor: 'cursor_1', search: 'gotv' });

    const parsed = new URL((fetchMock.mock.calls[0] as unknown as [string])[0]);
    expect(parsed.pathname).toBe('/v1/email/templates');
    expect(parsed.searchParams.get('limit')).toBe('100');
    expect(parsed.searchParams.get('cursor')).toBe('cursor_1');
    expect(parsed.searchParams.get('search')).toBe('gotv');
    expect(res.data.data[0]!.name).toBe('GOTV');
    expect(res.data.next_cursor).toBe('cursor_2');
  });

  it('omits unset list query params', async () => {
    const fetchMock = vi.fn(async () => okResponse({ data: [], has_more: false, next_cursor: null }));
    const client = makeClient(fetchMock as unknown as typeof fetch);
    await client.listEmailTemplates();

    const parsed = new URL((fetchMock.mock.calls[0] as unknown as [string])[0]);
    expect(parsed.searchParams.has('limit')).toBe(false);
    expect(parsed.searchParams.has('cursor')).toBe(false);
    expect(parsed.searchParams.has('search')).toBe(false);
  });

  it('encodes the id on the single-template read', async () => {
    const fetchMock = vi.fn(async () => okResponse({ id: 'tpl/1' }));
    const client = makeClient(fetchMock as unknown as typeof fetch);
    await client.getEmailTemplate('tpl/1');

    expect((fetchMock.mock.calls[0] as unknown as [string])[0]).toBe(
      'https://api.politicalcomms.com/v1/email/templates/tpl%2F1',
    );
  });

  it('surfaces lint findings alongside the created template', async () => {
    const fetchMock = vi.fn(async () =>
      jsonResponse(201, {
        success: true,
        data: {
          id: 'tpl_1',
          name: 'GOTV',
          description: null,
          content: {
            subject: 'Vote Tuesday',
            preheader: null,
            html: '<p>Vote</p>',
            text: null,
            editor: 'html',
          },
          thumbnail_url: null,
          lint: { errors: [{ code: 'MISSING_UNSUBSCRIBE' }], warnings: [] },
        },
      }),
    );
    const client = makeClient(fetchMock as unknown as typeof fetch);
    const res = await client.createEmailTemplate({
      name: 'GOTV',
      content: { subject: 'Vote Tuesday', html: '<p>Vote</p>' },
    });

    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe('https://api.politicalcomms.com/v1/email/templates');
    expect(init.method).toBe('POST');
    expect(JSON.parse(init.body as string).content.subject).toBe('Vote Tuesday');
    expect(res.data.content.editor).toBe('html');
    expect(res.data.lint?.errors).toHaveLength(1);
  });

});

describe('conversations', () => {
  it('serializes the list query and unwraps the cursor page', async () => {
    const fetchMock = vi.fn(async () =>
      okResponse({
        data: [{ conversation_id: 'conv_1', status: 'active', last_inbound_at: '2026-09-01T00:00:00Z' }],
        has_more: true,
        next_cursor: 'cursor_2',
      }),
    );
    const client = makeClient(fetchMock as unknown as typeof fetch);
    const res = await client.listConversations({
      project_id: 'proj_1',
      updated_since: '2026-08-25T00:00:00Z',
      include_test: true,
      limit: 100,
      cursor: 'cursor_1',
    });

    const parsed = new URL((fetchMock.mock.calls[0] as unknown as [string])[0]);
    expect(parsed.pathname).toBe('/v1/conversations');
    expect(parsed.searchParams.get('project_id')).toBe('proj_1');
    expect(parsed.searchParams.get('updated_since')).toBe('2026-08-25T00:00:00Z');
    expect(parsed.searchParams.get('include_test')).toBe('true');
    expect(parsed.searchParams.get('limit')).toBe('100');
    expect(parsed.searchParams.get('cursor')).toBe('cursor_1');
    expect(res.data.data[0]!.conversation_id).toBe('conv_1');
    expect(res.data.next_cursor).toBe('cursor_2');
  });

  it('omits unset list query params', async () => {
    const fetchMock = vi.fn(async () => okResponse({ data: [], has_more: false, next_cursor: null }));
    const client = makeClient(fetchMock as unknown as typeof fetch);
    await client.listConversations();

    const parsed = new URL((fetchMock.mock.calls[0] as unknown as [string])[0]);
    expect(parsed.searchParams.has('project_id')).toBe(false);
    expect(parsed.searchParams.has('updated_since')).toBe(false);
    expect(parsed.searchParams.has('include_test')).toBe(false);
    expect(parsed.searchParams.has('limit')).toBe(false);
    expect(parsed.searchParams.has('cursor')).toBe(false);
  });

  it('encodes the id on getConversation', async () => {
    const fetchMock = vi.fn(async () => okResponse({ conversation_id: 'conv/1', status: 'active' }));
    const client = makeClient(fetchMock as unknown as typeof fetch);
    await client.getConversation('conv/1');

    expect((fetchMock.mock.calls[0] as unknown as [string])[0]).toBe(
      'https://api.politicalcomms.com/v1/conversations/conv%2F1',
    );
  });

  it('serializes limit and cursor for listConversationMessages', async () => {
    const fetchMock = vi.fn(async () =>
      okResponse({
        data: [{ message_id: 'msg_1', direction: 'inbound', text: 'Hi', received_at: '2026-09-01T00:00:00Z' }],
        has_more: false,
        next_cursor: null,
      }),
    );
    const client = makeClient(fetchMock as unknown as typeof fetch);
    const res = await client.listConversationMessages('conv_1', { limit: 25, cursor: 'cursor_1' });

    const parsed = new URL((fetchMock.mock.calls[0] as unknown as [string])[0]);
    expect(parsed.pathname).toBe('/v1/conversations/conv_1/messages');
    expect(parsed.searchParams.get('limit')).toBe('25');
    expect(parsed.searchParams.get('cursor')).toBe('cursor_1');
    expect(res.data.data[0]!.direction).toBe('inbound');
  });

  it('replyToConversation POSTs the text body and auto-generates an Idempotency-Key', async () => {
    const fetchMock = vi.fn(async () =>
      jsonResponse(202, {
        success: true,
        data: {
          message_id: 'msg_2',
          conversation_id: 'conv_1',
          project_id: 'proj_1',
          from: '+15559876543',
          to: '+15551234567',
          text: 'Thanks for reaching out',
          created_at: '2026-09-07T10:00:00.000Z',
        },
      }),
    );
    const client = makeClient(fetchMock as unknown as typeof fetch);
    const res = await client.replyToConversation('conv_1', { text: 'Thanks for reaching out' });

    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe('https://api.politicalcomms.com/v1/conversations/conv_1/messages');
    expect(init.method).toBe('POST');
    expect(JSON.parse(init.body as string)).toEqual({ text: 'Thanks for reaching out' });
    expect((init.headers as Record<string, string>)['Idempotency-Key']).toMatch(UUID_RE);
    expect(res.data.message_id).toBe('msg_2');
  });

  it('replyToConversation sends media_ids with no text and returns media_urls', async () => {
    const fetchMock = vi.fn(async () =>
      jsonResponse(202, {
        success: true,
        data: { message_id: 'msg_4', text: '', media_urls: ['https://cdn.example.com/m/flyer.png'] },
      }),
    );
    const client = makeClient(fetchMock as unknown as typeof fetch);
    const res = await client.replyToConversation('conv_1', { media_ids: ['media_1'] });

    const [, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(JSON.parse(init.body as string)).toEqual({ media_ids: ['media_1'] });
    expect(res.data.media_urls).toEqual(['https://cdn.example.com/m/flyer.png']);
  });

  it('replyToConversation uses the caller-provided idempotency key', async () => {
    const fetchMock = vi.fn(async () => okResponse({ message_id: 'msg_3' }));
    const client = makeClient(fetchMock as unknown as typeof fetch);
    await client.replyToConversation('conv_1', { text: 'Hi' }, { idempotencyKey: 'reply-key-1' });

    const [, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect((init.headers as Record<string, string>)['Idempotency-Key']).toBe('reply-key-1');
  });
});

describe('webhook endpoints', () => {
  const endpoint = {
    id: 'a1b2c3d4-0000-4000-8000-000000000001',
    name: 'CRM sync',
    url: 'https://example.org/hooks',
    enabled: false,
    event_types: ['message.delivered'],
    failing_since: '2026-11-10T00:00:00Z',
    disabled_reason: 'consecutive_failures',
    created_at: '2026-10-01T00:00:00Z',
    updated_at: '2026-11-13T00:00:00Z',
  };

  it('serializes the list query and unwraps the cursor page', async () => {
    const fetchMock = vi.fn(async () =>
      okResponse({ data: [endpoint], has_more: true, next_cursor: 'cursor_2' }),
    );
    const client = makeClient(fetchMock as unknown as typeof fetch);
    const res = await client.listWebhookEndpoints({ limit: 25, cursor: 'cursor_1' });

    const parsed = new URL((fetchMock.mock.calls[0] as unknown as [string])[0]);
    expect(parsed.pathname).toBe('/v1/webhook-endpoints');
    expect(parsed.searchParams.get('limit')).toBe('25');
    expect(parsed.searchParams.get('cursor')).toBe('cursor_1');
    expect(res.data.data[0]!.disabled_reason).toBe('consecutive_failures');
    expect(res.data.next_cursor).toBe('cursor_2');
  });

  it('omits unset list query params', async () => {
    const fetchMock = vi.fn(async () => okResponse({ data: [], has_more: false, next_cursor: null }));
    const client = makeClient(fetchMock as unknown as typeof fetch);
    await client.listWebhookEndpoints();

    const parsed = new URL((fetchMock.mock.calls[0] as unknown as [string])[0]);
    expect(parsed.searchParams.has('limit')).toBe(false);
    expect(parsed.searchParams.has('cursor')).toBe(false);
  });

  it('encodes the id and unwraps the endpoint on get', async () => {
    const fetchMock = vi.fn(async () => okResponse(endpoint));
    const client = makeClient(fetchMock as unknown as typeof fetch);
    const res = await client.getWebhookEndpoint('a/b');

    expect((fetchMock.mock.calls[0] as unknown as [string])[0]).toBe(
      'https://api.politicalcomms.com/v1/webhook-endpoints/a%2Fb',
    );
    expect(res.data.event_types).toEqual(['message.delivered']);
  });

  it('maps a 404 on get to PoliticalCommsError', async () => {
    const fetchMock = vi.fn(async () => errorResponse(404, 'NOT_FOUND'));
    const client = makeClient(fetchMock as unknown as typeof fetch);
    await expect(client.getWebhookEndpoint('missing')).rejects.toMatchObject({
      code: 'NOT_FOUND',
      statusCode: 404,
    });
  });
});

describe('media usage', () => {
  it('sends usage: email_asset for an image an email template will reference', async () => {
    const fetchMock = vi.fn(async () => okResponse({ media_id: 'media_1', status: 'optimizing' }));
    const client = makeClient(fetchMock as unknown as typeof fetch);
    await client.importMedia({
      source_url: 'https://example.com/header.png',
      organization_id: 'org_1',
      usage: 'email_asset',
    });

    const [, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    const body = JSON.parse(init.body as string);
    expect(body.usage).toBe('email_asset');
    // Email assets are organization-scoped: sending brand_id too is a 400.
    expect(body).not.toHaveProperty('brand_id');
  });

  it('omits usage entirely for a default MMS import', async () => {
    const fetchMock = vi.fn(async () => okResponse({ media_id: 'media_2', status: 'optimizing' }));
    const client = makeClient(fetchMock as unknown as typeof fetch);
    await client.importMedia({ source_url: 'https://example.com/rally.jpg', brand_id: 'brand_1' });

    const [, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(JSON.parse(init.body as string)).not.toHaveProperty('usage');
  });
});

describe('triggered projects and campaigns', () => {
  const base = 'https://api.politicalcomms.com/v1';

  function call(fetchMock: ReturnType<typeof vi.fn>): { url: string; init: RequestInit; headers: Record<string, string> } {
    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    return { url, init, headers: init.headers as Record<string, string> };
  }

  it('POSTs a triggered project with its trigger and no list ids', async () => {
    const fetchMock = vi.fn(async () => okResponse({ project_id: 'proj_1', type: 'triggered' }));
    const client = makeClient(fetchMock as unknown as typeof fetch);
    await client.createProject({
      type: 'triggered',
      organization_id: 'org_1',
      phone_number_ids: ['pn_1'],
      name: 'Thank you',
      protocol: 'sms',
      message_text: 'Thanks {first_name}',
      trigger: {
        source: 'donation',
        delay_minutes: 5,
        donation: { integrations: [{ provider: 'winred', id: 'int_1' }], donor: 'first_time' },
      },
    });
    const { url, init } = call(fetchMock);
    expect(url).toBe(`${base}/projects`);
    const body = JSON.parse(init.body as string);
    expect(body.type).toBe('triggered');
    expect(body.trigger.donation.integrations[0]).toEqual({ provider: 'winred', id: 'int_1' });
    expect(body).not.toHaveProperty('contact_list_ids');
  });

  it('PATCHes a next-day trigger with its zone and time on updateProject', async () => {
    const fetchMock = vi.fn(async () => okResponse({}));
    const client = makeClient(fetchMock as unknown as typeof fetch);
    await client.updateProject('proj_1', {
      trigger: { source: 'api', start: 'next_day', delay_minutes: 0 },
      scheduled_timezone: 'America/Chicago',
      sequence_send_time: '09:30',
    });
    const { init } = call(fetchMock);
    expect(init.method).toBe('PATCH');
    expect(JSON.parse(init.body as string)).toEqual({
      trigger: { source: 'api', start: 'next_day', delay_minutes: 0 },
      scheduled_timezone: 'America/Chicago',
      sequence_send_time: '09:30',
    });
  });

  it('POSTs a tag trigger with follow-ups', async () => {
    const fetchMock = vi.fn(async () => okResponse({ project_id: 'proj_2', type: 'triggered' }));
    const client = makeClient(fetchMock as unknown as typeof fetch);
    const followUps: ProjectFollowUps = {
      steps: [
        { message_text: 'Still in?', wait: { unit: 'days', amount: 2 } },
        { message_text: 'Last call', media_ids: ['med_1'], wait: { unit: 'hours', amount: 6 } },
      ],
      stop_on_reply: true,
      stop_on_click: false,
    };
    await client.createProject({
      type: 'triggered',
      organization_id: 'org_1',
      phone_number_ids: ['pn_1'],
      name: 'Welcome volunteers',
      protocol: 'mms',
      message_text: 'Welcome {first_name}',
      trigger: { source: 'tag', tag: { tag_ids: ['tag_1'] } },
      follow_ups: followUps,
      scheduled_timezone: 'America/New_York',
      sequence_send_time: '10:00',
    });
    const body = JSON.parse(call(fetchMock).init.body as string);
    expect(body.trigger).toEqual({ source: 'tag', tag: { tag_ids: ['tag_1'] } });
    expect(body.follow_ups.steps[1]).toEqual({ message_text: 'Last call', media_ids: ['med_1'], wait: { unit: 'hours', amount: 6 } });
    expect(body.sequence_send_time).toBe('10:00');
  });

  it('PATCHes follow_ups: null to clear them', async () => {
    const fetchMock = vi.fn(async () => okResponse({ follow_ups: null }));
    const client = makeClient(fetchMock as unknown as typeof fetch);
    const res = await client.updateProject('proj_1', { follow_ups: null });
    expect(JSON.parse(call(fetchMock).init.body as string)).toEqual({ follow_ups: null });
    expect(res.data.follow_ups).toBeNull();
  });

  it('startProject without a body sends none and keeps the options', async () => {
    const fetchMock = vi.fn(async () => okResponse({ project_id: 'proj_1', status: 'active', type: 'triggered' }));
    const client = makeClient(fetchMock as unknown as typeof fetch);
    await client.startProject('proj_1', undefined, { idempotencyKey: 'start-1' });
    const { url, init, headers } = call(fetchMock);
    expect(url).toBe(`${base}/projects/proj_1/start`);
    expect(init.method).toBe('POST');
    expect(init.body).toBeUndefined();
    expect(headers['Idempotency-Key']).toBe('start-1');
  });

  it('startProject sends the audience of a tag trigger', async () => {
    const fetchMock = vi.fn(async () => okResponse({ project_id: 'proj_2', status: 'active', type: 'triggered' }));
    const client = makeClient(fetchMock as unknown as typeof fetch);
    await client.startProject('proj_2', { audience: 'new_only' });
    expect(JSON.parse(call(fetchMock).init.body as string)).toEqual({ audience: 'new_only' });
  });

  it('addProjectRecipient resolves a repeat as already_entered', async () => {
    const fetchMock = vi.fn(async () => okResponse({ status: 'already_entered', reason: 'already_entered' }));
    const client = makeClient(fetchMock as unknown as typeof fetch);
    const res = await client.addProjectRecipient('proj_1', { phone_number: '+12025550101' });
    expect(res.data).toEqual({ status: 'already_entered', reason: 'already_entered' });
  });

  it('endProject POSTs without a body', async () => {
    const fetchMock = vi.fn(async () => okResponse({}));
    const client = makeClient(fetchMock as unknown as typeof fetch);
    await client.endProject('proj_1');
    const { url, init, headers } = call(fetchMock);
    expect(url).toBe(`${base}/projects/proj_1/end`);
    expect(init.method).toBe('POST');
    expect(init.body).toBeUndefined();
    expect(headers['Idempotency-Key']).toMatch(UUID_RE);
  });

  it('addProjectRecipient POSTs the recipient and returns the queued answer', async () => {
    const fetchMock = vi.fn(async () => okResponse({ status: 'queued', send_at: '2026-11-13T14:00:00.000Z' }));
    const client = makeClient(fetchMock as unknown as typeof fetch);
    const res = await client.addProjectRecipient(
      'proj_1',
      { phone_number: '+12025550141', fields: { first_name: 'Ada', amount: 25 }, occurrence_id: 'evt_123' },
      { idempotencyKey: 'add-1' },
    );
    const { url, init, headers } = call(fetchMock);
    expect(url).toBe(`${base}/projects/proj_1/recipients`);
    expect(init.method).toBe('POST');
    expect(JSON.parse(init.body as string)).toEqual({
      phone_number: '+12025550141',
      fields: { first_name: 'Ada', amount: 25 },
      occurrence_id: 'evt_123',
    });
    expect(headers['Idempotency-Key']).toBe('add-1');
    expect(res.data).toEqual({ status: 'queued', send_at: '2026-11-13T14:00:00.000Z' });
  });

  it('addProjectRecipient maps a 409 CONTACT_OPTED_OUT to PoliticalCommsError', async () => {
    const fetchMock = vi.fn(async () => errorResponse(409, 'CONTACT_OPTED_OUT'));
    const client = makeClient(fetchMock as unknown as typeof fetch);
    await expect(client.addProjectRecipient('proj_1', { phone_number: '+12025550141' })).rejects.toMatchObject({
      code: 'CONTACT_OPTED_OUT',
      statusCode: 409,
    });
  });

  it('createProjectHook POSTs without a body', async () => {
    const fetchMock = vi.fn(async () =>
      jsonResponse(201, { success: true, data: { hook_url: 'https://api.politicalcomms.com/webhooks/trigger/text/proj_1/s3cret' } }),
    );
    const client = makeClient(fetchMock as unknown as typeof fetch);
    const res = await client.createProjectHook('proj_1');
    const { url, init, headers } = call(fetchMock);
    expect(url).toBe(`${base}/projects/proj_1/hook`);
    expect(init.method).toBe('POST');
    expect(init.body).toBeUndefined();
    expect(headers['Idempotency-Key']).toMatch(UUID_RE);
    expect(res.data.hook_url).toContain('/webhooks/trigger/text/proj_1/');
  });

  it('createEmailCampaign accepts a trigger without list_ids', async () => {
    const fetchMock = vi.fn(async () => okResponse({ id: 'camp_1', type: 'triggered' }));
    const client = makeClient(fetchMock as unknown as typeof fetch);
    await client.createEmailCampaign({
      name: 'Welcome',
      sender_identity_id: 'sid_1',
      template_id: 'tpl_1',
      trigger: {
        source: 'event',
        event: { event: 'email_click', sources: { ids: ['camp_0'] }, link_url: 'https://example.org/give' },
      },
    });
    const { url, init } = call(fetchMock);
    expect(url).toBe(`${base}/email/campaigns`);
    const body = JSON.parse(init.body as string);
    expect(body.trigger.event.event).toBe('email_click');
    expect(body).not.toHaveProperty('list_ids');
  });

  it('createEmailCampaign sends a next-day tag trigger with its timezone and send time', async () => {
    const fetchMock = vi.fn(async () => okResponse({ id: 'camp_2', type: 'triggered' }));
    const client = makeClient(fetchMock as unknown as typeof fetch);
    await client.createEmailCampaign({
      name: 'Welcome',
      sender_identity_id: 'sid_1',
      template_id: 'tpl_1',
      trigger: { source: 'tag', tag: { tag_ids: ['tag_1'] }, start: 'next_day' },
      timezone: 'America/Denver',
      sequence_send_time: '08:00',
    });
    const body = JSON.parse(call(fetchMock).init.body as string);
    expect(body.trigger).toEqual({ source: 'tag', tag: { tag_ids: ['tag_1'] }, start: 'next_day' });
    expect(body.timezone).toBe('America/Denver');
    expect(body.sequence_send_time).toBe('08:00');
  });

  it('createEmailCampaign sends a sequence beside a trigger', async () => {
    const fetchMock = vi.fn(async () => okResponse({ id: 'camp_4', type: 'triggered' }));
    const client = makeClient(fetchMock as unknown as typeof fetch);
    await client.createEmailCampaign({
      name: 'Welcome series',
      sender_identity_id: 'sid_1',
      template_id: 'tpl_1',
      trigger: { source: 'api' },
      sequence: { steps: [{ template_id: 'tpl_2', delay_days: 1, send_time: '09:00' }] },
    });
    const body = JSON.parse(call(fetchMock).init.body as string);
    expect(body.trigger).toEqual({ source: 'api' });
    expect(body.sequence.steps[0].delay_days).toBe(1);
  });

  it('createEmailCampaign sends sequence.stop_on_click', async () => {
    const fetchMock = vi.fn(async () => okResponse({ id: 'camp_3', type: 'broadcast', stop_on_click: true }));
    const client = makeClient(fetchMock as unknown as typeof fetch);
    const res = await client.createEmailCampaign({
      name: 'Drip',
      sender_identity_id: 'sid_1',
      list_ids: ['l_1'],
      template_id: 'tpl_1',
      sequence: {
        stop_on_reply: false,
        stop_on_click: true,
        steps: [{ template_id: 'tpl_2', delay_days: 3, send_time: '09:00' }],
      },
    });
    expect(JSON.parse(call(fetchMock).init.body as string).sequence.stop_on_click).toBe(true);
    expect(res.data.type).toBe('broadcast');
  });

  it('scheduleEmailCampaign sends the audience of a tag trigger', async () => {
    const fetchMock = vi.fn(async () => okResponse({ id: 'camp_2', status: 'sending' }));
    const client = makeClient(fetchMock as unknown as typeof fetch);
    await client.scheduleEmailCampaign('camp_2', { audience: 'current_and_new' });
    const { url, init } = call(fetchMock);
    expect(url).toBe(`${base}/email/campaigns/camp_2/schedule`);
    expect(JSON.parse(init.body as string)).toEqual({ audience: 'current_and_new' });
  });

  it('endEmailCampaign POSTs without a body', async () => {
    const fetchMock = vi.fn(async () => okResponse({ id: 'camp_1', status: 'completed' }));
    const client = makeClient(fetchMock as unknown as typeof fetch);
    await client.endEmailCampaign('camp_1', { idempotencyKey: 'end-1' });
    const { url, init, headers } = call(fetchMock);
    expect(url).toBe(`${base}/email/campaigns/camp_1/end`);
    expect(init.method).toBe('POST');
    expect(init.body).toBeUndefined();
    expect(headers['Idempotency-Key']).toBe('end-1');
  });

  it('pauseEmailCampaign POSTs without a body', async () => {
    const fetchMock = vi.fn(async () => okResponse({ id: 'camp_1', status: 'paused', pause_reason: 'api' }));
    const client = makeClient(fetchMock as unknown as typeof fetch);
    const res = await client.pauseEmailCampaign('camp_1', { idempotencyKey: 'pause-1' });
    const { url, init, headers } = call(fetchMock);
    expect(url).toBe(`${base}/email/campaigns/camp_1/pause`);
    expect(init.method).toBe('POST');
    expect(init.body).toBeUndefined();
    expect(headers['Idempotency-Key']).toBe('pause-1');
    expect(res.data.pause_reason).toBe('api');
  });

  it('resumeEmailCampaign POSTs resume_at and generates an idempotency key', async () => {
    const fetchMock = vi.fn(async () =>
      okResponse({ id: 'camp_1', status: 'paused', resume_at: '2026-12-01T15:00:00Z' }),
    );
    const client = makeClient(fetchMock as unknown as typeof fetch);
    const res = await client.resumeEmailCampaign('camp_1', { resume_at: '2026-12-01T15:00:00Z' });
    const { url, init, headers } = call(fetchMock);
    expect(url).toBe(`${base}/email/campaigns/camp_1/resume`);
    expect(init.method).toBe('POST');
    expect(JSON.parse(init.body as string)).toEqual({ resume_at: '2026-12-01T15:00:00Z' });
    expect(headers['Idempotency-Key']).toMatch(UUID_RE);
    expect(res.data.resume_at).toBe('2026-12-01T15:00:00Z');
  });

  it('resumeEmailCampaign with no body sends an empty object and honors idempotencyKey', async () => {
    const fetchMock = vi.fn(async () => okResponse({ id: 'camp_1', status: 'sending', resume_at: null }));
    const client = makeClient(fetchMock as unknown as typeof fetch);
    await client.resumeEmailCampaign('camp_1', undefined, { idempotencyKey: 'resume-1' });
    const { init, headers } = call(fetchMock);
    expect(JSON.parse(init.body as string)).toEqual({});
    expect(headers['Idempotency-Key']).toBe('resume-1');
  });

  it('addEmailCampaignRecipient POSTs the recipient and returns already_entered', async () => {
    const fetchMock = vi.fn(async () => okResponse({ status: 'already_entered', reason: 'duplicate' }));
    const client = makeClient(fetchMock as unknown as typeof fetch);
    const res = await client.addEmailCampaignRecipient(
      'camp_1',
      { email: 'ada@example.org', fields: { first_name: 'Ada' }, occurrence_id: 'evt_9' },
      { idempotencyKey: 'add-2' },
    );
    const { url, init, headers } = call(fetchMock);
    expect(url).toBe(`${base}/email/campaigns/camp_1/recipients`);
    expect(init.method).toBe('POST');
    expect(JSON.parse(init.body as string)).toEqual({
      email: 'ada@example.org',
      fields: { first_name: 'Ada' },
      occurrence_id: 'evt_9',
    });
    expect(headers['Idempotency-Key']).toBe('add-2');
    expect(res.data).toEqual({ status: 'already_entered', reason: 'duplicate' });
  });

  it('createEmailCampaignHook POSTs without a body', async () => {
    const fetchMock = vi.fn(async () => jsonResponse(201, { success: true, data: { hook_url: 'https://x/webhooks/trigger/email/camp_1/s' } }));
    const client = makeClient(fetchMock as unknown as typeof fetch);
    await client.createEmailCampaignHook('camp_1');
    const { url, init, headers } = call(fetchMock);
    expect(url).toBe(`${base}/email/campaigns/camp_1/hook`);
    expect(init.method).toBe('POST');
    expect(init.body).toBeUndefined();
    expect(headers['Idempotency-Key']).toMatch(UUID_RE);
  });
});

describe('tags', () => {
  const base = 'https://api.politicalcomms.com/v1';
  const tag = {
    id: 'a1b2c3d4-0000-4000-8000-0000000000aa',
    name: 'Volunteers',
    kind: 'manual',
    activity_event: null,
    within_days: null,
    member_count: 10000,
    member_count_capped: true,
    live_triggers: [{ id: 'proj_9', name: 'Welcome volunteers', channel: 'text' }],
    organization_id: 'org_1',
    created_at: '2026-11-17T00:00:00Z',
  };

  function call(fetchMock: ReturnType<typeof vi.fn>): {
    url: string;
    init: RequestInit;
    headers: Record<string, string>;
    body: unknown;
  } {
    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    const body = init.body === undefined ? undefined : JSON.parse(init.body as string);
    return { url, init, headers: init.headers as Record<string, string>, body };
  }

  it('listTags GETs /tags with the organization filter and unwraps the array', async () => {
    const fetchMock = vi.fn(async () => okResponse([tag]));
    const client = makeClient(fetchMock as unknown as typeof fetch);
    const res = await client.listTags({ organization_id: 'org_2' });
    const { url, init } = call(fetchMock);
    expect(url).toBe(`${base}/tags?organization_id=org_2`);
    expect(init.method).toBe('GET');
    expect(res.data[0]!.member_count_capped).toBe(true);
    expect(res.data[0]!.live_triggers).toEqual([{ id: 'proj_9', name: 'Welcome volunteers', channel: 'text' }]);
  });

  it('listTags without a query sends no params', async () => {
    const fetchMock = vi.fn(async () => okResponse([]));
    const client = makeClient(fetchMock as unknown as typeof fetch);
    await client.listTags();
    expect(call(fetchMock).url).toBe(`${base}/tags`);
  });

  it('createTag POSTs a manual tag with a generated idempotency key', async () => {
    const fetchMock = vi.fn(async () => jsonResponse(201, { success: true, data: tag }));
    const client = makeClient(fetchMock as unknown as typeof fetch);
    const res = await client.createTag({ name: 'Volunteers' });
    const { url, init, headers, body } = call(fetchMock);
    expect(url).toBe(`${base}/tags`);
    expect(init.method).toBe('POST');
    expect(body).toEqual({ name: 'Volunteers' });
    expect(headers['Idempotency-Key']).toMatch(UUID_RE);
    expect(res.data.kind).toBe('manual');
  });

  it('createTag POSTs an activity tag with its window', async () => {
    const activity = { ...tag, name: 'Donated (90 days)', kind: 'activity', activity_event: 'donated', within_days: 90, member_count: null, member_count_capped: false };
    const fetchMock = vi.fn(async () => okResponse(activity));
    const client = makeClient(fetchMock as unknown as typeof fetch);
    const res = await client.createTag({ activity_event: 'donated', within_days: 90, organization_id: 'org_2' });
    expect(call(fetchMock).body).toEqual({ activity_event: 'donated', within_days: 90, organization_id: 'org_2' });
    expect(res.data.member_count).toBeNull();
  });

  it('renameTag PATCHes the encoded id with the new name', async () => {
    const fetchMock = vi.fn(async () => okResponse({ ...tag, name: 'Core volunteers' }));
    const client = makeClient(fetchMock as unknown as typeof fetch);
    const res = await client.renameTag('a/b', { name: 'Core volunteers' }, { idempotencyKey: 'rename-1' });
    const { url, init, headers, body } = call(fetchMock);
    expect(url).toBe(`${base}/tags/a%2Fb`);
    expect(init.method).toBe('PATCH');
    expect(body).toEqual({ name: 'Core volunteers' });
    expect(headers['Idempotency-Key']).toBe('rename-1');
    expect(res.data.name).toBe('Core volunteers');
  });

  it('deleteTag DELETEs without a body or a generated idempotency key', async () => {
    const fetchMock = vi.fn(async () => okResponse({ id: tag.id, deleted: true }));
    const client = makeClient(fetchMock as unknown as typeof fetch);
    const res = await client.deleteTag(tag.id);
    const { url, init, headers } = call(fetchMock);
    expect(url).toBe(`${base}/tags/${tag.id}`);
    expect(init.method).toBe('DELETE');
    expect(init.body).toBeUndefined();
    expect(headers['Idempotency-Key']).toBeUndefined();
    expect(res.data.deleted).toBe(true);
  });

  it('deleteTag surfaces TAG_IN_USE with the blocking sends in body.details', async () => {
    const details = {
      projects: [{ id: 'proj_1', name: 'GOTV', status: 'scheduled' }],
      emailCampaigns: [{ id: 'camp_1', name: 'Rally', status: 'sending' }],
    };
    const fetchMock = vi.fn(async () =>
      jsonResponse(409, { success: false, error: 'This tag is used by a send', code: 'TAG_IN_USE', details }),
    );
    const client = makeClient(fetchMock as unknown as typeof fetch);
    const err = await client.deleteTag(tag.id).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(PoliticalCommsError);
    expect((err as PoliticalCommsError).code).toBe('TAG_IN_USE');
    expect(((err as PoliticalCommsError).body as { details: unknown }).details).toEqual(details);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('addTagContacts POSTs identifiers and returns added and invalid counts', async () => {
    const fetchMock = vi.fn(async () => okResponse({ added: 2, invalid: 1 }));
    const client = makeClient(fetchMock as unknown as typeof fetch);
    const res = await client.addTagContacts(tag.id, { identifiers: ['(202) 555-0101', 'ada@example.org', 'nope'] });
    const { url, init, headers, body } = call(fetchMock);
    expect(url).toBe(`${base}/tags/${tag.id}/contacts`);
    expect(init.method).toBe('POST');
    expect(body).toEqual({ identifiers: ['(202) 555-0101', 'ada@example.org', 'nope'] });
    expect(headers['Idempotency-Key']).toMatch(UUID_RE);
    expect(res.data).toEqual({ added: 2, invalid: 1 });
  });

  it('addTagContacts with a contact list resolves the 202 queued answer, with no counts', async () => {
    const fetchMock = vi.fn(async () => jsonResponse(202, { success: true, data: { queued: true, job_id: 'job_1' } }));
    const client = makeClient(fetchMock as unknown as typeof fetch);
    const res = await client.addTagContacts(tag.id, { contact_list_id: 'cl_1' });
    expect(call(fetchMock).body).toEqual({ contact_list_id: 'cl_1' });
    expect(res.data).toEqual({ queued: true, job_id: 'job_1' });
    if (!res.data.queued) throw new Error('expected the queued shape');
    expect(res.data.job_id).toBe('job_1');
    expect('added' in res.data).toBe(false);
  });

  it('addTagContacts sends fire_triggers and returns triggers.entered', async () => {
    const fetchMock = vi.fn(async () => okResponse({ added: 1, invalid: 0, triggers: { entered: 1 } }));
    const client = makeClient(fetchMock as unknown as typeof fetch);
    const res = await client.addTagContacts(tag.id, { identifiers: ['+12025550101'], fire_triggers: true });
    expect(call(fetchMock).body).toEqual({ identifiers: ['+12025550101'], fire_triggers: true });
    if (res.data.queued) throw new Error('expected counts for identifiers');
    expect(res.data.triggers).toEqual({ entered: 1 });
  });

  it('addTagContacts with a list and fire_triggers resolves the queued echo', async () => {
    const fetchMock = vi.fn(async () =>
      jsonResponse(202, { success: true, data: { queued: true, job_id: 'job_5', fire_triggers: true } }),
    );
    const client = makeClient(fetchMock as unknown as typeof fetch);
    const res = await client.addTagContacts(tag.id, { contact_list_id: 'cl_1', fire_triggers: true });
    expect(call(fetchMock).body).toEqual({ contact_list_id: 'cl_1', fire_triggers: true });
    if (!res.data.queued) throw new Error('expected the queued shape');
    expect(res.data.fire_triggers).toBe(true);
  });

  it('tagContacts sends fire_triggers: false beside the name', async () => {
    const fetchMock = vi.fn(async () => okResponse({ tag, created: false, added: 1, invalid: 0 }));
    const client = makeClient(fetchMock as unknown as typeof fetch);
    await client.tagContacts({ name: 'Volunteers', identifiers: ['+12025550101'], fire_triggers: false });
    expect(call(fetchMock).body).toEqual({ name: 'Volunteers', identifiers: ['+12025550101'], fire_triggers: false });
  });

  it('removeTagContacts with a contact list resolves the 202 queued answer', async () => {
    const fetchMock = vi.fn(async () => jsonResponse(202, { success: true, data: { queued: true, job_id: 'job_2' } }));
    const client = makeClient(fetchMock as unknown as typeof fetch);
    const res = await client.removeTagContacts(tag.id, { contact_list_id: 'cl_1' });
    expect(res.data).toEqual({ queued: true, job_id: 'job_2' });
  });

  it('removeTagContacts sends a DELETE with a JSON body, as removeEmailSuppressions does', async () => {
    const fetchMock = vi.fn(async () => okResponse({ removed: 1, not_tagged: 1, invalid: 0 }));
    const client = makeClient(fetchMock as unknown as typeof fetch);
    const res = await client.removeTagContacts(tag.id, { identifiers: ['+12025550101', 'bob@example.org'] }, { idempotencyKey: 'untag-1' });
    const { url, init, headers, body } = call(fetchMock);
    expect(url).toBe(`${base}/tags/${tag.id}/contacts`);
    expect(init.method).toBe('DELETE');
    expect(headers['Content-Type']).toBe('application/json');
    expect(headers['Idempotency-Key']).toBe('untag-1');
    expect(body).toEqual({ identifiers: ['+12025550101', 'bob@example.org'] });
    expect(res.data.not_tagged).toBe(1);
  });

  it('tagContacts POSTs the name and source to /tags/contacts and returns created', async () => {
    const fetchMock = vi.fn(async () => okResponse({ tag, created: true, added: 2, invalid: 0 }));
    const client = makeClient(fetchMock as unknown as typeof fetch);
    const res = await client.tagContacts({ name: 'Volunteers', identifiers: ['+12025550101', 'ada@example.org'], organization_id: 'org_1' });
    const { url, init, headers, body } = call(fetchMock);
    expect(url).toBe(`${base}/tags/contacts`);
    expect(init.method).toBe('POST');
    expect(headers['Idempotency-Key']).toMatch(UUID_RE);
    expect(body).toEqual({ name: 'Volunteers', identifiers: ['+12025550101', 'ada@example.org'], organization_id: 'org_1' });
    expect(res.data.created).toBe(true);
    expect(res.data.tag.id).toBe(tag.id);
    if (res.data.queued) throw new Error('expected counts for identifiers');
    expect(res.data.added).toBe(2);
  });

  it('tagContacts with a contact list resolves the queued answer with the tag it created', async () => {
    const fetchMock = vi.fn(async () =>
      jsonResponse(202, { success: true, data: { tag, created: true, queued: true, job_id: 'job_3' } }),
    );
    const client = makeClient(fetchMock as unknown as typeof fetch);
    const res = await client.tagContacts({ name: 'Volunteers', contact_list_id: 'cl_1' });
    expect(res.data).toEqual({ tag, created: true, queued: true, job_id: 'job_3' });
  });

  it('untagContacts sends a DELETE with the name and a contact list in the body', async () => {
    const fetchMock = vi.fn(async () =>
      jsonResponse(202, { success: true, data: { tag, queued: true, job_id: 'job_4' } }),
    );
    const client = makeClient(fetchMock as unknown as typeof fetch);
    const res = await client.untagContacts({ name: 'volunteers', contact_list_id: 'cl_1' });
    const { url, init, headers, body } = call(fetchMock);
    expect(url).toBe(`${base}/tags/contacts`);
    expect(init.method).toBe('DELETE');
    expect(headers['Content-Type']).toBe('application/json');
    expect(body).toEqual({ name: 'volunteers', contact_list_id: 'cl_1' });
    expect(res.data).toEqual({ tag, queued: true, job_id: 'job_4' });
  });

  it('createProject and updateProject pass the three tag fields through', async () => {
    const fetchMock = vi.fn(async () => okResponse({ project_id: 'proj_1', tag_ids: ['t1'] }));
    const client = makeClient(fetchMock as unknown as typeof fetch);
    await client.createProject({
      organization_id: 'org_1',
      phone_number_ids: ['pn_1'],
      name: 'Tagged',
      protocol: 'sms',
      message_text: 'Hi',
      tag_ids: ['t1'],
      require_tag_ids: ['t2'],
      suppression_tag_ids: ['t3'],
    });
    expect(call(fetchMock).body).toMatchObject({ tag_ids: ['t1'], require_tag_ids: ['t2'], suppression_tag_ids: ['t3'] });
    expect(call(fetchMock).body).not.toHaveProperty('contact_list_ids');

    fetchMock.mockClear();
    const res = await client.updateProject('proj_1', { contact_list_ids: [], tag_ids: ['t1'], suppression_tag_ids: [] });
    const { url, init, body } = call(fetchMock);
    expect(url).toBe(`${base}/projects/proj_1`);
    expect(init.method).toBe('PATCH');
    expect(body).toEqual({ contact_list_ids: [], tag_ids: ['t1'], suppression_tag_ids: [] });
    expect(res.data.tag_ids).toEqual(['t1']);
  });

  it('getContactList passes the import and email failure reasons through', async () => {
    const tooMany = { code: 'TAG_COLUMN_TOO_MANY_TAGS', message: 'That column would create more than 100 tags. Check that it is the right column.' };
    const fetchMock = vi.fn(async () =>
      okResponse({ list_id: 'cl_1', import: { status: 'failed', error: tooMany }, email: { status: 'ready', error: null } }),
    );
    const client = makeClient(fetchMock as unknown as typeof fetch);
    const res = await client.getContactList('cl_1');
    expect(res.data.import?.error).toEqual(tooMany);
    expect(res.data.email?.error).toBeNull();
  });

  it('createEmailCampaign accepts tags without list_ids', async () => {
    const fetchMock = vi.fn(async () => okResponse({ id: 'camp_1', name: 'N', status: 'draft', sender_identity_id: 's_1', tag_ids: ['t1'] }));
    const client = makeClient(fetchMock as unknown as typeof fetch);
    const res = await client.createEmailCampaign({
      name: 'N',
      sender_identity_id: 's_1',
      template_id: 'tpl_1',
      tag_ids: ['t1'],
      require_tag_ids: ['t2'],
      suppression_tag_ids: ['t3'],
    });
    const { url, body } = call(fetchMock);
    expect(url).toBe(`${base}/email/campaigns`);
    expect(body).toEqual({
      name: 'N',
      sender_identity_id: 's_1',
      template_id: 'tpl_1',
      tag_ids: ['t1'],
      require_tag_ids: ['t2'],
      suppression_tag_ids: ['t3'],
    });
    expect(res.data.tag_ids).toEqual(['t1']);
  });

  it('importContactList passes tag_ids, tag_names, and tags_column through', async () => {
    const fetchMock = vi.fn(async () => okResponse({ purpose: 'audience', list_id: 'cl_1' }));
    const client = makeClient(fetchMock as unknown as typeof fetch);
    await client.importContactList({
      source_url: 'https://example.org/a.csv',
      list_name: 'A',
      phone_column: 'Phone',
      tag_ids: ['t1'],
      tag_names: ['Walk list'],
      tags_column: 'Tags',
      fire_triggers: true,
    });
    expect(call(fetchMock).body).toEqual({
      source_url: 'https://example.org/a.csv',
      list_name: 'A',
      phone_column: 'Phone',
      tag_ids: ['t1'],
      tag_names: ['Walk list'],
      tags_column: 'Tags',
      fire_triggers: true,
    });
  });
});
