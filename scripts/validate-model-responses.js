import fs from 'fs'
import path from 'path'
import { fileURLToPath } from 'url'

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)
const rootDir = path.resolve(__dirname, '..')
const questionsPath = path.resolve(rootDir, 'questions.json')
const modelResponseDir = path.resolve(rootDir, 'model_response')

function readJson(filePath) {
  return JSON.parse(fs.readFileSync(filePath, 'utf8'))
}

function assert(condition, message) {
  if (!condition) {
    throw new Error(message)
  }
}

function listModelResponseFiles() {
  if (!fs.existsSync(modelResponseDir)) {
    return []
  }
  return fs
    .readdirSync(modelResponseDir)
    .filter((f) => f.endsWith('.json'))
    .map((f) => path.join(modelResponseDir, f))
}

function validate() {
  assert(fs.existsSync(questionsPath), 'questions.json not found (run npm run generate-questions)')
  const manifest = readJson(questionsPath)
  const questions = manifest.questions || []

  assert(questions.length > 0, 'questions.json must contain at least one question')

  const modelFiles = listModelResponseFiles()
  assert(modelFiles.length >= 2, `Expected at least 2 JSON files in model_response/, found ${modelFiles.length}`)

  const payloads = modelFiles.map((p) => ({ path: p, data: readJson(p) }))

  for (const question of questions) {
    const metadataFile = path.resolve(rootDir, question.metadataPath)
    assert(fs.existsSync(metadataFile), `Missing metadata: ${question.metadataPath}`)

    let matchCount = 0
    for (const { data } of payloads) {
      const responses = data.responses
      if (!Array.isArray(responses)) {
        continue
      }
      const hit = responses.some((r) => r && r.dataset_id === question.id)
      if (hit) {
        matchCount += 1
      }
    }
    assert(
      matchCount >= 2,
      `Question ${question.id}: need at least 2 model_response/*.json files containing this dataset_id (found ${matchCount})`
    )
  }

  console.log(`Validation passed (${questions.length} question(s), ${modelFiles.length} model file(s)).`)
}

try {
  validate()
} catch (error) {
  console.error(`Validation error: ${error.message}`)
  process.exit(1)
}
