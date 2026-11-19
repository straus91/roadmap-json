// The "Send to ATLAS" button and the short step behind it, as one self-contained piece.
//
// The editor does not know how sending works. It calls this hook with the card and gets back two
// things to place: the button (for its toolbar) and the panel (shown below the toolbar while the
// person writes the description). When the app is not shown inside a host, both are null and
// the editor looks exactly as it does on its own.

import { useState } from 'react'
import type { ReactNode } from 'react'
import { MAX_DESCRIPTION, sendCard, suggestDescription } from './protocol.ts'

export interface Host {
  origin: string // where the card goes; from the server's EMBED_ORIGINS list
  name: string // what the button calls it, e.g. "ATLAS"
}

interface SendOptions {
  host: Host | null
  cardType: 'dataset' | 'model'
  fileName: string
  card: unknown // the card exactly as it would be downloaded
  body: unknown // its contents, to draft the description from
  /** True while the card has problems or another action is running: the button is disabled. */
  blocked: boolean
  blockedReason: string
  /** The final check before anything leaves: resolves false (after showing why) if the card is not valid. */
  confirmValid: () => Promise<boolean>
  report: (tone: 'ok' | 'bad', text: string) => void
}

export function useSendToHost(options: SendOptions): { button: ReactNode; panel: ReactNode } {
  const { host, cardType, fileName, card, body, blocked, blockedReason, confirmValid, report } = options
  const [open, setOpen] = useState(false)
  const [busy, setBusy] = useState(false)
  const [description, setDescription] = useState('')
  if (!host) return { button: null, panel: null }

  const start = () => {
    if (!description.trim()) setDescription(suggestDescription(body).slice(0, MAX_DESCRIPTION))
    setOpen(true)
  }

  const send = async () => {
    setBusy(true)
    try {
      if (!(await confirmValid())) {
        setOpen(false)
        return
      }
      await sendCard(host.origin, host.name, { cardType, description: description.trim(), fileName: `${fileName}.${cardType}.json`, card })
      setOpen(false)
      report('ok', `Sent to ${host.name}. Finish creating the card there.`)
    } catch (error) {
      report('bad', (error as Error).message)
    } finally {
      setBusy(false)
    }
  }

  const button = (
    <button type="button" className="primary" disabled={blocked || busy} onClick={start} title={blocked ? blockedReason : `Hand this card to ${host.name}`}>
      Send to {host.name}
    </button>
  )

  const panel = open ? (
    <section className="panel send-dialog" aria-label={`Send to ${host.name}`}>
      <h2>Send to {host.name}</h2>
      <label className="label" htmlFor="host-description">Description</label>
      <textarea id="host-description" value={description} maxLength={MAX_DESCRIPTION} onChange={(event) => setDescription(event.target.value)}
        placeholder="One or two sentences on what this is" />
      <p className="count-note">{description.length}/{MAX_DESCRIPTION}</p>
      <p className="help">
        {host.name} shows this in its list of cards. A first draft is taken from the card; edit it freely. The card itself goes along unchanged.
      </p>
      <div className="row">
        <button type="button" className="primary" disabled={busy || blocked || !description.trim()} onClick={send}>Send</button>
        <button type="button" disabled={busy} onClick={() => setOpen(false)}>Cancel</button>
      </div>
    </section>
  ) : null

  return { button, panel }
}
