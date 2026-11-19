// One published card, laid out for reading: a summary of what a reader chooses by, then every
// section the card contains. Nothing in the card is left out, and long text keeps its line breaks.

import { useEffect, useState } from 'react'
import type { ReactNode } from 'react'
import type { CardType } from './api.ts'
import { TypeBadge } from './Library.tsx'
import { NOT_STATED, getLibraryCard, libraryLink, sizeParts } from './library.ts'
import type { LibraryCard, LibraryRecord } from './library.ts'
import { parseResults } from './results.ts'
import type { Json } from './schema.ts'

type Dict = Record<string, unknown>

/** The library as the reader left it (filters and all), so "back" returns to the same list. */
function lastLibraryView(): string {
  try {
    return sessionStorage.getItem('roadmap-library-last') || '#/library'
  } catch {
    return '#/library'
  }
}
const isDict = (value: unknown): value is Dict => value !== null && typeof value === 'object' && !Array.isArray(value)
const isScalar = (value: unknown) => ['string', 'number', 'boolean'].includes(typeof value)
const isBlank = (value: unknown): boolean =>
  value === null || value === undefined || value === '' || (Array.isArray(value) && value.every(isBlank)) || (isDict(value) && Object.values(value).every(isBlank))
const isLink = (text: string) => /^https?:\/\/\S+$/.test(text)
const COUNTS = ['Patient count', 'Exam count', 'Series count', 'Image count', 'Site count']
const COUNT_HEADS: Record<string, string> = { 'Patient count': 'Patients', 'Exam count': 'Exams', 'Series count': 'Series', 'Image count': 'Images', 'Site count': 'Sites' }
// The order a reader wants: what it is and how it performs first, who made it and how it is indexed last.
const SECTION_ORDER = ['Model properties', 'Model performance', 'Dataset properties', 'Partitions', 'Imaging', 'Descriptors', 'Indexing']
const rank = (key: string) => (SECTION_ORDER.includes(key) ? SECTION_ORDER.indexOf(key) : SECTION_ORDER.length)

interface CardViewProps {
  id: string
  onEdit: (cardType: CardType, body: Json, name: string) => void
}

export default function CardView({ id, onEdit }: CardViewProps) {
  const [record, setRecord] = useState<LibraryRecord | null>(null)
  const [failure, setFailure] = useState<string | null>(null)

  useEffect(() => {
    let current = true
    setRecord(null)
    setFailure(null)
    getLibraryCard(id).then(
      (found) => current && setRecord(found),
      (error: Error) => current && setFailure(error.message),
    )
    window.scrollTo(0, 0)
    return () => {
      current = false
    }
  }, [id])

  if (failure)
    return (
      <>
        <p className="banner bad">{failure}</p>
        <a href="#/library">Back to the library</a>
      </>
    )
  if (!record) return <p className="muted">Loading the card…</p>

  const cardType: CardType = 'Dataset' in record.card ? 'dataset' : 'model'
  const body = (record.card[cardType === 'dataset' ? 'Dataset' : 'Model'] ?? {}) as Dict
  const facts = record.facts
  const title = facts?.title || String(body.Name ?? 'Card')
  const sections = Object.entries(body)
    .filter(([key, value]) => key !== 'Name' && key !== 'Link' && !isBlank(value))
    .sort(([a], [b]) => rank(a) - rank(b))
  const link = typeof body.Link === 'string' ? body.Link : ''

  const download = () => {
    const url = URL.createObjectURL(new Blob([JSON.stringify(record.card, null, 2) + '\n'], { type: 'application/json' }))
    const anchor = document.createElement('a')
    anchor.href = url
    anchor.download = `${title.replace(/[^\w.-]+/g, '_').slice(0, 80)}.${cardType}.json`
    anchor.click()
    URL.revokeObjectURL(url)
  }

  return (
    <article className="card-view">
      <a className="back" href={lastLibraryView()}>← Library</a>

      <section className="panel card-top">
        <div className="card-title">
          <TypeBadge type={cardType} />
          <h2>{title}</h2>
        </div>
        {facts?.summary && <p className="card-summary">{facts.summary}</p>}
        {facts && <Glance facts={facts} />}
        <div className="row card-actions">
          {link && <a className="button primary" href={link} target="_blank" rel="noreferrer">Open the {cardType === 'dataset' ? 'dataset' : 'publication'} ↗</a>}
          <button type="button" onClick={download}>Download card (JSON)</button>
          <button type="button" onClick={() => onEdit(cardType, body as Json, title)}>Open in the editor</button>
          {facts && <a className="button" href={facts.atlas_url} target="_blank" rel="noreferrer">View on ATLAS ↗</a>}
        </div>
      </section>

      {sections.map(([key, value]) => (
        <section className="panel card-section" key={key}>
          <h3>{key}</h3>
          {key === 'Partitions' && Array.isArray(value) ? <Partitions rows={value} />
            : key === 'Model performance' && isDict(value) ? <Performance value={value} />
              : <Value value={value} top />}
        </section>
      ))}
    </article>
  )
}

/** The facts a reader decides by, each linking to the library filtered on it. */
function Glance({ facts }: { facts: LibraryCard }) {
  const links = (key: 'modality' | 'subspecialty' | 'task', values: string[]) =>
    values.map((value, index) => (
      <span key={value}>
        {index > 0 && ', '}
        <a href={libraryLink({ [key]: [value] })}>{value}</a>
      </span>
    ))
  const rows: [string, ReactNode][] = []
  if (facts.modalities.length) rows.push(['Modality', links('modality', facts.modalities)])
  if (facts.subspecialties.length) rows.push(['Subspecialty', links('subspecialty', facts.subspecialties)])
  if (facts.tasks.length) rows.push(['Task', links('task', facts.tasks)])
  if (facts.type === 'dataset') rows.push(['Size', sizeParts(facts).join(' · ') || NOT_STATED])
  if (facts.type === 'model') rows.push(['Metrics reported', facts.metrics.join(', ') || NOT_STATED])
  rows.push(['Population', facts.ages ? `${facts.population} (${age(facts.ages[0])} to ${age(facts.ages[1])})` : facts.population])
  rows.push(['Published', facts.year ? String(facts.year) : NOT_STATED])
  rows.push(['License', facts.license || NOT_STATED])
  if (facts.organizations.length) rows.push(['From', facts.organizations.slice(0, 3).join('; ') + (facts.organizations.length > 3 ? ` +${facts.organizations.length - 3}` : '')])
  return (
    <dl className="glance">
      {rows.map(([label, content]) => (
        <div key={label}>
          <dt>{label}</dt>
          <dd className={content === NOT_STATED ? 'muted' : ''}>{content}</dd>
        </div>
      ))}
    </dl>
  )
}

const age = (years: number) => (years < 2 ? `${Math.round(years * 12)} months` : `${Math.round(years)} years`)

/** An age range as the card stores it, [[18, "years"], [90, "years"]], in words. */
function ageRange(value: unknown): string | null {
  if (!Array.isArray(value) || value.length !== 2) return null
  const bound = (item: unknown) => (Array.isArray(item) && item.length === 2 && typeof item[0] === 'number' ? `${item[0]} ${item[1]}` : null)
  const [low, high] = [bound(value[0]), bound(value[1])]
  return low && high ? `${low} to ${high}` : null
}

function Text({ text }: { text: string }) {
  if (isLink(text)) return <a href={text} target="_blank" rel="noreferrer" className="wrap">{text}</a>
  return <p className="prose">{text}</p>
}

function Value({ value, top = false }: { value: unknown; top?: boolean }): ReactNode {
  if (isBlank(value)) return <span className="muted">–</span>
  if (typeof value === 'string') return <Text text={value} />
  if (typeof value === 'number') return value.toLocaleString('en-US')
  if (typeof value === 'boolean') return value ? 'Yes' : 'No'
  if (Array.isArray(value)) {
    const range = ageRange(value)
    if (range) return range
    const items = value.filter((item) => !isBlank(item))
    if (items.every(isScalar)) {
      if (items.every((item) => String(item).length <= 48))
        return <span className="fact-chips">{items.map((item, index) => <span className="fact-chip" key={index}>{String(item)}</span>)}</span>
      return <ul className="plain">{items.map((item, index) => <li key={index}><Value value={item} /></li>)}</ul>
    }
    if (items.every(isDict)) return <Rows rows={items as Dict[]} />
    return <ul className="plain">{items.map((item, index) => <li key={index}><Value value={item} /></li>)}</ul>
  }
  if (isDict(value)) {
    const entries = Object.entries(value).filter(([, item]) => !isBlank(item))
    return (
      <dl className={top ? 'fields-read' : 'fields-read nested'}>
        {entries.map(([key, item]) => (
          <div key={key} className={typeof item === 'string' && item.length > 90 || Array.isArray(item) || isDict(item) ? 'wide' : ''}>
            <dt>{key}</dt>
            <dd><Value value={item} /></dd>
          </div>
        ))}
      </dl>
    )
  }
  return String(value)
}

/** A list of records (authors, organizations, references, procedures) as a table or a plain list. */
function Rows({ rows }: { rows: Dict[] }) {
  const keys = [...new Set(rows.flatMap((row) => Object.keys(row).filter((key) => !isBlank(row[key]))))]
  if (keys.length === 1)
    return <ul className="plain columns">{rows.map((row, index) => <li key={index}><Value value={row[keys[0]]} /></li>)}</ul>
  const simple = rows.every((row) => keys.every((key) => isBlank(row[key]) || isScalar(row[key])))
  if (simple && keys.length <= 6)
    return (
      <div className="table-wrap">
        <table className="read-table">
          <thead><tr>{keys.map((key) => <th key={key}>{key}</th>)}</tr></thead>
          <tbody>
            {rows.map((row, index) => (
              <tr key={index}>{keys.map((key) => <td key={key}><Cell value={row[key]} /></td>)}</tr>
            ))}
          </tbody>
        </table>
      </div>
    )
  return <div className="blocks">{rows.map((row, index) => <div className="block" key={index}><Value value={row} /></div>)}</div>
}

function Cell({ value }: { value: unknown }) {
  if (isBlank(value)) return <span className="muted">–</span>
  if (typeof value === 'string' && isLink(value)) return <a href={value} target="_blank" rel="noreferrer" className="wrap">{value}</a>
  if (typeof value === 'number') return value.toLocaleString('en-US')
  return String(value)
}

/** Partitions as one table: a row per partition, its subsets indented beneath it. */
function Partitions({ rows }: { rows: unknown[] }) {
  const groups = rows.filter(isDict).map((row) => ({
    name: String(row.Partition ?? 'Partition'),
    total: isDict(row.Total) ? row.Total : {},
    subsets: Array.isArray(row.Subsets) ? row.Subsets.filter(isDict) : [],
    comments: typeof row.Comments === 'string' ? row.Comments : '',
  }))
  const every = groups.flatMap((group) => [group.total, ...group.subsets])
  const counts = COUNTS.filter((key) => every.some((item) => !isBlank(item[key])))
  const extras = ['Sex', 'Age range', 'Demographic'].filter((key) => every.some((item) => !isBlank(item[key])))
  const notes = every.some((item) => !isBlank(item.Criterion) || !isBlank(item.Comments)) || groups.some((group) => group.comments)
  const line = (item: Dict, label: ReactNode, key: string, extra = '') => (
    <tr key={key} className={extra}>
      <td>{label}</td>
      {counts.map((count) => <td className="num" key={count}><Cell value={item[count]} /></td>)}
      {extras.map((field) => <td key={field}>{field === 'Age range' ? ageRange(item[field]) ?? <span className="muted">–</span> : <Cell value={item[field]} />}</td>)}
      {notes && <td className="note">{[item.Criterion, item.Comments].filter((text) => typeof text === 'string' && text).join(' ')}</td>}
    </tr>
  )
  return (
    <div className="table-wrap">
      <table className="read-table">
        <thead>
          <tr>
            <th>Partition</th>
            {counts.map((count) => <th className="num" key={count}>{COUNT_HEADS[count]}</th>)}
            {extras.map((field) => <th key={field}>{field}</th>)}
            {notes && <th>Notes</th>}
          </tr>
        </thead>
        <tbody>
          {groups.flatMap((group, index) => [
            line({ ...group.total, Comments: [group.total.Comments, group.comments].filter(Boolean).join(' ') }, <strong>{group.name}</strong>, `p${index}`),
            ...group.subsets.map((subset, at) => line(subset, <span className="subset">Subset</span>, `p${index}s${at}`, 'subset-row')),
          ])}
        </tbody>
      </table>
    </div>
  )
}

/** Model performance: the metrics reported, results as a table when the text is laid out as one. */
function Performance({ value }: { value: Dict }) {
  const { Metrics: metrics, Comments: comments, ...rest } = value
  const results = typeof comments === 'string' ? parseResults(comments) : null
  return (
    <>
      {Array.isArray(metrics) && metrics.length > 0 && (
        <div className="read-field">
          <p className="read-label">Metrics reported</p>
          <Value value={metrics} />
        </div>
      )}
      {results && results.rows.length > 0 && (
        <div className="table-wrap read-field">
          <table className="read-table">
            <thead><tr><th>Measured on</th><th>Metric</th><th>Result</th><th>Interval or note</th></tr></thead>
            <tbody>
              {results.rows.map((row, index) => (
                <tr key={index}>
                  <td>{index > 0 && results.rows[index - 1].set === row.set ? '' : row.set}</td>
                  <td>{row.metric}</td>
                  <td><strong>{row.value}</strong></td>
                  <td>{row.detail}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {results && results.remarks.trim() && (
        <div className="read-field">
          <p className="read-label">{results.rows.length ? 'Remarks' : 'Results'}</p>
          <Text text={results.remarks.trim()} />
        </div>
      )}
      {!isBlank(rest) && <Value value={rest} top />}
    </>
  )
}
