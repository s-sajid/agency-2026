import { streamChatEvents, fetchSpendByYear } from '@/lib/api'

global.fetch = jest.fn()

class MockEventSource {
  static instances: MockEventSource[] = []

  onmessage: ((event: { data: string }) => void) | null = null
  onerror: (() => void) | null = null
  closed = false

  constructor(public url: string) {
    MockEventSource.instances.push(this)
  }

  emit(data: unknown) {
    this.onmessage?.({ data: JSON.stringify(data) })
  }

  close() {
    this.closed = true
  }
}

global.EventSource = MockEventSource as unknown as typeof EventSource

async function waitForEventSource(): Promise<MockEventSource> {
  for (let i = 0; i < 10; i++) {
    const source = MockEventSource.instances.at(-1)
    if (source) return source
    await new Promise((resolve) => setTimeout(resolve, 0))
  }
  throw new Error('EventSource was not created')
}

describe('streamChatEvents (SSE)', () => {
  beforeEach(() => {
    ;(fetch as jest.Mock).mockReset()
    MockEventSource.instances = []
  })

  it('yields events from the SSE stream and stops at status=complete', async () => {
    ;(fetch as jest.Mock).mockResolvedValueOnce({ ok: true, json: async () => ({ job_id: 'j1' }) })
    const events: unknown[] = []
    const consume = (async () => {
      for await (const ev of streamChatEvents('test')) events.push(ev)
    })()

    const source = await waitForEventSource()
    expect(source.url).toBe('/chat/stream/j1')
    source.emit({ kind: 'tool', payload: { tool: 'router', label: 'Router', question: 'hi' } })
    source.emit({ kind: 'tool_done', payload: { tool_done: 'router' } })
    source.emit({ kind: 'text', payload: { text: 'hello world' } })
    source.emit({ kind: 'status', payload: { status: 'complete' } })
    await consume

    expect(events).toEqual([
      { type: 'tool', name: 'router', label: 'Router', question: 'hi' },
      { type: 'tool_done', name: 'router' },
      { type: 'text', text: 'hello world' },
    ])
    expect(source.closed).toBe(true)
  })

  it('throws when an error event appears in the stream', async () => {
    ;(fetch as jest.Mock).mockResolvedValueOnce({ ok: true, json: async () => ({ job_id: 'j2' }) })

    const consume = async () => {
      for await (const _ of streamChatEvents('bad')) { /* consume */ }
    }
    const pending = consume()
    const source = await waitForEventSource()
    source.emit({ kind: 'error', payload: { error: 'backend exploded' } })

    await expect(pending).rejects.toThrow('backend exploded')
    expect(source.closed).toBe(true)
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
    expect(fetch).toHaveBeenCalledWith('/dashboard/spend-by-year')
  })

  it('throws on non-ok response', async () => {
    ;(fetch as jest.Mock).mockResolvedValueOnce({ ok: false, status: 503 })
    await expect(fetchSpendByYear()).rejects.toThrow('HTTP 503')
  })
})
