import "dotenv/config"
import express from "express"
import rateLimit from "express-rate-limit"
import { fileURLToPath } from "url"
import path from "path"
import { existsSync } from "fs"

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const app = express()
app.use(express.json())

const scanLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 20,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: "Too many requests, please try again later." },
})

const systemPrompt = [
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
].join(" ")

const ALLOWED_PROVIDERS = new Set(["openai", "groq"])

app.post("/api/scan", scanLimiter, async (req, res) => {
  const { resume, jobDescription, provider, model, temperature } = req.body

  const resolvedProvider = ALLOWED_PROVIDERS.has(provider) ? provider : "openai"

  const userInput = [
    "JOB DESCRIPTION:",
    jobDescription || "Not provided",
    "---",
    "RESUME:",
    resume,
  ].join("\n")

  let apiKey
  let apiUrl

  if (resolvedProvider === "groq") {
    apiKey = process.env.GROQ_API_KEY
    apiUrl = "https://api.groq.com/openai/v1/chat/completions"
  } else {
    apiKey = process.env.OPENAI_API_KEY
    apiUrl = "https://api.openai.com/v1/chat/completions"
  }

  if (!apiKey) {
    return res.status(500).json({ error: `API key for ${resolvedProvider} is not configured` })
  }

  try {
    const upstream = await fetch(apiUrl, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        model,
        temperature,
        messages: [
          { role: "system", content: systemPrompt },
          { role: "user", content: userInput },
        ],
        max_tokens: 900,
      }),
    })

    if (!upstream.ok) {
      const txt = await upstream.text()
      console.error(`${resolvedProvider} error:`, txt)
      return res
        .status(upstream.status)
        .json({ error: `Upstream provider returned an error` })
    }

    const data = await upstream.json()
    return res.json(data)
  } catch (err) {
    console.error(err)
    return res.status(500).json({ error: "Internal error" })
  }
})

// Serve built frontend in production (only when dist/ has been built)
const distPath = path.join(__dirname, "..", "dist")
if (existsSync(distPath)) {
  app.use(express.static(distPath))
  app.get("*", (_req, res) => {
    res.sendFile(path.join(distPath, "index.html"))
  })
}

const PORT = process.env.PORT || 3001
app.listen(PORT, () => {
  console.log(`Server running on http://localhost:${PORT}`)
})
