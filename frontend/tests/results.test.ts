import { describe, expect, it } from 'vitest'
import { formatResults, parseResults, tidyCell } from '../src/results.ts'

const TABLE =
  'Internal test set (n = 485), benign vs malignant: area under the receiver operating characteristic curve = 0.95 (95% CI: 0.92, 0.97); accuracy = 91.1% (95% CI: 87.5, 94.4).\n' +
  'External test set 1 (n = 454): sensitivity = 89.0%; Dice similarity coefficient = 0.611 (95% CI: 0.533, 0.67).'
const REMARKS = 'The model outperformed the clinical baseline (P < .001).\nReaders improved with assistance.'

describe('results table kept inside the Comments text', () => {
  it('reads the layout into rows and remarks, and writes back exactly the same text', () => {
    const text = `${TABLE}\n\n${REMARKS}`
    const parsed = parseResults(text)
    expect(parsed.rows).toHaveLength(4)
    expect(parsed.rows[1]).toEqual({
      set: 'Internal test set (n = 485), benign vs malignant',
      metric: 'accuracy',
      value: '91.1%',
      detail: '95% CI: 87.5, 94.4',
    })
    expect(parsed.rows[2]).toEqual({ set: 'External test set 1 (n = 454)', metric: 'sensitivity', value: '89.0%', detail: '' })
    expect(parsed.remarks).toBe(REMARKS)
    expect(formatResults(parsed)).toBe(text)
    expect(formatResults(parseResults(TABLE))).toBe(TABLE)
  })

  it('never alters text that is not in the layout: it all becomes remarks', () => {
    for (const text of [
      'Evaluated on 4026 patients. AUC 0.95 (95% CI: 0.92, 0.97); accuracy 91.1%.',
      'Note: results vary by site.',
      `${REMARKS}\n\n${TABLE}`, // results after prose are left as prose
      `${TABLE}\n${REMARKS}`, // prose without the blank line
      'Test set: accuracy = high.', // no number, so not a result
    ]) {
      const parsed = parseResults(text)
      expect(parsed.rows).toEqual([])
      expect(formatResults(parsed)).toBe(text)
    }
  })

  it('groups consecutive rows on the same data into one sentence and skips unfinished rows', () => {
    const text = formatResults({
      rows: [
        { set: 'Test set', metric: 'accuracy', value: '0.9', detail: '' },
        { set: 'Test set', metric: 'sensitivity', value: '0.8', detail: '0.7-0.9' },
        { set: 'Test set', metric: '', value: '', detail: '' }, // being typed
        { set: 'External set', metric: 'accuracy', value: '0.85', detail: '' },
      ],
      remarks: '  ',
    })
    expect(text).toBe('Test set: accuracy = 0.9; sensitivity = 0.8 (0.7-0.9).\nExternal set: accuracy = 0.85.')
    expect(parseResults(text).rows).toHaveLength(3)
  })

  it('keeps separator characters out of cells so the text can always be read back', () => {
    const row = {
      set: tidyCell('Test set: site A; site B', 'set'),
      metric: tidyCell('F1 = score', 'metric'),
      value: tidyCell('91/150 (60.7%)', 'value'),
      detail: tidyCell('range; wide', 'detail'),
    }
    const text = formatResults({ rows: [row], remarks: '' })
    expect(parseResults(text).rows).toEqual([row])
  })

  it('contains nothing but ordinary sentences when line breaks are ignored', () => {
    const shown = `${TABLE}\n\n${REMARKS}`.replace(/\s+/g, ' ')
    expect(shown).toContain('(95% CI: 87.5, 94.4). External test set 1')
  })
})
