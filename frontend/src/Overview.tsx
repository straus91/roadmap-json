// The overview page: what the library holds and where it is thin. Every number is a link to
// the library filtered to exactly those cards.
//
// Colour: datasets are always blue and models always orange (here and on the type badges);
// the coverage grid uses one blue ramp, light for few cards and dark for many.

import { useMemo, useState } from 'react'
import { NOT_STATED, libraryLink, shortMetric } from './library.ts'
import type { Chosen, LibraryCard, LibraryIndex } from './library.ts'

const NO_CARDS: LibraryCard[] = []
type Scope = 'all' | 'dataset' | 'model'
const SCOPES: { key: Scope; label: string }[] = [
  { key: 'all', label: 'All cards' },
  { key: 'dataset', label: 'Datasets' },
  { key: 'model', label: 'Models' },
]
const typeFilter = (scope: Scope): Chosen => (scope === 'all' ? {} : { type: [scope === 'dataset' ? 'Dataset' : 'Model'] })
const plural = (value: number, one: string, many: string) => `${value} ${value === 1 ? one : many}`

function tally(cards: LibraryCard[], values: (card: LibraryCard) => string[]): [string, number][] {
  const counts = new Map<string, number>()
  for (const card of cards) for (const value of values(card)) counts.set(value, (counts.get(value) ?? 0) + 1)
  return [...counts].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
}

const MIN_COLUMN = 5 // subspecialties with fewer cards than this are left out of the coverage grid
const COLUMN_HEIGHT = 150 // pixels, the tallest year

/** Which of the six shades a count gets. 0 is reserved for "no cards". */
const STEPS = [1, 3, 6, 11, 21, 41]
const shade = (count: number) => STEPS.filter((from) => count >= from).length
const stepLabel = (index: number) => (index === STEPS.length - 1 ? `${STEPS[index]}+` : STEPS[index] === STEPS[index + 1] - 1 ? `${STEPS[index]}` : `${STEPS[index]}–${STEPS[index + 1] - 1}`)

export default function Overview({ index, failure }: { index: LibraryIndex | null; failure: string | null }) {
  const [scope, setScope] = useState<Scope>('all')
  const cards = index?.cards ?? NO_CARDS
  const datasets = useMemo(() => cards.filter((card) => card.type === 'dataset'), [cards])
  const models = useMemo(() => cards.filter((card) => card.type === 'model'), [cards])

  if (failure) return <p className="banner bad">{failure}</p>
  if (!index) return <p className="muted">Loading the library…</p>
  if (!cards.length)
    return <p className="banner warn">{index.syncing ? 'The cards are being read from ATLAS for the first time. This takes a minute or two.' : 'The library is empty: the cards could not be read from ATLAS.'}</p>

  const years = cards.map((card) => card.year).filter((year): year is number => year !== null)
  return (
    <div className="overview">
      <div className="stat-tiles">
        <a className="stat" href={libraryLink()}><span className="muted">Published cards</span><strong>{cards.length}</strong></a>
        <a className="stat" href={libraryLink({ type: ['Dataset'] })}><span className="muted"><i className="swatch dataset" /> Datasets</span><strong>{datasets.length}</strong></a>
        <a className="stat" href={libraryLink({ type: ['Model'] })}><span className="muted"><i className="swatch model" /> Models</span><strong>{models.length}</strong></a>
        <div className="stat"><span className="muted">Publication years</span><strong>{years.length ? `${Math.min(...years)}–${Math.max(...years)}` : '–'}</strong></div>
      </div>

      <section className="panel">
        <div className="chart-head">
          <div>
            <h2>Coverage: modality by subspecialty</h2>
            <p className="muted">How many cards cover each combination. Empty cells are gaps in the library. Click a number to see those cards.</p>
          </div>
          <div className="segmented small" role="group" aria-label="Cards counted">
            {SCOPES.map(({ key, label }) => (
              <button type="button" key={key} className={scope === key ? 'selected' : ''} aria-pressed={scope === key} onClick={() => setScope(key)}>{label}</button>
            ))}
          </div>
        </div>
        <Coverage cards={scope === 'all' ? cards : scope === 'dataset' ? datasets : models} scope={scope} />
      </section>

      <div className="chart-pair">
        <section className="panel">
          <h2>Cards by year of publication</h2>
          <p className="muted">The year the dataset or model was published, as the card states it.</p>
          <Years cards={cards} />
        </section>
        <section className="panel">
          <h2>How complete the cards are</h2>
          <p className="muted">The share of cards that state each fact. Click a row to see the cards that leave it out.</p>
          <Completeness cards={cards} datasets={datasets} models={models} />
        </section>
      </div>

      <div className="chart-pair">
        <section className="panel">
          <h2>What the models do</h2>
          <p className="muted">The ten most common intended uses among the {models.length} model cards.</p>
          <Bars rows={tally(models, (card) => card.tasks).slice(0, 10)} link={(value) => libraryLink({ type: ['Model'], task: [value] })} unit={['model', 'models']} />
        </section>
        <section className="panel">
          <h2>Metrics the models report</h2>
          <p className="muted">The ten most reported performance metrics among the {models.length} model cards.</p>
          <Bars rows={tally(models, (card) => card.metrics).slice(0, 10)} label={shortMetric}
            link={(value) => libraryLink({ type: ['Model'], metric: [value] })} unit={['model', 'models']} />
        </section>
      </div>
    </div>
  )
}

function Coverage({ cards, scope }: { cards: LibraryCard[]; scope: Scope }) {
  const modalities = tally(cards, (card) => card.modalities)
  const every = tally(cards, (card) => card.subspecialties)
  const subspecialties = every.filter(([, total]) => total >= MIN_COLUMN) // keep the grid readable
  const left = every.length - subspecialties.length
  const cell = (modality: string, subspecialty: string) =>
    cards.filter((card) => card.modalities.includes(modality) && card.subspecialties.includes(subspecialty)).length
  const what = scope === 'dataset' ? ['dataset', 'datasets'] : scope === 'model' ? ['model', 'models'] : ['card', 'cards']
  return (
    <>
      <div className="table-wrap coverage-wrap">
        <table className="coverage">
          <thead>
            <tr>
              <td />
              {subspecialties.map(([name]) => <th key={name} scope="col"><span>{name}</span></th>)}
              <th scope="col" className="total"><span>All subspecialties</span></th>
            </tr>
          </thead>
          <tbody>
            {modalities.map(([modality, total]) => (
              <tr key={modality}>
                <th scope="row">{modality}</th>
                {subspecialties.map(([subspecialty]) => {
                  const count = cell(modality, subspecialty)
                  return (
                    <td key={subspecialty}>
                      {count ? (
                        <a className={`heat s${shade(count)}`} href={libraryLink({ ...typeFilter(scope), modality: [modality], subspecialty: [subspecialty] })}
                          title={`${modality} · ${subspecialty}: ${plural(count, what[0], what[1])}`}>{count}</a>
                      ) : (
                        <span className="heat s0" title={`${modality} · ${subspecialty}: no ${what[1]}`} />
                      )}
                    </td>
                  )
                })}
                <td className="total"><a href={libraryLink({ ...typeFilter(scope), modality: [modality] })}>{total}</a></td>
              </tr>
            ))}
            <tr className="totals">
              <th scope="row">All modalities</th>
              {subspecialties.map(([subspecialty, total]) => (
                <td key={subspecialty} className="total"><a href={libraryLink({ ...typeFilter(scope), subspecialty: [subspecialty] })}>{total}</a></td>
              ))}
              <td />
            </tr>
          </tbody>
        </table>
      </div>
      <p className="legend muted">
        <span className="heat s0 key" /> none
        {STEPS.map((_, index) => (
          <span key={index} className="legend-item"><span className={`heat s${index + 1} key`} /> {stepLabel(index)}</span>
        ))}
        <span className="legend-note">
          A card with two modalities or subspecialties is counted in each.
          {left > 0 && ` Not shown: ${left} subspecialties with fewer than ${MIN_COLUMN} ${what[1]}.`}
        </span>
      </p>
    </>
  )
}

function Years({ cards }: { cards: LibraryCard[] }) {
  const stated = cards.filter((card) => card.year !== null)
  if (!stated.length) return <p className="muted">No card states a year.</p>
  const first = Math.min(...stated.map((card) => card.year!))
  const last = Math.max(...stated.map((card) => card.year!))
  const years = Array.from({ length: last - first + 1 }, (_, offset) => first + offset)
  const of = (year: number, type: LibraryCard['type']) => stated.filter((card) => card.year === year && card.type === type).length
  const tallest = Math.max(...years.map((year) => of(year, 'dataset') + of(year, 'model')))
  const missing = cards.length - stated.length
  return (
    <>
      <p className="legend muted">
        <span className="legend-item"><i className="swatch dataset" /> Datasets</span>
        <span className="legend-item"><i className="swatch model" /> Models</span>
      </p>
      <div className="columns-chart" role="img" aria-label={`Cards published per year, ${first} to ${last}`}>
        {years.map((year) => {
          const [datasets, models] = [of(year, 'dataset'), of(year, 'model')]
          const total = datasets + models
          return (
            <a className="column" key={year} href={libraryLink({ year: [String(year)] })}
              title={`${year}: ${plural(datasets, 'dataset', 'datasets')}, ${plural(models, 'model', 'models')}`}>
              <span className="column-value">{total || ''}</span>
              <span className="column-stack" style={{ height: `${Math.round((total / tallest) * COLUMN_HEIGHT)}px` }}>
                {models > 0 && <span className="segment model" style={{ flexGrow: models }} />}
                {datasets > 0 && <span className="segment dataset" style={{ flexGrow: datasets }} />}
              </span>
              <span className="column-label">{String(year).slice(2).padStart(3, '’')}</span>
            </a>
          )
        })}
      </div>
      {missing > 0 && (
        <p className="muted fine">
          <a href={libraryLink({ year: [NOT_STATED] })}>{plural(missing, 'card does', 'cards do')} not state a year</a>.
        </p>
      )}
    </>
  )
}

interface BarsProps {
  rows: [string, number][]
  link: (value: string) => string
  unit: [string, string]
  label?: (value: string) => string
}

/** Horizontal bars, most frequent first, the count at the tip. One series, so no legend. */
function Bars({ rows, link, unit, label = (value) => value }: BarsProps) {
  const longest = Math.max(1, ...rows.map(([, count]) => count))
  if (!rows.length) return <p className="muted">No card states this.</p>
  return (
    <ul className="bars">
      {rows.map(([value, count]) => (
        <li key={value}>
          <a href={link(value)} title={`${value}: ${plural(count, unit[0], unit[1])}`}>
            <span className="bar-label">{label(value)}</span>
            <span className="bar-track"><span className="bar model" style={{ width: `calc((100% - 44px) * ${count / longest})` }} /><span className="bar-value">{count}</span></span>
          </a>
        </li>
      ))}
    </ul>
  )
}

function Completeness({ cards, datasets, models }: { cards: LibraryCard[]; datasets: LibraryCard[]; models: LibraryCard[] }) {
  const rows: { label: string; of: LibraryCard[]; group: Scope; has: (card: LibraryCard) => boolean; missing?: Chosen }[] = [
    { label: 'Year of publication', of: cards, group: 'all', has: (card) => card.year !== null, missing: { year: [NOT_STATED] } },
    { label: 'License', of: cards, group: 'all', has: (card) => card.license !== '', missing: { license: [NOT_STATED] } },
    { label: 'ATLAS description', of: cards, group: 'all', has: (card) => card.has_atlas_description },
    { label: 'Number of patients', of: datasets, group: 'dataset', has: (card) => Boolean(card.sizes.patient) },
    { label: 'Any size (patients, exams, images…)', of: datasets, group: 'dataset', has: (card) => Object.keys(card.sizes).length > 0 },
    { label: 'Age range', of: datasets, group: 'dataset', has: (card) => card.ages !== null },
    { label: 'Intended use (task)', of: models, group: 'model', has: (card) => card.tasks.length > 0 },
    { label: 'Performance results', of: models, group: 'model', has: (card) => card.has_performance },
  ]
  const groupName = { all: 'All cards', dataset: 'Datasets', model: 'Models' }
  return (
    <ul className="bars meters">
      {rows.map((row, index) => {
        const have = row.of.filter(row.has).length
        const share = row.of.length ? Math.round((have / row.of.length) * 100) : 0
        const content = (
          <>
            <span className="bar-label">{row.label}<span className="muted block">{groupName[row.group]}</span></span>
            <span className="bar-track">
              <span className="meter"><span className={`bar ${row.group}`} style={{ width: `${share}%` }} /></span>
              <span className="bar-value">{share}%<span className="muted"> · {have} of {row.of.length}</span></span>
            </span>
          </>
        )
        const missing = row.missing ? libraryLink({ ...typeFilter(row.group), ...row.missing }) : null
        return (
          <li key={index}>
            {missing ? <a href={missing} title={`See the ${row.of.length - have} cards that do not state this`}>{content}</a> : <div className="bar-row">{content}</div>}
          </li>
        )
      })}
    </ul>
  )
}
