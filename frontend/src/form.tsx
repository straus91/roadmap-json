// The form is generated from the ATLAS schema: one widget per kind of schema node (see
// kindOf in schema.ts). It can only produce fields and values the schema defines.

import { createContext, useContext, useEffect, useId, useMemo, useState } from 'react'
import type { ReactNode } from 'react'
import { formatResults, parseResults, tidyCell } from './results.ts'
import type { ResultRow, Results } from './results.ts'
import { isEmpty, kindOf, pointerOf, resolve, summarize } from './schema.ts'
import type { Json, Path, Schema } from './schema.ts'

export interface FormContext {
  root: Schema
  problems: Map<string, string[]> // editor pointer -> messages
  focus: { pointer: string; tick: number } | null
  change: (path: Path, value: Json | undefined) => void
}

const Context = createContext<FormContext | null>(null)
export const FormProvider = Context.Provider

function useForm(): FormContext {
  const context = useContext(Context)
  if (!context) throw new Error('form widgets need a FormProvider')
  return context
}

// Meanings of the RSNA content codes (the schema lists only the two-letter codes).
const CODE_MEANINGS: Record<string, string> = {
  BR: 'breast', BQ: 'biomarkers / quantitative', CA: 'cardiac', CH: 'chest', CT: 'computed tomography',
  ED: 'education', ER: 'emergency radiology', GI: 'gastrointestinal', GU: 'genitourinary',
  HN: 'head and neck', HP: 'health policy', IN: 'informatics', IR: 'interventional',
  LM: 'leadership and management', MI: 'molecular imaging', MK: 'musculoskeletal', MR: 'magnetic resonance',
  NM: 'nuclear medicine', NR: 'neuroradiology', OB: 'obstetric / gynecologic', OI: 'oncologic imaging',
  OT: 'other', PD: 'pediatric', PH: 'physics', PR: 'professionalism', SQ: 'safety and quality',
  RO: 'radiation oncology', RS: 'research and statistics', US: 'ultrasound', VA: 'vascular',
}

interface FieldProps {
  name: string
  node: Schema // as written in the parent (may be a $ref)
  path: Path
  value: Json | undefined
  required?: boolean
  bare?: boolean // inside a table cell: no label, no help text
}

/** Problems reported exactly on this field, or (for list-like widgets) on its entries. */
function useProblems(path: Path, withChildren: boolean): string[] {
  const { problems } = useForm()
  const pointer = pointerOf(path)
  return useMemo(() => {
    const found = [...(problems.get(pointer) ?? [])]
    if (withChildren)
      for (const [key, messages] of problems)
        if (key.startsWith(pointer + '/')) {
          const entry = key.slice(pointer.length + 1).split('/')[0]
          const where = /^\d+$/.test(entry) ? `Entry ${Number(entry) + 1}: ` : ''
          found.push(...messages.map((message) => where + message))
        }
    return found
  }, [problems, pointer, withChildren])
}

export function Field({ name, node: raw, path, value, required, bare }: FieldProps) {
  const { root } = useForm()
  const node = resolve(raw, root)
  const kind = kindOf(node, root)
  const id = useId()
  const isList = kind === 'choiceList' || kind === 'textList' || kind === 'integerList' || kind === 'ageRange'
  const problems = useProblems(path, isList)
  const pointer = pointerOf(path)

  if (kind === 'group')
    return (
      <fieldset className="group" data-pointer={pointer}>
        <legend>{name}</legend>
        {node.description && <p className="help">{node.description}</p>}
        <Problems messages={problems} />
        <ObjectFields node={node} path={path} value={value} />
      </fieldset>
    )

  if (kind === 'objectList')
    return (
      <div className="field wide" data-pointer={pointer}>
        {!bare && <span className="label">{name}</span>}
        {!bare && node.description && <p className="help">{node.description}</p>}
        <Problems messages={problems} />
        <ObjectList name={name} node={node} path={path} value={value} />
      </div>
    )

  const wide = kind === 'longText' || isList
  return (
    <div className={`field ${wide ? 'wide' : ''} ${problems.length ? 'invalid' : ''}`} data-pointer={pointer}>
      {!bare && (
        <label className="label" htmlFor={id}>
          {name}
          {required && <span className="required" title="Required"> *</span>}
        </label>
      )}
      <Widget kind={kind} node={node} path={path} value={value} id={id} label={name} />
      {!bare && node.description && <p className="help">{node.description}</p>}
      {!bare && <Problems messages={problems} />}
    </div>
  )
}

function Problems({ messages }: { messages: string[] }) {
  if (!messages.length) return null
  return (
    <ul className="field-problems" role="alert">
      {messages.map((message) => (
        <li key={message}>{message}</li>
      ))}
    </ul>
  )
}

interface WidgetProps {
  kind: ReturnType<typeof kindOf>
  node: Schema
  path: Path
  value: Json | undefined
  id: string
  label: string
}

function Widget({ kind, node, path, value, id, label }: WidgetProps) {
  const { change, root } = useForm()
  const text = value === undefined || value === null ? '' : typeof value === 'object' ? JSON.stringify(value) : String(value)
  const placeholder = node.examples?.[0] !== undefined && typeof node.examples[0] !== 'object' ? `e.g. ${node.examples[0]}` : undefined
  const set = (next: Json | undefined) => change(path, next === '' ? undefined : next)

  switch (kind) {
    case 'longText':
      return (
        <textarea
          id={id}
          aria-label={label}
          value={text}
          rows={Math.min(12, Math.max(1, Math.ceil(text.length / 80)))}
          onChange={(event) => set(event.target.value)}
        />
      )
    case 'integer':
    case 'number':
      return (
        <input
          id={id}
          aria-label={label}
          className="short"
          inputMode="numeric"
          value={text}
          placeholder={placeholder}
          onChange={(event) => {
            const typed = event.target.value.replace(/,/g, '').trim()
            const numeric = kind === 'integer' ? /^-?\d+$/.test(typed) : /^-?\d+(\.\d+)?$/.test(typed)
            set(numeric ? Number(typed) : typed)
          }}
        />
      )
    case 'date':
      return (
        <input
          id={id}
          aria-label={label}
          className="short"
          value={text}
          placeholder="2024 or 2024-03-15"
          onChange={(event) => {
            const typed = event.target.value.trim()
            set(/^\d{4}$/.test(typed) ? Number(typed) : typed)
          }}
        />
      )
    case 'boolean':
      return (
        <select id={id} aria-label={label} className="short" value={value === true ? 'yes' : value === false ? 'no' : ''}
          onChange={(event) => set(event.target.value === '' ? undefined : event.target.value === 'yes')}>
          <option value="">Not stated</option>
          <option value="yes">Yes</option>
          <option value="no">No</option>
        </select>
      )
    case 'choice': {
      const options: string[] = node.enum.map(String)
      return (
        <select id={id} aria-label={label} value={text} onChange={(event) => set(event.target.value)}>
          <option value="">Not stated</option>
          {text && !options.includes(text) && <option value={text}>{text} (not allowed)</option>}
          {options.map((option) => (
            <option key={option}>{option}</option>
          ))}
        </select>
      )
    }
    case 'choiceList':
      return <ChoiceList options={resolve(node.items, root).enum.map(String)} path={path} value={value} id={id} label={label} />
    case 'textList':
    case 'integerList':
      return <TagList numeric={kind === 'integerList'} suggestions={resolve(node.items, root).examples} path={path} value={value} id={id} label={label} />
    case 'ageRange':
      return <AgeRange node={node} path={path} value={value} id={id} />
    case 'unknown':
      return <input id={id} aria-label={label} value={text} onChange={(event) => set(event.target.value)} />
    default:
      return (
        <input
          id={id}
          aria-label={label}
          type={node.format === 'email' ? 'email' : node.format === 'uri' ? 'url' : 'text'}
          value={text}
          placeholder={placeholder}
          onChange={(event) => set(event.target.value)}
        />
      )
  }
}

function asList(value: Json | undefined): Json[] {
  return Array.isArray(value) ? value : value === undefined || value === null ? [] : [value]
}

interface ListWidgetProps {
  path: Path
  value: Json | undefined
  id: string
  label: string
}

/** Several values from a fixed list. Short lists are shown whole; long ones are searched. */
function ChoiceList({ options, path, value, id, label }: ListWidgetProps & { options: string[] }) {
  const { change } = useForm()
  const [query, setQuery] = useState('')
  const [open, setOpen] = useState(false)
  const chosen = asList(value).map(String)
  const update = (next: string[]) => change(path, next.length ? next : undefined)
  const toggle = (option: string) =>
    update(chosen.includes(option) ? chosen.filter((item) => item !== option) : [...chosen, option])
  const stray = chosen.filter((item) => !options.includes(item))

  if (options.length <= 40 && options.every((option) => option.length <= 12))
    return (
      <div className="chips" role="group" aria-label={label} id={id}>
        {options.map((option) => (
          <button type="button" key={option} className={`chip toggle ${chosen.includes(option) ? 'on' : ''}`}
            aria-pressed={chosen.includes(option)} onClick={() => toggle(option)}>
            <strong>{option}</strong>
            {CODE_MEANINGS[option] && <span> {CODE_MEANINGS[option]}</span>}
          </button>
        ))}
        {stray.map((item) => (
          <button type="button" key={item} className="chip bad" onClick={() => toggle(item)} title="Not an allowed value; click to remove">
            {item} ×
          </button>
        ))}
      </div>
    )

  const words = query.toLowerCase().split(/\s+/).filter(Boolean)
  const matches = options.filter(
    (option) => !chosen.includes(option) && words.every((word) => option.toLowerCase().includes(word)),
  )
  return (
    <div className="picker">
      <div className="chips">
        {chosen.map((item) => (
          <span key={item} className={`chip ${options.includes(item) ? '' : 'bad'}`}>
            {item}
            <button type="button" className="chip-x" aria-label={`Remove ${item}`} title="Remove" onClick={() => toggle(item)}>×</button>
          </span>
        ))}
      </div>
      <input
        id={id}
        aria-label={`Add to ${label}`}
        value={query}
        placeholder={`Type to search the ${options.length} allowed values, then pick one to add it`}
        onChange={(event) => {
          setQuery(event.target.value)
          setOpen(true)
        }}
        onFocus={() => setOpen(true)}
        onBlur={() => setTimeout(() => setOpen(false), 150)}
        onKeyDown={(event) => {
          if (event.key === 'Enter' && matches.length) {
            event.preventDefault()
            toggle(matches[0])
            setQuery('')
          }
        }}
      />
      {open && (
        <ul className="options">
          {matches.slice(0, 60).map((option) => (
            <li key={option}>
              <button type="button" onMouseDown={(event) => event.preventDefault()}
                onClick={() => {
                  toggle(option)
                  setQuery('')
                }}>
                {option}
              </button>
            </li>
          ))}
          {!matches.length && <li className="none">No matching option</li>}
        </ul>
      )}
    </div>
  )
}

/** Free entries (keywords, codes): type one and press Enter. */
function TagList({ numeric, suggestions, path, value, id, label }: ListWidgetProps & { numeric: boolean; suggestions?: Json[] }) {
  const { change } = useForm()
  const [draft, setDraft] = useState('')
  const listId = useId()
  const entries = asList(value)
  const update = (next: Json[]) => change(path, next.length ? next : undefined)
  const add = (raw: string) => {
    const pieces = raw.split(/[;\n]/).map((piece) => piece.trim()).filter(Boolean)
    const fresh = pieces
      .map((piece): Json => (numeric && /^\d+$/.test(piece) ? Number(piece) : piece))
      .filter((piece) => !entries.includes(piece))
    if (fresh.length) update([...entries, ...fresh])
    setDraft('')
  }
  return (
    <div className="picker">
      <div className="chips">
        {entries.map((entry, index) => (
          <span key={`${index}-${String(entry)}`} className="chip">
            {String(entry)}
            <button type="button" className="chip-x" aria-label={`Remove ${String(entry)}`} title="Remove"
              onClick={() => update(entries.filter((_, at) => at !== index))}>×</button>
          </span>
        ))}
      </div>
      <input
        id={id}
        aria-label={`Add to ${label}`}
        value={draft}
        list={suggestions?.length ? listId : undefined}
        inputMode={numeric ? 'numeric' : undefined}
        placeholder="Type an entry and press Enter to add it"
        onChange={(event) => setDraft(event.target.value)}
        onBlur={() => draft.trim() && add(draft)}
        onKeyDown={(event) => {
          if (event.key === 'Enter') {
            event.preventDefault()
            add(draft)
          }
        }}
      />
      {suggestions?.length ? (
        <datalist id={listId}>
          {suggestions.map((suggestion) => (
            <option key={String(suggestion)} value={String(suggestion)} />
          ))}
        </datalist>
      ) : null}
    </div>
  )
}

/** [[low, unit], [high, unit]] shown as "from 18 years to 90 years". */
function AgeRange({ node, path, value, id }: { node: Schema; path: Path; value: Json | undefined; id: string }) {
  const { change, root } = useForm()
  const units: string[] = resolve(resolve(node.items, root).items, root).enum ?? ['days', 'months', 'years']
  const bounds = asList(value).map(asList)
  const part = (bound: number, at: number) => bounds[bound]?.[at] ?? ''
  const update = (bound: number, at: number, raw: string) => {
    const next = [0, 1].map((b) => [part(b, 0), part(b, 1)] as Json[])
    next[bound][at] = at === 0 && /^\d+$/.test(raw.trim()) ? Number(raw.trim()) : raw.trim()
    for (const pair of next) if (pair[0] !== '' && pair[1] === '') pair[1] = 'years'
    const blank = next.every((pair) => pair[0] === '')
    change(path, blank ? undefined : next.map((pair) => pair.map((item) => (item === '' ? null : item))))
  }
  const half = bounds.length > 0 && [0, 1].some((bound) => part(bound, 0) === '')
  return (
    <div className="age-range">
      {[0, 1].map((bound) => (
        <span key={bound}>
          <span className="muted">{bound === 0 ? 'from' : 'to'}</span>
          <input id={bound === 0 ? id : undefined} aria-label={bound === 0 ? 'Youngest age' : 'Oldest age'} className="tiny"
            inputMode="numeric" value={String(part(bound, 0) ?? '')} onChange={(event) => update(bound, 0, event.target.value)} />
          <select aria-label={bound === 0 ? 'Unit of youngest age' : 'Unit of oldest age'} value={String(part(bound, 1) ?? '')}
            onChange={(event) => update(bound, 1, event.target.value)}>
            <option value=""></option>
            {units.map((unit) => (
              <option key={unit}>{unit}</option>
            ))}
          </select>
        </span>
      ))}
      {half && <span className="help">Fill in both ends, or clear both.</span>}
    </div>
  )
}

/** The fields of one object: every field the schema defines, empty when there is nothing yet. */
export function ObjectFields({ node, path, value }: { node: Schema; path: Path; value: Json | undefined }) {
  const { root } = useForm()
  const properties: Record<string, Schema> = node.properties ?? {}
  if (isPerformance(node, root)) return <PerformanceEditor node={node} path={path} value={value} />
  const required: string[] = node.required ?? []
  const record = value !== null && typeof value === 'object' && !Array.isArray(value) ? value : {}
  return (
    <div className="fields">
      {Object.keys(properties).map((key) => (
        <Field key={key} name={key} node={properties[key]} path={[...path, key]} value={record[key]} required={required.includes(key)} />
      ))}
    </div>
  )
}

function isFlat(item: Schema, root: Schema): boolean {
  return Object.values<Schema>(item.properties ?? {}).every((property) => {
    const kind = kindOf(resolve(property, root), root)
    return kind !== 'group' && kind !== 'objectList' && kind !== 'choiceList' && kind !== 'textList' && kind !== 'integerList'
  })
}

/** A list of objects: authors, references, partitions... */
function ObjectList({ name, node, path, value }: { name: string; node: Schema; path: Path; value: Json | undefined }) {
  const { change, root, focus } = useForm()
  const item = resolve(node.items, root)
  const rows = asList(value)
  const nested = path.some((part) => typeof part === 'number')
  const singular = name.replace(/ies$/, 'y').replace(/s$/, '').toLowerCase()
  const [open, setOpen] = useState<number | null>(null)
  const pointer = pointerOf(path)

  useEffect(() => {
    if (!focus || !focus.pointer.startsWith(pointer + '/')) return
    const row = Number(focus.pointer.slice(pointer.length + 1).split('/')[0])
    if (Number.isInteger(row)) setOpen(row)
  }, [focus, pointer])

  const add = () => {
    change([...path, rows.length], {})
    setOpen(rows.length)
  }
  const move = (from: number, to: number) => {
    const next = [...rows]
    next.splice(to, 0, next.splice(from, 1)[0])
    change(path, next)
    setOpen(null)
  }

  if (item.properties?.Total && item.properties?.Subsets)
    return <PartitionsEditor item={item} path={path} rows={rows} onAdd={add} onRemove={(index) => change([...path, index], undefined)} />
  const flatKeys = Object.keys(item.properties ?? {})
  if (isFlat(item, root) && (nested || flatKeys.length <= 4))
    return <ObjectTable item={item} path={path} rows={rows} singular={singular} onAdd={add} />

  return (
    <div className="rows">
      {rows.map((row, index) => (
        <Row key={index} index={index} count={rows.length} item={item} path={[...path, index]} value={row} singular={singular}
          open={open === index} onToggle={() => setOpen(open === index ? null : index)}
          onRemove={() => {
            change([...path, index], undefined)
            setOpen(null)
          }}
          onMove={(to) => move(index, to)} />
      ))}
      <button type="button" className="add" onClick={add}>
        + Add {singular}
      </button>
    </div>
  )
}

interface RowProps {
  index: number
  count: number
  item: Schema
  path: Path
  value: Json
  singular: string
  open: boolean
  onToggle: () => void
  onRemove: () => void
  onMove: (to: number) => void
}

function Row({ index, count, item, path, value, singular, open, onToggle, onRemove, onMove }: RowProps) {
  const { problems } = useForm()
  const pointer = pointerOf(path)
  const troubled = [...problems.keys()].filter((key) => key === pointer || key.startsWith(pointer + '/')).length
  const summary = summarize(value) || (isEmpty(value) ? `New ${singular}` : `${singular} ${index + 1}`)
  return (
    <div className={`row-card ${open ? 'open' : ''}`} data-pointer={pointer}>
      <div className="row-head">
        <button type="button" className="row-title" aria-expanded={open} onClick={onToggle}>
          <span className="caret" aria-hidden="true">{open ? '▾' : '▸'}</span>
          <span className="number">{index + 1}</span>
          <span className="summary">{summary}</span>
          {troubled > 0 && <span className="badge bad">{troubled} to fix</span>}
        </button>
        <span className="row-actions">
          <button type="button" title="Move up" aria-label={`Move ${singular} ${index + 1} up`} disabled={index === 0} onClick={() => onMove(index - 1)}>↑</button>
          <button type="button" title="Move down" aria-label={`Move ${singular} ${index + 1} down`} disabled={index === count - 1} onClick={() => onMove(index + 1)}>↓</button>
          <button type="button" className="remove" aria-label={`Remove ${singular} ${index + 1}`} onClick={onRemove}>Remove</button>
        </span>
      </div>
      {open && <ObjectFields node={item} path={path} value={value} />}
    </div>
  )
}

/** Short, uniform objects (subsets of a partition, procedures) as a small spreadsheet. */
function ObjectTable({ item, path, rows, singular, onAdd }: { item: Schema; path: Path; rows: Json[]; singular: string; onAdd: () => void }) {
  const { change, problems } = useForm()
  const properties: Record<string, Schema> = item.properties ?? {}
  const keys = Object.keys(properties)
  const used = keys.filter((key) => rows.some((row) => row !== null && typeof row === 'object' && !Array.isArray(row) && row[key] !== undefined))
  // Columns to offer while the table is still empty: all of them when few, else the free-text
  // descriptor followed by the first counts. Once rows have content, only used columns show.
  const [extra, setExtra] = useState<string[]>(() => {
    if (used.length) return []
    if (keys.length <= 4) return keys
    const texts = keys.filter((key) => properties[key].type === 'string' && !properties[key].enum && key !== 'Comments')
    const counts = keys.filter((key) => properties[key].type === 'integer')
    return [...new Set([...(item.required ?? []), ...texts.slice(0, 1), ...counts.slice(1, 4)])]
  })
  // What a row is about (criterion, sex...) reads first, counts next, comments last.
  const rank = (key: string) => (/^(comments|notes)$/i.test(key) ? 2 : ['integer', 'number'].includes(properties[key].type) || properties[key].type === 'array' ? 1 : 0)
  const columns = keys.filter((key) => used.includes(key) || extra.includes(key)).sort((a, b) => rank(a) - rank(b))
  const spare = keys.filter((key) => !columns.includes(key))
  const pointer = pointerOf(path)
  const messages = [...problems].filter(([key]) => key.startsWith(pointer + '/')).flatMap(([key, list]) => {
    const [row, column] = key.slice(pointer.length + 1).split('/')
    return list.map((message) => `Row ${Number(row) + 1}${column ? `, ${column.replace(/~1/g, '/')}` : ''}: ${message}`)
  })

  let table: ReactNode = null
  if (rows.length && columns.length)
    table = (
      <div className="table-wrap">
        <table>
          <thead>
            <tr>
              {columns.map((key) => (
                <th key={key} title={properties[key].description}>{key}</th>
              ))}
              <th aria-label="Remove"></th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row, index) => (
              <tr key={index} data-pointer={pointerOf([...path, index])}>
                {columns.map((key) => (
                  <td key={key}>
                    <Field bare name={key} node={properties[key]} path={[...path, index, key]}
                      value={row !== null && typeof row === 'object' && !Array.isArray(row) ? row[key] : undefined} />
                  </td>
                ))}
                <td>
                  <button type="button" className="remove" aria-label={`Remove ${singular} ${index + 1}`}
                    onClick={() => change([...path, index], undefined)}>Remove</button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    )

  return (
    <div className="rows">
      {table}
      <Problems messages={messages} />
      <div className="table-actions">
        <button type="button" className="add" onClick={onAdd}>
          + Add {singular}
        </button>
        {spare.length > 0 && (
          <select aria-label="Add a column" value="" onChange={(event) => event.target.value && setExtra([...extra, event.target.value])}>
            <option value="">+ Add a column…</option>
            {spare.map((key) => (
              <option key={key}>{key}</option>
            ))}
          </select>
        )}
      </div>
    </div>
  )
}

function asRecord(value: Json | undefined): Record<string, Json> {
  return value !== null && typeof value === 'object' && !Array.isArray(value) ? value : {}
}

// ------------------------------------------------------------------ model performance
/** "Model performance" in the ATLAS schema: a list of metric names plus one Comments text. */
function isPerformance(node: Schema, root: Schema): boolean {
  const properties: Record<string, Schema> = node.properties ?? {}
  const keys = Object.keys(properties)
  return (
    keys.length === 2 &&
    'Metrics' in properties &&
    'Comments' in properties &&
    kindOf(resolve(properties.Metrics, root), root) === 'choiceList' &&
    resolve(properties.Comments, root).type === 'string'
  )
}

/**
 * A results table (evaluated on / metric / value / range) kept inside the Comments text, one
 * sentence per evaluation set. See results.ts for the layout and why it is done this way.
 */
function PerformanceEditor({ node, path, value }: { node: Schema; path: Path; value: Json | undefined }) {
  const { change, root } = useForm()
  const record = asRecord(value)
  const text = typeof record.Comments === 'string' ? record.Comments : ''
  const allowed: string[] = resolve(resolve(node.properties.Metrics, root).items, root).enum.map(String)
  const [local, setLocal] = useState<Results>(() => parseResults(text))
  const listId = useId()
  const commentsPath = [...path, 'Comments']
  const problems = useProblems(commentsPath, false)

  // The card changed from outside this table (JSON view, tidy, a new card): read it again.
  useEffect(() => {
    if (formatResults(local) !== text.trim()) setLocal(parseResults(text))
  }, [text]) // eslint-disable-line react-hooks/exhaustive-deps

  const write = (next: Results) => {
    setLocal(next)
    const comments = formatResults(next)
    // every metric that has a result is also listed under Metrics ("other" when it has no ATLAS name)
    const listed = asList(record.Metrics).map(String)
    const lower = new Map(allowed.map((name) => [name.toLowerCase(), name]))
    for (const row of next.rows) {
      if (!row.metric.trim() || !row.value.trim()) continue
      const name = lower.get(row.metric.trim().toLowerCase()) ?? lower.get('other') ?? null
      if (name && !listed.includes(name)) listed.push(name)
    }
    const group: Record<string, Json> = {}
    if (listed.length) group.Metrics = listed
    if (comments) group.Comments = comments
    change(path, Object.keys(group).length ? group : undefined)
  }
  const setCell = (index: number, part: keyof ResultRow, raw: string) =>
    write({ ...local, rows: local.rows.map((row, at) => (at === index ? { ...row, [part]: tidyCell(raw, part) } : row)) })
  const addRow = () =>
    write({ ...local, rows: [...local.rows, { set: local.rows.at(-1)?.set ?? '', metric: '', value: '', detail: '' }] })
  const saved = formatResults(local)

  return (
    <div className="fields">
      <Field name="Metrics" node={node.properties.Metrics} path={[...path, 'Metrics']} value={record.Metrics} />
      <div className="field wide" data-pointer={pointerOf(commentsPath)}>
        <span className="label">Results</span>
        <p className="help">One row per reported number. A metric used here is added to the list above automatically.</p>
        {local.rows.length > 0 && (
          <div className="table-wrap">
            <table className="results">
              <thead>
                <tr>
                  <th title="The data the number was measured on, for example: Internal test set (n = 485)">Evaluated on</th>
                  <th>Metric</th>
                  <th>Value</th>
                  <th title="Confidence interval, range, or a short note">Range or note</th>
                  <th aria-label="Remove"></th>
                </tr>
              </thead>
              <tbody>
                {local.rows.map((row, index) => (
                  <tr key={index}>
                    <td>
                      <input aria-label={`Result ${index + 1}: evaluated on`} value={row.set} placeholder="Internal test set (n = 485)"
                        onChange={(event) => setCell(index, 'set', event.target.value)} />
                    </td>
                    <td>
                      <input aria-label={`Result ${index + 1}: metric`} value={row.metric} list={listId} placeholder="sensitivity"
                        onChange={(event) => setCell(index, 'metric', event.target.value)} />
                    </td>
                    <td className="narrow">
                      <input aria-label={`Result ${index + 1}: value`} value={row.value} placeholder="0.91"
                        onChange={(event) => setCell(index, 'value', event.target.value)} />
                    </td>
                    <td>
                      <input aria-label={`Result ${index + 1}: range or note`} value={row.detail} placeholder="95% CI: 0.86, 0.94"
                        onChange={(event) => setCell(index, 'detail', event.target.value)} />
                    </td>
                    <td>
                      <button type="button" className="remove" aria-label={`Remove result ${index + 1}`}
                        onClick={() => write({ ...local, rows: local.rows.filter((_, at) => at !== index) })}>
                        Remove
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        <datalist id={listId}>
          {allowed.map((name) => (
            <option key={name} value={name} />
          ))}
        </datalist>
        <div className="table-actions">
          <button type="button" className="add" onClick={addRow}>
            + Add result
          </button>
        </div>
        <label className="label sub" htmlFor={`${listId}remarks`}>
          Other remarks
        </label>
        <textarea id={`${listId}remarks`} value={local.remarks} rows={Math.min(12, Math.max(2, Math.ceil(local.remarks.length / 80)))}
          placeholder="Anything else about performance: comparisons with other models, reader studies, subgroups…"
          onChange={(event) => write({ ...local, remarks: event.target.value })} />
        <Problems messages={problems} />
        <details className="saved-as">
          <summary>How this is saved in the card</summary>
          <p className="help">
            The ATLAS schema has no separate place for a value per metric, so the table and remarks are stored together as the card's
            “Comments” text for model performance, one sentence per evaluation set:
          </p>
          <pre>{saved || '(nothing yet)'}</pre>
        </details>
      </div>
    </div>
  )
}

// ------------------------------------------------------------------ dataset partitions
const plural = (key: string) => key.replace(/ count$/i, 's')

/** Subsets that split a partition by one thing only (sex, race/ethnicity) should add up to its total. */
function sumChecks(row: Record<string, Json>, counts: string[]): string[] {
  const total = asRecord(row.Total)
  const subsets = asList(row.Subsets).map(asRecord)
  const notes: string[] = []
  for (const by of ['Sex', 'Demographic']) {
    const others = ['Sex', 'Demographic', 'Criterion', 'Age range'].filter((key) => key !== by)
    const group = subsets.filter((subset) => subset[by] !== undefined && others.every((key) => subset[key] === undefined))
    if (group.length < 2) continue
    for (const key of counts) {
      if (typeof total[key] !== 'number' || !group.every((subset) => typeof subset[key] === 'number')) continue
      const sum = group.reduce((acc, subset) => acc + (subset[key] as number), 0)
      const what = plural(key).toLowerCase()
      notes.push(
        sum === total[key]
          ? `By ${by.toLowerCase()}: the ${group.length} groups add up to the total of ${sum.toLocaleString('en-US')} ${what}.`
          : `By ${by.toLowerCase()}: the ${group.length} groups add up to ${sum.toLocaleString('en-US')} ${what}, but the total is ${(total[key] as number).toLocaleString('en-US')}. Check the numbers, unless some ${what} are in no group.`,
      )
    }
  }
  return notes
}

interface PartitionsProps {
  item: Schema
  path: Path
  rows: Json[]
  onAdd: () => void
  onRemove: (index: number) => void
}

/** Partitions as the table a paper would print: one row each, counts side by side, details below. */
function PartitionsEditor({ item, path, rows, onAdd, onRemove }: PartitionsProps) {
  const { root, focus, problems } = useForm()
  const total = resolve(item.properties.Total, root)
  const totalFields: Record<string, Schema> = total.properties ?? {}
  const counts = Object.keys(totalFields).filter((key) => resolve(totalFields[key], root).type === 'integer')
  const used = counts.filter((key) => rows.some((row) => asRecord(asRecord(row).Total)[key] !== undefined))
  const [extra, setExtra] = useState<string[]>(() => (used.length ? [] : counts.filter((key) => /patient|exam|image/i.test(key))))
  const columns = counts.filter((key) => used.includes(key) || extra.includes(key))
  const spare = counts.filter((key) => !columns.includes(key))
  const [open, setOpen] = useState<number | null>(null)
  const pointer = pointerOf(path)
  /** Is this problem/field shown in the overview table itself (as opposed to under "Details")? */
  const inTable = (rest: string) => {
    const [, first, second] = rest.split('/')
    return first === 'Partition' || (first === 'Total' && second !== undefined && columns.includes(second))
  }

  useEffect(() => {
    if (!focus || !focus.pointer.startsWith(pointer + '/')) return
    const rest = focus.pointer.slice(pointer.length + 1)
    const row = Number(rest.split('/')[0])
    if (Number.isInteger(row) && !inTable(rest)) setOpen(row)
  }, [focus, pointer]) // eslint-disable-line react-hooks/exhaustive-deps

  const under = [...problems].filter(([key]) => key.startsWith(pointer + '/')).map(([key, list]) => [key.slice(pointer.length + 1), list] as const)
  const cellMessages = under
    .filter(([rest]) => inTable(rest))
    .flatMap(([rest, list]) => {
      const [row, first, second] = rest.split('/')
      return list.map((message) => `Row ${Number(row) + 1}, ${second ?? first}: ${message}`)
    })
  const hidden = (index: number) => under.filter(([rest]) => rest.split('/')[0] === String(index) && !inTable(rest)).length
  const sums = columns.map((key) =>
    rows.reduce<number | null>((acc, row) => {
      const value = asRecord(asRecord(row).Total)[key]
      return typeof value === 'number' ? (acc ?? 0) + value : acc
    }, null),
  )
  const detailKeys = Object.keys(totalFields).filter((key) => !counts.includes(key))
  const otherKeys = Object.keys(item.properties).filter((key) => !['Partition', 'Total', 'Subsets'].includes(key))

  return (
    <div className="rows">
      {rows.length > 0 && (
        <div className="table-wrap">
          <table className="partitions">
            <thead>
              <tr>
                <th>Partition</th>
                {columns.map((key) => (
                  <th key={key} title={resolve(totalFields[key], root).description}>
                    {plural(key)}
                  </th>
                ))}
                <th aria-label="Actions"></th>
              </tr>
            </thead>
            <tbody>
              {rows.map((raw, index) => {
                const row = asRecord(raw)
                const rowPath = [...path, index]
                const more = hidden(index)
                const subsets = asList(row.Subsets).length
                return [
                  <tr key={index} data-pointer={pointerOf(rowPath)}>
                    <td>
                      <Field bare name="Partition" node={item.properties.Partition} path={[...rowPath, 'Partition']} value={row.Partition} />
                    </td>
                    {columns.map((key) => (
                      <td key={key} className="narrow">
                        <Field bare name={key} node={totalFields[key]} path={[...rowPath, 'Total', key]} value={asRecord(row.Total)[key]} />
                      </td>
                    ))}
                    <td className="actions">
                      <button type="button" aria-expanded={open === index} onClick={() => setOpen(open === index ? null : index)}>
                        {open === index ? 'Hide details' : subsets ? `Details · ${subsets} breakdown${subsets === 1 ? '' : 's'}` : 'Details'}
                        {more > 0 && <span className="badge bad"> {more} to fix</span>}
                      </button>
                      <button type="button" className="remove" aria-label={`Remove partition ${index + 1}`}
                        onClick={() => {
                          onRemove(index)
                          setOpen(null)
                        }}>
                        Remove
                      </button>
                    </td>
                  </tr>,
                  open === index && (
                    <tr key={`${index}-details`} className="details-row">
                      <td colSpan={columns.length + 2}>
                        <div className="fields">
                          {detailKeys.map((key) => (
                            <Field key={key} name={key === 'Comments' ? 'Comments on the totals' : key} node={totalFields[key]}
                              path={[...rowPath, 'Total', key]} value={asRecord(row.Total)[key]} />
                          ))}
                          {otherKeys.map((key) => (
                            <Field key={key} name={key === 'Comments' ? 'Comments on this partition' : key} node={item.properties[key]}
                              path={[...rowPath, key]} value={row[key]} />
                          ))}
                          <Field name="Breakdowns (subsets)" node={item.properties.Subsets} path={[...rowPath, 'Subsets']} value={row.Subsets} />
                          {sumChecks(row, counts).map((note) => (
                            <p key={note} className={`help wide-note ${note.includes('but the total') ? 'attention' : ''}`}>
                              {note}
                            </p>
                          ))}
                        </div>
                      </td>
                    </tr>
                  ),
                ]
              })}
            </tbody>
            {rows.length > 1 && (
              <tfoot>
                <tr>
                  <td>All partitions</td>
                  {sums.map((sum, at) => (
                    <td key={columns[at]} className="narrow">
                      {sum === null ? '' : sum.toLocaleString('en-US')}
                    </td>
                  ))}
                  <td></td>
                </tr>
              </tfoot>
            )}
          </table>
        </div>
      )}
      <Problems messages={cellMessages} />
      <div className="table-actions">
        <button type="button" className="add" onClick={onAdd}>
          + Add partition
        </button>
        {spare.length > 0 && (
          <select aria-label="Add a column" value="" onChange={(event) => event.target.value && setExtra([...extra, event.target.value])}>
            <option value="">+ Add a column…</option>
            {spare.map((key) => (
              <option key={key} value={key}>
                {plural(key)}
              </option>
            ))}
          </select>
        )}
      </div>
    </div>
  )
}
