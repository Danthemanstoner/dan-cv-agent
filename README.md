# dan-cv-agent

The facts API behind **Agent Dan**, the AI guide for [Dan Stoner's CV site](https://dan-stoner-cv-site.vercel.app), built on [Agentplace](https://agentplace.io) with the free GPT-6 Luna model.

Agent Dan holds no facts about Dan itself. Every answer comes from this API, so the agent can only say what Dan has checked, and says "I don't have that, ask Dan directly" when the API has nothing.

```
Visitor ──> CV site (launcher + animated face) ──> Agent Dan on Agentplace (Luna)
                                                        │ tool calls (MCP)
                                                        ▼
                                          this API (Vercel): REST + /mcp
                                            ├─ data/facts.json  (every fact has a source)
                                            ├─ data/games.json  (quiz + incident cases)
                                            └─ Postgres         (messages for Dan)
```

## What it does

| Tool | What it returns |
|---|---|
| `get_profile` | Who Dan is, where he's based, how he works, links, contact email |
| `list_projects`, `get_project(slug)` | Projects with what he did, numbers, stack, links and a showcase card |
| `get_timeline` | Career history and education |
| `search_facts(query)` | Matching facts with sources, or an empty list (meaning "not known") |
| `get_availability` | The kind of work he's open to (a note, not a live calendar) |
| `share_cv` | Link to the CV PDF, generated from the same facts |
| `draft_message` → `send_message` | Two-step handoff: preview first, save only after the visitor confirms. Nothing is emailed. |
| `quiz_question`, `quiz_answer` | "Guess the stack" quiz |
| `incident_case`, `incident_solve` | "Incident detective": three real production bugs and the rule Dan took from each |

Each tool is available three ways, all generated from one registry (`src/tools.ts`):

- **MCP** (Streamable HTTP, stateless): `POST /mcp`
- **REST**: `POST /api/tools/<name>` with a JSON body (read-only tools also accept `GET` with query parameters)
- **OpenAPI**: `GET /openapi.json`

Dan reads saved messages at `/inbox` (behind `INBOX_TOKEN`).

## Truth rules, enforced in code

- Facts are `verified` or `dan-to-confirm`. Only verified facts are served; the others stay in the file for Dan to review.
- `src/banned.ts` lists claims Agent Dan must never make (for example a Shopify Plus claim, a degree, revenue or pay figures). The patterns match affirmations, not topic words, so an honest denial ("Basketeer is not on Shopify Plus") passes and a claim fails.
- Every API response is scanned before it is sent. A response that would make a banned claim is refused with `blocked_claim` and logged, instead of served. The visitor's own words, echoed back in a message preview, are not scanned.
- Tests scan every response, the agent instructions and the generated CV, and fail if an unconfirmed fact is served. The key tests were checked by breaking the code on purpose and watching them fail.

## Run it

Needs Node 22+.

```bash
npm install
npm run dev            # http://localhost:3000, in-memory message store
npm test               # 34 tests: API, MCP with the real SDK client, truth rules, content checks
npm run typecheck
npm run build:cv       # rebuild public/cv.html and public/cv.pdf from the facts (needs Chrome)
```

Try it:

```bash
curl localhost:3000/api/tools/get_project?slug=basketeer-ops
npx @modelcontextprotocol/inspector   # then connect to http://localhost:3000/mcp (Streamable HTTP)
```

## Deploy (Vercel)

1. Create a Postgres database (Neon) and note its connection string.
2. Create the Vercel project from this repo and set these environment variables:

| Variable | What |
|---|---|
| `DATABASE_URL` | Postgres connection string for saved messages. Required in production. |
| `CONFIRM_SECRET` | 32+ random characters. Signs message drafts. |
| `INBOX_TOKEN` | 24+ random characters. Dan's inbox password. |
| `PUBLIC_BASE_URL` | The deployed URL, used for the CV link. |
| `ALLOWED_ORIGINS` | Optional. Comma-separated browser origins allowed to call the API. |

3. Deploy, then check `/api/health`, `/openapi.json` and `/mcp`.

The messages table is created on first use.

## Layout

```
src/        app (Express), tools registry, data loading, banned claims, messages, openapi
data/       facts.json, games.json
agentplace/ instructions.md (the agent's instructions), builder-prompt.md
public/     cv.html, cv.pdf, inbox.html
scripts/    dev server, CV builder
lottie/     Agent Dan's animated face: build script, player, tests
mockup/     the design mockup of the full experience
test/       vitest suites
```

## Production notes

What this would need before real traffic is in `NOTE.md`.
