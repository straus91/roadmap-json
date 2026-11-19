// Instant in-browser validation against the same ATLAS schema the server uses
// (fetched from /api/schemas/{type}), with messages that name the field.
// Mirrors backend/app/validation.py so both sides say the same thing.

import type { ErrorObject, ValidateFunction } from 'ajv'
import Ajv2020 from 'ajv/dist/2020'
import addFormats from 'ajv-formats'
import { getSchema } from './api.ts'
import type { CardType, Problem } from './api.ts'
import type { Schema } from './schema.ts'

const schemas = new Map<CardType, Promise<Schema>>()
const validators = new Map<CardType, Promise<ValidateFunction>>()

/** The ATLAS schema in force on the server, fetched once per visit. */
export function loadSchema(cardType: CardType): Promise<Schema> {
  let pending = schemas.get(cardType)
  if (!pending) {
    pending = getSchema(cardType) as Promise<Schema>
    pending.catch(() => schemas.delete(cardType))
    schemas.set(cardType, pending)
  }
  return pending
}

function loadValidator(cardType: CardType): Promise<ValidateFunction> {
  let pending = validators.get(cardType)
  if (!pending) {
    pending = loadSchema(cardType).then((schema) => {
      const ajv = new Ajv2020({ allErrors: true, verbose: true, strict: false })
      addFormats(ajv)
      return ajv.compile(schema)
    })
    pending.catch(() => validators.delete(cardType))
    validators.set(cardType, pending)
  }
  return pending
}

export function detectCardType(card: unknown): CardType | null {
  if (card === null || typeof card !== 'object') return null
  if ('Dataset' in card) return 'dataset'
  if ('Model' in card) return 'model'
  return null
}

export async function validateCard(card: unknown, cardType: CardType): Promise<Problem[]> {
  const validate = await loadValidator(cardType)
  if (validate(card)) return []
  const seen = new Set<string>()
  const problems: Problem[] = []
  for (const error of validate.errors ?? []) {
    // Errors from inside an anyOf branch are noise; the anyOf error itself is reported.
    if (error.keyword !== 'anyOf' && error.schemaPath.includes('/anyOf/')) continue
    const problem = describe(error)
    const key = `${problem.pointer}|${problem.message}`
    if (!seen.has(key)) {
      seen.add(key)
      problems.push(problem)
    }
  }
  return problems.sort((a, b) => a.pointer.localeCompare(b.pointer))
}

const TYPE_WORDS: Record<string, string> = {
  string: 'text',
  integer: 'a whole number',
  number: 'a number',
  boolean: 'true or false',
  array: 'a list',
  object: 'a group of fields',
}

function show(value: unknown): string {
  const text = typeof value === 'string' ? value : JSON.stringify(value)
  return text.length <= 50 ? text : `${text.slice(0, 47)}...`
}

export function locate(pointer: string): string {
  const parts = pointer
    .split('/')
    .slice(1)
    .map((part) => part.replace(/~1/g, '/').replace(/~0/g, '~'))
    .map((part) => (/^\d+$/.test(part) ? `item ${Number(part) + 1}` : part))
  return parts.join(' › ') || 'card'
}

function describe(error: ErrorObject): Problem {
  const params = error.params as Record<string, unknown>
  const value = error.data
  const limit = params.limit as number
  const size = typeof value === 'string' || Array.isArray(value) ? value.length : 0
  let pointer = error.instancePath
  let message: string

  switch (error.keyword) {
    case 'additionalProperties': {
      const name = String(params.additionalProperty)
      pointer += `/${name}`
      message = `"${name}" is not a field in the ATLAS schema; remove or rename it`
      break
    }
    case 'required': {
      const name = String(params.missingProperty)
      pointer += `/${name}`
      message = `"${name}" is required but missing`
      break
    }
    case 'enum': {
      const options = (params.allowedValues as unknown[]).map(String)
      const listed =
        options.length <= 12
          ? options.join(', ')
          : `${options.slice(0, 8).join(', ')}, ... (${options.length} options)`
      message = `"${show(value)}" is not an allowed value. Allowed: ${listed}`
      break
    }
    case 'const':
      message = `must be exactly "${String(params.allowedValue)}"`
      break
    case 'type': {
      const wanted = String(params.type).split(',')
      message = `must be ${wanted.map((t) => TYPE_WORDS[t] ?? t).join(' or ')} (got "${show(value)}")`
      break
    }
    case 'minLength':
      message = `is too short (${size} characters; at least ${limit} needed)`
      break
    case 'maxLength':
      message = `is too long (${size} characters; at most ${limit} allowed)`
      break
    case 'pattern':
      message = `"${show(value)}" is not in the expected format`
      break
    case 'format': {
      const nice: Record<string, string> = {
        uri: 'a full web address such as https://example.org',
        date: 'a date written as YYYY-MM-DD',
        email: 'an email address',
      }
      const format = String(params.format)
      message = `"${show(value)}" is not ${nice[format] ?? format}`
      break
    }
    case 'minItems':
    case 'maxItems':
      message = `must have ${error.keyword === 'minItems' ? 'at least' : 'at most'} ${limit} item(s) (has ${size})`
      break
    case 'minProperties':
    case 'maxProperties':
      message = `must have ${error.keyword === 'minProperties' ? 'at least' : 'at most'} ${limit} field(s) filled in`
      break
    case 'uniqueItems':
      message = 'contains the same value more than once'
      break
    case 'minimum':
    case 'maximum':
      message = `must be ${error.keyword === 'minimum' ? 'at least' : 'at most'} ${limit} (got ${show(value)})`
      break
    case 'anyOf':
      message = /\/Date\/|\/Date$/.test(error.instancePath)
        ? `"${show(value)}" is not a valid date; use YYYY-MM-DD or a year as a number (2024)`
        : `"${show(value)}" is not in an accepted format`
      break
    default:
      message = error.message ?? 'is not valid'
  }
  return { pointer, location: locate(pointer), message, keyword: error.keyword }
}
