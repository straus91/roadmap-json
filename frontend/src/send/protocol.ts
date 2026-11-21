// Talking to the page this app is shown inside (a "host", such as ATLAS).
//
// A host shows the card creator in a frame. The two exchange plain JSON messages with
// window.postMessage, and this app only ever talks to a host on the server's EMBED_ORIGINS list.
// No password, token or API key is involved: the person is signed in to the host, not here.
//
//   this app -> host   { source: 'roadmap-card-creator', type: 'ready', version: 1 }
//   this app -> host   { source: 'roadmap-card-creator', type: 'card', version: 1, id,
//                        cardType: 'dataset' | 'model', description, fileName, card }
//   host -> this app   { source: 'atlas', type: 'card-received', id }          (it has the card)
//   host -> this app   { source: 'atlas', type: 'card-rejected', id, reason }  (it could not take it)
//   host -> this app   { source: 'atlas', type: 'open-card', version: 1, card, title?, check? }
//                                                                    (open this card for editing;
//                                                                     `check`: see ../check/protocol.ts)
//
// Everything about this feature lives in this folder. The rest of the app only calls
// `useSendToHost` (the button and its step) and `listenForCards` (cards the host asks to open).

export const MAX_DESCRIPTION = 2000 // ATLAS's own limit for a card's description
const SELF = 'roadmap-card-creator'
const HOST = 'atlas'

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

/** Tell the host this app has loaded and can take messages. */
export function announce(host: string) {
  window.parent.postMessage({ source: SELF, type: 'ready', version: 1 }, host)
}

export interface Handover {
  cardType: 'dataset' | 'model'
  description: string
  fileName: string
  card: unknown
}

/** Hand the card over and wait for the host to say it has it. Rejects with a sentence to show. */
export function sendCard(host: string, hostName: string, handover: Handover, waitMs = 8000): Promise<void> {
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
      if (event.origin !== host || !data || data.source !== HOST || data.id !== id) return
      if (data.type === 'card-received') finish()
      if (data.type === 'card-rejected')
        finish(new Error(data.reason ? `${hostName} did not accept the card: ${data.reason}` : `${hostName} did not accept the card.`))
    }
    const timer = setTimeout(
      () => finish(new Error(`${hostName} did not confirm that it received the card. Download the card and upload it there instead.`)),
      waitMs,
    )
    window.addEventListener('message', listen)
    window.parent.postMessage({ source: SELF, type: 'card', version: 1, id, ...handover }, host)
  })
}

/** Cards the host asks this app to open for editing. Returns the function that stops listening. */
export function listenForCards(host: string, open: (card: Record<string, unknown>, title: string, check: unknown) => void): () => void {
  const listen = (event: MessageEvent) => {
    const data = event.data as { source?: string; type?: string; card?: unknown; title?: unknown; check?: unknown } | null
    if (event.origin !== host || event.source !== window.parent || !data || data.source !== HOST || data.type !== 'open-card') return
    const card = data.card
    if (card === null || typeof card !== 'object' || Array.isArray(card)) return
    open(card as Record<string, unknown>, typeof data.title === 'string' ? data.title : 'card', data.check)
  }
  window.addEventListener('message', listen)
  return () => window.removeEventListener('message', listen)
}

/** A first draft of the description the host shows in its list, taken from the card's own text. */
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
