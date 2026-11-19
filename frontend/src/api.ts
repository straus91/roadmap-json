// Thin client for the backend (see backend/app/main.py).

export type CardType = 'dataset' | 'model'

export interface Problem {
  pointer: string
  location: string
  message: string
}

export interface Health {
  status: string
  version: string
  provider: string
  model: string
  configured: boolean
  max_upload_mb: number
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
  }
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
