// The library page: every card ATLAS publishes, searched and filtered by what a radiologist
// chooses by (type, modality, subspecialty, task, population, year), not by record details.
// The search and filters stay at the top of the screen while the list scrolls.

import { useEffect, useMemo, useRef, useState } from 'react'
import type { ReactNode } from 'react'
import {
  FILTERS, NOT_STATED, SORTS, downloadCard, filterCards, metricsWithValues, optionsFor, paramsToQuery, queryToParams, resultsFor, shortMetric, sizeParts, sortCards,
} from './library.ts'
import type { Chosen, FilterKey, FilterSpec, LibraryCard, LibraryIndex, Option, Query, SortKey } from './library.ts'
import { go } from './route.ts'

const NO_CARDS: LibraryCard[] = []
const VIEW_KEY = 'roadmap-library-view'
const RESULTS_NOTE =
  ' Result values were read from the performance text of each card by AI and checked to appear in that text; the text itself is on the page of the card.' +
  ' Different models are measured on different data, so the values are not a ranking.'
type View = 'list' | 'grid'

function readView(): View {
  try {
    const saved = localStorage.getItem(VIEW_KEY)
    if (saved === 'grid' || saved === 'list') return saved
  } catch {
    // private window: fall through to the default
  }
  return window.innerWidth < 700 ? 'grid' : 'list' // a table is hard to read on a phone
}

export function TypeBadge({ type }: { type: LibraryCard['type'] }) {
  return <span className={`type-badge ${type}`}>{type === 'dataset' ? 'Dataset' : 'Model'}</span>
}

interface LibraryProps {
  index: LibraryIndex | null
  failure: string | null
  params: URLSearchParams
}

export default function Library({ index, failure, params }: LibraryProps) {
  const query = useMemo(() => paramsToQuery(params), [params])
  const [text, setText] = useState(query.text)
  const [openMenu, setOpenMenu] = useState<string | null>(null)
  const [view, setView] = useState<View>(readView)
  const [sort, setSort] = useState<SortKey>('title')
  const [metric, setMetric] = useState<string | null>(null) // null = the most reported one; '' = list the metrics instead
  const bar = useRef<HTMLDivElement>(null)

  useEffect(() => setText(query.text), [query.text])
  useEffect(() => {
    try {
      sessionStorage.setItem('roadmap-library-last', `#/library${queryToParams(query)}`)
    } catch {
      // private window: "back" from a card then returns to the unfiltered library
    }
  }, [query])

  // Close an open filter when clicking elsewhere or pressing Escape.
  useEffect(() => {
    if (!openMenu) return
    const outside = (event: MouseEvent) => {
      if (!(event.target as HTMLElement).closest('.filter')) setOpenMenu(null)
    }
    const escape = (event: KeyboardEvent) => event.key === 'Escape' && setOpenMenu(null)
    document.addEventListener('mousedown', outside)
    document.addEventListener('keydown', escape)
    return () => {
      document.removeEventListener('mousedown', outside)
      document.removeEventListener('keydown', escape)
    }
  }, [openMenu])

  const update = (next: Query) => go(`#/library${queryToParams(next)}`, true)
  const typed = (value: string) => {
    setText(value)
    update({ ...query, text: value })
  }
  const toggle = (key: FilterKey, value: string) => {
    const current = query.chosen[key] ?? []
    const next = current.includes(value) ? current.filter((item) => item !== value) : [...current, value]
    update({ ...query, chosen: { ...query.chosen, [key]: next } })
  }
  const chooseView = (next: View) => {
    setView(next)
    try {
      localStorage.setItem(VIEW_KEY, next)
    } catch {
      // private window: the choice simply is not remembered
    }
  }

  const cards = index?.cards ?? NO_CARDS
  const shown = useMemo(() => sortCards(filterCards(cards, query), sort), [cards, query, sort])
  const options = useMemo(() => {
    const all = new Map<FilterKey, Option[]>()
    for (const spec of FILTERS) all.set(spec.key, optionsFor(cards, query, spec))
    return all
  }, [cards, query])

  const active = FILTERS.flatMap((spec) => (query.chosen[spec.key] ?? []).map((value) => ({ spec, value })))
  const types = query.chosen.type ?? []
  const mode = types.length === 1 ? (types[0] === 'Dataset' ? 'dataset' : 'model') : 'mixed'
  const valued = useMemo(() => {
    const every = metricsWithValues(shown)
    const shared = every.filter(([, cardsWith]) => cardsWith >= 2) // one-off metric names would bury the list
    return shared.length ? shared : every
  }, [shown])
  const shownMetric = metric === null || (metric !== '' && !valued.some(([name]) => name === metric)) ? (valued[0]?.[0] ?? '') : metric
  const more = FILTERS.filter((spec) => !spec.main)
  const moreCount = more.reduce((sum, spec) => sum + (query.chosen[spec.key]?.length ?? 0), 0)

  if (failure) return <p className="banner bad">{failure}</p>
  if (!index) return <p className="muted">Loading the library…</p>
  if (!cards.length)
    return (
      <p className="banner warn">
        {index.syncing
          ? 'The cards are being read from ATLAS for the first time. This takes a minute or two; the page fills in by itself.'
          : `The library is empty: the cards could not be read from ATLAS${index.last_error ? ` (${index.last_error})` : ''}.`}
      </p>
    )

  return (
    <div className="library">
      <div className="lib-bar" ref={bar}>
        <input type="search" className="lib-search" value={text} onChange={(event) => typed(event.target.value)}
          placeholder="Search names, authors, institutions, keywords" aria-label="Search the library" />
        <div className="filters">
          {FILTERS.filter((spec) => spec.main).map((spec) => (
            <FilterMenu key={spec.key} label={spec.label} open={openMenu === spec.key} count={query.chosen[spec.key]?.length ?? 0}
              onOpen={(open) => setOpenMenu(open ? spec.key : null)}>
              <Options spec={spec} options={options.get(spec.key) ?? []} chosen={query.chosen} onToggle={toggle} />
            </FilterMenu>
          ))}
          <FilterMenu label="More" open={openMenu === 'more'} count={moreCount} onOpen={(open) => setOpenMenu(open ? 'more' : null)}>
            {more.map((spec) => (
              <div className="filter-group" key={spec.key}>
                <p className="filter-heading">{spec.label}</p>
                <Options spec={spec} options={options.get(spec.key) ?? []} chosen={query.chosen} onToggle={toggle} />
              </div>
            ))}
          </FilterMenu>
        </div>
        {(active.length > 0 || query.text.trim()) && (
          <div className="active-filters">
            {active.map(({ spec, value }) => (
              <button type="button" className="active-chip" key={`${spec.key}:${value}`} onClick={() => toggle(spec.key, value)}
                title="Remove this filter">
                <span className="muted">{spec.label}:</span> {value} <span aria-hidden="true">×</span>
              </button>
            ))}
            <button type="button" className="link" onClick={() => go('#/library', true)}>Clear all</button>
          </div>
        )}
      </div>

      <div className="lib-head">
        <p className="muted" role="status">
          {shown.length === cards.length ? `${cards.length} published cards` : `${shown.length} of ${cards.length} published cards`}
        </p>
        <div className="row">
          {mode === 'model' && view === 'list' && valued.length > 0 && (
            <label className="muted inline">
              Show result for{' '}
              <select value={shownMetric} onChange={(event) => setMetric(event.target.value)}>
                {valued.map(([name, cardsWith]) => <option key={name} value={name}>{shortMetric(name)} ({cardsWith})</option>)}
                <option value="">Names of the metrics only</option>
              </select>
            </label>
          )}
          <label className="muted inline">
            Sort by{' '}
            <select value={sort} onChange={(event) => setSort(event.target.value as SortKey)}>
              {SORTS.map(({ key, label }) => <option key={key} value={key}>{label}</option>)}
            </select>
          </label>
          <div className="segmented small" role="group" aria-label="Layout">
            <button type="button" className={view === 'list' ? 'selected' : ''} aria-pressed={view === 'list'} onClick={() => chooseView('list')}>List</button>
            <button type="button" className={view === 'grid' ? 'selected' : ''} aria-pressed={view === 'grid'} onClick={() => chooseView('grid')}>Grid</button>
          </div>
        </div>
      </div>

      {shown.length === 0 ? (
        <p className="panel muted">No card matches these filters. Remove one, or clear them all.</p>
      ) : view === 'grid' ? (
        <div className="tiles">{shown.map((card) => <Tile key={card.id} card={card} />)}</div>
      ) : (
        <ListTable cards={shown} mode={mode} metric={shownMetric} />
      )}

      <p className="muted fine">
        Read from {index.source.replace('https://', '')}
        {index.synced_at ? ` on ${new Date(index.synced_at).toLocaleString([], { dateStyle: 'medium', timeStyle: 'short' })}` : ''}. Everything shown
        comes from the cards themselves; “{NOT_STATED.toLowerCase()}” means the card does not say.
        {mode === 'model' && RESULTS_NOTE}
      </p>
    </div>
  )
}

interface FilterMenuProps {
  label: string
  open: boolean
  count: number
  onOpen: (open: boolean) => void
  children: ReactNode
}

function FilterMenu({ label, open, count, onOpen, children }: FilterMenuProps) {
  return (
    <div className={`filter ${open ? 'open' : ''}`}>
      <button type="button" className={`filter-button ${count ? 'used' : ''}`} aria-expanded={open} onClick={() => onOpen(!open)}>
        {label}
        {count > 0 && <span className="filter-count">{count}</span>}
        <span aria-hidden="true" className="caret">▾</span>
      </button>
      {open && <div className="filter-panel">{children}</div>}
    </div>
  )
}

interface OptionsProps {
  spec: FilterSpec
  options: Option[]
  chosen: Chosen
  onToggle: (key: FilterKey, value: string) => void
}

function Options({ spec, options, chosen, onToggle }: OptionsProps) {
  const [find, setFind] = useState('')
  const picked = chosen[spec.key] ?? []
  const visible = find.trim() ? options.filter((option) => option.value.toLowerCase().includes(find.trim().toLowerCase())) : options
  if (!options.length) return <p className="muted">No card gives this.</p>
  return (
    <>
      {options.length > 12 && (
        <input type="search" value={find} onChange={(event) => setFind(event.target.value)} placeholder={`Find a ${spec.label.toLowerCase()}`}
          aria-label={`Find a ${spec.label.toLowerCase()}`} />
      )}
      <ul className="filter-options">
        {visible.map((option) => (
          <li key={option.value}>
            <label className={option.count === 0 ? 'empty' : ''}>
              <input type="checkbox" checked={picked.includes(option.value)} onChange={() => onToggle(spec.key, option.value)} />
              <span className="name">{option.value}</span>
              <span className="muted number">{option.count}</span>
            </label>
          </li>
        ))}
      </ul>
    </>
  )
}

const few = (items: string[], limit: number) => (items.length > limit ? `${items.slice(0, limit).join(', ')} +${items.length - limit}` : items.join(', '))
const dash = <span className="muted">–</span>
const number = (value: number | undefined) => (value ? value.toLocaleString('en-US') : dash)

function ListTable({ cards, mode, metric }: { cards: LibraryCard[]; mode: 'mixed' | 'dataset' | 'model'; metric: string }) {
  return (
    <div className="table-wrap lib-table-wrap">
      <table className="lib-table">
        <thead>
          <tr>
            <th>Name</th>
            {mode === 'mixed' && <th>Type</th>}
            <th>Modality</th>
            <th>Subspecialty</th>
            {mode === 'mixed' && <th>Size or task</th>}
            {mode === 'dataset' && (
              <>
                <th className="num">Patients</th>
                <th className="num">Exams</th>
                <th className="num">Images</th>
                <th className="num">Sites</th>
                <th>Population</th>
              </>
            )}
            {mode === 'model' && (
              <>
                <th>Task</th>
                <th>{metric ? `${shortMetric(metric)} (read by AI)` : 'Metrics reported'}</th>
              </>
            )}
            <th className="num">Year</th>
            {mode !== 'mixed' && <th>License</th>}
            <th aria-label="Download and open" />
          </tr>
        </thead>
        <tbody>
          {cards.map((card) => (
            <tr key={card.id}>
              <td className="name-cell">
                <a href={`#/library/${card.id}`}>{card.title}</a>
                {card.summary && <span className="muted line">{card.summary}</span>}
              </td>
              {mode === 'mixed' && <td><TypeBadge type={card.type} /></td>}
              <td>{card.modalities.length ? few(card.modalities, 3) : dash}</td>
              <td>{card.subspecialties.length ? few(card.subspecialties, 2) : dash}</td>
              {mode === 'mixed' && (
                <td>{card.type === 'dataset' ? sizeParts(card).slice(0, 2).join(' · ') || dash : few(card.tasks, 2) || dash}</td>
              )}
              {mode === 'dataset' && (
                <>
                  <td className="num">{number(card.sizes.patient)}</td>
                  <td className="num">{number(card.sizes.exam)}</td>
                  <td className="num">{number(card.sizes.image)}</td>
                  <td className="num">{number(card.sizes.site)}</td>
                  <td>{card.population === NOT_STATED ? dash : card.population}</td>
                </>
              )}
              {mode === 'model' && (
                <>
                  <td>{few(card.tasks, 2) || dash}</td>
                  <td>{metric ? <Result card={card} metric={metric} /> : card.metrics.length ? few(card.metrics.map(shortMetric), 4) : dash}</td>
                </>
              )}
              <td className="num">{card.year ?? dash}</td>
              {mode !== 'mixed' && <td className="license-cell">{card.license || dash}</td>}
              <td className="quick-cell"><QuickActions card={card} /></td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

/** Download the card, or go straight to the dataset or publication, without opening the card's page. */
function QuickActions({ card }: { card: LibraryCard }) {
  const [state, setState] = useState<'idle' | 'busy' | 'failed'>('idle')
  const download = () => {
    setState('busy')
    downloadCard(card).then(() => setState('idle'), () => setState('failed'))
  }
  const target = card.type === 'dataset' ? 'dataset' : 'publication'
  return (
    <span className="quick">
      <button type="button" className="icon-button" disabled={state === 'busy'} onClick={download}
        title={state === 'failed' ? 'The card could not be downloaded. Try again.' : 'Download this card (JSON)'}
        aria-label={`Download the card for ${card.title}`}>
        <svg viewBox="0 0 20 20" width="18" height="18" aria-hidden="true">
          <path d="M10 3v9m0 0-3.5-3.5M10 12l3.5-3.5M4 15.5h12" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      </button>
      {card.link && (
        <a className="icon-button" href={card.link} target="_blank" rel="noreferrer" title={`Open the ${target} in a new tab`}
          aria-label={`Open the ${target} for ${card.title} in a new tab`}>
          <svg viewBox="0 0 20 20" width="18" height="18" aria-hidden="true">
            <path d="M8 5H5v10h10v-3M11 4h5v5M16 4l-7 7" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
        </a>
      )}
    </span>
  )
}

/** The headline result of a card for a metric: the first one its text gives, with what it was measured on. */
function Result({ card, metric }: { card: LibraryCard; metric: string }) {
  const found = resultsFor(card, metric)
  if (!found.length) return dash
  const [first] = found
  return (
    <span title={[first.set, first.detail].filter(Boolean).join(' · ')}>
      <strong>{first.value}</strong>
      {found.length > 1 && <span className="muted"> +{found.length - 1} more</span>}
      <span className="muted line">{first.set}</span>
    </span>
  )
}

/** Up to two headline results of different metrics, e.g. "Dice 0.943 · NSD 0.966". */
function headline(card: LibraryCard): string[] {
  const seen = new Set<string>()
  const parts: string[] = []
  for (const result of card.results) {
    if (seen.has(result.metric) || parts.length === 2) continue
    seen.add(result.metric)
    parts.push(`${shortMetric(result.metric)} ${result.value}`)
  }
  return parts
}

function Tile({ card }: { card: LibraryCard }) {
  const results = card.type === 'model' ? headline(card) : []
  const facts = card.type === 'dataset' ? sizeParts(card).slice(0, 3) : results.length ? results : card.metrics.slice(0, 4).map(shortMetric)
  const chips = [...card.modalities.slice(0, 3), ...card.subspecialties.slice(0, 2), ...card.tasks.slice(0, 1)]
  return (
    <div className="tile">
      <a className="tile-main" href={`#/library/${card.id}`}>
      <span className="tile-head">
        <TypeBadge type={card.type} />
        <strong>{card.title}</strong>
      </span>
      {card.summary && <span className="tile-summary">{card.summary}</span>}
      {chips.length > 0 && <span className="tile-chips">{chips.map((chip) => <span className="fact-chip" key={chip}>{chip}</span>)}</span>}
      {facts.length > 0 && (
        <span className="tile-facts">
          {card.type === 'model' && !results.length && <span className="muted">Reports </span>}
          {facts.join(card.type === 'model' && !results.length ? ', ' : ' · ')}
        </span>
      )}
      </a>
      <span className="tile-foot">
        <span className="muted">
          {[card.organizations[0], card.year, card.license ? card.license.slice(0, 40) : 'License not stated'].filter(Boolean).join(' · ')}
        </span>
        <QuickActions card={card} />
      </span>
    </div>
  )
}
