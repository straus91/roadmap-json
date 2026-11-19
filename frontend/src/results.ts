// A results table for "Model performance".
//
// The ATLAS schema gives model performance exactly two fields: a list of metric names and one
// free-text "Comments". It has no place for a value per metric. So the editor offers a table
// and stores it *inside* that Comments text, one sentence per evaluation set:
//
//   Internal test set (n = 485): accuracy = 91.1% (95% CI: 87.5, 94.4); sensitivity = 92.9%.
//   External test set 1 (n = 454): accuracy = 88.4%.
//
//   Any further remarks follow after a blank line, as ordinary prose.
//
// The saved card is unchanged in shape (Comments is still one string), and the text reads as
// plain sentences wherever it is shown, including on sites that ignore line breaks.

export interface ResultRow {
  set: string // what it was measured on
  metric: string
  value: string
  detail: string // confidence interval, range, or any short note
}

export interface Results {
  rows: ResultRow[]
  remarks: string
}

/** Characters that separate the parts of a sentence may not appear inside a cell. */
export function tidyCell(text: string, part: keyof ResultRow): string {
  let out = text.replace(/\s+/g, ' ').replace(/;/g, ',')
  if (part === 'set') out = out.replace(/: /g, ' - ')
  if (part === 'metric') out = out.replace(/ = /g, ' ')
  if (part === 'value') out = out.replace(/ \(/g, ' [').replace(/\)$/, ']')
  return out
}

function formatLine(set: string, rows: ResultRow[]): string {
  const items = rows.map((row) => `${row.metric} = ${row.value}${row.detail ? ` (${row.detail})` : ''}`)
  return `${set}: ${items.join('; ')}.`
}

/** Rows with nothing measured yet (no metric or no value) are not written out. */
function complete(row: ResultRow): boolean {
  return row.set.trim() !== '' && row.metric.trim() !== '' && row.value.trim() !== ''
}

export function formatResults({ rows, remarks }: Results): string {
  const lines: string[] = []
  const ready = rows.filter(complete).map((row) => ({
    set: row.set.trim(),
    metric: row.metric.trim(),
    value: row.value.trim(),
    detail: row.detail.trim(),
  }))
  for (let start = 0; start < ready.length; ) {
    let end = start
    while (end < ready.length && ready[end].set === ready[start].set) end++
    lines.push(formatLine(ready[start].set, ready.slice(start, end)))
    start = end
  }
  const table = lines.join('\n')
  const prose = remarks.trim()
  return table && prose ? `${table}\n\n${prose}` : table || prose
}

function parseLine(line: string): ResultRow[] | null {
  if (!line.endsWith('.')) return null
  const cut = line.indexOf(': ')
  if (cut <= 0) return null
  const set = line.slice(0, cut)
  const rows: ResultRow[] = []
  for (const item of line.slice(cut + 2, -1).split('; ')) {
    const equals = item.indexOf(' = ')
    if (equals <= 0) return null
    const metric = item.slice(0, equals)
    const rest = item.slice(equals + 3)
    const open = rest.endsWith(')') ? rest.indexOf(' (') : -1
    const value = open >= 0 ? rest.slice(0, open) : rest
    const detail = open >= 0 ? rest.slice(open + 2, -1) : ''
    if (!value || !/\d/.test(value)) return null // a result has a number in it
    rows.push({ set, metric, value, detail })
  }
  return rows.length ? rows : null
}

/**
 * Read a Comments text back into table + remarks. Text that is not in the layout above is
 * never altered: it simply all becomes "remarks" and the table starts empty. The table is only
 * used when writing it back would reproduce the text exactly.
 */
export function parseResults(text: string): Results {
  const whole: Results = { rows: [], remarks: text }
  const lines = text.split('\n')
  const rows: ResultRow[] = []
  let at = 0
  for (; at < lines.length; at++) {
    const parsed = parseLine(lines[at])
    if (!parsed) break
    rows.push(...parsed)
  }
  if (!rows.length) return whole
  if (at < lines.length && lines[at] !== '') return whole // prose must follow a blank line
  const candidate: Results = { rows, remarks: lines.slice(at + 1).join('\n') }
  return formatResults(candidate) === text ? candidate : whole
}
