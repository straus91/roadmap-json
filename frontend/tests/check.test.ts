// Author check: which sections count as changed, and what a host may ask for.
import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { changedSections, readCheck, stable } from '../src/check/protocol.ts'
import { exportCard, sectionsOf } from '../src/schema.ts'
import type { Json, Schema } from '../src/schema.ts'

const schema: Schema = JSON.parse(readFileSync(new URL('../../backend/schemas/dataset.json', import.meta.url), 'utf-8'))
const sections = sectionsOf(schema, 'dataset')
const saved = (body: Json) => exportCard(body, schema, 'dataset').Dataset

describe('author check', () => {
  const published: Json = { Name: 'Chest set', Descriptors: { License: { Text: 'CC BY 4.0' }, Comments: '' }, Indexing: { Keywords: ['chest', 'CT'] } }

  it('counts no section as changed when the card only differs in key order or empty fields', () => {
    const same: Json = { Indexing: { Keywords: ['chest', 'CT'] }, Descriptors: { Comments: '  ', License: { Text: 'CC BY 4.0' } }, Name: 'Chest set', Link: '' }
    expect(changedSections(sections, saved(published), saved(same))).toEqual([])
    expect(stable({ b: 1, a: [2, { d: 3, c: 4 }] })).toBe(stable({ a: [2, { c: 4, d: 3 }], b: 1 }))
  })

  it('names the sections the author changed, as the editor shows them', () => {
    const edited: Json = { Name: 'Chest CT set', Descriptors: { License: { Text: 'CC BY-NC 4.0' } }, Indexing: { Keywords: ['chest', 'CT'] } }
    expect(changedSections(sections, saved(published), saved(edited))).toEqual(['Basics', 'Descriptors'])
    expect(changedSections(sections, saved(published), saved({ ...(published as object), Indexing: { Keywords: ['CT', 'chest'] } } as Json))).toEqual(['Indexing'])
  })

  it('only takes a check request that carries the published card', () => {
    expect(readCheck({ original: { Dataset: {} }, flagged: ['Indexing', 7] })).toEqual({ original: { Dataset: {} }, flagged: ['Indexing'] })
    expect(readCheck({ original: { Dataset: {} } })?.flagged).toEqual([])
    expect(readCheck(undefined) ?? readCheck({ flagged: [] }) ?? readCheck({ original: [] }) ?? readCheck('yes')).toBeNull()
  })
})
