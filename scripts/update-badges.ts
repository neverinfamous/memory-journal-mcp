import fs from 'fs'
import path from 'path'
import { fileURLToPath } from 'url'

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)
const ROOT_DIR = path.resolve(__dirname, '..')

function getBadgeColor(percentage: number): string {
    if (percentage >= 95) return 'brightgreen'
    if (percentage >= 85) return 'green'
    if (percentage >= 75) return 'yellowgreen'
    if (percentage >= 65) return 'yellow'
    if (percentage >= 50) return 'orange'
    return 'red'
}

function updateBadges() {
    const summaryPath = path.join(ROOT_DIR, '.test-output/coverage/coverage-summary.json')

    if (!fs.existsSync(summaryPath)) {
        console.error(`Coverage summary not found at ${summaryPath}`)
        console.error(
            'Run "npm run test:coverage" first, and ensure "json-summary" is in your vitest coverage reporters.'
        )
        process.exit(1)
    }

    const summary = JSON.parse(fs.readFileSync(summaryPath, 'utf-8'))

    // We use the "lines" coverage to match the badge
    const linesPct = summary.total.lines.pct
    const color = getBadgeColor(linesPct)

    // The exact regex depends on how the badge is formed, but generally:
    // ![Coverage](https://img.shields.io/badge/Coverage-96.7%25-brightgreen.svg)
    const regex = /!\[Coverage\]\(https:\/\/img\.shields\.io\/badge\/Coverage-[0-9.]+.*?\.svg\)/g
    const newBadge = `![Coverage](https://img.shields.io/badge/Coverage-${linesPct}%25-${color}.svg)`

    const filesToUpdate = ['README.md', 'DOCKER_README.md']

    for (const file of filesToUpdate) {
        const filePath = path.join(ROOT_DIR, file)
        if (fs.existsSync(filePath)) {
            let content = fs.readFileSync(filePath, 'utf-8')
            regex.lastIndex = 0
            if (regex.test(content)) {
                regex.lastIndex = 0
                content = content.replace(regex, newBadge)
                fs.writeFileSync(filePath, content, 'utf-8')
                console.log(`Updated coverage badge in ${file} to ${linesPct}%`)
            } else {
                console.log(`No coverage badge found in ${file} to update.`)
                process.exit(1)
            }
        }
    }
}

updateBadges()
