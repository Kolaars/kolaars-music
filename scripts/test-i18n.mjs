/**
 * Localization sanity check.
 *
 * Verifies that the English dictionary is complete and safe to render: every
 * literal `t('…')` key in the renderer and the main process has a translation,
 * placeholders survive, and no Cyrillic leaks into English copy. Dynamic keys
 * (route tables, shortcut lists, provider metadata) are exercised by the smoke
 * test; this check catches the ordinary case where a new string is added and
 * the dictionary is forgotten.
 */

import fs from 'node:fs'
import path from 'node:path'
import ts from 'typescript'

const ROOT = process.cwd()
const EN_PATH = path.join(ROOT, 'src', 'shared', 'i18n.en.ts')
const SOURCE_ROOTS = [
  path.join(ROOT, 'src', 'renderer', 'src'),
  path.join(ROOT, 'src', 'main')
]
const CYRILLIC = /[\u0400-\u04ff]/
const PLACEHOLDER = /\{(\w+)\}/g

function normalise(input) {
  return input.replace(/\s+/g, ' ').trim()
}

function walk(target) {
  const stat = fs.statSync(target)
  if (!stat.isDirectory()) return /\.(ts|tsx)$/.test(target) ? [target] : []
  const files = []
  for (const entry of fs.readdirSync(target, { withFileTypes: true })) {
    const child = path.join(target, entry.name)
    if (entry.isDirectory()) files.push(...walk(child))
    else if (/\.(ts|tsx)$/.test(entry.name)) files.push(child)
  }
  return files
}

function parse(file) {
  return ts.createSourceFile(
    file,
    fs.readFileSync(file, 'utf8'),
    ts.ScriptTarget.Latest,
    true,
    file.endsWith('.tsx') ? ts.ScriptKind.TSX : ts.ScriptKind.TS
  )
}

function readDictionary() {
  const source = parse(EN_PATH)
  let entries = null
  source.forEachChild((node) => {
    if (!ts.isVariableStatement(node)) return
    for (const declaration of node.declarationList.declarations) {
      if (declaration.name.getText(source) !== 'EN' || !declaration.initializer) continue
      if (!ts.isObjectLiteralExpression(declaration.initializer)) continue
      entries = declaration.initializer
    }
  })
  if (!entries) throw new Error('EN dictionary object was not found in src/shared/i18n.en.ts')

  const dictionary = new Map()
  for (const property of entries.properties) {
    if (!ts.isPropertyAssignment(property) || !ts.isStringLiteral(property.name)) continue
    const key = property.name.text
    const value = property.initializer
    if (!ts.isStringLiteral(value) && !ts.isNoSubstitutionTemplateLiteral(value)) {
      throw new Error(`translation for ${JSON.stringify(key)} is not a string literal`)
    }
    dictionary.set(key, value.text)
  }
  return dictionary
}

function readKeys() {
  const keys = new Set()
  for (const file of SOURCE_ROOTS.flatMap(walk)) {
    const source = parse(file)
    const visit = (node) => {
      if (ts.isCallExpression(node) && ts.isIdentifier(node.expression)) {
        const name = node.expression.text
        if ((name === 't' || name === 'translate' || name === 'english') && node.arguments.length) {
          const argument = node.arguments[0]
          if (ts.isStringLiteral(argument) || ts.isNoSubstitutionTemplateLiteral(argument)) {
            keys.add(argument.text)
          }
        }
      }
      ts.forEachChild(node, visit)
    }
    visit(source)
  }
  return keys
}

const problems = []
const dictionary = readDictionary()
const keys = readKeys()

if (dictionary.size < 600) problems.push(`dictionary only has ${dictionary.size} entries`)
if (keys.size < 590) problems.push(`only ${keys.size} t() keys were found`)

for (const [key, value] of dictionary) {
  if (!value.trim()) problems.push(`empty translation for ${JSON.stringify(key)}`)
  if (CYRILLIC.test(value)) problems.push(`Cyrillic left in ${JSON.stringify(key)} -> ${JSON.stringify(value)}`)
  const expected = [...key.matchAll(PLACEHOLDER)].map((match) => match[1]).sort().join(',')
  const actual = [...value.matchAll(PLACEHOLDER)].map((match) => match[1]).sort().join(',')
  if (expected !== actual) {
    problems.push(`placeholder mismatch for ${JSON.stringify(key)} -> ${JSON.stringify(value)}`)
  }
  if (key.startsWith('·') && !value.startsWith(' ')) {
    problems.push(`fragment translation must keep its leading space: ${JSON.stringify(key)}`)
  }
}

for (const rawKey of keys) {
  const key = normalise(rawKey)
  if (!dictionary.has(key)) problems.push(`missing English translation for ${JSON.stringify(key)}`)
}

if (problems.length > 0) {
  console.error(`i18n check failed with ${problems.length} problem(s):`)
  for (const problem of problems) console.error(`  - ${problem}`)
  process.exit(1)
}

console.log(`i18n check passed: ${keys.size} source keys, ${dictionary.size} translations`)
