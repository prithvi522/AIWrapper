# AI Resume Scanner (Vite + React)

Weighted, explainable ATS-style scoring with hard rejects and mobile-friendly flow.

## Dev

### Frontend only (no live AI calls)
```bash
npm install
npm run dev
```

### Full-stack local dev (frontend + Express backend)
```bash
cp .env.example .env   # then fill in your API keys
npm install
npm run dev:full
```
This starts the Express backend on port 3001 and the Vite dev server (which proxies `/api` requests to it).

## Build
```bash
npm run build
```

## Self-hosted (Node.js server)
```bash
npm run build        # build the frontend into dist/
cp .env.example .env # fill in API keys
npm run server       # serves dist/ and /api/scan on PORT (default 3001)
```

## Deploy (Vercel or Netlify)
- Build: `npm run build`
- Output: `dist/`
- Env: `OPENAI_API_KEY` (OpenAI) and optionally `GROQ_API_KEY` (Groq)
- Requests go to `/api/scan` serverless proxy which routes to OpenAI or Groq based on the selected provider.

### Vercel
- `api/scan.js` is auto-detected as a Serverless Function at `/api/scan`.
- Add `OPENAI_API_KEY` and (optional) `GROQ_API_KEY` in Project Settings → Environment Variables.

### Netlify
- Build/Output same as above.
- Copy `api/scan.js` to `netlify/functions/scan.js` (or configure your functions dir) and add `OPENAI_API_KEY`/`GROQ_API_KEY` in site settings.

## How to use
1) Upload a text-based PDF/DOCX (or Load sample).
2) Paste the Job Description (required).
3) Fix red validation errors; warnings are optional.
4) Mobile: Next → JD → Run. Desktop: click Run.
5) Results show weighted score, dimensions, strengths, risks, gaps, rewrites. Copy/share as needed.
