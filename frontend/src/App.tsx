import { useEffect, useRef, useState } from 'react'
import type { ChangeEvent, DragEvent } from 'react'
import { extractCard, getHealth } from './api.ts'
import type { CardType, Extraction, Health, Problem } from './api.ts'
import { detectCardType, validateCard } from './validate.ts'

type Check =
  | { state: 'empty' }
  | { state: 'syntax'; message: string }
  | { state: 'checked'; problems: Problem[]; cardType: CardType }
  | { state: 'unavailable'; message: string }

export default function App() {
  const [health, setHealth] = useState<Health | null>(null)
  const [offline, setOffline] = useState(false)
  const [cardType, setCardType] = useState<CardType>('dataset')
  const [file, setFile] = useState<File | null>(null)
  const [dragging, setDragging] = useState(false)
  const [busy, setBusy] = useState(false)
  const [seconds, setSeconds] = useState(0)
  const [failure, setFailure] = useState<string | null>(null)
  const [extraction, setExtraction] = useState<Extraction | null>(null)
  const [text, setText] = useState('')
  const [check, setCheck] = useState<Check>({ state: 'empty' })
  const [copied, setCopied] = useState(false)
  const request = useRef<AbortController | null>(null)

  useEffect(() => {
    getHealth().then(setHealth, () => setOffline(true))
  }, [])

  useEffect(() => {
    if (!busy) return
    const started = Date.now()
    const timer = setInterval(() => setSeconds(Math.round((Date.now() - started) / 1000)), 1000)
    return () => clearInterval(timer)
  }, [busy])

  // Re-validate in the browser whenever the JSON changes (instant, no server round-trip).
  useEffect(() => {
    if (!text.trim()) {
      setCheck({ state: 'empty' })
      return
    }
    let card: unknown
    try {
      card = JSON.parse(text)
    } catch (error) {
      setCheck({ state: 'syntax', message: (error as Error).message })
      return
    }
    const kind = detectCardType(card) ?? cardType
    let current = true
    validateCard(card, kind).then(
      (problems) => current && setCheck({ state: 'checked', problems, cardType: kind }),
      (error: Error) => current && setCheck({ state: 'unavailable', message: error.message }),
    )
    return () => {
      current = false
    }
  }, [text, cardType])

  function choose(candidate: File | undefined) {
    if (!candidate) return
    setFailure(null)
    if (candidate.name.toLowerCase().endsWith('.json')) {
      candidate.text().then((content) => {
        setExtraction(null)
        setText(content)
      })
      return
    }
    if (candidate.type !== 'application/pdf' && !candidate.name.toLowerCase().endsWith('.pdf')) {
      setFailure('Choose a PDF of the paper, or a card .json file to check.')
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
      setExtraction(result)
      setText(JSON.stringify(result.card, null, 2))
    } catch (error) {
      if (!controller.signal.aborted) setFailure((error as Error).message)
    } finally {
      setBusy(false)
    }
  }

  function download() {
    const kind = check.state === 'checked' ? check.cardType : cardType
    const url = URL.createObjectURL(new Blob([text], { type: 'application/json' }))
    const link = document.createElement('a')
    link.href = url
    link.download = `${(file?.name ?? 'card').replace(/\.pdf$/i, '')}.${kind}.json`
    link.click()
    URL.revokeObjectURL(url)
  }

  async function copy() {
    await navigator.clipboard.writeText(text)
    setCopied(true)
    setTimeout(() => setCopied(false), 1500)
  }

  const ready = health?.configured === true

  return (
    <div className="page">
      <header>
        <div>
          <h1>ROADMAP Card Creator</h1>
          <p className="muted">Turn a paper into an RSNA ATLAS dataset or model card.</p>
        </div>
        {health && (
          <span className={`pill ${ready ? 'ok' : 'warn'}`}>
            {ready ? health.model : 'No API key configured'}
          </span>
        )}
      </header>

      {offline && (
        <p className="banner bad">
          Cannot reach the server. Check that it is running (<code>docker compose up</code>).
        </p>
      )}
      {health && !ready && (
        <p className="banner warn">
          Creating cards from a PDF is switched off until an API key is added to the{' '}
          <code>.env</code> file. You can still open a card file to check it.
        </p>
      )}

      <section className="panel">
        <h2>1. Choose the paper</h2>
        <div className="segmented" role="radiogroup" aria-label="Card type">
          {(['dataset', 'model'] as const).map((kind) => (
            <button
              key={kind}
              role="radio"
              aria-checked={cardType === kind}
              className={cardType === kind ? 'selected' : ''}
              onClick={() => setCardType(kind)}
              disabled={busy}
            >
              {kind === 'dataset' ? 'Dataset card' : 'Model card'}
            </button>
          ))}
        </div>

        <label
          className={`drop ${dragging ? 'over' : ''}`}
          onDragOver={(event) => {
            event.preventDefault()
            setDragging(true)
          }}
          onDragLeave={() => setDragging(false)}
          onDrop={onDrop}
        >
          <input
            type="file"
            accept="application/pdf,.pdf,application/json,.json"
            disabled={busy}
            onChange={(event: ChangeEvent<HTMLInputElement>) => {
              choose(event.target.files?.[0])
              event.target.value = ''
            }}
          />
          {file ? (
            <span>
              <strong>{file.name}</strong>
              <span className="muted"> · {(file.size / 1024 / 1024).toFixed(1)} MB · click to change</span>
            </span>
          ) : (
            <span>
              <strong>Drop the paper's PDF here</strong> or click to choose it
              <span className="muted block">You can also open an existing card (.json) to check it</span>
            </span>
          )}
        </label>

        <div className="row">
          <button className="primary" onClick={create} disabled={!file || busy || !ready}>
            {busy ? 'Reading the paper…' : `Create ${cardType} card`}
          </button>
          {busy && (
            <>
              <span className="muted" aria-live="polite">
                {seconds}s · usually takes one to three minutes
              </span>
              <button onClick={() => request.current?.abort()}>Cancel</button>
            </>
          )}
        </div>
        {failure && <p className="banner bad">{failure}</p>}
      </section>

      {text && (
        <section className="panel">
          <h2>2. Review the card</h2>
          <Status check={check} />

          {check.state === 'checked' && check.problems.length > 0 && (
            <ul className="problems">
              {check.problems.map((problem) => (
                <li key={problem.pointer + problem.message}>
                  <span className="where">{problem.location}</span>
                  {problem.message}
                </li>
              ))}
            </ul>
          )}

          {extraction && extraction.warnings.length > 0 && (
            <details>
              <summary>
                {extraction.warnings.length} automatic adjustment
                {extraction.warnings.length === 1 ? '' : 's'} made to fit the ATLAS schema
              </summary>
              <ul className="adjustments">
                {extraction.warnings.map((warning) => (
                  <li key={warning}>{warning}</li>
                ))}
              </ul>
            </details>
          )}

          <textarea
            value={text}
            onChange={(event) => setText(event.target.value)}
            spellCheck={false}
            aria-label="Card JSON"
          />

          <div className="row">
            <button className="primary" onClick={download}>
              Download JSON
            </button>
            <button onClick={copy}>{copied ? 'Copied' : 'Copy'}</button>
            {extraction && (
              <span className="muted">
                Read by {extraction.meta.model}
                {extraction.meta.repaired ? ' · corrected once automatically' : ''}
              </span>
            )}
          </div>
        </section>
      )}
    </div>
  )
}

function Status({ check }: { check: Check }) {
  if (check.state === 'syntax')
    return <p className="banner bad">The text is not valid JSON: {check.message}</p>
  if (check.state === 'unavailable')
    return <p className="banner warn">Could not check the card: {check.message}</p>
  if (check.state !== 'checked') return null
  const count = check.problems.length
  return count === 0 ? (
    <p className="banner ok">Valid ATLAS {check.cardType} card. Review the content, then download it.</p>
  ) : (
    <p className="banner warn">
      {count} thing{count === 1 ? '' : 's'} to fix before this is a valid ATLAS {check.cardType} card:
    </p>
  )
}
