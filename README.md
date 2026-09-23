# Sitecheck — SEO & Website Visibility Audit (V1)

Enter a URL, click **Analyze Website**, get a clear SEO audit report:
- Overall score out of 100
- Critical issues
- Warnings
- Things that are working well
- Actionable recommendations

No accounts, no payments, no saved history, no AI calls yet — on purpose.
This is the audit engine working correctly first. Free tier only, no paid
services required.

---

## 1. Where every file goes (and why)

```
seo-audit-mvp/
├── api/
│   └── analyze.js       ← Serverless function. Becomes POST /api/analyze automatically.
├── lib/
│   └── analyzer.js       ← All SEO-checking logic (no HTTP/framework code in here).
├── public/
│   ├── index.html         ← The one-page dashboard UI.
│   ├── style.css           ← Mobile-first responsive styling.
│   └── script.js            ← Calls /api/analyze and renders the report.
├── package.json
├── .gitignore
└── README.md
```

**Why split it this way:**
- `lib/analyzer.js` has zero knowledge of HTTP, Vercel, or the frontend — it's
  "give me HTML, get back a scored report." That means later you can call it
  from a different API route, a queue worker, or a CLI without rewriting it.
- `api/analyze.js` is the *only* file that talks to the outside internet or
  would ever read a secret key. The browser never sees the raw fetch — it
  just gets clean JSON back.
- `public/` is served as static files. There is no key to leak here in V1,
  and there never should be, even after later phases add one server-side.

---

## 2. How it works (core flow)

1. User types a URL into `public/index.html` and clicks **Analyze Website**.
2. `script.js` sends `POST /api/analyze` with `{ url }`.
3. `api/analyze.js` (server-side only) validates the URL, fetches the target
   page's raw HTML with a timeout and size cap, then calls `runAudit()` from
   `lib/analyzer.js`.
4. `analyzer.js` runs 9 checks, scores each, and buckets every check into
   **critical / warning / working well**, then builds a deduplicated,
   priority-ordered **recommendations** list from the failing/warning tips.
5. JSON comes back to the browser; `script.js` renders the score meter and
   the four report sections — no page reload, no framework.

---

## 3. What V1 checks (9 checks, 100 points)

| # | Check | Points | What it looks at |
|---|---|---|---|
| 1 | Page Title | 12 | Exists, length 30–60 chars |
| 2 | Meta Description | 12 | Exists, length 70–160 chars |
| 3 | H1 Heading | 10 | Exactly one H1 present |
| 4 | Heading Structure | 10 | Logical H1→H2→H3 nesting, no skipped levels |
| 5 | Image Alt Text | 10 | % of `<img>` tags with an `alt` attribute |
| 6 | Basic On-Page SEO | 10 | Canonical tag, unique title/description, viewport tag |
| 7 | Internal Links | 12 | Internal link count, empty hrefs, generic anchor text ("click here") |
| 8 | Basic Technical SEO | 12 | HTTPS, not `noindex`, charset declared |
| 9 | Basic Content Analysis | 12 | Word count, paragraph structure, text-to-HTML ratio |

Each check returns a `pass` / `warn` / `fail` status, a plain-language
message, and — if not passing — a specific tip. `buildReport()` in
`lib/analyzer.js` sorts these into the four report sections and generates
the recommendations list. Every report ends with a line clarifying that
these are best-practice recommendations, not a ranking guarantee.

---

## 4. Deploying — from your phone, no CLI needed

1. **GitHub**: create a free account, make a new empty repo (e.g.
   `sitecheck-mvp`), and upload every file in this project via "Add file →
   Upload files," keeping the folder structure exactly as shown above.
2. **Vercel**: sign in at vercel.com with your GitHub account, click
   "Add New… → Project," import the repo, leave default settings (Vercel
   auto-detects `/api` as serverless functions and `/public` as static
   assets), and click Deploy. You'll get a live URL in under a minute.

Future edits: change files in the GitHub web/app editor and commit to
`main` — Vercel redeploys automatically on every push.

### Running it locally (optional)
```bash
npm install
npx vercel dev
```

---

## 5. Guardrails already built in

- **No API keys anywhere in V1** — there are none to expose. When a future
  phase adds one (e.g. for AI-generated recommendations), it goes only in
  Vercel's Environment Variables and is read only inside `/api` files —
  never in anything under `/public`.
- **No ranking guarantees.** The recommendations list always ends with a
  line stating these are best-practice suggestions, not a promise of
  specific Google or AI-search placement.
- **Basic abuse protection.** `api/analyze.js` includes a lightweight
  per-IP rate limit, a fetch timeout, an HTML size cap, and content-type
  validation before parsing anything.

---

## 6. Deliberately NOT in V1

Per current scope, these are intentionally left out until the core audit is
solid and validated:
- User accounts / authentication
- Payments or subscriptions
- Saved report history or a multi-page dashboard
- Any AI-generated content (recommendations are rule-based only)
- Competitor analysis, local SEO checks, AI-search visibility checks

---

## 7. Where future features plug in (not built yet)

The structure was chosen so each of these is an *addition*, not a rewrite:

- **AI-generated recommendations:** add a new function (or `api/insights.js`)
  that takes the same `checks` array `runAudit()` already produces and sends
  a summary to an LLM, reading its API key via `process.env.SOME_KEY` set in
  Vercel's dashboard — never called from `public/script.js` directly.
- **Competitor analysis:** a new `api/compare.js` can call the existing
  `runAudit()` twice (it's already exported and reusable) and diff the
  results — no changes needed to `lib/analyzer.js`.
- **Local SEO:** add `lib/localSeoChecks.js` for NAP consistency, Google
  Business Profile presence, and local schema, returning checks in the same
  `{ id, category, label, max, score, status, message, tip }` shape so they
  merge straight into the existing report structure.
- **AI-search visibility:** add checks for `llms.txt` and structured data
  (JSON-LD) — same shape, same pattern, added to the `checks` array in
  `runAudit()`.
- **Accounts, saved reports, subscriptions:** layer on later with a free-tier
  auth provider (Clerk/NextAuth), a free-tier Postgres database (Neon/
  Supabase), and Stripe billing — none of which the current core engine
  needs to know about.
