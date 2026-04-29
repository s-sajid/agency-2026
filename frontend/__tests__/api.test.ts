import { streamChatEvents, fetchSpendByYear } from '@/lib/api'

global.fetch = jest.fn()

function mockSequence(...responses: Array<Partial<Response> | { ok: boolean; json: () => Promise<unknown>; text?: () => Promise<string> }>) {
  const mock = fetch as jest.Mock
  for (const r of responses) mock.mockResolvedValueOnce(r as Response)
}

describe('streamChatEvents (polling)', () => {
  beforeEach(() => {
    ;(fetch as jest.Mock).mockReset()
  })

  it('yields events from the first poll and stops at status=complete', async () => {
    mockSequence(
      { ok: true, json: async () => ({ job_id: 'j1' }) },
      {
        ok: true,
        json: async () => ({
          job_id: 'j1',
          status: 'complete',
          events: [
            { kind: 'tool', payload: { tool: 'router', label: 'Router', question: 'hi' } },
            { kind: 'tool_done', payload: { tool_done: 'router' } },
            { kind: 'text', payload: { text: 'hello world' } },
          ],
          active_agent: null,
          result: null,
        }),
      },
    )

    const events: unknown[] = []
    for await (const ev of streamChatEvents('test')) events.push(ev)

    expect(events).toEqual([
      { type: 'tool', name: 'router', label: 'Router', question: 'hi' },
      { type: 'tool_done', name: 'router' },
      { type: 'text', text: 'hello world' },
    ])
  })

  it('throws when an error event appears in the stream', async () => {
    mockSequence(
      { ok: true, json: async () => ({ job_id: 'j2' }) },
      {
        ok: true,
        json: async () => ({
          job_id: 'j2',
          status: 'error',
          events: [{ kind: 'error', payload: { error: 'backend exploded' } }],
          active_agent: null,
          result: null,
        }),
      },
    )

    await expect(async () => {
      for await (const _ of streamChatEvents('bad')) { /* consume */ }
    }).rejects.toThrow('backend exploded')
  })
})

describe('fetchSpendByYear', () => {
  beforeEach(() => {
    ;(fetch as jest.Mock).mockReset()
  })

  it('returns parsed spend-by-year array from the dashboard endpoint', async () => {
    ;(fetch as jest.Mock).mockResolvedValueOnce({
      ok: true,
      json: async () => [
        { year: 2021, total_spend: 1000000 },
        { year: 2022, total_spend: 2000000 },
      ],
    })
    const result = await fetchSpendByYear()
    expect(result).toEqual([
      { year: 2021, total_spend: 1000000 },
      { year: 2022, total_spend: 2000000 },
    ])
    expect(fetch).toHaveBeenCalledWith('/dashboard/spend-by-year', { cache: 'no-store' })
  })

  it('throws on non-ok response', async () => {
    ;(fetch as jest.Mock).mockResolvedValueOnce({ ok: false, status: 503 })
    await expect(fetchSpendByYear()).rejects.toThrow('HTTP 503')
  })
})
