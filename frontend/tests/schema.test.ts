// The editor must be able to show and edit everything the ATLAS schema defines, and must only
// ever save a card in the schema's shape. These tests run against the same schema files the
// server bundles.
import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { clean, exportCard, kindOf, resolve, sectionsOf, setAt, toEditorPointer } from '../src/schema.ts'
import type { Json, Schema } from '../src/schema.ts'

const load = (name: string): Schema =>
  JSON.parse(readFileSync(new URL(`../../backend/schemas/${name}.json`, import.meta.url), 'utf-8'))

/** Every node reachable from the card body, with the path that leads to it. */
function walk(node: Schema, root: Schema, path: string, seen: [string, Schema][] = []): [string, Schema][] {
  const resolved = resolve(node, root)
  seen.push([path, resolved])
  for (const [key, child] of Object.entries<Schema>(resolved.properties ?? {})) walk(child, root, `${path} › ${key}`, seen)
  if (resolved.type === 'array' && resolved.items && !resolved.items.prefixItems && kindOf(resolved, root) === 'objectList')
    walk(resolved.items, root, `${path}[]`, seen)
  return seen
}

describe.each([
  ['dataset', 'Dataset'],
  ['model', 'Model'],
] as const)('%s schema', (cardType, rootKey) => {
  const schema = load(cardType)

  it('has an input widget for every field', () => {
    const nodes = walk(schema.properties[rootKey], schema, rootKey)
    expect(nodes.length).toBeGreaterThan(40)
    const unsupported = nodes.filter(([, node]) => kindOf(node, schema) === 'unknown').map(([path]) => path)
    expect(unsupported).toEqual([])
  })

  it('puts every top-level field in exactly one section', () => {
    const body = resolve(schema.properties[rootKey], schema)
    const inSections = sectionsOf(schema, cardType).flatMap((section) => section.fields)
    expect([...inSections].sort()).toEqual(Object.keys(body.properties).sort())
  })

  it('always saves exactly {"$schema", root}, with the published schema address', () => {
    for (const body of [{}, { Name: '  ' }, { Name: 'A name', junk: [], more: { deep: [''] } }] as Json[]) {
      const card = exportCard(body, schema, cardType)
      expect(Object.keys(card)).toEqual(['$schema', rootKey])
      expect(card.$schema).toBe(`https://atlas.rsna.org/schemas/2025-11/${cardType}.json`)
    }
  })
})

describe('saving', () => {
  it('drops empty values and trims text, but keeps zero and false', () => {
    const body: Json = { Name: ' x ', Empty: '', List: ['', ' a '], Group: { Inner: [] }, Count: 0, Flag: false, Nothing: null }
    expect(clean(body)).toEqual({ Name: 'x', List: ['a'], Count: 0, Flag: false })
  })

  it('maps a problem on the saved card back to the row being edited', () => {
    const body: Json = { Authors: [{}, { Name: 'A' }, { Name: '' }, { Name: 'B', Email: 'bad' }] }
    const kept = new Map<string, number[]>()
    const saved = clean(body, kept, '/Dataset') as { Authors: Json[] }
    expect(saved.Authors).toHaveLength(2)
    expect(toEditorPointer('/Dataset/Authors/1/Email', kept)).toBe('/Dataset/Authors/3/Email')
  })

  it('edits without mutating, and removes list rows', () => {
    const before: Json = { List: [{ a: 1 }, { a: 2 }] }
    const after = setAt(before, ['List', 0], undefined)
    expect(after).toEqual({ List: [{ a: 2 }] })
    expect(before).toEqual({ List: [{ a: 1 }, { a: 2 }] })
    expect(setAt({}, ['A', 'B', 0, 'C'], 5)).toEqual({ A: { B: [{ C: 5 }] } })
  })
})
