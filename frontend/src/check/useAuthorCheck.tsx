// Author check, as one self-contained piece (see protocol.ts for what it is).
//
// The editor calls this hook and places what it gets back: a mark for each section in the list,
// a line at the top of the open section, and a sentence for the toolbar. Outside an author
// check the hook returns null and the editor looks exactly as it does on its own.

import { useEffect, useMemo, useRef, useState } from 'react'
import type { ReactNode } from 'react'
import { exportCard, rootKey, setAt } from '../schema.ts'
import type { Json, Schema, Section } from '../schema.ts'
import { changedSections, listenForFinish, reportProgress } from './protocol.ts'
import type { CheckRequest } from './protocol.ts'

export type SectionState = 'right' | 'changed' | 'flagged'

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
  const [flagged, setFlagged] = useState<string[]>(check?.flagged ?? [])
  const original = useMemo(() => (check?.original[root] ?? {}) as Json, [check, root])
  const savedOriginal = useMemo(() => exportCard(original, schema, cardType)[root], [original, schema, cardType, root])
  const changed = useMemo(() => (check ? changedSections(sections, savedOriginal, card[root]) : []), [check, sections, savedOriginal, card, root])
  // a changed section is the author's own version, so it is no longer "not right"
  const stillFlagged = useMemo(() => flagged.filter((label) => !changed.includes(label) && sections.some((section) => section.label === label)), [flagged, changed, sections])

  const current = useRef({ card, changed, flagged: stillFlagged, problems, confirmValid: options.confirmValid })
  useEffect(() => {
    current.current = { card, changed, flagged: stillFlagged, problems, confirmValid: options.confirmValid }
  })

  // Tell the host a moment after every change, so it can keep the author's work.
  useEffect(() => {
    if (!host || !check || problems === null) return
    const timer = setTimeout(() => reportProgress(host.origin, { cardType, card, changed, flagged: stillFlagged, problems }), 500)
    return () => clearTimeout(timer)
  }, [host, check, cardType, card, changed, stillFlagged, problems])

  // The host's final button: nothing counts as reviewed unless the server confirms the card is valid.
  useEffect(() => {
    if (!host || !check) return
    return listenForFinish(host.origin, async () => {
      const now = current.current
      const answer = { cardType, card: now.card, changed: now.changed, flagged: now.flagged }
      if (now.problems === null) return { ...answer, ok: false, reason: 'The card is still being checked. Try again in a moment.' }
      if (now.problems > 0)
        return { ...answer, ok: false, reason: `${now.problems} thing${now.problems === 1 ? ' needs' : 's need'} fixing first. They are listed above the card, under “What to fix”.` }
      const valid = await now.confirmValid()
      return valid ? { ...answer, ok: true } : { ...answer, ok: false, reason: 'The card does not fit the ATLAS schema yet. What to fix is listed above the card.' }
    })
  }, [host, check, cardType])

  if (!host || !check) return null

  const stateOf = (section: Section): SectionState =>
    changed.includes(section.label) ? 'changed' : stillFlagged.includes(section.label) ? 'flagged' : 'right'
  const flag = (section: Section, on: boolean) =>
    setFlagged((now) => (on ? [...new Set([...now, section.label])] : now.filter((label) => label !== section.label)))
  const undo = (section: Section) => {
    let next: Json | undefined = body
    for (const name of section.fields) next = setAt(next, [name], (original as Record<string, Json>)?.[name])
    onBody(next ?? {})
  }

  const mark = (section: Section) => {
    const state = stateOf(section)
    const text = { right: 'Right', changed: 'Changed by you', flagged: 'Marked as not right' }[state]
    return <span className={`check-mark ${state}`} title={text} aria-label={text}>{{ right: '✓', changed: '✎', flagged: '✕' }[state]}</span>
  }

  const line = (section: Section) => {
    const state = stateOf(section)
    if (state === 'changed')
      return (
        <p className="check-line changed">
          <strong>Changed by you.</strong> Your version of this section is kept.{' '}
          <button type="button" className="link" onClick={() => undo(section)}>Undo my changes in this section</button>
        </p>
      )
    return (
      <div className={`check-line ${state}`}>
        <label>
          <input type="checkbox" checked={state === 'right'} onChange={(event) => flag(section, !event.target.checked)} />
          <strong>This section is right</strong>
        </label>
        <span className="help">
          {state === 'right'
            ? 'Leave the tick if everything here is correct. If something is wrong, simply correct it below.'
            : 'Marked as not right. Correct it below if you can, or say what is wrong in the comments under the card.'}
        </span>
      </div>
    )
  }

  const parts = [`${sections.length - changed.length - stillFlagged.length} of ${sections.length} sections right`]
  if (changed.length) parts.push(`${changed.length} changed by you`)
  if (stillFlagged.length) parts.push(`${stillFlagged.length} marked as not right`)
  return { mark, line, summary: parts.join(' · ') }
}
