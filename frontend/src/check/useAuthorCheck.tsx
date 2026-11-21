// Author check, as one self-contained piece (see protocol.ts for what it is).
//
// The editor calls this hook and places what it gets back: a mark for each section in the list,
// a line at the top of the open section, and a sentence for the toolbar. Outside an author
// check the hook returns null and the editor looks exactly as it does on its own.

import { useEffect, useMemo, useRef } from 'react'
import type { ReactNode } from 'react'
import { exportCard, rootKey, setAt } from '../schema.ts'
import type { Json, Schema, Section } from '../schema.ts'
import { changedSections, listenForFinish, reportProgress } from './protocol.ts'
import type { CheckRequest } from './protocol.ts'

interface CheckOptions {
  host: { origin: string; name: string } | null
  check: CheckRequest | null
  schema: Schema
  cardType: 'dataset' | 'model'
  sections: Section[]
  body: Json
  card: Record<string, Json> // the card exactly as it would be saved
  problems: number | null // null while the card is being checked
  onBody: (body: Json) => void
  /** The server's check, as before a download: resolves false (after showing why) if the card is not valid. */
  confirmValid: () => Promise<boolean>
}

export interface AuthorCheck {
  mark: (section: Section) => ReactNode
  line: (section: Section) => ReactNode
  summary: string
}

export function useAuthorCheck(options: CheckOptions): AuthorCheck | null {
  const { host, check, schema, cardType, sections, body, card, problems, onBody } = options
  const root = rootKey(cardType)
  const original = useMemo(() => (check?.original[root] ?? {}) as Json, [check, root])
  const savedOriginal = useMemo(() => exportCard(original, schema, cardType)[root], [original, schema, cardType, root])
  const changed = useMemo(() => (check ? changedSections(sections, savedOriginal, card[root]) : []), [check, sections, savedOriginal, card, root])

  const current = useRef({ card, changed, problems, confirmValid: options.confirmValid })
  useEffect(() => {
    current.current = { card, changed, problems, confirmValid: options.confirmValid }
  })

  // Tell the host a moment after every change, so it can keep the author's work.
  useEffect(() => {
    if (!host || !check || problems === null) return
    const timer = setTimeout(() => reportProgress(host.origin, { cardType, card, changed, problems }), 500)
    return () => clearTimeout(timer)
  }, [host, check, cardType, card, changed, problems])

  // The host's final button: nothing counts as reviewed unless the server confirms the card is valid.
  useEffect(() => {
    if (!host || !check) return
    return listenForFinish(host.origin, async () => {
      const now = current.current
      const answer = { cardType, card: now.card, changed: now.changed }
      if (now.problems === null) return { ...answer, ok: false, reason: 'The card is still being checked. Try again in a moment.' }
      if (now.problems > 0)
        return { ...answer, ok: false, reason: `${now.problems} thing${now.problems === 1 ? ' needs' : 's need'} fixing first. They are listed above the card, under “What to fix”.` }
      const valid = await now.confirmValid()
      return valid ? { ...answer, ok: true } : { ...answer, ok: false, reason: 'The card does not fit the ATLAS schema yet. What to fix is listed above the card.' }
    })
  }, [host, check, cardType])

  if (!host || !check) return null

  const edited = (section: Section) => changed.includes(section.label)
  const undo = (section: Section) => {
    let next: Json | undefined = body
    for (const name of section.fields) next = setAt(next, [name], (original as Record<string, Json>)?.[name])
    onBody(next ?? {})
  }

  const mark = (section: Section) => {
    const text = edited(section) ? 'Edited by you' : 'Right'
    return <span className={`check-mark ${edited(section) ? 'changed' : 'right'}`} title={text} aria-label={text}>{edited(section) ? '✎' : '✓'}</span>
  }

  const line = (section: Section) =>
    edited(section) ? (
      <p className="check-line changed">
        <strong><span aria-hidden="true">✎</span> Edited by you.</strong> Your version of this section is kept.{' '}
        <button type="button" className="link" onClick={() => undo(section)}>Undo my changes in this section</button>
      </p>
    ) : (
      <p className="check-line right">
        <strong><span aria-hidden="true">✓</span> Right as it is.</strong> If something in this section is wrong, simply correct it below.
      </p>
    )

  const parts = [`${sections.length - changed.length} of ${sections.length} sections right as they are`]
  if (changed.length) parts.push(`${changed.length} edited by you`)
  return { mark, line, summary: parts.join(' · ') }
}
