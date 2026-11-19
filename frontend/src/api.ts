// Thin client for the backend (see backend/app/main.py).

export type CardType = 'dataset' | 'model'

export interface Problem {
  pointer: string
  location: string
  message: string
  keyword?: string
}

export interface Health {
  status: string
  version: string
  provider: string
  model: string
  configured: boolean
  max_upload_mb: number
  max_pdf_pages: number
  schemas: Record<CardType, { source: string; url: string; checked_at: string | null }>
  budget: {
    paused: boolean
    // present only when the server is set to show usage to visitors
    monthly_budget_usd?: number
    spent_usd?: number
    papers_this_month?: number
  }
}

export interface Extraction {
  card: Record<string, unknown>
  valid: boolean
  errors: Problem[]
  warnings: string[]
  meta: {
    provider: string
    model: string
    repaired: boolean
    usage: Record<string, number>
    cost_usd?: number // present only when the server is set to show usage to visitors
    cost_is_estimate?: boolean
  }
}

export interface Tidied {
  card: Record<string, unknown>
  warnings: string[]
  valid: boolean
  errors: Problem[]
}

async function readJson<T>(response: Response): Promise<T> {
  if (response.ok) return (await response.json()) as T
  let detail = `The server answered with an error (${response.status}).`
  try {
    const body = (await response.json()) as { detail?: unknown }
    if (typeof body.detail === 'string') detail = body.detail
  } catch {
    // not JSON: keep the generic message
  }
  throw new Error(detail)
}

const UNREACHABLE = 'Could not reach the server. Check your internet connection and try again.'

/** fetch, but a dropped connection becomes a sentence a person can act on ("Failed to fetch" is not one). */
async function request(input: string, init?: RequestInit): Promise<Response> {
  try {
    return await fetch(input, init)
  } catch (error) {
    if (init?.signal?.aborted) throw error
    throw new Error(UNREACHABLE)
  }
}

export async function getHealth(): Promise<Health> {
  return readJson<Health>(await request('/api/health'))
}

export async function getSchema(cardType: CardType): Promise<object> {
  return readJson<object>(await request(`/api/schemas/${cardType}`))
}

function pause(ms: number, signal: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(resolve, ms)
    signal.addEventListener('abort', () => {
      clearTimeout(timer)
      reject(new DOMException('Cancelled', 'AbortError'))
    }, { once: true })
  })
}

interface Job {
  status: 'running' | 'done' | 'failed'
  result?: Extraction
  detail?: string
}

/**
 * Hand a paper to the server. It answers at once with a ticket; the reading itself happens
 * there and is collected with `waitForCard`. Holding one request open for a minute does not
 * survive a phone locking its screen or changing network, and this does.
 */
export async function sendPaper(cardType: CardType, file: File, signal: AbortSignal): Promise<string> {
  const form = new FormData()
  form.append('card_type', cardType)
  form.append('file', file)
  const started = await readJson<{ job_id: string }>(await request('/api/jobs', { method: 'POST', body: form, signal }))
  return started.job_id
}

/** Ask for the card every two seconds until it is ready. Short losses of connection are ridden out. */
export async function waitForCard(jobId: string, signal: AbortSignal): Promise<Extraction> {
  let missed = 0
  for (;;) {
    await pause(2000, signal)
    let response: Response
    try {
      response = await fetch(`/api/jobs/${jobId}`, { signal })
    } catch (error) {
      if (signal.aborted) throw error
      if (++missed > 60) throw new Error('The connection to the server was lost for too long. Check your internet connection and try again.')
      continue // offline for a moment: the paper is still being read, keep asking
    }
    missed = 0
    const job = await readJson<Job>(response)
    if (job.status === 'done' && job.result) return job.result
    if (job.status === 'failed') throw new Error(job.detail ?? 'The paper could not be read. Please try again.')
  }
}

function postJson(path: string, body: unknown): Promise<Response> {
  return request(path, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
}

/** The server's verdict on a card: the authority on whether it is a valid ATLAS card. */
export async function serverValidate(
  card: unknown,
  cardType: CardType,
): Promise<{ valid: boolean; errors: Problem[] }> {
  return readJson(await postJson(`/api/validate?card_type=${cardType}`, card))
}

/** Ask the server to tidy a card to the schema (fix names and formats, drop what is not allowed). */
export async function tidyCard(card: unknown, cardType: CardType): Promise<Tidied> {
  return readJson<Tidied>(await postJson(`/api/normalize?card_type=${cardType}`, card))
}
