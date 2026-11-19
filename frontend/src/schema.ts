// Everything the editor knows about a card comes from the ATLAS JSON Schema served by the
// API. Nothing here names a specific field: add a field to the schema and the form shows it.

export type Json = null | boolean | number | string | Json[] | { [key: string]: Json }
export type Schema = Record<string, any> // eslint-disable-line @typescript-eslint/no-explicit-any
export type Path = (string | number)[]

/** Follow local $refs; keywords written next to the $ref (description...) are kept. */
export function resolve(node: Schema | undefined, root: Schema): Schema {
  let current: Schema = node ?? {}
  for (let hops = 0; current.$ref && hops < 16; hops++) {
    const name = String(current.$ref).replace('#/$defs/', '')
    const { $ref: _ref, ...siblings } = current
    current = { ...(root.$defs?.[name] ?? {}), ...siblings }
  }
  return current
}

export type Kind =
  | 'text'
  | 'longText'
  | 'integer'
  | 'number'
  | 'boolean'
  | 'choice' // one value from an enum
  | 'date' // ISO date string or integer year
  | 'ageRange' // [[low, unit], [high, unit]]
  | 'choiceList' // several values from an enum
  | 'textList' // free strings (keywords, codes)
  | 'integerList'
  | 'objectList'
  | 'group' // nested object
  | 'unknown'

/** Which input widget a schema node needs. */
export function kindOf(node: Schema, root: Schema): Kind {
  if (node.enum) return 'choice'
  const options: Schema[] | undefined = node.anyOf ?? node.oneOf
  if (options) {
    const resolved = options.map((option) => resolve(option, root))
    if (resolved.some((o) => o.format === 'date') && resolved.some((o) => o.type === 'integer'))
      return 'date'
    return 'unknown'
  }
  if (node.type === 'object' || (!node.type && node.properties)) return 'group'
  if (node.type === 'array') {
    const items = resolve(node.items, root)
    if (items.type === 'array' && items.prefixItems) return 'ageRange'
    if (items.enum) return 'choiceList'
    if (items.type === 'object' || items.properties) return 'objectList'
    if (items.type === 'integer') return 'integerList'
    return 'textList'
  }
  if (node.type === 'string') {
    const short = node.format || node.pattern || (node.maxLength && node.maxLength <= 256)
    return short ? 'text' : 'longText'
  }
  if (node.type === 'integer') return 'integer'
  if (node.type === 'number') return 'number'
  if (node.type === 'boolean') return 'boolean'
  return 'unknown'
}

export function pointerOf(path: Path): string {
  return path.map((part) => '/' + String(part).replace(/~/g, '~0').replace(/\//g, '~1')).join('')
}

export function pathOf(pointer: string): Path {
  return pointer
    .split('/')
    .slice(1)
    .map((part) => part.replace(/~1/g, '/').replace(/~0/g, '~'))
    .map((part) => (/^\d+$/.test(part) ? Number(part) : part))
}

export function getAt(value: Json | undefined, path: Path): Json | undefined {
  let current: Json | undefined = value
  for (const part of path) {
    if (current === null || typeof current !== 'object') return undefined
    current = (current as Record<string, Json>)[part as string]
  }
  return current
}

/** Immutable set. `undefined` removes the key (or, in a list, the item). */
export function setAt(value: Json | undefined, path: Path, next: Json | undefined): Json | undefined {
  if (path.length === 0) return next
  const [head, ...rest] = path
  if (typeof head === 'number') {
    const list = Array.isArray(value) ? [...value] : []
    const child = setAt(list[head], rest, next)
    if (child === undefined) list.splice(head, 1)
    else list[head] = child
    return list
  }
  const object: Record<string, Json> =
    value !== null && typeof value === 'object' && !Array.isArray(value) ? { ...value } : {}
  const child = setAt(object[head], rest, next)
  if (child === undefined) delete object[head]
  else object[head] = child
  return object
}

export function isEmpty(value: Json | undefined): boolean {
  if (value === undefined || value === null || value === '') return true
  if (Array.isArray(value)) return value.every(isEmpty)
  if (typeof value === 'object') return Object.values(value).every(isEmpty)
  return false
}

/**
 * The card as it will be saved: no empty strings, lists or groups (the schema rejects most of
 * them, and an empty field carries no information). The editor keeps half-filled rows while
 * you type; `kept` records, for every list, which editor rows survived, so a problem reported
 * on the saved card can be shown on the right row in the editor.
 */
export function clean(value: Json, kept: Map<string, number[]> = new Map(), pointer = ''): Json | undefined {
  if (Array.isArray(value)) {
    const indexes: number[] = []
    const out: Json[] = []
    value.forEach((item, index) => {
      const cleaned = clean(item, kept, `${pointer}/${out.length}`)
      if (cleaned !== undefined) {
        out.push(cleaned)
        indexes.push(index)
      }
    })
    kept.set(pointer, indexes)
    return out.length ? out : undefined
  }
  if (value !== null && typeof value === 'object') {
    const out: Record<string, Json> = {}
    for (const [key, item] of Object.entries(value)) {
      const cleaned = clean(item, kept, `${pointer}/${key.replace(/~/g, '~0').replace(/\//g, '~1')}`)
      if (cleaned !== undefined) out[key] = cleaned
    }
    return Object.keys(out).length ? out : undefined
  }
  if (typeof value === 'string') {
    const trimmed = value.trim()
    return trimmed === '' ? undefined : trimmed
  }
  return value === null ? undefined : value
}

/** Translate a pointer on the saved card to the matching pointer in the editor's copy. */
export function toEditorPointer(pointer: string, kept: Map<string, number[]>): string {
  let saved = ''
  let editor = ''
  for (const part of pointer.split('/').slice(1)) {
    const rows = kept.get(saved)
    saved += '/' + part
    editor += '/' + (rows && /^\d+$/.test(part) ? (rows[Number(part)] ?? part) : part)
  }
  return editor
}

export function rootKey(cardType: 'dataset' | 'model'): 'Dataset' | 'Model' {
  return cardType === 'dataset' ? 'Dataset' : 'Model'
}

/** The card that leaves the editor: root is always exactly {"$schema", "Dataset" | "Model"}. */
export function exportCard(
  body: Json,
  schema: Schema,
  cardType: 'dataset' | 'model',
  kept: Map<string, number[]> = new Map(),
): Record<string, Json> {
  const root = rootKey(cardType)
  return {
    $schema: schema.properties.$schema.const as string,
    [root]: clean(body, kept, `/${root}`) ?? {},
  }
}

export interface Section {
  key: string // '' for the scalar fields that sit directly on the card (Name, Link)
  label: string
  fields: string[]
}

/** One section per top-level group of the card, in schema order; loose fields come first. */
export function sectionsOf(schema: Schema, cardType: 'dataset' | 'model'): Section[] {
  const body = resolve(schema.properties[rootKey(cardType)], schema)
  const loose: string[] = []
  const sections: Section[] = []
  for (const [key, raw] of Object.entries<Schema>(body.properties ?? {})) {
    const kind = kindOf(resolve(raw, schema), schema)
    if (kind === 'group' || kind === 'objectList') sections.push({ key, label: key, fields: [key] })
    else loose.push(key)
  }
  return loose.length ? [{ key: '', label: 'Basics', fields: loose }, ...sections] : sections
}

/** A one-line description of a list row, e.g. "Training · 21,784 exams · 752,803 images". */
export function summarize(value: Json | undefined): string {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return ''
  const parts: string[] = []
  const numbers: string[] = []
  const walk = (item: Record<string, Json>) => {
    for (const [key, child] of Object.entries(item)) {
      if (typeof child === 'string' && parts.length < 2 && child.length) {
        const aside = /^(comments|notes)$/i.test(key) || /^(https?:|\S+@\S+$)/.test(child)
        if (!aside && (parts.length === 0 || child.length <= 80)) parts.push(child.length > 70 ? child.slice(0, 67) + '…' : child)
      } else if (typeof child === 'number' && numbers.length < 3 && / count$/i.test(key)) {
        numbers.push(`${child.toLocaleString('en-US')} ${key.replace(/ count$/i, '').toLowerCase()}${child === 1 ? '' : 's'}`)
      } else if (child && typeof child === 'object' && !Array.isArray(child)) walk(child)
    }
  }
  walk(value)
  return [...parts, ...numbers].join(' · ')
}
