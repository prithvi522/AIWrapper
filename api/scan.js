export const config = {
  runtime: "edge",
}

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

export default async function handler(req) {
  if (req.method !== "POST") {
    return new Response("Method Not Allowed", { status: 405 })
  }

  try {
    const { resume, jobDescription, provider, model, temperature } = await req.json()

    const userInput = [
      "JOB DESCRIPTION:",
      jobDescription || "Not provided",
      "---",
      "RESUME:",
      resume,
    ].join("\n")

    let apiKey
    let apiUrl

    if (provider === "groq") {
      apiKey = process.env.GROQ_API_KEY
      apiUrl = "https://api.groq.com/openai/v1/chat/completions"
    } else {
      apiKey = process.env.OPENAI_API_KEY
      apiUrl = "https://api.openai.com/v1/chat/completions"
    }

    if (!apiKey) {
      return new Response(`API key for ${provider || "openai"} is not configured`, { status: 500 })
    }

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
      console.error(`${provider || "openai"} error:`, txt)
      return new Response(`Error from ${provider || "openai"}: ${upstream.statusText}`, {
        status: upstream.status,
      })
    }

    const data = await upstream.json()
    const content = data.choices?.[0]?.message?.content
    return new Response(JSON.stringify({ content }), {
      headers: { "Content-Type": "application/json" },
    })
  } catch (err) {
    console.error(err)
    return new Response("Internal error", { status: 500 })
  }
}
