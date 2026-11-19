// The card editor: one section of the card per screen, a list of what still needs fixing,
// and the paper beside it when one was uploaded.

import { useEffect, useMemo, useRef, useState } from 'react'
import { serverValidate, tidyCard } from './api.ts'
import type { CardType, Extraction, Problem } from './api.ts'
import { Field, FormProvider, ObjectFields } from './form.tsx'
import { exportCard, getAt, isEmpty, kindOf, pathOf, resolve, rootKey, sectionsOf, setAt, toEditorPointer } from './schema.ts'
import type { Json, Path, Schema } from './schema.ts'
import { detectCardType, locate, validateCard } from './validate.ts'

interface EditorProps {
  schema: Schema
  cardType: CardType
  body: Json
  onBody: (body: Json) => void
  onCardType: (cardType: CardType) => void
  extraction: Extraction | null
  adjustments: string[]
  onAdjustments: (list: string[]) => void
  paper: File | null
  fileName: string
  onStartOver: () => void
}

export default function Editor(props: EditorProps) {
  const { schema, cardType, body, onBody, extraction, adjustments, paper, fileName } = props
  const root = rootKey(cardType)
  const sections = useMemo(() => sectionsOf(schema, cardType), [schema, cardType])
  const bodyNode = useMemo(() => resolve(schema.properties[root], schema), [schema, root])
  const [section, setSection] = useState(sections[0]?.key ?? '')
  const [view, setView] = useState<'form' | 'json'>('form')
  const [problems, setProblems] = useState<Problem[] | null>(null)
  const [focus, setFocus] = useState<{ pointer: string; tick: number } | null>(null)
  const [showPaper, setShowPaper] = useState(false)
  const [notice, setNotice] = useState<{ tone: 'ok' | 'bad' | 'warn'; text: string } | null>(null)
  const [working, setWorking] = useState(false)
  const main = useRef<HTMLDivElement>(null)
  const paperUrl = useMemo(() => (paper ? URL.createObjectURL(paper) : null), [paper])
  useEffect(() => () => void (paperUrl && URL.revokeObjectURL(paperUrl)), [paperUrl])

  const card = useMemo(() => exportCard(body, schema, cardType), [body, schema, cardType])

  // Check the card in the browser on every change (instant; the server re-checks on download).
  useEffect(() => {
    let current = true
    const timer = setTimeout(() => {
      const kept = new Map<string, number[]>()
      const saved = exportCard(body, schema, cardType, kept)
      validateCard(saved, cardType).then(
        (found) => {
          if (!current) return
          setProblems(
            found.map((problem) => {
              const pointer = toEditorPointer(problem.pointer, kept)
              return { ...problem, pointer, location: locate(pointer) }
            }),
          )
        },
        () => current && setProblems(null),
      )
    }, 200)
    return () => {
      current = false
      clearTimeout(timer)
    }
  }, [body, schema, cardType])

  const byPointer = useMemo(() => {
    const map = new Map<string, string[]>()
    for (const problem of problems ?? []) map.set(problem.pointer, [...(map.get(problem.pointer) ?? []), problem.message])
    return map
  }, [problems])

  const change = (path: Path, value: Json | undefined) => {
    setNotice(null)
    onBody(setAt(body, path.slice(1), value) ?? {})
  }

  const sectionOf = (pointer: string): string => {
    const key = pathOf(pointer)[1]
    return sections.find((candidate) => candidate.key === key)?.key ?? sections[0].key
  }
  const count = (key: string) =>
    (problems ?? []).filter((problem) => {
      const top = String(pathOf(problem.pointer)[1] ?? '')
      const owner = sections.find((candidate) => candidate.key === top || candidate.fields.includes(top))
      return (owner?.key ?? sections[0].key) === key
    }).length

  const jump = (problem: Problem) => {
    setView('form')
    const top = String(pathOf(problem.pointer)[1] ?? '')
    const owner = sections.find((candidate) => candidate.key === top || candidate.fields.includes(top))
    setSection(owner?.key ?? sectionOf(problem.pointer))
    setFocus({ pointer: problem.pointer, tick: Date.now() })
  }

  // After a jump: scroll to the field (the deepest rendered ancestor of the pointer) and focus it.
  useEffect(() => {
    if (!focus) return
    const timer = setTimeout(() => {
      let best: HTMLElement | null = null
      for (const element of main.current?.querySelectorAll<HTMLElement>('[data-pointer]') ?? []) {
        const pointer = element.dataset.pointer ?? ''
        if ((focus.pointer === pointer || focus.pointer.startsWith(pointer + '/')) && pointer.length >= (best?.dataset.pointer ?? '').length)
          best = element
      }
      if (!best) return
      best.scrollIntoView({ behavior: 'smooth', block: 'center' })
      best.classList.add('flash')
      best.querySelector<HTMLElement>('input, select, textarea')?.focus({ preventScroll: true })
      setTimeout(() => best?.classList.remove('flash'), 1600)
    }, 80)
    return () => clearTimeout(timer)
  }, [focus])

  const save = (draft: boolean) => {
    const url = URL.createObjectURL(new Blob([JSON.stringify(card, null, 2) + '\n'], { type: 'application/json' }))
    const link = document.createElement('a')
    link.href = url
    link.download = `${fileName}.${cardType}${draft ? '.draft' : ''}.json`
    link.click()
    URL.revokeObjectURL(url)
  }

  const download = async () => {
    setWorking(true)
    try {
      const verdict = await serverValidate(card, cardType) // the server's check is the authority
      if (verdict.valid) {
        save(false)
        setNotice({ tone: 'ok', text: 'Downloaded. The server confirmed this is a valid ATLAS card.' })
      } else {
        setProblems(verdict.errors)
        setNotice({ tone: 'bad', text: 'The server found problems, so the card was not downloaded. Fix the items listed.' })
      }
    } catch (error) {
      setNotice({ tone: 'bad', text: `Could not check the card with the server (${(error as Error).message}). Nothing was downloaded.` })
    } finally {
      setWorking(false)
    }
  }

  const tidy = async () => {
    setWorking(true)
    try {
      const result = await tidyCard({ [root]: body }, cardType)
      onBody((result.card[root] as Json) ?? {})
      props.onAdjustments(result.warnings)
      setNotice({
        tone: result.valid ? 'ok' : 'warn',
        text: `Tidied to the ATLAS schema: ${result.warnings.length} change${result.warnings.length === 1 ? '' : 's'} (listed under "automatic adjustments").`,
      })
    } catch (error) {
      setNotice({ tone: 'bad', text: (error as Error).message })
    } finally {
      setWorking(false)
    }
  }

  const total = problems?.length ?? 0
  const foreign = (problems ?? []).some((problem) => problem.keyword === 'additionalProperties')
  const active = sections.find((candidate) => candidate.key === section) ?? sections[0]

  return (
    <div className={`editor ${showPaper && paperUrl ? 'with-paper' : ''}`}>
      <div className="editor-bar">
        <div className={`status ${problems === null ? 'warn' : total ? 'warn' : 'ok'}`} role="status">
          {problems === null
            ? 'Checking…'
            : total
              ? `${total} thing${total === 1 ? '' : 's'} to fix before this is a valid ATLAS ${cardType} card`
              : `Valid ATLAS ${cardType} card`}
        </div>
        <div className="bar-actions">
          {paperUrl && (
            <button type="button" onClick={() => setShowPaper(!showPaper)}>
              {showPaper ? 'Hide paper' : 'Show paper'}
            </button>
          )}
          <div className="segmented small" role="tablist" aria-label="View">
            <button type="button" role="tab" aria-selected={view === 'form'} className={view === 'form' ? 'selected' : ''} onClick={() => setView('form')}>Form</button>
            <button type="button" role="tab" aria-selected={view === 'json'} className={view === 'json' ? 'selected' : ''} onClick={() => setView('json')}>JSON</button>
          </div>
          <button type="button" onClick={() => save(true)} title="Save what you have so far, even if it is not valid yet">Save draft</button>
          <button type="button" className="primary" disabled={working || problems === null || total > 0} onClick={download}
            title={total ? 'Fix the listed items first' : 'Check with the server and download'}>
            Download card
          </button>
        </div>
      </div>

      {notice && <p className={`banner ${notice.tone}`}>{notice.text}</p>}

      {total > 0 && (
        <details className="todo" open>
          <summary>What to fix ({total})</summary>
          <ul>
            {(problems ?? []).map((problem) => (
              <li key={problem.pointer + problem.message}>
                <button type="button" className="link" onClick={() => jump(problem)}>{problem.location}</button>
                <span> {problem.message}</span>
              </li>
            ))}
          </ul>
          {foreign && (
            <p>
              <button type="button" disabled={working} onClick={tidy}>Tidy to the ATLAS schema</button>
              <span className="muted"> Renames fields the schema spells differently and removes the ones it does not have. Every change is listed.</span>
            </p>
          )}
        </details>
      )}

      {adjustments.length > 0 && (
        <details className="todo quiet">
          <summary>{adjustments.length} automatic adjustment{adjustments.length === 1 ? '' : 's'} made to fit the ATLAS schema</summary>
          <ul>
            {adjustments.map((line) => (
              <li key={line}>{line}</li>
            ))}
          </ul>
        </details>
      )}

      <div className="editor-body">
        {view === 'form' ? (
          <>
            <nav className="sections" aria-label="Card sections">
              {sections.map((candidate) => {
                const filled = candidate.fields.some((field) => !isEmpty(getAt(body, [field])))
                const issues = count(candidate.key)
                return (
                  <button type="button" key={candidate.key} className={candidate.key === section ? 'current' : ''}
                    aria-current={candidate.key === section ? 'page' : undefined} onClick={() => setSection(candidate.key)}>
                    <span className={`dot ${filled ? 'filled' : ''}`} aria-hidden="true" />
                    <span className="name">{candidate.label}</span>
                    {issues > 0 && <span className="badge bad">{issues}</span>}
                  </button>
                )
              })}
            </nav>
            <div className="section" ref={main}>
              <FormProvider value={{ root: schema, problems: byPointer, focus, change }}>
                <h2>{active.label}</h2>
                <SectionBody key={`${cardType}:${active.key}`} schema={schema} bodyNode={bodyNode} root={root} fields={active.fields} body={body} />
              </FormProvider>
            </div>
          </>
        ) : (
          <JsonView card={card} cardType={cardType} root={root} onBody={onBody} onCardType={props.onCardType} />
        )}
        {showPaper && paperUrl && <iframe className="paper" title="The uploaded paper" src={paperUrl} />}
      </div>

      <footer className="editor-foot muted">
        {extraction && (
          <span>
            Read by {extraction.meta.model}
            {extraction.meta.repaired ? ', corrected once automatically' : ''} · cost {extraction.meta.cost_is_estimate ? 'about ' : ''}$
            {extraction.meta.cost_usd.toFixed(2)} ·{' '}
          </span>
        )}
        <button type="button" className="link" onClick={props.onStartOver}>Start another card</button>
      </footer>
    </div>
  )
}

function SectionBody({ schema, bodyNode, root, fields, body }: { schema: Schema; bodyNode: Schema; root: string; fields: string[]; body: Json }) {
  const required: string[] = bodyNode.required ?? []
  // A section that is one group shows that group's fields directly, all of them, so nothing
  // the schema allows is hidden; loose fields (Name, Link) are shown as they are.
  if (fields.length === 1) {
    const node = resolve(bodyNode.properties[fields[0]], schema)
    if (kindOf(node, schema) === 'group')
      return (
        <>
          {node.description && <p className="help lead">{node.description}</p>}
          <ObjectFields node={node} path={[root, fields[0]]} value={getAt(body, [fields[0]])} />
        </>
      )
  }
  return (
    <div className="fields">
      {fields.map((field) => (
        <Field key={field} name={field} node={bodyNode.properties[field]} path={[root, field]} value={getAt(body, [field])} required={required.includes(field)} />
      ))}
    </div>
  )
}

function JsonView({ card, cardType, root, onBody, onCardType }: { card: Record<string, Json>; cardType: CardType; root: string; onBody: (body: Json) => void; onCardType: (cardType: CardType) => void }) {
  const [text, setText] = useState(() => JSON.stringify(card, null, 2))
  const [trouble, setTrouble] = useState<string | null>(null)
  const edit = (next: string) => {
    setText(next)
    try {
      const parsed = JSON.parse(next) as Json
      if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) {
        setTrouble('A card is a JSON object: { … }')
        return
      }
      const kind = detectCardType(parsed) ?? cardType
      const key = kind === cardType ? root : rootKey(kind)
      const extra = Object.keys(parsed).filter((name) => name !== '$schema' && name !== key)
      setTrouble(extra.length ? `Only "$schema" and "${key}" belong at the top level; ${extra.map((name) => `"${name}"`).join(', ')} will not be saved.` : null)
      if (kind !== cardType) onCardType(kind)
      onBody((parsed as Record<string, Json>)[key] ?? {})
    } catch (error) {
      setTrouble(`Not valid JSON yet: ${(error as Error).message}`)
    }
  }
  return (
    <div className="section json">
      <p className="help lead">The card exactly as it will be saved. You can edit it here; the form and the checks follow.</p>
      {trouble && <p className="banner warn">{trouble}</p>}
      <textarea value={text} spellCheck={false} aria-label="Card JSON" onChange={(event) => edit(event.target.value)} />
    </div>
  )
}
