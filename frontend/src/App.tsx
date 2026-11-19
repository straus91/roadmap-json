import { useEffect, useRef, useState } from 'react'
import type { ChangeEvent, DragEvent } from 'react'
import { extractCard, getHealth } from './api.ts'
import type { CardType, Extraction, Health } from './api.ts'
import Editor from './Editor.tsx'
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
  const [busy, setBusy] = useState(false)
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
    if (!busy) return
    const started = Date.now()
    const timer = setInterval(() => setSeconds(Math.round((Date.now() - started) / 1000)), 1000)
    return () => clearInterval(timer)
  }, [busy])

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

  /** Open an existing card file. Its own content says whether it is a dataset or a model card. */
  function openCard(candidate: File) {
    const name = candidate.name.replace(/\.json$/i, '').replace(/\.(dataset|model)(\.draft)?$/i, '')
    candidate.text().then((content) => {
      try {
        const parsed = JSON.parse(content) as Json
        if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) throw new Error('not a card')
        const record = parsed as Record<string, Json>
        const kind = detectCardType(parsed) ?? ('Model properties' in record || 'Model performance' in record ? 'model' : 'dataset')
        // A file without the "Dataset"/"Model" wrapper is opened as the body itself, so its
        // fields show up in "What to fix" instead of being dropped silently.
        const { $schema: _ignored, ...rest } = record
        setFile(null)
        open(kind, record[rootKey(kind)] ?? rest, name)
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

  async function create(kind: CardType) {
    if (!file) return
    const controller = new AbortController()
    request.current = controller
    setCardType(kind)
    setBusy(true)
    setSeconds(0)
    setFailure(null)
    try {
      const result = await extractCard(kind, file, controller.signal)
      open(kind, (result.card[rootKey(kind)] as Json) ?? {}, file.name.replace(/\.pdf$/i, ''), result)
      refreshHealth()
    } catch (error) {
      if (!controller.signal.aborted) setFailure((error as Error).message)
    } finally {
      setBusy(false)
    }
  }

  const startOver = () => {
    if (!window.confirm('Leave this card? It stays saved in this browser until you start another one.')) return
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
  const schema = loaded?.cardType === cardType ? loaded.schema : null
  const editing = body !== null && schema !== null

  return (
    <div className={`page ${editing ? 'wide' : ''}`}>
      <header>
        <div>
          <h1>ROADMAP Card Creator</h1>
          <p className="muted">Create, check and edit RSNA ATLAS dataset and model cards.</p>
        </div>
        {health && <span className={`pill ${health.configured ? 'ok' : 'warn'}`}>{health.configured ? health.model : 'No API key configured'}</span>}
      </header>

      {offline && <p className="banner bad">Cannot reach the server. Check that it is running (<code>docker compose up</code>).</p>}
      {body !== null && !schema && !offline && <p className="muted">Loading the ATLAS schema…</p>}

      {editing ? (
        <Editor schema={schema} cardType={cardType} body={body} onBody={setBody} onCardType={setCardType} extraction={extraction}
          adjustments={adjustments} onAdjustments={setAdjustments} paper={file} fileName={fileName} onStartOver={startOver} />
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
            {!file ? (
              <button type="button" className="drop" onClick={() => pdfInput.current?.click()}>
                <strong>Drop the paper's PDF here</strong> or click to choose it
                <span className="muted block">The paper is read for you and the card is filled in. You review and edit it afterwards.</span>
              </button>
            ) : busy ? (
              <div className="step">
                <p><strong>Reading {file.name}…</strong></p>
                <p className="muted" aria-live="polite">{seconds}s · usually takes less than a minute</p>
                <button type="button" onClick={() => request.current?.abort()}>Cancel</button>
              </div>
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
                To read a paper, its PDF is sent to {READERS[health.provider] ?? 'an outside AI service'}. Only upload papers you are
                free to share, such as published articles. Opening or editing a card sends nothing outside this site.
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
              ). Papers read this month: {health.budget.papers_this_month} (${health.budget.spent_usd.toFixed(2)} of $
              {health.budget.monthly_budget_usd.toFixed(0)}). PDFs up to {health.max_pdf_pages} pages.
            </p>
          )}
        </>
      )}
    </div>
  )
}
