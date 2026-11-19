// "Send to ATLAS": handing a finished card to the page this app is shown inside.
//
// ATLAS shows its card creator inside a frame on its own Creator page. When this app is the
// one in that frame, it can pass the finished card (and the short description ATLAS asks for)
// to the ATLAS page around it, where the person is already signed in. No password or key is
// involved, and the card is only ever handed to a site on the server's EMBED_ORIGINS list.
//
// The messages (window.postMessage), all plain JSON:
//   this app -> host   { source: 'roadmap-card-creator', type: 'ready', version: 1 }
//   this app -> host   { source: 'roadmap-card-creator', type: 'card', version: 1, id,
//                        cardType: 'dataset' | 'model', description, fileName, card }
//   host -> this app   { source: 'atlas', type: 'card-received', id }          (it has the card)
//   host -> this app   { source: 'atlas', type: 'card-rejected', id, reason }  (it could not take it)

export const MAX_DESCRIPTION = 2000 // ATLAS's own limit for a card's description

/** The site this app is shown inside, if it is one that may receive cards; otherwise null. */
export function hostPage(allowed: string[]): string | null {
  if (window.parent === window) return null
  let origin: string | null = null
  try {
    origin = window.location.ancestorOrigins?.[0] ?? (document.referrer ? new URL(document.referrer).origin : null)
  } catch {
    origin = null
  }
  if (!origin) return null
  return allowed.includes(origin) || origin === window.location.origin ? origin : null
}

export function announce(host: string) {
  window.parent.postMessage({ source: 'roadmap-card-creator', type: 'ready', version: 1 }, host)
}

export interface Handover {
  cardType: 'dataset' | 'model'
  description: string
  fileName: string
  card: unknown
}

/** Hand the card over and wait for the host to say it has it. Rejects with a sentence to show. */
export function sendCard(host: string, handover: Handover, waitMs = 8000): Promise<void> {
  const id = `${Date.now()}-${Math.random().toString(36).slice(2, 10)}`
  return new Promise((resolve, reject) => {
    const finish = (error?: Error) => {
      window.removeEventListener('message', listen)
      clearTimeout(timer)
      if (error) reject(error)
      else resolve()
    }
    const listen = (event: MessageEvent) => {
      const data = event.data as { source?: string; type?: string; id?: string; reason?: string } | null
      if (event.origin !== host || !data || data.source !== 'atlas' || data.id !== id) return
      if (data.type === 'card-received') finish()
      if (data.type === 'card-rejected') finish(new Error(data.reason ? `ATLAS did not accept the card: ${data.reason}` : 'ATLAS did not accept the card.'))
    }
    const timer = setTimeout(
      () => finish(new Error('ATLAS did not confirm that it received the card. Download the card and upload it there instead.')),
      waitMs,
    )
    window.addEventListener('message', listen)
    window.parent.postMessage({ source: 'roadmap-card-creator', type: 'card', version: 1, id, ...handover }, host)
  })
}

/** A first draft of the description ATLAS shows in its list, taken from the card's own text. */
export function suggestDescription(body: unknown): string {
  const record = (body ?? {}) as Record<string, Record<string, unknown> | undefined>
  const candidates = [
    record.Descriptors?.Comments,
    record['Dataset properties']?.Motivation,
    record['Model properties']?.['Clinical benefit'],
    record['Model properties']?.['Indications for use'],
  ]
  const text = candidates.find((value): value is string => typeof value === 'string' && value.trim() !== '') ?? ''
  const tidy = text.replace(/\s+/g, ' ').trim()
  if (tidy.length <= 300) return tidy
  const cut = tidy.slice(0, 300)
  const stop = cut.lastIndexOf('. ')
  return stop > 80 ? cut.slice(0, stop + 1) : `${cut.slice(0, cut.lastIndexOf(' '))}…`
}
