# Send to ATLAS: what the ATLAS side needs

The card creator (V2) can hand a finished card straight to ATLAS, so nobody has to download a
JSON file and upload it again. V2's half is built. This note is for whoever maintains ATLAS and
describes the other half, which is small.

## How it works

ATLAS already shows its card creator inside a frame on the Creator page
(`<iframe src="/api/card-creator-static/index.html" …>`). When V2 is the app in that frame:

1. The person finishes a card in V2 and chooses **Send to ATLAS**.
2. V2 asks for the description ATLAS shows in its list (up to 2,000 characters, the same limit
   as the "Create Index Card" dialog) and offers a first draft taken from the card.
3. V2 checks the card against the ATLAS schema one last time, then passes the card and the
   description to the ATLAS page around it with `window.postMessage`.
4. The ATLAS page does what "Create Index Card → Save" does today, with those two values, and
   answers that it has the card.

The person is already signed in to ATLAS in that page, so no password, token or API key is
involved, and V2 never talks to the ATLAS back end.

## What to change in ATLAS

1. Point the frame at V2 (for example `https://card-creator.pedsrad.org/`, or wherever RSNA
   hosts it). Keep `allow-scripts allow-same-origin allow-forms allow-popups allow-downloads` in
   the frame's `sandbox`. V2 opens no pop-up questions, so `allow-modals` is not needed.
2. Add a listener on the Creator page:

```js
const CREATOR = 'https://card-creator.pedsrad.org' // where V2 is served from

window.addEventListener('message', async (event) => {
  if (event.origin !== CREATOR) return                       // only the card creator
  const message = event.data
  if (!message || message.source !== 'roadmap-card-creator' || message.type !== 'card') return
  try {
    // message.cardType     'dataset' | 'model'
    // message.description  text for the list page (at most 2,000 characters)
    // message.fileName     e.g. "MRSegmentator.model.json"
    // message.card         the card itself: { "$schema": …, "Dataset" | "Model": { … } }
    await createIndexCard({ description: message.description, card: message.card }) // ATLAS's own save
    event.source.postMessage({ source: 'atlas', type: 'card-received', id: message.id }, event.origin)
  } catch (error) {
    event.source.postMessage(
      { source: 'atlas', type: 'card-rejected', id: message.id, reason: String(error.message || error) },
      event.origin,
    )
  }
})
```

3. Tell whoever runs V2 the address of the ATLAS site, so it can be listed in V2's
   `EMBED_ORIGINS` setting (default: `https://atlas.rsna.org`). V2 only shows the button, and
   only hands a card over, when the page around it is on that list. V2 also tells browsers,
   with a `Content-Security-Policy: frame-ancestors` header, to refuse to show it in a frame on
   any site that is not on the list.

Optional: ATLAS can also ask V2 to open an existing card for editing, for example from an
"Edit" button on a card's page:

```js
frame.contentWindow.postMessage(
  { source: 'atlas', type: 'open-card', version: 1, title: 'MRSegmentator', card },
  CREATOR,
)
```

Send it after V2 has said it is ready (the `ready` message below).

## The messages

All are plain JSON objects.

| Direction | Message |
|---|---|
| V2 → ATLAS | `{ source: 'roadmap-card-creator', type: 'ready', version: 1 }` when V2 has loaded |
| V2 → ATLAS | `{ source: 'roadmap-card-creator', type: 'card', version: 1, id, cardType, description, fileName, card }` |
| ATLAS → V2 | `{ source: 'atlas', type: 'card-received', id }` |
| ATLAS → V2 | `{ source: 'atlas', type: 'card-rejected', id, reason }` |
| ATLAS → V2 | `{ source: 'atlas', type: 'open-card', version: 1, card, title }` (optional: open this card for editing) |

If ATLAS does not answer within 8 seconds, V2 tells the person the card was not confirmed and
suggests downloading it and uploading it the usual way.

## Author check (optional)

ATLAS can also ask the author of a published card to go through it in V2, section by section.
ATLAS opens the card with a `check` part. V2 then shows, in place of its own download and
send buttons, where each section stands: "Right as it is" to begin with, and "Edited by you"
once the author corrects a field in it (with a link to undo). A section is one or the other:
an author who finds something wrong corrects it. V2 writes nothing to its own saved draft during a check: ATLAS keeps the author's work and
owns the final button.

| Direction | Message |
|---|---|
| ATLAS → V2 | `{ source: 'atlas', type: 'open-card', version: 1, card, title, check: { original } }` — `card`: the author's version so far (the published card at first); `original`: the published card |
| V2 → ATLAS | `{ source: 'roadmap-card-creator', type: 'check-progress', version: 1, cardType, card, changed, problems }` a moment after every change, so ATLAS can keep the work. `changed` names the edited sections as V2 shows them; `problems` counts what does not fit the schema |
| ATLAS → V2 | `{ source: 'atlas', type: 'check-finish', id }` when the author presses ATLAS's final button |
| V2 → ATLAS | `{ source: 'roadmap-card-creator', type: 'check-result', version: 1, id, ok, reason, cardType, card, changed }` — `ok` only after V2's server confirmed the card fits the ATLAS schema; otherwise `reason` says what stands in the way |

Loading the frame as `…/?check=1` shows "Loading your card…" instead of V2's start page until
the card arrives. This lives in `frontend/src/check/` (`protocol.ts`, `useAuthorCheck.tsx`).
ATLAS V2's `frontend/src/Validate.tsx` is a working example of the ATLAS side.

## Where this lives in V2

Everything about the feature is in one folder, `frontend/src/send/`: `protocol.ts` (the
messages) and `useSendToHost.tsx` (the button and its description step). The editor only places
the button. Two settings control it: `EMBED_ORIGINS` (who may frame V2 and receive cards) and
`EMBED_NAME` (what the button calls that site; default "ATLAS").

## Trying it without ATLAS

- `/atlas-standin.html` on any V2 site is a plain page that plays ATLAS's part: it shows V2 in a
  frame, receives the card and displays what it got. It saves nothing. The script at the bottom
  of that page (`frontend/public/atlas-standin.html`) is a complete working example of the
  listener.
- [ATLAS V2](https://github.com/straus91/atlas-v2), a separate project, is a fuller example: a
  site with its own Browse and Overview pages that frames V2 on its Creator page, receives
  cards from it and sends cards to it for editing (`frontend/src/host.ts` there).
