import { useEffect, useRef, useState } from 'react'
import type { ChangeEvent, DragEvent } from 'react'
import { extractCard, getHealth } from './api.ts'
import type { CardType, Extraction, Health } from './api.ts'
import Editor from './Editor.tsx'
import { rootKey } from './schema.ts'
import type { Json, Schema } from './schema.ts'
import { detectCardType, loadSchema } from './validate.ts'

const DRAFT_KEY = 'roadmap-card-draft'

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
  const [file, setFile] = useState<File | null>(null)
  const [dragging, setDragging] = useState(false)
  const [busy, setBusy] = useState(false)
  const [seconds, setSeconds] = useState(0)
  const [failure, setFailure] = useState<string | null>(null)
  const [body, setBody] = useState<Json | null>(null) // null = start screen
  const [extraction, setExtraction] = useState<Extraction | null>(null)
  const [adjustments, setAdjustments] = useState<string[]>([])
  const [fileName, setFileName] = useState('card')
  const [draft, setDraft] = useState<Draft | null>(readDraft)
  const request = useRef<AbortController | null>(null)

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
  }

  function choose(candidate: File | undefined) {
    if (!candidate) return
    setFailure(null)
    const name = candidate.name.replace(/\.(pdf|json)$/i, '').replace(/\.(dataset|model)(\.draft)?$/i, '')
    if (candidate.name.toLowerCase().endsWith('.json')) {
      candidate.text().then((content) => {
        try {
          const parsed = JSON.parse(content) as Json
          if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) throw new Error('not a card')
          const kind = detectCardType(parsed) ?? cardType
          const record = parsed as Record<string, Json>
          // A file without the "Dataset"/"Model" wrapper is opened as the body itself, so its
          // fields show up in "What to fix" instead of being dropped silently.
          const { $schema: _ignored, ...rest } = record
          setFile(null)
          open(kind, record[rootKey(kind)] ?? rest, name)
        } catch {
          setFailure('That file is not a card: it does not contain valid JSON.')
        }
      })
      return
    }
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
    choose(event.dataTransfer.files[0])
  }

  async function create() {
    if (!file) return
    const controller = new AbortController()
    request.current = controller
    setBusy(true)
    setSeconds(0)
    setFailure(null)
    try {
      const result = await extractCard(cardType, file, controller.signal)
      open(cardType, (result.card[rootKey(cardType)] as Json) ?? {}, file.name.replace(/\.pdf$/i, ''), result)
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

  const ready = health?.configured === true && !health.budget.paused
  const schema = loaded?.cardType === cardType ? loaded.schema : null
  const editing = body !== null && schema !== null

  return (
    <div className={`page ${editing ? 'wide' : ''}`}>
      <header>
        <div>
          <h1>ROADMAP Card Creator</h1>
          <p className="muted">Turn a paper into an RSNA ATLAS dataset or model card, then review and edit it.</p>
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
              Creating cards from a PDF is switched off until an API key is added to the <code>.env</code> file. You can still open a
              card or start a blank one.
            </p>
          )}
          {health?.configured && health.budget.paused && (
            <p className="banner warn">
              This month's budget for reading papers has been used up, so creating cards from a PDF is paused until the 1st. You can
              still open a card or start a blank one.
            </p>
          )}

          <section className="panel">
            <h2>What kind of card?</h2>
            <div className="segmented" role="radiogroup" aria-label="Card type">
              {(['dataset', 'model'] as const).map((kind) => (
                <button type="button" key={kind} role="radio" aria-checked={cardType === kind} className={cardType === kind ? 'selected' : ''}
                  onClick={() => setCardType(kind)} disabled={busy}>
                  {kind === 'dataset' ? 'Dataset card' : 'Model card'}
                </button>
              ))}
            </div>

            <h2 className="spaced">Start from a paper</h2>
            <label className={`drop ${dragging ? 'over' : ''}`}
              onDragOver={(event) => {
                event.preventDefault()
                setDragging(true)
              }}
              onDragLeave={() => setDragging(false)} onDrop={onDrop}>
              <input type="file" accept="application/pdf,.pdf,application/json,.json" disabled={busy}
                onChange={(event: ChangeEvent<HTMLInputElement>) => {
                  choose(event.target.files?.[0])
                  event.target.value = ''
                }} />
              {file ? (
                <span>
                  <strong>{file.name}</strong>
                  <span className="muted"> · {(file.size / 1024 / 1024).toFixed(1)} MB · click to change</span>
                </span>
              ) : (
                <span>
                  <strong>Drop the paper's PDF here</strong> or click to choose it
                  <span className="muted block">Dropping an existing card (.json) opens it for editing</span>
                </span>
              )}
            </label>
            <div className="row">
              <button type="button" className="primary" onClick={create} disabled={!file || busy || !ready}>
                {busy ? 'Reading the paper…' : `Create ${cardType} card`}
              </button>
              {busy && (
                <>
                  <span className="muted" aria-live="polite">{seconds}s · usually takes less than a minute</span>
                  <button type="button" onClick={() => request.current?.abort()}>Cancel</button>
                </>
              )}
            </div>
            {failure && <p className="banner bad">{failure}</p>}

            <h2 className="spaced">Or start without a paper</h2>
            <div className="row">
              <button type="button" disabled={busy || !schema} onClick={() => open(cardType, {}, 'card')}>
                Blank {cardType} card
              </button>
              {draft && (
                <button type="button" disabled={busy} onClick={() => open(draft.cardType, draft.body, draft.fileName)}>
                  Continue “{draft.fileName}” ({draft.cardType}, {new Date(draft.savedAt).toLocaleString([], { dateStyle: 'medium', timeStyle: 'short' })})
                </button>
              )}
            </div>
          </section>

          {health && (
            <p className="muted fine">
              Cards are checked against the schema ATLAS publishes ({health.schemas[cardType].source === 'bundled' ? 'built-in copy' : 'read from atlas.rsna.org'}
              ). Papers read this month: {health.budget.papers_this_month} (${health.budget.spent_usd.toFixed(2)} of $
              {health.budget.monthly_budget_usd.toFixed(0)}). PDFs up to {health.max_pdf_pages} pages.
            </p>
          )}
        </>
      )}
    </div>
  )
}
