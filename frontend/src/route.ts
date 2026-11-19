// Which page is showing. Kept in the address after the "#", so pages and filtered views can be
// linked to, the Back button works, and the server needs to know nothing about pages.
import { useEffect, useState } from 'react'

export interface Route {
  page: 'create' | 'library' | 'card' | 'overview'
  id: string // the card, on the 'card' page
  params: URLSearchParams
}

export function parseRoute(hash: string): Route {
  const [path, search = ''] = hash.replace(/^#\/?/, '').split('?')
  const params = new URLSearchParams(search)
  const parts = path.split('/').filter(Boolean)
  if (parts[0] === 'library') return parts[1] ? { page: 'card', id: decodeURIComponent(parts[1]), params } : { page: 'library', id: '', params }
  if (parts[0] === 'overview') return { page: 'overview', id: '', params }
  return { page: 'create', id: '', params }
}

export function useRoute(): Route {
  const [route, setRoute] = useState(() => parseRoute(window.location.hash))
  useEffect(() => {
    const update = () => setRoute(parseRoute(window.location.hash))
    window.addEventListener('hashchange', update)
    return () => window.removeEventListener('hashchange', update)
  }, [])
  return route
}

/** Go to a page. `replace` changes the address without adding a step to the Back button. */
export function go(hash: string, replace = false) {
  if (replace) {
    window.history.replaceState(null, '', hash)
    window.dispatchEvent(new HashChangeEvent('hashchange'))
  } else window.location.hash = hash
}
