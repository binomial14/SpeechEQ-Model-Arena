import fs from 'fs'
import path from 'path'
import { fileURLToPath } from 'url'

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)
const rootDir = path.resolve(__dirname, '..')
const dataDir = path.resolve(rootDir, 'data')
const questionsFile = path.resolve(rootDir, 'questions.json')

/**
 * Discover every scenario under data/<subscale_slug>/<dataset_id>/metadata.json
 * and write questions.json for Apps Script sync and optional legacy manifest loading.
 */
function discoverQuestionsFromData() {
  if (!fs.existsSync(dataDir)) {
    throw new Error('Missing data directory')
  }

  const questions = []
  const subscales = fs
    .readdirSync(dataDir, { withFileTypes: true })
    .filter((d) => d.isDirectory())
    .map((d) => d.name)
    .sort()

  for (const subscale of subscales) {
    const subscaleDir = path.join(dataDir, subscale)
    const datasetIds = fs
      .readdirSync(subscaleDir, { withFileTypes: true })
      .filter((d) => d.isDirectory())
      .map((d) => d.name)
      .sort()

    for (const datasetId of datasetIds) {
      const metadataPathFs = path.join(subscaleDir, datasetId, 'metadata.json')
      if (!fs.existsSync(metadataPathFs)) {
        continue
      }

      questions.push({
        id: datasetId,
        subscale,
        path: `data/${subscale}/${datasetId}`,
        metadataPath: `data/${subscale}/${datasetId}/metadata.json`
      })
    }
  }

  questions.sort((a, b) => {
    if (a.subscale !== b.subscale) {
      return a.subscale.localeCompare(b.subscale)
    }
    return a.id.localeCompare(b.id)
  })

  return questions
}

function generateQuestions() {
  const questions = discoverQuestionsFromData()

  if (questions.length === 0) {
    throw new Error('No questions found under data/ (expected data/<subscale>/<dataset_id>/metadata.json)')
  }

  fs.writeFileSync(questionsFile, `${JSON.stringify({ questions }, null, 2)}\n`, 'utf8')
  console.log(`Wrote ${questionsFile} with ${questions.length} question(s)`)
}

try {
  generateQuestions()
} catch (error) {
  console.error(`Error: ${error.message}`)
  process.exit(1)
}
