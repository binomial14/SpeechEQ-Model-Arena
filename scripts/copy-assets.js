import fs from 'fs'
import path from 'path'
import { fileURLToPath } from 'url'

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)
const rootDir = path.resolve(__dirname, '..')
const distDir = path.resolve(rootDir, 'dist')

function copyRecursive(src, dest) {
  if (!fs.existsSync(src)) {
    return
  }
  fs.cpSync(src, dest, { recursive: true, force: true })
}

function main() {
  if (!fs.existsSync(distDir)) {
    fs.mkdirSync(distDir, { recursive: true })
  }
  copyRecursive(path.resolve(rootDir, 'data'), path.resolve(distDir, 'data'))
  copyRecursive(path.resolve(rootDir, 'model_responses'), path.resolve(distDir, 'model_responses'))
  copyRecursive(path.resolve(rootDir, 'model_response'), path.resolve(distDir, 'model_response'))
  fs.copyFileSync(path.resolve(rootDir, 'questions.json'), path.resolve(distDir, 'questions.json'))
  console.log('Copied data assets to dist/')
}

main()
