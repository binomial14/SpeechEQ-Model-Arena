// Google Apps Script backend for SpeechEQ-Model-Arena
// Configure before deployment.
const SHEET_ID = 'YOUR_SHEET_ID'
const QUESTIONS_JSON_URL = 'YOUR_QUESTIONS_JSON_URL'
const QUESTION_COUNT = 5
const MAX_ASSIGNMENTS_PER_QUESTION = 5
/** Max model slots per question (columns Qn_model_m_name / Qn_model_m_rate). */
const MAX_MODELS_PER_QUESTION = 6

function getOrCreateSheet(spreadsheet, name) {
  let sheet = spreadsheet.getSheetByName(name)
  if (!sheet) {
    sheet = spreadsheet.insertSheet(name)
  }
  return sheet
}

function ensureQuestionsHeader(sheet) {
  if (sheet.getLastRow() === 0) {
    sheet.appendRow(['question_id', 'assignment_count'])
  }
}

function getResponseHeaderRow() {
  const header = [
    'Timestamp',
    'Prolific PID',
    'Study ID',
    'Session ID',
    'Client Version'
  ]
  for (let q = 1; q <= QUESTION_COUNT; q += 1) {
    header.push('Q' + q + '_id')
    for (let m = 1; m <= MAX_MODELS_PER_QUESTION; m += 1) {
      header.push('Q' + q + '_model_' + m + '_name', 'Q' + q + '_model_' + m + '_rate')
    }
  }
  return header
}

function ensureResponsesHeader(sheet) {
  const expected = getResponseHeaderRow()
  if (sheet.getLastRow() === 0) {
    sheet.appendRow(expected)
    return
  }
  const existing = sheet.getRange(1, 1, 1, sheet.getLastColumn()).getValues()[0]
  if (existing.length !== expected.length || String(existing[0]).trim() !== 'Timestamp') {
    // Replace header row if schema changed (e.g. migration from JSON column).
    sheet.getRange(1, 1, 1, expected.length).setValues([expected])
  }
}

function buildFlatResponseRow(data) {
  const row = [
    data.timestamp || new Date().toISOString(),
    data.prolificPid || 'N/A',
    data.studyId || 'N/A',
    data.sessionId || 'N/A',
    data.clientVersion || 'N/A'
  ]
  const questions = data.questions || []
  for (let qi = 0; qi < QUESTION_COUNT; qi += 1) {
    const q = questions[qi]
    if (!q) {
      row.push('')
      for (let mi = 0; mi < MAX_MODELS_PER_QUESTION; mi += 1) {
        row.push('', '')
      }
      continue
    }
    row.push(String(q.questionId || '').trim())
    const scores = Array.isArray(q.modelScores) ? q.modelScores : []
    for (let mi = 0; mi < MAX_MODELS_PER_QUESTION; mi += 1) {
      const ms = scores[mi]
      if (ms && ms.modelId) {
        row.push(String(ms.modelId), ms.score != null && ms.score !== '' ? ms.score : '')
      } else {
        row.push('', '')
      }
    }
  }
  return row
}

function jsonOut(payload) {
  return ContentService.createTextOutput(JSON.stringify(payload)).setMimeType(
    ContentService.MimeType.JSON
  )
}

function doGet(e) {
  try {
    if (e.parameter.action === 'getQuestions') {
      const count = parseInt(e.parameter.count || String(QUESTION_COUNT), 10)
      const spreadsheet = SpreadsheetApp.openById(SHEET_ID)
      const questionsSheet = getOrCreateSheet(spreadsheet, 'Questions')
      ensureQuestionsHeader(questionsSheet)
      const lastRow = questionsSheet.getLastRow()
      if (lastRow <= 1) {
        return jsonOut({
          success: false,
          error: 'Questions tab is empty. Run syncQuestionsFromJSON() or add rows.',
          questions: [],
          exhausted: true
        })
      }

      const rows = questionsSheet.getRange(2, 1, lastRow - 1, 2).getValues()
      const activeRows = rows
        .map((r) => ({
          id: String(r[0] || '').trim(),
          count: parseInt(r[1] || '0', 10)
        }))
        .filter((r) => r.id && r.count < MAX_ASSIGNMENTS_PER_QUESTION)

      activeRows.sort(function (a, b) {
        return a.count - b.count
      })

      if (activeRows.length === 0) {
        return jsonOut({
          success: true,
          questions: [],
          exhausted: true,
          message: 'All question_ids reached max assignments (' + MAX_ASSIGNMENTS_PER_QUESTION + ').'
        })
      }

      const picked = activeRows.slice(0, count)
      if (picked.length < count) {
        return jsonOut({
          success: false,
          error:
            'Not enough questions available (need ' +
            count +
            ', have ' +
            picked.length +
            ' under cap).',
          questions: picked.map((q) => q.id),
          exhausted: false
        })
      }

      return jsonOut({
        success: true,
        questions: picked.map((q) => q.id),
        exhausted: false
      })
    }
    return jsonOut({ success: true, message: 'SpeechEQ-Model-Arena Apps Script is running.' })
  } catch (error) {
    return jsonOut({ success: false, error: String(error) })
  }
}

function doPost(e) {
  try {
    let data
    if (e.parameter && e.parameter.data) {
      data = JSON.parse(e.parameter.data)
    } else if (e.postData && e.postData.contents) {
      data = JSON.parse(e.postData.contents)
    } else {
      throw new Error('No payload received')
    }

    const questions = data.questions || []
    if (questions.length !== QUESTION_COUNT) {
      throw new Error('Expected ' + QUESTION_COUNT + ' questions in submission')
    }

    const spreadsheet = SpreadsheetApp.openById(SHEET_ID)
    const responsesSheet = getOrCreateSheet(spreadsheet, 'Responses')
    const questionsSheet = getOrCreateSheet(spreadsheet, 'Questions')
    ensureResponsesHeader(responsesSheet)
    ensureQuestionsHeader(questionsSheet)

    responsesSheet.appendRow(buildFlatResponseRow(data))

    const qLastRow = questionsSheet.getLastRow()
    if (qLastRow > 1) {
      const qValues = questionsSheet.getRange(2, 1, qLastRow - 1, 2).getValues()
      const countById = {}
      for (let i = 0; i < qValues.length; i += 1) {
        countById[String(qValues[i][0]).trim()] = {
          row: i + 2,
          count: parseInt(qValues[i][1] || '0', 10)
        }
      }
      for (let i = 0; i < questions.length; i += 1) {
        const qid = String(questions[i].questionId || '').trim()
        if (countById[qid]) {
          questionsSheet.getRange(countById[qid].row, 2).setValue(countById[qid].count + 1)
          countById[qid].count += 1
        }
      }
    }

    return jsonOut({ success: true, message: 'Saved successfully' })
  } catch (error) {
    return jsonOut({ success: false, error: String(error) })
  }
}

/**
 * One-time: fill Questions tab from hosted questions.json (ids only, assignment_count = 0).
 * Preserves existing assignment_count per id when re-syncing.
 */
function syncQuestionsFromJSON() {
  const spreadsheet = SpreadsheetApp.openById(SHEET_ID)
  const sheet = getOrCreateSheet(spreadsheet, 'Questions')
  ensureQuestionsHeader(sheet)
  const response = UrlFetchApp.fetch(QUESTIONS_JSON_URL)
  const payload = JSON.parse(response.getContentText())
  const questions = payload.questions || []

  const lastRow = sheet.getLastRow()
  const existing = {}
  if (lastRow > 1) {
    const rows = sheet.getRange(2, 1, lastRow - 1, 2).getValues()
    rows.forEach(function (r) {
      existing[String(r[0]).trim()] = parseInt(r[1] || '0', 10)
    })
    sheet.deleteRows(2, lastRow - 1)
  }

  const outRows = questions.map(function (q) {
    const id = String(q.id).trim()
    const prev = existing[id]
    return [id, prev != null ? prev : 0]
  })
  if (outRows.length > 0) {
    sheet.getRange(2, 1, outRows.length, 2).setValues(outRows)
  }

  return { success: true, totalQuestions: outRows.length }
}
