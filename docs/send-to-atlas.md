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
   the frame's `sandbox`.
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
   only hands a card over, when the page around it is on that list.

## The messages

All are plain JSON objects.

| Direction | Message |
|---|---|
| V2 → ATLAS | `{ source: 'roadmap-card-creator', type: 'ready', version: 1 }` when V2 has loaded |
| V2 → ATLAS | `{ source: 'roadmap-card-creator', type: 'card', version: 1, id, cardType, description, fileName, card }` |
| ATLAS → V2 | `{ source: 'atlas', type: 'card-received', id }` |
| ATLAS → V2 | `{ source: 'atlas', type: 'card-rejected', id, reason }` |

If ATLAS does not answer within 8 seconds, V2 tells the person the card was not confirmed and
suggests downloading it and uploading it the usual way.

## Trying it without ATLAS

`/atlas-standin.html` on any V2 site is a plain page that plays ATLAS's part: it shows V2 in a
frame, receives the card and displays what it got. It saves nothing. The script at the bottom of
that page (`frontend/public/atlas-standin.html`) is a complete working example of the listener.
