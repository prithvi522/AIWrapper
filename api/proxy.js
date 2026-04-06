export default async function handler(req, res) {
  const apiKey = process.env.OPENAI_API_KEY
  if (!apiKey) {
    return res.status(500).json({ error: "OPENAI_API_KEY not set on server" })
  }

  try {
    const body = typeof req.body === "string" ? req.body : JSON.stringify(req.body)
    const upstream = await fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${apiKey}`,
      },
      body,
    })

    res.status(upstream.status)
    upstream.body.pipe(res)
  } catch (err) {
    console.error(err)
    res.status(500).json({ error: "Proxy error" })
  }
}
