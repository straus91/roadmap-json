// Author check: the messages.
//
// A host (such as ATLAS) can ask the author of a published card to go through it here, section
// by section. The host opens the card with a `check` part; this app then shows, in place of the
// download and send buttons, whether each section is still as published ("Right") or was
// "Edited by you", and tells the host how far the author is. A section is one or the other:
// an author who finds something wrong corrects it. The host keeps the work (so the author can
// come back to it) and owns the final button.
//
//   host -> this app   { source: 'atlas', type: 'open-card', version: 1, card, title,
//                        check: { original } }
//                        card      the author's version so far (the published card at first)
//                        original  the published card, to tell which sections were edited
//   this app -> host   { source: 'roadmap-card-creator', type: 'check-progress', version: 1,
//                        cardType, card, changed, problems }
//                        sent a moment after every change; `changed` names the edited sections,
//                        `problems` counts what does not fit the schema
//   host -> this app   { source: 'atlas', type: 'check-finish', id }
//                        the author pressed the host's final button
//   this app -> host   { source: 'roadmap-card-creator', type: 'check-result', version: 1, id,
//                        ok, reason?, cardType, card, changed }
//                        ok only after this app's server confirmed the card fits the schema
//
// Sections are named as the editor shows them ("Basics", "Descriptors", ...).

import type { Json } from '../schema.ts'

const SELF = 'roadmap-card-creator'
const HOST = 'atlas'

export interface CheckRequest {
  original: Record<string, Json>
}

/** The `check` part of an open-card message, if it is one. */
export function readCheck(value: unknown): CheckRequest | null {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return null
  const { original } = value as { original?: unknown }
  if (original === null || typeof original !== 'object' || Array.isArray(original)) return null
  return { original: original as Record<string, Json> }
}

export interface Progress {
  cardType: 'dataset' | 'model'
  card: unknown
  changed: string[]
  problems: number
}

export function reportProgress(host: string, progress: Progress) {
  window.parent.postMessage({ source: SELF, type: 'check-progress', version: 1, ...progress }, host)
}

export interface Result {
  ok: boolean
  reason?: string
  cardType: 'dataset' | 'model'
  card: unknown
  changed: string[]
}

/** Answer the host's final button. `finish` does the last check and says how it went. Returns the function that stops listening. */
export function listenForFinish(host: string, finish: () => Promise<Result>): () => void {
  const listen = (event: MessageEvent) => {
    const data = event.data as { source?: string; type?: string; id?: unknown } | null
    if (event.origin !== host || event.source !== window.parent || !data || data.source !== HOST || data.type !== 'check-finish') return
    const id = data.id
    void finish().then((result) => window.parent.postMessage({ source: SELF, type: 'check-result', version: 1, id, ...result }, host))
  }
  window.addEventListener('message', listen)
  return () => window.removeEventListener('message', listen)
}

/** JSON with the keys in order, so two values that say the same compare as equal. */
export function stable(value: Json | undefined): string {
  if (value === undefined) return ''
  if (Array.isArray(value)) return `[${value.map(stable).join(',')}]`
  if (value !== null && typeof value === 'object')
    return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${stable(value[key])}`).join(',')}}`
  return JSON.stringify(value)
}

/** The sections whose content differs between two saved card bodies. */
export function changedSections(sections: { label: string; fields: string[] }[], before: Json | undefined, after: Json | undefined): string[] {
  const field = (body: Json | undefined, name: string) =>
    body !== null && typeof body === 'object' && !Array.isArray(body) ? body[name] : undefined
  return sections
    .filter((section) => section.fields.some((name) => stable(field(before, name)) !== stable(field(after, name))))
    .map((section) => section.label)
}
