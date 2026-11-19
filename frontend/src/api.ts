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

export async function getHealth(): Promise<Health> {
  return readJson<Health>(await fetch('/api/health'))
}

export async function getSchema(cardType: CardType): Promise<object> {
  return readJson<object>(await fetch(`/api/schemas/${cardType}`))
}

export async function extractCard(
  cardType: CardType,
  file: File,
  signal: AbortSignal,
): Promise<Extraction> {
  const form = new FormData()
  form.append('card_type', cardType)
  form.append('file', file)
  return readJson<Extraction>(await fetch('/api/extract', { method: 'POST', body: form, signal }))
}

function postJson(path: string, body: unknown): Promise<Response> {
  return fetch(path, {
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
