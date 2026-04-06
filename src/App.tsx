import { useMemo, useRef, useState, useEffect } from "react"
import "./App.css"

type Experience = "fresher" | "experienced"

type ValidationResult = {
  errors: string[]
  warnings: string[]
}

type LineRender =
  | { type: "blank"; text: string }
  | { type: "bullet"; text: string }
  | { type: "kv"; key: string; value: string }
  | { type: "text"; text: string }

type ParsedResult = {
  rejected?: boolean
  total_score?: number
  dimensions?: { name: string; weight: number; score: number; reason?: string }[]
  strengths?: string[]
  risks?: string[]
  gaps?: string[]
  rewrites?: string[]
}

function App() {
  const [resumeText, setResumeText] = useState(defaultResume)
  const [jobDescription, setJobDescription] = useState(defaultJD)
  const [experience, setExperience] = useState<Experience>("experienced")
  const [provider, setProvider] = useState<"openai" | "groq">("openai")
  const [model, setModel] = useState("gpt-4o-mini")
  const [temperature, setTemperature] = useState(0.1)
  const [status, setStatus] = useState("Ready")
  const [output, setOutput] = useState("Run a scan to see results here.")
  const [loading, setLoading] = useState(false)
  const [fileName, setFileName] = useState("")
  const [fileNote, setFileNote] = useState(
    "Accepts .pdf or .docx only (text-based).",
  )
  const [hasResult, setHasResult] = useState(false)
  const [validation, setValidation] = useState<ValidationResult>({
    errors: [],
    warnings: [],
  })
  const [hardReject, setHardReject] = useState<string | null>(null)
  const [isMobile, setIsMobile] = useState(false)
  const [mobileStep, setMobileStep] = useState<0 | 1>(0) // 0=resume, 1=JD

  const systemPrompt = useMemo(
    () =>
      [
        "You are an enterprise ATS reviewer using a weighted rubric.",
        "Weights: Skills 40% (Required vs Preferred), Experience 30%, Education/Certs 15%, Formatting/Quality 15%.",
        "Use 0-5 rubric per dimension: 5 Expert, 4 Strong, 3 Average, 2 Weak, 1 Poor, 0 Missing.",
        "TOTAL_SCORE 0-100 = weighted average of the 0-5 scores * 20.",
        "Hard rejections set TOTAL_SCORE to 0 and REJECTED=true: scanned/unaligned text; missing standard headers; no valid email+phone in first 20%.",
        "Require a Job Description: compare must-have vs nice-to-have skills.",
        "For each dimension include score0to5 and reasoning with specific quote from resume or JD; list deductions explicitly.",
        "Return strict JSON: { rejected, total_score, dimensions:[{name,weight,score,reason}], strengths:[], risks:[], gaps:[], rewrites:[] }.",
        "Gaps must list missing JD must-haves first, then nice-to-haves.",
        "Rewrites: 3 bullets tailored to JD with measurable outcome.",
        "Be concise and specific; cite short quoted phrases for evidence.",
      ].join(" "),
    [],
  )

  const handleFile = async (file: File) => {
    setFileName(file.name)
    setFileNote("Reading file...")
    setHardReject(null)
    try {
      const lower = file.name.toLowerCase()
      const isPdf = file.type === "application/pdf" || lower.endsWith(".pdf")
      const isDocx =
        file.type ===
          "application/vnd.openxmlformats-officedocument.wordprocessingml.document" ||
        lower.endsWith(".docx")

      if (!isPdf && !isDocx) {
        setHardReject("Unsupported format. Only .pdf or .docx are allowed.")
        setFileNote("Rejected: only .pdf or .docx supported.")
        return
      }

      if (file.type.startsWith("image")) {
        setHardReject("Image files auto-rejected. Provide text-based PDF or DOCX.")
        setFileNote("Rejected: image-based resumes not accepted.")
        return
      }

      let text = ""
      if (isPdf) {
        text = await file.text()
        if (text.trim().length < 50 || isLikelyScanned(text)) {
          setHardReject("PDF appears image-based/unreadable. Provide a text-based PDF.")
          setValidation({ errors: ["PDF likely image-based or empty."], warnings: [] })
          setFileNote("PDF rejected: needs selectable text (not a scan).")
          return
        }
        setFileNote("PDF loaded. Please skim for OCR issues.")
      } else if (isDocx) {
        text = await file.text()
        if (isLikelyBinary(text)) {
          setHardReject("DOCX content unreadable here. Export to PDF or paste text.")
          setFileNote("DOCX unreadable here; convert to text/PDF.")
          return
        }
        setFileNote("DOCX loaded. Verify content below.")
      }

      if (text.trim().length === 0) {
        setHardReject("No text detected. Paste the resume text to proceed.")
        setFileNote("Empty file. Paste text manually.")
        return
      }

      setResumeText(text)
      const v = evaluate(text, experience, jobDescription)
      setValidation(v)
      setHardReject(v.errors.find((e) => e.startsWith("Hard reject")) || null)
    } catch (err) {
      console.error(err)
      setHardReject("Failed to read file. Paste resume text instead.")
      setFileNote("File read failed. Paste text manually.")
    }
  }

  const run = async () => {
    const precheck = evaluate(resumeText, experience, jobDescription)
    setValidation(precheck)
    const hard = precheck.errors.find((e) => e.startsWith("Hard reject")) || null
    setHardReject(hard)
    if (hard || precheck.errors.length > 0) {
      setStatus("Fix validation errors before running.")
      return
    }

    setLoading(true)
    setStatus("Calling model...")
    setHasResult(false)
    try {
      const payload = {
        jobDescription,
        resume: resumeText,
        provider,
        model,
        temperature,
      }

      const res = await fetch("/api/scan", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify(payload),
      })

      if (!res.ok) throw new Error(`HTTP ${res.status} ${res.statusText}`)

      const data = (await res.json()) as {
        choices?: { message?: { content?: string } }[]
      }
      const content = data?.choices?.[0]?.message?.content
      setOutput(content || "No content returned.")
      setStatus("Scan complete")
      setHasResult(true)
    } catch (err) {
      console.error(err)
      setOutput(fallbackSample)
      setStatus("Fallback sample shown (live call failed)")
      setHasResult(true)
    } finally {
      setLoading(false)
    }
  }

  const resultsRef = useRef<HTMLDivElement | null>(null)

  useEffect(() => {
    if (hasResult && resultsRef.current) {
      resultsRef.current.scrollIntoView({ behavior: "smooth", block: "start" })
    }
  }, [hasResult])

  useEffect(() => {
    const v = evaluate(resumeText, experience, jobDescription)
    setValidation(v)
    setHardReject(v.errors.find((e) => e.startsWith("Hard reject")) || null)
  }, [resumeText, experience, jobDescription])

  useEffect(() => {
    const saved = localStorage.getItem("resume-wrapper-state")
    if (saved) {
      try {
        const parsed = JSON.parse(saved) as {
          resumeText?: string
          jobDescription?: string
          experience?: Experience
        }
        if (parsed.resumeText) setResumeText(parsed.resumeText)
        if (parsed.jobDescription) setJobDescription(parsed.jobDescription)
        if (parsed.experience) setExperience(parsed.experience)
      } catch (err) {
        console.error("Failed to load saved state", err)
      }
    }
  }, [])

  useEffect(() => {
    const payload = JSON.stringify({ resumeText, jobDescription, experience })
    localStorage.setItem("resume-wrapper-state", payload)
  }, [resumeText, jobDescription, experience])

  const formattedLines: LineRender[] = useMemo(() => {
    return output.split("\n").map((line) => {
      const trimmed = line.trim()
      if (!trimmed) return { type: "blank", text: "" }
      if (trimmed.startsWith("- ")) {
        return { type: "bullet", text: trimmed.slice(2) }
      }
      const colonIndex = trimmed.indexOf(":")
      if (colonIndex > 0) {
        return {
          type: "kv",
          key: trimmed.slice(0, colonIndex).trim(),
          value: trimmed.slice(colonIndex + 1).trim(),
        }
      }
      return { type: "text", text: trimmed }
    })
  }, [output])

  const parsedResult: ParsedResult | null = useMemo(() => {
    try {
      const obj = JSON.parse(output)
      if (typeof obj === "object" && obj !== null) {
        return obj as ParsedResult
      }
    } catch {
      return null
    }
    return null
  }, [output])

  useEffect(() => {
    const mq = window.matchMedia("(max-width: 720px)")
    const handler = (e: MediaQueryListEvent | MediaQueryList) => {
      const mobile = "matches" in e ? e.matches : (e as MediaQueryList).matches
      setIsMobile(mobile)
      if (!mobile) setMobileStep(0)
    }
    handler(mq)
    mq.addEventListener("change", handler)
    return () => mq.removeEventListener("change", handler)
  }, [])

  return (
    <div className="page">
      <header className="hero">
        <div>
          <p className="eyebrow">AI Resume Scanner</p>
          <h1>Weighted, explainable scoring</h1>
          <p className="lede">
            Upload a text-based PDF or DOCX and a required job description. We enforce
            hard rejects, then score 🎯 Skills / 🧭 Experience / 🎓 Education / ✨ Formatting with a 0-5 rubric and quote-backed deductions.
          </p>
          <div className="tags">
            <span>Hard rejects built-in</span>
            <span>Weighted rubric</span>
            <span>Explainable JSON</span>
          </div>
        </div>
        <div className="connect card">
          <div className="row two">
            <label>Provider
              <select
                value={provider}
                onChange={(e) => setProvider(e.target.value as "openai" | "groq")}
              >
                <option value="openai">OpenAI</option>
                <option value="groq">Groq</option>
              </select>
            </label>
            <label>Model
              <select value={model} onChange={(e) => setModel(e.target.value)}>
                <option value="gpt-4o-mini">gpt-4o-mini</option>
                <option value="gpt-4o">gpt-4o</option>
                <option value="gpt-3.5-turbo">gpt-3.5-turbo</option>
                <option value="o1-mini">o1-mini</option>
                <option value="llama3-8b-8192">llama3-8b-8192 (Groq)</option>
                <option value="mixtral-8x7b-32768">mixtral-8x7b-32768 (Groq)</option>
              </select>
            </label>
            <label>Temperature: {temperature.toFixed(2)}
              <input
                type="range"
                min={0}
                max={1}
                step={0.05}
                value={temperature}
                onChange={(e) => setTemperature(Number(e.target.value))}
              />
            </label>
          </div>
          <div className="row">
            <label>Experience level</label>
            <select
              value={experience}
              onChange={(e) => setExperience(e.target.value as Experience)}
            >
              <option value="fresher">Fresher (max 1 page)</option>
              <option value="experienced">Experienced (max 2 pages)</option>
            </select>
          </div>
          <div className="status">{status}</div>
        </div>
      </header>

      <main className="layout">
        <section className="card">
          {hardReject && <div className="alert error">{hardReject}</div>}
          {validation.errors.length > 0 && !hardReject && (
            <div className="alert error">
              <strong>Fix before running:</strong>
              <ul>
                {validation.errors.map((e) => (
                  <li key={e}>{e}</li>
                ))}
              </ul>
            </div>
          )}
          {validation.warnings.length > 0 && (
            <div className="alert warn">
              <strong>Warnings:</strong>
              <ul>
                {validation.warnings.map((w) => (
                  <li key={w}>{w}</li>
                ))}
              </ul>
            </div>
          )}
          <div className="inputs">
            {(!isMobile || mobileStep === 0) && (
              <div className="block">
                <div className="head">
                  <span>Resume</span>
                  <div className="actions">
                    <label className="upload">
                      Upload file
                      <input
                        type="file"
                        accept=".pdf,.docx"
                        onChange={(e) => {
                          const f = e.target.files?.[0]
                          if (f) handleFile(f)
                        }}
                      />
                    </label>
                    <button onClick={() => setResumeText(defaultResume)} className="ghost">
                      Load sample
                    </button>
                  </div>
                </div>
                <p className="note">{fileName ? `${fileName} • ${fileNote}` : fileNote}</p>
                <textarea
                  value={resumeText}
                  onChange={(e) => setResumeText(e.target.value)}
                  rows={14}
                />
              </div>
            )}
            {(!isMobile || mobileStep === 1) && (
              <div className="block">
                <div className="head">
                  <span>Job description (required)</span>
                  <button onClick={() => setJobDescription(defaultJD)} className="ghost">
                    Load sample JD
                  </button>
                </div>
                <textarea
                  value={jobDescription}
                  onChange={(e) => setJobDescription(e.target.value)}
                  rows={14}
                  placeholder="Paste JD here — required for weighted scoring."
                />
              </div>
            )}
          </div>
          {isMobile ? (
            <div className="wizard-nav">
              <div className="wizard-buttons">
                {mobileStep === 1 && (
                  <button className="ghost" onClick={() => setMobileStep(0)}>
                    ← Previous (Resume)
                  </button>
                )}
                {mobileStep === 0 && (
                  <button className="primary" onClick={() => setMobileStep(1)}>
                    Next → JD
                  </button>
                )}
                {mobileStep === 1 && (
                  <button
                    className="primary"
                    onClick={run}
                    disabled={loading || !!hardReject || validation.errors.length > 0}
                  >
                    {loading ? "Running..." : "Run scan"}
                  </button>
                )}
              </div>
              <span className="note">
                Hard rejects enforced locally. Without a model endpoint, fallback sample is shown.
              </span>
            </div>
          ) : (
            <div className="run-row">
              <button
                className="primary"
                onClick={run}
                disabled={loading || !!hardReject || validation.errors.length > 0}
              >
                {loading ? "Running..." : "Run scan"}
              </button>
              <span className="note">
                Hard rejects enforced locally. Without a model endpoint, fallback sample is shown.
              </span>
            </div>
          )}
        </section>

        <section className="card" ref={resultsRef}>
          <div className="head">
            <span>Results</span>
            <button
              className="ghost"
              onClick={() => navigator.clipboard.writeText(output)}
            >
              Copy
            </button>
          </div>
          <div className="output-box pretty">
            {parsedResult ? (
              <div className="result-grid">
                <div className="score-card">
                  <div className="score-label">{parsedResult.rejected ? "Rejected" : "Total Score"}</div>
                  <div className={`score-value ${parsedResult.rejected ? "score-bad" : "score-good"}`}>
                    {parsedResult.rejected ? "0" : parsedResult.total_score ?? "—"}
                  </div>
                </div>

                {parsedResult.dimensions && (
                  <div className="dims">
                    <div className="section-title">Dimensions</div>
                    {parsedResult.dimensions.map((d) => (
                      <div key={d.name} className="dim-row">
                        <div className="dim-left">
                          <span className="pill">{d.name}</span>
                          <span className="dim-weight">{Math.round(d.weight * 100)}%</span>
                        </div>
                        <div className="dim-right">
                          <span className="score-chip">{d.score}/5</span>
                          {d.reason && <span className="dim-reason">{d.reason}</span>}
                        </div>
                      </div>
                    ))}
                  </div>
                )}

                {parsedResult.strengths && (
                  <div className="chips">
                    <div className="section-title">👍 Strengths</div>
                    <div className="chip-row">
                      {parsedResult.strengths.map((s, i) => (
                        <span key={i} className="chip good">{s}</span>
                      ))}
                    </div>
                  </div>
                )}

                {parsedResult.risks && (
                  <div className="chips">
                    <div className="section-title">⚠️ Risks</div>
                    <div className="chip-row">
                      {parsedResult.risks.map((r, i) => (
                        <span key={i} className="chip warn">{r}</span>
                      ))}
                    </div>
                  </div>
                )}

                {parsedResult.gaps && (
                  <div className="chips">
                    <div className="section-title">🕳️ Gaps</div>
                    <div className="chip-row">
                      {parsedResult.gaps.map((g, i) => (
                        <span key={i} className="chip gap">{g}</span>
                      ))}
                    </div>
                  </div>
                )}

                {parsedResult.rewrites && (
                  <div className="rewrites">
                    <div className="section-title">✍️ Rewrites</div>
                    <ul>
                      {parsedResult.rewrites.map((r, i) => (
                        <li key={i}>{r}</li>
                      ))}
                    </ul>
                  </div>
                )}
              </div>
            ) : (
              formattedLines.map((line, idx) => {
                if (line.type === "blank") return <div key={idx} className="result-blank" />
                if (line.type === "bullet")
                  return (
                    <div key={idx} className="result-line bullet">
                      <span className="dot-bullet">•</span>
                      <span className="result-value">{line.text}</span>
                    </div>
                  )
                if (line.type === "kv")
                  return (
                    <div key={idx} className="result-line kv">
                      <span className="result-key">{line.key}</span>
                      {line.value && <span className="result-value"> {line.value}</span>}
                    </div>
                  )
                return (
                  <div key={idx} className="result-line text">
                    <span className="result-value">{line.text}</span>
                  </div>
                )
              })
            )}
          </div>
        </section>
        <section className="card manual">
          <div className="head">
            <span>📘 Quick User Manual</span>
          </div>
          <ol className="manual-list">
            <li>Upload a text-based PDF/DOCX or tap “Load sample.”</li>
            <li>Paste the job description (required for scoring).</li>
            <li>Fix red errors; warnings are optional.</li>
            <li>On mobile: Next → JD, then Run. On desktop: click Run.</li>
            <li>Scroll to Results, copy JSON or chips, and share.</li>
          </ol>
        </section>
      </main>
    </div>
  )
}

function evaluate(
  text: string,
  experience: Experience,
  jobDescription: string,
): ValidationResult {
  const errors: string[] = []
  const warnings: string[] = []

  const trimmed = text.trim()
  if (!trimmed) {
    errors.push("Hard reject: no text detected in resume.")
    return { errors, warnings }
  }

  if (!jobDescription.trim()) {
    errors.push("Hard reject: job description is required for weighted scoring.")
  }

  const words = trimmed.split(/\s+/).length
  const pages = words / 500
  if (experience === "fresher" && pages > 1.1) {
    errors.push("Hard reject: Freshers must be ≤ 1 page (approx 500 words).")
  }
  if (experience === "experienced" && pages > 2.1) {
    errors.push("Hard reject: Experienced resumes must be ≤ 2 pages (approx 1000 words).")
  }

  const lower = trimmed.toLowerCase()
  const standardHeadings = ["work experience", "professional experience", "education", "skills"]
  const hasStandard = standardHeadings.some((h) => lower.includes(h))
  if (!hasStandard) {
    errors.push("Hard reject: Missing standard section headings (Experience / Education / Skills).")
  }

  const firstSlice = trimmed.slice(0, Math.ceil(trimmed.length * 0.2))
  const hasEmail = /[\w.+-]+@[\w.-]+\.[A-Za-z]{2,}/.test(firstSlice)
  const hasPhone = /(\+?\d[\d\s\-()]{6,}\d)/.test(firstSlice)
  if (!hasEmail || !hasPhone) {
    errors.push("Hard reject: Email and phone must appear near the top of the resume (first 20%).")
  }

  const creativeHeads = [/my journey/i, /where i\'ve been/i, /career story/i]
  if (creativeHeads.some((r) => r.test(trimmed))) {
    warnings.push("Non-standard headings detected (use Experience, Education, Skills).")
  }

  if (/[★⭐✪✰✵➤➔➜➥➣✔✓✕✖❌]/.test(trimmed)) {
    warnings.push("Non-standard bullets or icons detected; use simple dots or dashes.")
  }

  return { errors, warnings }
}

function isLikelyScanned(text: string) {
  const printable = text.replace(/\s+/g, "")
  const letters = printable.replace(/[^A-Za-z0-9]/g, "")
  const ratio = letters.length / Math.max(1, printable.length)
  return ratio < 0.15
}

function isLikelyBinary(text: string) {
  return /\x00/.test(text) || text.slice(0, 50).includes("PK")
}

const defaultResume = `NAME: Jordan Patel
EMAIL: jordan.patel@example.com | PHONE: 555-123-9876

WORK EXPERIENCE
Senior Frontend Engineer | Acme Corp | 2021–Present
- Led design system rollout across 9 squads; cut feature lead time 40%.
- Improved TTI by 180ms via route-splitting, memoized hooks, bundle audits.
- Mentored 4 engineers; introduced visual regression pipeline and Storybook a11y checks.

EDUCATION
B.S. Computer Science, State University, 2018

SKILLS
React, TypeScript, Node, Design Systems, Accessibility, Testing, GraphQL, Performance
`

const defaultJD = `ROLE: Staff Frontend Engineer
MUST: React, TypeScript, performance optimization, design systems, accessibility, testing
NICE: Node, GraphQL, mentoring
`

const fallbackSample = `{
  "rejected": false,
  "total_score": 82,
  "dimensions": [
    {"name":"Skills","weight":0.4,"score":4,"reason":"Matches React, TS, design systems; missing explicit WCAG metrics"},
    {"name":"Experience","weight":0.3,"score":4,"reason":"Senior title, led design system, mentored; limited backend depth"},
    {"name":"Education/Certs","weight":0.15,"score":3,"reason":"CS degree present; no certifications listed"},
    {"name":"Formatting","weight":0.15,"score":3,"reason":"Standard headers; assume single column; check for tables/graphics"}
  ],
  "strengths": ["Design system leadership", "Performance wins (40% lead time, 180ms TTI)", "Mentoring"],
  "risks": ["No explicit accessibility metrics", "Sparse testing automation detail", "Backend exposure light"],
  "gaps": ["WCAG/a11y metrics", "Automation/E2E evidence", "GraphQL depth", "Observability"],
  "rewrites": [
    "Led design system for 9 squads; cut feature lead time 40% and UI defects 18%.",
    "Improved TTI by 180ms via route-splitting, memoized hooks, bundle audits across 3 products.",
    "Mentored 4 engineers; built visual regression suite and Storybook axe checks (accessibility)."
  ]
}`

export default App
