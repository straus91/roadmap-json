// Searching, filtering and counting in the library must agree with each other: the number
// beside a filter option is exactly the number of cards choosing it would show.
import { describe, expect, it } from 'vitest'
import { FILTERS, NOT_STATED, filterCards, libraryLink, optionsFor, paramsToQuery, queryToParams, sizeParts, sortCards } from '../src/library.ts'
import type { LibraryCard, Query } from '../src/library.ts'
import { parseRoute } from '../src/route.ts'

const card = (over: Partial<LibraryCard>): LibraryCard => ({
  id: over.title ?? 'x', type: 'dataset', title: 'Untitled', name: '', summary: '', has_atlas_description: false, atlas_url: '', link: '',
  modalities: [], subspecialties: [], content_codes: [], tasks: [], metrics: [], population: NOT_STATED, ages: null, year: null,
  license: '', organizations: [], sizes: {}, formats: [], architecture: '', has_performance: false, results: [], results_read: false, search: (over.title ?? '').toLowerCase(),
  ...over,
})

const CARDS = [
  card({ title: 'Liver CT set', modalities: ['CT'], subspecialties: ['Gastrointestinal'], year: 2023, sizes: { patient: 500, image: 12000 }, license: 'CC BY 4.0' }),
  card({ title: 'Brain MRI set', modalities: ['MRI'], subspecialties: ['Neuroradiology', 'Pediatric'], population: 'Pediatric', year: 2021, sizes: { patient: 80 } }),
  card({ title: 'Liver segmenter', type: 'model', modalities: ['CT', 'MRI'], subspecialties: ['Gastrointestinal'], tasks: ['Image segmentation'], metrics: ['Dice similarity coefficient'], year: 2024 }),
  card({ title: 'Fracture finder', type: 'model', modalities: ['Radiography'], subspecialties: ['Musculoskeletal'], tasks: ['Detection'], metrics: ['sensitivity'] }),
]
const spec = (key: string) => FILTERS.find((filter) => filter.key === key)!
const titles = (query: Query) => filterCards(CARDS, query).map((found) => found.title)

describe('library filters', () => {
  it('needs every word typed, and one chosen value per filter in use', () => {
    expect(titles({ text: 'liver', chosen: {} })).toEqual(['Liver CT set', 'Liver segmenter'])
    expect(titles({ text: 'liver set', chosen: {} })).toEqual(['Liver CT set'])
    expect(titles({ text: '', chosen: { modality: ['CT', 'Radiography'] } })).toEqual(['Liver CT set', 'Liver segmenter', 'Fracture finder'])
    expect(titles({ text: '', chosen: { modality: ['CT'], type: ['Model'] } })).toEqual(['Liver segmenter'])
    expect(titles({ text: '', chosen: { year: [NOT_STATED] } })).toEqual(['Fracture finder'])
    expect(titles({ text: '', chosen: { license: [NOT_STATED], type: ['Dataset'] } })).toEqual(['Brain MRI set'])
  })

  it('counts beside each option what choosing it would show', () => {
    const query: Query = { text: '', chosen: { type: ['Model'], modality: ['CT'] } }
    for (const option of optionsFor(CARDS, query, spec('modality'))) {
      const chosen = { ...query.chosen, modality: [option.value] }
      expect(filterCards(CARDS, { text: '', chosen }).length).toBe(option.count)
    }
    expect(optionsFor(CARDS, query, spec('modality')).map((option) => option.value)).toEqual(['CT', 'MRI', 'Radiography'])
    expect(optionsFor(CARDS, { text: '', chosen: {} }, spec('year')).map((option) => option.value)).toEqual(['2024', '2023', '2021', NOT_STATED])
  })

  it('keeps a filtered view in the page address', () => {
    const query: Query = { text: 'liver ct', chosen: { modality: ['CT', 'MRI'], subspecialty: ['Research and statistical methods'] } }
    const route = parseRoute(`#/library${queryToParams(query)}`)
    expect(route.page).toBe('library')
    expect(paramsToQuery(route.params)).toEqual(query)
    expect(parseRoute(libraryLink({ task: ['Detection'] })).params.getAll('task')).toEqual(['Detection'])
    expect(parseRoute('#/library/abc-123')).toMatchObject({ page: 'card', id: 'abc-123' })
    expect(parseRoute('').page).toBe('create')
  })

  it('sorts, and words sizes', () => {
    expect(sortCards(CARDS, 'newest').map((found) => found.title)).toEqual(['Liver segmenter', 'Liver CT set', 'Brain MRI set', 'Fracture finder'])
    expect(sortCards(CARDS, 'largest')[0].title).toBe('Liver CT set')
    expect(sizeParts(CARDS[0])).toEqual(['500 patients', '12,000 images'])
  })
})
