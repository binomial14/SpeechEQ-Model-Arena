import { useEffect, useMemo, useState } from 'react'

import questionsManifest from '../questions.json'

/**
 * Browsers block cross-origin fetch to script.google.com (CORS). When the Vite dev/preview proxy
 * is in use, call `/api/google-macro/...` instead (vite.config.js).
 */
function shouldUseAppsScriptProxy() {
  if (import.meta.env.DEV) {
    return true
  }
  if (typeof window === 'undefined') {
    return false
  }
  const h = window.location.hostname
  if (h === 'localhost' || h === '127.0.0.1' || h === '::1') {
    return true
  }
  // `vite preview` default port — works for http://LAN_IP:4173 as well as loopback.
  const p = window.location.port
  if (p === '4173' || p === '4174') {
    return true
  }
  return false
}

function resolveAppsScriptUrl(raw) {
  if (!raw || typeof raw !== 'string') {
    return ''
  }
  const trimmed = raw.trim()
  if (!trimmed.startsWith('https://script.google.com')) {
    return trimmed
  }
  if (shouldUseAppsScriptProxy()) {
    return `/api/google-macro${trimmed.slice('https://script.google.com'.length)}`
  }
  return trimmed
}

function getGoogleFormUrl() {
  return resolveAppsScriptUrl(import.meta.env.VITE_GOOGLE_FORM_URL || '')
}
const PROLIFIC_EXIT_URL =
  import.meta.env.VITE_PROLIFIC_EXIT_URL ||
  'https://app.prolific.com/submissions/complete?cc=C1GDHKVZ'
const QUESTION_COUNT = 5
/** Same ids as `npm run generate-questions` / Google Sheet `question_id` column */
const QUESTION_POOL = (questionsManifest.questions || []).map((q) => ({
  dataset_id: q.id,
  subscale_slug: q.subscale
}))
const metadataModules = import.meta.glob('../data/**/metadata.json', {
  eager: true,
  import: 'default'
})
const modelResponseModules = import.meta.glob('../model_response/*.json', {
  eager: true,
  import: 'default'
})

function shuffle(list) {
  const copy = [...list]
  for (let i = copy.length - 1; i > 0; i -= 1) {
    const j = Math.floor(Math.random() * (i + 1))
    ;[copy[i], copy[j]] = [copy[j], copy[i]]
  }
  return copy
}

/** Normalize high_eq_option / selected_option strings like "option1", "Option 1". */
function normalizeOptionKey(value) {
  if (typeof value !== 'string') {
    return ''
  }
  const compact = value.trim().toLowerCase().replace(/\s+/g, '')
  if (compact === 'option1' || compact.endsWith('option1')) {
    return 'option1'
  }
  if (compact === 'option2' || compact.endsWith('option2')) {
    return 'option2'
  }
  return ''
}

/**
 * Sentence block has aggregate `correct` (majority / label for the sentence).
 * Pick the first individual_result whose `correct` matches that value, then parse its raw_response.
 */
function pickIndividualResult(sentenceData) {
  if (!sentenceData || !Array.isArray(sentenceData.individual_results)) {
    return null
  }
  const items = sentenceData.individual_results
  const target = sentenceData.correct
  const matched = items.find((item) => item.correct === target)
  return matched ?? items[0] ?? null
}

function parseRawResponse(rawResponse) {
  if (typeof rawResponse !== 'string' || !rawResponse.trim()) {
    return null
  }
  const trimmed = rawResponse.trim()
  const fenced = trimmed.match(/```(?:json)?\s*([\s\S]*?)\s*```/i)
  let candidate = fenced ? fenced[1].trim() : trimmed
  try {
    return JSON.parse(candidate)
  } catch {
    const start = candidate.indexOf('{')
    const end = candidate.lastIndexOf('}')
    if (start !== -1 && end > start) {
      try {
        return JSON.parse(candidate.slice(start, end + 1))
      } catch {
        return null
      }
    }
    return null
  }
}

function normalizeReasoningForLabels(preferred) {
  if (!preferred || typeof preferred.reasoning !== 'string') {
    return 'No reasoning provided.'
  }
  const reasoning = preferred.reasoning.trim()
  // In our display, "Option 1" is always resonant and "Option 2" is always dissonant.
  // In raw model text, resonant may correspond to either raw option1 or option2 depending on `high_eq_option`,
  // so we swap the option numbers when needed.
  const highEq = normalizeOptionKey(preferred.high_eq_option)
  const swap = highEq === 'option2' // raw option2 is resonant -> it becomes display option1

  if (!swap) {
    return reasoning
  }

  // Use placeholders to avoid double-replacing.
  let swapped = reasoning.replace(/Option\s*1/g, '__TMP_RAW_OPTION1__')
  swapped = swapped.replace(/Option\s*2/g, '__TMP_RAW_OPTION2__')
  swapped = swapped.replace(/option1/g, '__TMP_RAW_OPTION1__')
  swapped = swapped.replace(/option2/g, '__TMP_RAW_OPTION2__')

  swapped = swapped.replace(/__TMP_RAW_OPTION1__/g, 'Option 2')
  swapped = swapped.replace(/__TMP_RAW_OPTION2__/g, 'Option 1')
  return swapped
}

function normalizeOptionMentionsForDisplayOrder(text, highEqOption) {
  if (typeof text !== 'string' || !text.trim()) {
    return ''
  }
  const highEq = normalizeOptionKey(highEqOption)
  if (highEq !== 'option2') {
    return text.trim()
  }
  // Raw option2 is resonant, but in display resonant is always Option 1.
  let swapped = text.trim().replace(/Option\s*1/g, '__TMP_RAW_OPTION1__')
  swapped = swapped.replace(/Option\s*2/g, '__TMP_RAW_OPTION2__')
  swapped = swapped.replace(/option1/g, '__TMP_RAW_OPTION1__')
  swapped = swapped.replace(/option2/g, '__TMP_RAW_OPTION2__')
  swapped = swapped.replace(/__TMP_RAW_OPTION1__/g, 'Option 2')
  swapped = swapped.replace(/__TMP_RAW_OPTION2__/g, 'Option 1')
  return swapped
}

function extractSentenceDetails(sentenceData) {
  const preferred = pickIndividualResult(sentenceData)
  const parsedRaw = parseRawResponse(preferred?.raw_response)
  const highEq = normalizeOptionKey(preferred?.high_eq_option)
  const resonantProfile =
    highEq === 'option1'
      ? parsedRaw?.acoustic_profile_1 || ''
      : highEq === 'option2'
        ? parsedRaw?.acoustic_profile_2 || ''
        : ''
  const dissonantProfile =
    highEq === 'option1'
      ? parsedRaw?.acoustic_profile_2 || ''
      : highEq === 'option2'
        ? parsedRaw?.acoustic_profile_1 || ''
        : ''
  const reasoningFromRaw =
    typeof parsedRaw?.reasoning === 'string' && parsedRaw.reasoning.trim()
      ? parsedRaw.reasoning.trim()
      : preferred?.reasoning || ''
  const preferredForReasoning = preferred
    ? { ...preferred, reasoning: reasoningFromRaw || preferred.reasoning }
    : null

  return {
    selected: selectedLabelFromCorrectness(sentenceData),
    isCorrect: sentenceData?.correct === true,
    selectedOptionNumber:
      sentenceData?.correct === true ? 1 : sentenceData?.correct === false ? 2 : null,
    resonantDescription: normalizeOptionMentionsForDisplayOrder(
      resonantProfile,
      preferred?.high_eq_option
    ),
    dissonantDescription: normalizeOptionMentionsForDisplayOrder(
      dissonantProfile,
      preferred?.high_eq_option
    ),
    situationalDemand:
      normalizeOptionMentionsForDisplayOrder(parsedRaw?.situational_demand || '', preferred?.high_eq_option),
    reasoning: normalizeReasoningForLabels(preferredForReasoning)
  }
}

function selectedLabelFromCorrectness(sentenceData) {
  if (sentenceData?.correct === true) {
    return 'resonant'
  }
  if (sentenceData?.correct === false) {
    return 'dissonant'
  }
  return 'unknown'
}

function buildModelEvaluation(responseEntry) {
  const s4 = responseEntry?.sentence_4 || null
  const s6 = responseEntry?.sentence_6 || null
  return {
    sentence4: extractSentenceDetails(s4),
    sentence6: extractSentenceDetails(s6)
  }
}

function buildConversationLines(metadata) {
  const conversation = Array.isArray(metadata?.conversation) ? metadata.conversation : []
  return conversation.map((turn, idx) => ({
    id: `${turn.speaker || 'speaker'}-${turn.sentence_number || idx}`,
    sentenceNumber: turn.sentence_number || idx + 1,
    label: turn.speaker === 'speaker1' ? metadata?.scenario?.speaker1_name || 'Speaker 1' : metadata?.scenario?.speaker2_name || 'Speaker 2',
    text: turn.text || ''
  }))
}

function normalizeMetadataPath(metadataModuleKey) {
  return metadataModuleKey.replace(/^\.\.\//, '')
}

function resolveAudioPath(metadataModuleKey, sourceAudioPath) {
  if (!sourceAudioPath) {
    return ''
  }
  const metadataPath = normalizeMetadataPath(metadataModuleKey)
  const metadataDir = metadataPath.replace(/\/metadata\.json$/, '')
  const audioFileName = sourceAudioPath.split('/').pop()
  if (!audioFileName) {
    return ''
  }
  return `${metadataDir}/audio/${audioFileName}`
}

function buildAudioOptions(metadata, sentenceNumber, metadataModuleKey) {
  const audioFiles = Array.isArray(metadata?.audio_files) ? metadata.audio_files : []
  const candidates = audioFiles.filter(
    (item) => item?.speaker === 'speaker2' && item?.sentence_number === sentenceNumber
  )
  const normalized = candidates.map((item, idx) => {
    const label = item.eq_level === 'high' ? 'resonant' : 'dissonant'
    return {
      optionId: `s${sentenceNumber}_opt_${idx + 1}_${item.eq_level || 'unknown'}`,
      sentenceNumber,
      label,
      audioPath: resolveAudioPath(metadataModuleKey, item.audio_path),
      toneDescription: item.tone_description || ''
    }
  })
  return {
    resonant: normalized.find((item) => item.label === 'resonant') || null,
    dissonant: normalized.find((item) => item.label === 'dissonant') || null
  }
}

function App() {
  /** Only true while loading scenarios after "Start Study" (not on first paint). */
  const [loading, setLoading] = useState(false)
  const [errorMessage, setErrorMessage] = useState('')
  const [showIntro, setShowIntro] = useState(true)
  const [questions, setQuestions] = useState([])
  const [currentQuestionIndex, setCurrentQuestionIndex] = useState(0)
  const [ratings, setRatings] = useState({})
  const [submitting, setSubmitting] = useState(false)
  const [submitted, setSubmitted] = useState(false)
  const [prolificIds, setProlificIds] = useState({
    prolificPid: '',
    studyId: '',
    sessionId: ''
  })

  useEffect(() => {
    const urlParams = new URLSearchParams(window.location.search)
    setProlificIds({
      prolificPid: urlParams.get('PROLIFIC_PID') || '',
      studyId: urlParams.get('STUDY_ID') || '',
      sessionId: urlParams.get('SESSION_ID') || ''
    })
  }, [])

  /**
   * Ask Apps Script for the next QUESTION_COUNT ids (lowest assignment_count first, cap 5 each).
   * If VITE_GOOGLE_FORM_URL is unset, returns { skipped: true } and the caller uses local fallback.
   */
  const fetchQuestionAllocation = async () => {
    const formUrl = getGoogleFormUrl()
    if (!formUrl) {
      return { skipped: true, ids: [] }
    }
    let response
    try {
      response = await fetch(
        `${formUrl}?action=getQuestions&count=${QUESTION_COUNT}`
      )
    } catch (err) {
      throw new Error(
        `Network error talking to Apps Script (${err?.message || 'Failed to fetch'}). ` +
          'If you are on localhost, keep VITE_GOOGLE_FORM_URL as the full https://script.google.com/.../exec URL; ' +
          'the dev server proxies it. If this is a static production host, you need a same-origin proxy or host that allows CORS to script.google.com.'
      )
    }
    const rawText = await response.text()
    let body
    try {
      body = JSON.parse(rawText)
    } catch {
      throw new Error(
        `Apps Script did not return JSON (HTTP ${response.status}). ` +
          `Check VITE_GOOGLE_FORM_URL and redeploy the Web App. Body starts with: ${rawText.slice(0, 240)}`
      )
    }
    if (!response.ok) {
      throw new Error(
        `Apps Script HTTP ${response.status} ${response.statusText}. ` +
          (body.error || body.message || rawText.slice(0, 240) || 'No error detail.')
      )
    }
    if (body.exhausted) {
      throw new Error(
        body.message ||
          'Every question_id has reached the maximum assignment count. Data collection is complete.'
      )
    }
    if (body.success === false) {
      throw new Error(body.error || 'Could not allocate questions.')
    }
    const ids = Array.isArray(body.questions) ? body.questions : []
    if (ids.length !== QUESTION_COUNT) {
      throw new Error(
        body.error ||
          `Expected ${QUESTION_COUNT} question ids from the server, got ${ids.length}.`
      )
    }
    return { skipped: false, ids }
  }

  const loadSession = async () => {
    try {
      const modelPayloads = Object.entries(modelResponseModules).map(([path, payload]) => ({
        path,
        payload
      }))

      if (QUESTION_POOL.length > 0 && modelPayloads.length > 0) {
        const allocation = await fetchQuestionAllocation()
        const byDatasetId = new Map(QUESTION_POOL.map((entry) => [entry.dataset_id, entry]))
        let chosenEntries
        if (allocation.skipped) {
          chosenEntries = QUESTION_POOL.slice(0, QUESTION_COUNT)
        } else {
          chosenEntries = allocation.ids.map((id) => byDatasetId.get(id)).filter(Boolean)
          if (chosenEntries.length !== QUESTION_COUNT) {
            const missing = allocation.ids.filter((id) => !byDatasetId.has(id))
            throw new Error(
              `Sheet returned ${allocation.ids.length} id(s) but only ${chosenEntries.length} match questions.json / local data. ` +
                `Missing or unknown ids: ${missing.join(', ') || '(none)'}. ` +
                `Run npm run generate-questions and sync the same ids to the Sheet.`
            )
          }
        }

        if (chosenEntries.length !== QUESTION_COUNT) {
          throw new Error(
            `Expected ${QUESTION_COUNT} questions but found ${chosenEntries.length}. ` +
              `QUESTION_POOL has ${QUESTION_POOL.length} entries (run npm run generate-questions).`
          )
        }

        const hydrated = chosenEntries.map((entry, idx) => {
          const metadataPathSuffix = `/data/${entry.subscale_slug}/${entry.dataset_id}/metadata.json`
          const metadataKey = Object.keys(metadataModules).find((k) => k.endsWith(metadataPathSuffix))
          const metadata = metadataKey ? metadataModules[metadataKey] : null
          if (!metadata) {
            throw new Error(`Missing metadata for ${entry.dataset_id}`)
          }

          const shownModels = modelPayloads
            .map(({ path, payload }) => {
              const modelId = path.split('/').pop()?.replace('.json', '') || `model_${idx}`
              const responseEntry = Array.isArray(payload?.responses)
                ? payload.responses.find((r) => r?.dataset_id === entry.dataset_id)
                : null
              if (!responseEntry) {
                return null
              }
              return {
                modelId,
                displayName: payload?.model || modelId,
                evaluation: buildModelEvaluation(responseEntry)
              }
            })
            .filter(Boolean)

          if (shownModels.length < 2) {
            throw new Error(`Question ${entry.dataset_id} must include at least 2 model responses`)
          }

          return {
            id: entry.dataset_id,
            subscale: entry.subscale_slug,
            metadata,
            conversationLines: buildConversationLines(metadata),
            sentenceAudio: {
              4: buildAudioOptions(metadata, 4, metadataKey),
              6: buildAudioOptions(metadata, 6, metadataKey)
            },
            shownModels: shuffle(shownModels)
          }
        })

        setQuestions(hydrated)
      } else {
        const baseUrl = import.meta.env.BASE_URL
        const manifestRes = await fetch(`${baseUrl}questions.json`)
        if (!manifestRes.ok) {
          throw new Error('Unable to load questions.json')
        }

        const manifestJson = await manifestRes.json()
        const manifestQuestions = Array.isArray(manifestJson.questions)
          ? manifestJson.questions
          : []

        const allocation = await fetchQuestionAllocation()
        const byQuestionId = new Map(manifestQuestions.map((q) => [q.id, q]))
        const chosenQuestions = allocation.skipped
          ? manifestQuestions.slice(0, QUESTION_COUNT)
          : allocation.ids.map((id) => byQuestionId.get(id)).filter(Boolean)

        if (chosenQuestions.length !== QUESTION_COUNT) {
          throw new Error(
            `Expected ${QUESTION_COUNT} questions but found ${chosenQuestions.length}`
          )
        }

        const hydrated = []
        for (const question of chosenQuestions) {
          const metadataRes = await fetch(`${baseUrl}${question.metadataPath}`)
          if (!metadataRes.ok) {
            throw new Error(`Failed to load metadata for ${question.id}`)
          }
          const metadata = await metadataRes.json()

          const modelResPath = question.modelResponsePath || `model_responses/${question.id}.json`
          const modelRes = await fetch(`${baseUrl}${modelResPath}`)
          if (!modelRes.ok) {
            throw new Error(`Failed to load model responses for ${question.id}`)
          }
          const modelPayload = await modelRes.json()
          if (!Array.isArray(modelPayload.models) || modelPayload.models.length < 2) {
            throw new Error(`Question ${question.id} must include at least 2 models`)
          }

          const shownModels = shuffle(modelPayload.models)
          hydrated.push({
            ...question,
            metadata,
            sentenceAudio: {},
            shownModels
          })
        }

        setQuestions(hydrated)
      }
      setLoading(false)
    } catch (err) {
      setErrorMessage(err.message || 'Failed to load session')
      setLoading(false)
    }
  }

  const handleStartStudy = async () => {
    setErrorMessage('')
    setShowIntro(false)
    setLoading(true)
    await loadSession()
  }

  const currentQuestion = questions[currentQuestionIndex]

  const currentQuestionRating = useMemo(
    () => ratings[currentQuestion?.id] || { models: {} },
    [ratings, currentQuestion]
  )

  const isCurrentQuestionComplete = useMemo(() => {
    if (!currentQuestion) {
      return false
    }
    const values = currentQuestion.shownModels.map(
      (model) => currentQuestionRating.models?.[model.modelId]
    )
    if (values.some((v) => !v)) {
      return false
    }
    return true
  }, [currentQuestion, currentQuestionRating])

  const setModelRating = (questionId, modelId, scoreValue) => {
    setRatings((prev) => ({
      ...prev,
      [questionId]: {
        ...(prev[questionId] || {}),
        models: {
          ...((prev[questionId] && prev[questionId].models) || {}),
          [modelId]: scoreValue
        }
      }
    }))
  }

  const nextQuestion = () => {
    if (!isCurrentQuestionComplete) {
      return
    }
    if (currentQuestionIndex < questions.length - 1) {
      setCurrentQuestionIndex((prev) => prev + 1)
    }
  }

  const prevQuestion = () => {
    if (currentQuestionIndex > 0) {
      setCurrentQuestionIndex((prev) => prev - 1)
    }
  }

  const submit = async () => {
    if (submitted || submitting) {
      return
    }
    const allComplete = questions.every((q) => {
      const answer = ratings[q.id] || { models: {} }
      const modelValues = q.shownModels.map((m) => answer.models?.[m.modelId])
      return modelValues.length > 1 && modelValues.every(Boolean)
    })
    if (!allComplete) {
      setErrorMessage('Please complete all 1-10 ratings for all 5 questions.')
      return
    }
    const formUrl = getGoogleFormUrl()
    if (!formUrl) {
      setErrorMessage('Missing VITE_GOOGLE_FORM_URL.')
      return
    }

    setSubmitting(true)
    setErrorMessage('')

    const payload = {
      timestamp: new Date().toISOString(),
      prolificPid: prolificIds.prolificPid || 'N/A',
      studyId: prolificIds.studyId || 'N/A',
      sessionId: prolificIds.sessionId || 'N/A',
      clientVersion: '1.0.0',
      questions: questions.map((q) => {
        const answer = ratings[q.id] || { models: {} }
        return {
          questionId: q.id,
          subscale: q.subscale,
          modelOrderShown: q.shownModels.map((m) => m.modelId),
          modelScores: q.shownModels.map((m) => ({
            modelId: m.modelId,
            score: answer.models?.[m.modelId] || null
          }))
        }
      })
    }

    try {
      let response
      try {
        response = await fetch(formUrl, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/x-www-form-urlencoded'
          },
          body: `data=${encodeURIComponent(JSON.stringify(payload))}`
        })
      } catch (err) {
        throw new Error(
          `Network error submitting to Apps Script (${err?.message || 'Failed to fetch'}). ` +
            'Same fix as loading questions: use dev proxy on localhost with full script URL in .env.'
        )
      }
      const text = await response.text()
      let isSuccess = response.ok
      try {
        const json = JSON.parse(text)
        isSuccess = isSuccess && json.success === true
      } catch {
        isSuccess = isSuccess && text.toLowerCase().includes('success')
      }
      if (!isSuccess) {
        throw new Error('Submission failed')
      }
      setSubmitted(true)
      window.location.href = PROLIFIC_EXIT_URL
    } catch (err) {
      setErrorMessage('Submission failed. Please try again.')
      setSubmitting(false)
    }
  }

  if (showIntro) {
    return (
      <main className="container">
        <h1>SpeechEQ Model Arena</h1>
        <h2 className="intro-title">Welcome and Thank You!</h2>
        <p className="lead">
          In this task, you will help us evaluate the &quot;Emotional Intelligence&quot; of various
          Artificial Intelligence models. We want to know if these AI models can genuinely understand
          complex human social situations.
        </p>

        <section className="intro-section">
          <h3>What you will do</h3>
          <p>You will read <strong>5 short scenarios</strong>. For each scenario, you will follow these steps:</p>
          <ol className="intro-list">
            <li>
              <strong>Read the context:</strong> Read a short dialogue between two people experiencing
              social friction or emotional stress.
            </li>
            <li>
              <strong>Review the two options:</strong> You will see two possible ways the conversation
              could continue (Option A and Option B). One response is emotionally intelligent, and the
              other is socially inappropriate. In the study interface they are labeled{' '}
              <strong>Option 1 (Resonant)</strong> and <strong>Option 2 (Dissonant)</strong>, with audio
              for the key continuation lines.
            </li>
            <li>
              <strong>Evaluate the AI&apos;s comparative reasoning:</strong> The AI was presented with
              both options and asked to analyze them. You will read the AI&apos;s explanation, where it
              discusses both options and makes its final choice.{' '}
              <strong>
                The AI may have analyzed them incorrectly or chosen the wrong final option.
              </strong>{' '}
              Green and red highlighting shows whether its final choice matched the better option for
              this task.
            </li>
            <li>
              <strong>Rate the AI:</strong> Give a <strong>single overall score from 1 to 10</strong> per
              model based on how well it evaluated the two options. If several models are shown, rate
              each independently.
            </li>
          </ol>
        </section>

        <section className="intro-section">
          <h3>How to score the AI (the 1–10 scale)</h3>
          <p>
            When deciding on your single score from 1 to 10, please evaluate the AI based on these three
            dimensions:
          </p>
          <ul className="intro-inline-list">
            <li>
              <strong>Contextual awareness:</strong> Did the AI accurately identify the underlying social
              tension in the original dialogue?
            </li>
            <li>
              <strong>Comparative decision quality:</strong> Did the AI accurately recognize why the good
              option was appropriate <em>and</em> why the bad option was offensive or awkward?
            </li>
            <li>
              <strong>Reasoning quality:</strong> Is the AI&apos;s justification logical, insightful, and
              convincingly grounded in emotional intelligence?
            </li>
          </ul>
          <div className="intro-guide">
            <p className="intro-guide-label">The scoring guide</p>
            <ul>
              <li>
                <strong>1–3 (Fail):</strong> The AI completely misunderstood both options, picked the
                wrong final answer, or its reasoning makes no sense.
              </li>
              <li>
                <strong>4–7 (Mediocre):</strong> The AI understands the basic topic but misses the deeper
                emotional nuance. It might have picked the right option, but failed to adequately explain
                why the other option was bad (or vice versa).
              </li>
              <li>
                <strong>8–10 (Excellent):</strong> The AI provided a highly insightful, human-like
                comparison of both options, perfectly articulated why the bad option was inappropriate,
                and confidently selected the correct response.
              </li>
            </ul>
          </div>
        </section>

        <section className="intro-callout">
          <h3>⚠️ Important guidelines before you start ⚠️</h3>
          <ul>
            <li>
              <strong>The AI can be wrong.</strong> If the AI confidently defends a terrible social
              choice or misunderstands the nuance of the two options, give it a low score.
            </li>
            <li>
              <strong>Ignore grammar.</strong> Do not penalize an AI for using bullet points or robotic
              phrasing like &quot;As an AI…&quot; Focus exclusively on its emotional intelligence.
            </li>
          </ul>
        </section>

        <div className="intro-actions">
          <button className="btn primary" type="button" onClick={handleStartStudy}>
            Start study
          </button>
        </div>
      </main>
    )
  }

  if (loading) {
    return <div className="center-panel">Loading scenarios from Google Sheets…</div>
  }

  if (errorMessage && questions.length === 0) {
    return (
      <main className="container">
        <div className="center-panel error">{errorMessage}</div>
        <div className="actions" style={{ justifyContent: 'center', marginTop: 16 }}>
          <button
            type="button"
            className="btn"
            onClick={() => {
              setErrorMessage('')
              setShowIntro(true)
            }}
          >
            Back to introduction
          </button>
        </div>
      </main>
    )
  }

  return (
    <main className="container">
      <h1>SpeechEQ Model Arena</h1>
      <div className="progress">Question {currentQuestionIndex + 1} / {questions.length}</div>
      <section className="scenario-panel" aria-labelledby="scenario-heading">
        <div className="section-eyebrow">Scenario context</div>
        <h2 id="scenario-heading">{currentQuestion.metadata?.scenario?.title || 'Scenario'}</h2>
        {currentQuestion.metadata?.scenario?.context ? (
          <p className="scenario-setup">{currentQuestion.metadata.scenario.context}</p>
        ) : null}
        {(currentQuestion.conversationLines || []).length > 0 ? (
          <div className="scenario-dialogue">
            <p className="scenario-dialogue-label">Dialogue and continuation options (shared setup)</p>
            {(currentQuestion.conversationLines || []).map((line) => (
              <div key={line.id}>
                <p>
                  <strong>Sentence {line.sentenceNumber} - {line.label}:</strong> {line.text}
                </p>
                {(line.sentenceNumber === 4 || line.sentenceNumber === 6) ? (
                  <div className="model-row">
                    <div className="model-header">
                      <strong>Sentence {line.sentenceNumber} audio options</strong>
                    </div>
                    <div className="audio-options-row">
                      <div>
                        <p className="audio-option-caption">Option 1 (Resonant)</p>
                        {currentQuestion.sentenceAudio?.[line.sentenceNumber]?.resonant?.audioPath ? (
                          <audio
                            controls
                            preload="none"
                            src={currentQuestion.sentenceAudio?.[line.sentenceNumber]?.resonant?.audioPath}
                          >
                            Your browser does not support the audio element.
                          </audio>
                        ) : (
                          <p className="model-response">Missing Option 1 audio.</p>
                        )}
                      </div>
                      <div>
                        <p className="audio-option-caption">Option 2 (Dissonant)</p>
                        {currentQuestion.sentenceAudio?.[line.sentenceNumber]?.dissonant?.audioPath ? (
                          <audio
                            controls
                            preload="none"
                            src={currentQuestion.sentenceAudio?.[line.sentenceNumber]?.dissonant?.audioPath}
                          >
                            Your browser does not support the audio element.
                          </audio>
                        ) : (
                          <p className="model-response">Missing Option 2 audio.</p>
                        )}
                      </div>
                    </div>
                  </div>
                ) : null}
              </div>
            ))}
          </div>
        ) : null}
      </section>

      <section className="rating-panel" aria-labelledby="rating-heading">
        <div className="section-eyebrow section-eyebrow--rating">Model responses</div>
        <p className="rating-panel-hint">
          Below is each model&apos;s forced choices and written explanations for this scenario. This
          material is <strong>not</strong> part of the dialogue above—use it only to judge the models
          and assign scores.
        </p>
        <h3 id="rating-heading">Rate all model responses independently</h3>
        {currentQuestion.shownModels.map((model, modelIdx) => (
          <div key={model.modelId} className="model-row">
            <div className="model-header">
              <strong>Model {modelIdx + 1}</strong>
            </div>
            <div className={`sentence-eval ${model.evaluation?.sentence4?.isCorrect ? 'correct' : 'incorrect'}`}>
              <p className="model-response">
                <strong>Sentence 4:</strong>{' '}
                Model selected Option {model.evaluation?.sentence4?.selectedOptionNumber || 'unknown'}
              </p>
              {model.evaluation?.sentence4?.resonantDescription ? (
                <p className="model-response">
                  <strong>Option 1 (Resonant) description:</strong> {model.evaluation?.sentence4?.resonantDescription}
                </p>
              ) : null}
              {model.evaluation?.sentence4?.dissonantDescription ? (
                <p className="model-response">
                  <strong>Option 2 (Dissonant) description:</strong> {model.evaluation?.sentence4?.dissonantDescription}
                </p>
              ) : null}
              {model.evaluation?.sentence4?.situationalDemand ? (
                <p className="model-response">
                  <strong>Situational demand:</strong> {model.evaluation?.sentence4?.situationalDemand}
                </p>
              ) : null}
              <p className="model-response">{model.evaluation?.sentence4?.reasoning || 'No reasoning provided.'}</p>
            </div>

            <div className={`sentence-eval ${model.evaluation?.sentence6?.isCorrect ? 'correct' : 'incorrect'}`}>
              <p className="model-response">
                <strong>Sentence 6:</strong>{' '}
                Model selected Option {model.evaluation?.sentence6?.selectedOptionNumber || 'unknown'}
              </p>
              {model.evaluation?.sentence6?.resonantDescription ? (
                <p className="model-response">
                  <strong>Option 1 (Resonant) description:</strong> {model.evaluation?.sentence6?.resonantDescription}
                </p>
              ) : null}
              {model.evaluation?.sentence6?.dissonantDescription ? (
                <p className="model-response">
                  <strong>Option 2 (Dissonant) description:</strong> {model.evaluation?.sentence6?.dissonantDescription}
                </p>
              ) : null}
              {model.evaluation?.sentence6?.situationalDemand ? (
                <p className="model-response">
                  <strong>Situational demand:</strong> {model.evaluation?.sentence6?.situationalDemand}
                </p>
              ) : null}
              <p className="model-response">{model.evaluation?.sentence6?.reasoning || 'No reasoning provided.'}</p>
            </div>

            <div className="score-row">
              <span>Score: </span>
              {Array.from({ length: 10 }, (_, idx) => idx + 1).map((score) => (
                <button
                  key={score}
                  type="button"
                  className="btn score-btn"
                  onClick={() => setModelRating(currentQuestion.id, model.modelId, score)}
                  aria-pressed={currentQuestionRating.models?.[model.modelId] === score}
                >
                  {score}
                </button>
              ))}
            </div>
          </div>
        ))}
      </section>

      {errorMessage && <div className="error-banner">{errorMessage}</div>}

      <div className="actions">
        <button className="btn" onClick={prevQuestion} disabled={currentQuestionIndex === 0}>
          Previous
        </button>
        {currentQuestionIndex < questions.length - 1 ? (
          <button className="btn primary" onClick={nextQuestion} disabled={!isCurrentQuestionComplete}>
            Next
          </button>
        ) : (
          <button className="btn primary" onClick={submit} disabled={!isCurrentQuestionComplete || submitting}>
            {submitting ? 'Submitting...' : submitted ? 'Submitted' : 'Submit'}
          </button>
        )}
      </div>
    </main>
  )
}

export default App
