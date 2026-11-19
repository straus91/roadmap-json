// The library of published ATLAS cards: what the server knows about each card, and the
// searching, filtering and counting the Library and Overview pages share. Pure functions only.

export interface LibraryCard {
  id: string
  type: 'dataset' | 'model'
  title: string
  name: string
  summary: string
  has_atlas_description: boolean
  atlas_url: string
  link: string
  modalities: string[]
  subspecialties: string[]
  content_codes: string[]
  tasks: string[]
  metrics: string[]
  population: string
  ages: [number, number] | null
  year: number | null
  license: string
  organizations: string[]
  sizes: Partial<Record<SizeKind, number>>
  formats: string[]
  architecture: string
  has_performance: boolean
  search: string
}

export interface LibraryIndex {
  cards: LibraryCard[]
  count: number
  synced_at: string | null
  last_error: string | null
  syncing: boolean
  source: string
}

export interface LibraryRecord {
  card: Record<string, unknown>
  title: string
  description: string
  facts: LibraryCard | null
}

export type SizeKind = 'patient' | 'exam' | 'series' | 'image' | 'site'
export const SIZE_KINDS: { kind: SizeKind; one: string; many: string }[] = [
  { kind: 'patient', one: 'patient', many: 'patients' },
  { kind: 'exam', one: 'exam', many: 'exams' },
  { kind: 'image', one: 'image', many: 'images' },
  { kind: 'series', one: 'series', many: 'series' },
  { kind: 'site', one: 'site', many: 'sites' },
]

export async function getLibrary(): Promise<LibraryIndex> {
  const response = await fetch('/api/library')
  if (!response.ok) throw new Error(`The library could not be loaded (${response.status}).`)
  return (await response.json()) as LibraryIndex
}

export async function getLibraryCard(id: string): Promise<LibraryRecord> {
  const response = await fetch(`/api/library/${encodeURIComponent(id)}`)
  if (response.status === 404) throw new Error('That card is not in the library.')
  if (!response.ok) throw new Error(`The card could not be loaded (${response.status}).`)
  return (await response.json()) as LibraryRecord
}

// ------------------------------------------------------------------ filters
export type FilterKey = 'type' | 'modality' | 'subspecialty' | 'task' | 'population' | 'year' | 'metric' | 'license' | 'size'

export interface FilterSpec {
  key: FilterKey
  label: string
  /** Shown in the bar itself; the others sit under "More". */
  main: boolean
  /** The values a card has for this filter. A card matches when it has any chosen value. */
  values: (card: LibraryCard) => string[]
  /** Fixed order of the options; otherwise most frequent first. */
  order?: string[]
}

export const NOT_STATED = 'Not stated'

export const FILTERS: FilterSpec[] = [
  { key: 'type', label: 'Type', main: true, values: (card) => [card.type === 'dataset' ? 'Dataset' : 'Model'], order: ['Dataset', 'Model'] },
  { key: 'modality', label: 'Modality', main: true, values: (card) => (card.modalities.length ? card.modalities : [NOT_STATED]) },
  { key: 'subspecialty', label: 'Subspecialty', main: true, values: (card) => (card.subspecialties.length ? card.subspecialties : [NOT_STATED]) },
  { key: 'task', label: 'Task', main: true, values: (card) => card.tasks },
  { key: 'population', label: 'Population', main: true, values: (card) => [card.population], order: ['Pediatric', 'Adult', 'Children and adults', NOT_STATED] },
  { key: 'year', label: 'Published', main: true, values: (card) => [card.year === null ? NOT_STATED : String(card.year)] },
  { key: 'metric', label: 'Metric reported', main: false, values: (card) => card.metrics },
  { key: 'license', label: 'License', main: false, values: (card) => [card.license ? 'Stated' : NOT_STATED], order: ['Stated', NOT_STATED] },
  {
    key: 'size', label: 'Size given as', main: false,
    values: (card) => SIZE_KINDS.filter(({ kind }) => card.sizes[kind]).map(({ many }) => many[0].toUpperCase() + many.slice(1)),
  },
]

export type Chosen = Partial<Record<FilterKey, string[]>>

export interface Query {
  text: string
  chosen: Chosen
}

const words = (text: string) => text.toLowerCase().split(/\s+/).filter(Boolean)

function passes(card: LibraryCard, query: Query, except?: FilterKey): boolean {
  for (const word of words(query.text)) if (!card.search.includes(word)) return false
  for (const spec of FILTERS) {
    const wanted = query.chosen[spec.key]
    if (spec.key === except || !wanted?.length) continue
    const has = spec.values(card)
    if (!wanted.some((value) => has.includes(value))) return false
  }
  return true
}

/** The cards that match every word typed and, for each filter in use, at least one chosen value. */
export function filterCards(cards: LibraryCard[], query: Query): LibraryCard[] {
  return cards.filter((card) => passes(card, query))
}

export interface Option {
  value: string
  count: number
}

/** A filter's options with how many cards each would give, with the other filters as they are. */
export function optionsFor(cards: LibraryCard[], query: Query, spec: FilterSpec): Option[] {
  const counts = new Map<string, number>()
  for (const card of cards) {
    if (!passes(card, query, spec.key)) continue
    for (const value of spec.values(card)) counts.set(value, (counts.get(value) ?? 0) + 1)
  }
  for (const value of query.chosen[spec.key] ?? []) if (!counts.has(value)) counts.set(value, 0)
  const options = [...counts].map(([value, count]) => ({ value, count }))
  if (spec.order) {
    const rank = (value: string) => (spec.order!.includes(value) ? spec.order!.indexOf(value) : spec.order!.length)
    return options.sort((a, b) => rank(a.value) - rank(b.value))
  }
  if (spec.key === 'year') return options.sort((a, b) => (a.value === NOT_STATED ? 1 : b.value === NOT_STATED ? -1 : b.value.localeCompare(a.value)))
  return options.sort((a, b) => (a.value === NOT_STATED ? 1 : b.value === NOT_STATED ? -1 : b.count - a.count || a.value.localeCompare(b.value)))
}

// ------------------------------------------------------------------ sorting and wording
export type SortKey = 'title' | 'newest' | 'oldest' | 'largest'
export const SORTS: { key: SortKey; label: string }[] = [
  { key: 'title', label: 'Name (A to Z)' },
  { key: 'newest', label: 'Newest publication' },
  { key: 'oldest', label: 'Oldest publication' },
  { key: 'largest', label: 'Most patients' },
]

export function sortCards(cards: LibraryCard[], key: SortKey): LibraryCard[] {
  const byTitle = (a: LibraryCard, b: LibraryCard) => a.title.localeCompare(b.title, undefined, { sensitivity: 'base' })
  const sorted = [...cards]
  if (key === 'title') return sorted.sort(byTitle)
  if (key === 'largest') return sorted.sort((a, b) => (b.sizes.patient ?? -1) - (a.sizes.patient ?? -1) || byTitle(a, b))
  const missing = key === 'newest' ? -Infinity : Infinity
  return sorted.sort((a, b) => {
    const [first, second] = [a.year ?? missing, b.year ?? missing]
    return (key === 'newest' ? second - first : first - second) || byTitle(a, b)
  })
}

export function count(value: number, one: string, many: string): string {
  return `${value.toLocaleString('en-US')} ${value === 1 ? one : many}`
}

/** "43 patients · 110 series": the sizes a card gives, most telling first. */
export function sizeParts(card: LibraryCard): string[] {
  return SIZE_KINDS.filter(({ kind }) => card.sizes[kind]).map(({ kind, one, many }) => count(card.sizes[kind]!, one, many))
}

const SHORT_METRIC: Record<string, string> = {
  'area under the receiver operating characteristic curve': 'AUC',
  'Dice similarity coefficient': 'Dice',
  'positive predictive value': 'PPV',
  'negative predictive value': 'NPV',
  'receiver operating characteristic analysis': 'ROC analysis',
  'intraclass correlation coefficient': 'ICC',
  'mean absolute error': 'MAE',
  'intersection over union': 'IoU',
  'normalized surface distance': 'NSD',
}

export function shortMetric(metric: string): string {
  return SHORT_METRIC[metric] ?? metric
}

// ------------------------------------------------------------------ the address bar
/** Filters live in the page address, so a filtered view can be linked to and shared. */
export function queryToParams(query: Query): string {
  const params = new URLSearchParams()
  if (query.text.trim()) params.set('q', query.text.trim())
  for (const spec of FILTERS) for (const value of query.chosen[spec.key] ?? []) params.append(spec.key, value)
  const text = params.toString()
  return text ? `?${text}` : ''
}

export function paramsToQuery(params: URLSearchParams): Query {
  const chosen: Chosen = {}
  for (const spec of FILTERS) {
    const values = params.getAll(spec.key)
    if (values.length) chosen[spec.key] = values
  }
  return { text: params.get('q') ?? '', chosen }
}

export function libraryLink(chosen: Chosen = {}, text = ''): string {
  return `#/library${queryToParams({ text, chosen })}`
}
