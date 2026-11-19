import { useEffect, useMemo, useRef, useState } from 'react'
import type { ChangeEvent, DragEvent } from 'react'
import { getHealth, sendPaper, waitForCard } from './api.ts'
import type { CardType, Extraction, Health } from './api.ts'
import Editor from './Editor.tsx'
import { announce, hostPage, listenForCards } from './send/protocol.ts'
import { rootKey } from './schema.ts'
import type { Json, Schema } from './schema.ts'
import { detectCardType, loadSchema } from './validate.ts'

const DRAFT_KEY = 'roadmap-card-draft'
const KINDS: { kind: CardType; label: string }[] = [
  { kind: 'dataset', label: 'Dataset card' },
  { kind: 'model', label: 'Model card' },
]

// Who receives an uploaded paper, by provider setting on the server.
const READERS: Record<string, string> = {
  gemini: "Google's Gemini service",
  anthropic: "Anthropic's Claude service",
}

interface Draft {
  cardType: CardType
  body: Json
  fileName: string
  savedAt: string
}

// A paper that is being read on the server. Remembered in the browser so that a reloaded page,
// or a phone that put the page to sleep, picks the card up instead of losing it.
const JOB_KEY = 'roadmap-card-job'

interface Pending {
  jobId: string
  cardType: CardType
  name: string
  startedAt: number
}

function readPending(): Pending | null {
  try {
    const pending = JSON.parse(localStorage.getItem(JOB_KEY) ?? 'null') as Pending | null
    return pending && pending.jobId && Date.now() - pending.startedAt < 25 * 60 * 1000 ? pending : null
  } catch {
    return null
  }
}

function storePending(pending: Pending | null) {
  try {
    if (pending) localStorage.setItem(JOB_KEY, JSON.stringify(pending))
    else localStorage.removeItem(JOB_KEY)
  } catch {
    // private window: the paper is still read, it just cannot be picked up after a reload
  }
}

function readDraft(): Draft | null {
  try {
    const draft = JSON.parse(localStorage.getItem(DRAFT_KEY) ?? 'null') as Draft | null
    return draft && draft.body && (draft.cardType === 'dataset' || draft.cardType === 'model') ? draft : null
  } catch {
    return null
  }
}

export default function App() {
  const [health, setHealth] = useState<Health | null>(null)
  const [offline, setOffline] = useState(false)
  const [cardType, setCardType] = useState<CardType>('dataset')
  // The schema is kept together with the card type it belongs to, so the editor can never be
  // shown a model card with the dataset schema (or the reverse) while the other one loads.
  const [loaded, setLoaded] = useState<{ cardType: CardType; schema: Schema } | null>(null)
  const [file, setFile] = useState<File | null>(null) // the PDF, once chosen
  const [dragging, setDragging] = useState(false)
  const [reading, setReading] = useState<{ name: string; startedAt: number } | null>(null) // a paper being read
  const busy = reading !== null
  const [seconds, setSeconds] = useState(0)
  const [failure, setFailure] = useState<string | null>(null)
  const [askBlank, setAskBlank] = useState(false)
  const [body, setBody] = useState<Json | null>(null) // null = start screen
  const [extraction, setExtraction] = useState<Extraction | null>(null)
  const [adjustments, setAdjustments] = useState<string[]>([])
  const [fileName, setFileName] = useState('card')
  const [draft, setDraft] = useState<Draft | null>(readDraft)
  const request = useRef<AbortController | null>(null)
  const pdfInput = useRef<HTMLInputElement>(null)
  const cardInput = useRef<HTMLInputElement>(null)

  const refreshHealth = () => getHealth().then(setHealth, () => setOffline(true))
  useEffect(() => {
    refreshHealth()
  }, [])

  useEffect(() => {
    let current = true
    loadSchema(cardType).then(
      (schema) => current && setLoaded({ cardType, schema }),
      () => current && setOffline(true),
    )
    return () => {
      current = false
    }
  }, [cardType])

  useEffect(() => {
    if (!reading) return
    const tick = () => setSeconds(Math.round((Date.now() - reading.startedAt) / 1000))
    tick()
    const timer = setInterval(tick, 1000)
    return () => clearInterval(timer)
  }, [reading])

  // Keep the card in this browser so a refresh or a closed tab does not lose the work.
  useEffect(() => {
    if (body === null) return
    const timer = setTimeout(() => {
      try {
        localStorage.setItem(DRAFT_KEY, JSON.stringify({ cardType, body, fileName, savedAt: new Date().toISOString() }))
      } catch {
        // private window or full storage: the card simply is not remembered
      }
    }, 400)
    return () => clearTimeout(timer)
  }, [body, cardType, fileName])

  const open = (kind: CardType, nextBody: Json, name: string, result: Extraction | null = null) => {
    setCardType(kind)
    setBody(nextBody)
    setFileName(name)
    setExtraction(result)
    setAdjustments(result?.warnings ?? [])
    setFailure(null)
    setAskBlank(false)
  }

  /** Open a card that is already an object. Its own content says whether it is a dataset or a model card. */
  function openParsed(record: Record<string, Json>, name: string) {
    const kind = detectCardType(record) ?? ('Model properties' in record || 'Model performance' in record ? 'model' : 'dataset')
    // A card without the "Dataset"/"Model" wrapper is opened as the body itself, so its
    // fields show up in "What to fix" instead of being dropped silently.
    const { $schema: _ignored, ...rest } = record
    setFile(null)
    open(kind, record[rootKey(kind)] ?? rest, name)
  }

  /** Open an existing card file. */
  function openCard(candidate: File) {
    const name = candidate.name.replace(/\.json$/i, '').replace(/\.(dataset|model)(\.draft)?$/i, '')
    candidate.text().then((content) => {
      try {
        const parsed = JSON.parse(content) as Json
        if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) throw new Error('not a card')
        openParsed(parsed as Record<string, Json>, name)
      } catch {
        setFailure('That file is not a card: it does not contain valid JSON.')
      }
    })
  }

  function choose(candidate: File | undefined) {
    if (!candidate) return
    setFailure(null)
    setAskBlank(false)
    if (candidate.name.toLowerCase().endsWith('.json')) return openCard(candidate)
    if (candidate.type !== 'application/pdf' && !candidate.name.toLowerCase().endsWith('.pdf')) {
      setFailure('Choose the PDF of the paper, or a card (.json) file to open.')
      return
    }
    const limit = health?.max_upload_mb ?? 20
    if (candidate.size > limit * 1024 * 1024) {
      setFailure(`That PDF is larger than ${limit} MB.`)
      return
    }
    setFile(candidate)
  }

  function onDrop(event: DragEvent) {
    event.preventDefault()
    setDragging(false)
    if (!busy) choose(event.dataTransfer.files[0])
  }

  /** Wait for a paper the server is reading, then open its card. */
  async function follow(pending: Pending, controller: AbortController) {
    setReading({ name: pending.name, startedAt: pending.startedAt })
    setFailure(null)
    try {
      const result = await waitForCard(pending.jobId, controller.signal)
      storePending(null)
      open(pending.cardType, (result.card[rootKey(pending.cardType)] as Json) ?? {}, pending.name, result)
      refreshHealth()
    } catch (error) {
      if (controller.signal.aborted) return // cancelled by the person, or the page is going away
      storePending(null)
      setFailure((error as Error).message)
    } finally {
      if (request.current === controller) setReading(null)
    }
  }

  async function create(kind: CardType) {
    if (!file) return
    const controller = new AbortController()
    request.current = controller
    const pending = { jobId: '', cardType: kind, name: file.name.replace(/\.pdf$/i, ''), startedAt: Date.now() }
    setCardType(kind)
    setReading({ name: pending.name, startedAt: pending.startedAt })
    setFailure(null)
    try {
      pending.jobId = await sendPaper(kind, file, controller.signal)
    } catch (error) {
      if (!controller.signal.aborted) setFailure((error as Error).message)
      setReading(null)
      return
    }
    storePending(pending)
    await follow(pending, controller)
  }

  const cancel = () => {
    storePending(null)
    request.current?.abort()
    setReading(null)
  }

  // A paper was still being read when this page was last open (reload, or a phone that put
  // the page to sleep): pick it up again.
  useEffect(() => {
    const pending = readPending()
    if (!pending) return
    const controller = new AbortController()
    request.current = controller
    void follow(pending, controller)
    return () => controller.abort()
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

  const startOver = () => {
    setDraft(readDraft())
    setBody(null)
    setFile(null)
    setExtraction(null)
  }

  const picked = (event: ChangeEvent<HTMLInputElement>) => {
    choose(event.target.files?.[0])
    event.target.value = ''
  }

  const canRead = health?.configured === true && !health.budget.paused

  // Shown inside a site that may receive cards (ATLAS)? Then offer "Send to ...", and open the
  // cards that site asks to have edited. On its own, the app has neither.
  const host = useMemo(() => {
    const origin = health ? hostPage(health.embed_origins ?? []) : null
    return origin ? { origin, name: health?.embed_name || 'ATLAS' } : null
  }, [health])
  // A card the host asks to open never silently replaces one that is being edited: it waits
  // for an answer, asked in the page (a frame may not be allowed to open pop-up questions).
  const [incoming, setIncoming] = useState<{ card: Record<string, Json>; title: string } | null>(null)
  const arrived = (card: Record<string, Json>, title: string) => (body === null ? openParsed(card, title) : setIncoming({ card, title }))
  const arrivedRef = useRef(arrived)
  arrivedRef.current = arrived
  useEffect(() => {
    if (!host) return
    const stop = listenForCards(host.origin, (card, title) => arrivedRef.current(card as Record<string, Json>, title))
    announce(host.origin) // tell the site around this app that it is ready
    return stop
  }, [host])
  const schema = loaded?.cardType === cardType ? loaded.schema : null
  const editing = body !== null && schema !== null

  return (
    <div className={`page ${editing ? 'wide' : ''}`}>
      <header>
        <div>
          <h1>
            ROADMAP Card Creator <span className="version">V2</span>
          </h1>
          <p className="muted">Create, check and edit RSNA ATLAS dataset and model cards.</p>
        </div>
        {health && <span className={`pill ${health.configured ? 'ok' : 'warn'}`}>{health.configured ? health.model : 'No API key configured'}</span>}
      </header>

      {offline && <p className="banner bad">Cannot reach the server. Check that it is running (<code>docker compose up</code>).</p>}
      {incoming && host && (
        <p className="banner warn" role="alert">
          {host.name} asks to open “{incoming.title}” here. That would replace the card you have open.{' '}
          <button type="button" className="link" onClick={() => {
            openParsed(incoming.card, incoming.title)
            setIncoming(null)
          }}>Open it</button>{' · '}
          <button type="button" className="link" onClick={() => setIncoming(null)}>Keep my card</button>
        </p>
      )}
      {body !== null && !schema && !offline && <p className="muted">Loading the ATLAS schema…</p>}

      {editing ? (
        <Editor schema={schema} cardType={cardType} body={body} onBody={setBody} onCardType={setCardType} extraction={extraction}
          adjustments={adjustments} onAdjustments={setAdjustments} paper={file} fileName={fileName} onStartOver={startOver} host={host} />
      ) : body !== null ? null : (
        <>
          {health && !health.configured && (
            <p className="banner warn">
              Creating a card from a PDF is switched off until an API key is added to the <code>.env</code> file. Opening a card and
              starting a blank one still work.
            </p>
          )}
          {health?.configured && health.budget.paused && (
            <p className="banner warn">
              This month's budget for reading papers has been used up, so creating a card from a PDF is paused until the 1st. Opening
              a card and starting a blank one still work.
            </p>
          )}
          {failure && <p className="banner bad">{failure}</p>}

          <input ref={pdfInput} className="hidden-input" type="file" accept="application/pdf,.pdf" onChange={picked} tabIndex={-1} aria-hidden="true" />
          <input ref={cardInput} className="hidden-input" type="file" accept="application/json,.json" onChange={picked} tabIndex={-1} aria-hidden="true" />

          <section className={`panel start-main ${dragging ? 'over' : ''}`}
            onDragOver={(event) => {
              event.preventDefault()
              setDragging(true)
            }}
            onDragLeave={() => setDragging(false)} onDrop={onDrop}>
            <h2>Create a card from a paper</h2>
            {reading ? (
              <div className="step">
                <p><strong>Reading {reading.name}…</strong></p>
                <p className="muted" aria-live="polite">{seconds}s · usually takes less than 2 minutes</p>
                <p className="muted">
                  You can switch to another app or lock your screen in the meantime. The card will be here when you come back.
                </p>
                <button type="button" onClick={cancel}>Cancel</button>
              </div>
            ) : !file ? (
              <button type="button" className="drop" onClick={() => pdfInput.current?.click()}>
                <strong>Drop the paper's PDF here</strong> or click to choose it
                <span className="muted block">The paper is read for you and the card is filled in. You review and edit it afterwards.</span>
              </button>
            ) : (
              <div className="step">
                <p>
                  <strong>{file.name}</strong>
                  <span className="muted"> · {(file.size / 1024 / 1024).toFixed(1)} MB · </span>
                  <button type="button" className="link" onClick={() => setFile(null)}>choose another</button>
                </p>
                <p className="question">What does this paper describe?</p>
                <div className="row">
                  {KINDS.map(({ kind, label }) => (
                    <button type="button" key={kind} className="primary" disabled={!canRead} onClick={() => create(kind)}>
                      {kind === 'dataset' ? 'A dataset' : 'A model'}
                      <span className="sub"> → {label.toLowerCase()}</span>
                    </button>
                  ))}
                </div>
              </div>
            )}
            {health?.configured && (
              <p className="muted notice">
                To read a paper, its PDF is sent to {READERS[health.provider] ?? 'an outside AI service'}. Opening or editing a card
                sends nothing outside this site.
              </p>
            )}
          </section>

          <div className="start-others">
            <section className="panel">
              <h2>Open an existing card</h2>
              <p className="muted">Check and edit a card file (.json) you already have.</p>
              <button type="button" disabled={busy} onClick={() => cardInput.current?.click()}>Choose a card file…</button>
              {draft && (
                <button type="button" disabled={busy} onClick={() => open(draft.cardType, draft.body, draft.fileName)}>
                  Continue “{draft.fileName}” <span className="muted">({draft.cardType}, {new Date(draft.savedAt).toLocaleString([], { dateStyle: 'medium', timeStyle: 'short' })})</span>
                </button>
              )}
            </section>
            <section className="panel">
              <h2>Start a blank card</h2>
              <p className="muted">Fill in a card by hand, with the same checks.</p>
              {askBlank ? (
                <div className="row">
                  {KINDS.map(({ kind, label }) => (
                    <button type="button" key={kind} disabled={busy} onClick={() => open(kind, {}, 'card')}>{label}</button>
                  ))}
                </div>
              ) : (
                <button type="button" disabled={busy} onClick={() => setAskBlank(true)}>Blank card…</button>
              )}
            </section>
          </div>

          {health && (
            <p className="muted fine">
              Cards are checked against the schema ATLAS publishes ({health.schemas.dataset.source === 'bundled' ? 'built-in copy' : 'read from atlas.rsna.org'}
              ). <Usage budget={health.budget} />
              PDFs up to {health.max_pdf_pages} pages.
            </p>
          )}
        </>
      )}
    </div>
  )
}

/** The month's paper count and spending; shown only when the server chooses to share it. */
function Usage({ budget }: { budget: Health['budget'] }) {
  if (budget.spent_usd === undefined) return null
  const spent = budget.spent_usd.toFixed(2)
  const limit = (budget.monthly_budget_usd ?? 0).toFixed(0)
  return (
    <>
      Papers read this month: {budget.papers_this_month} (US$ {spent} of {limit}).{' '}
    </>
  )
}
