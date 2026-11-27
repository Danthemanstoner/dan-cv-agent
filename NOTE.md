# Agent Dan: approach note

**Agent:** https://qwnwhg1uzhqp.run.agentplace.io/ (GPT-6 Luna, published Public, no sign-in)
**On my CV site:** https://dan-stoner-cv-site.vercel.app (corner button, bottom right)
**API:** https://dan-cv-agent.vercel.app (`/openapi.json`, `/mcp`)
**Code:** this repository

## What I built, and for whom

Agent Dan is the guide on my own CV site. My business is freelance product engineering, and its customers are hiring managers and clients. They ask who I am, what I've built, whether I'm available, and how to reach me. Agent Dan answers with project cards, shares my CV as a PDF, passes a message to me, and runs two small games built from real work: "Guess the stack", and "Incident detective" (three production bugs and the rule I took from each).

## How the pieces fit

```
Visitor ──> CV site (animated face button)
                │  Agentplace embed script (AgentplaceAssistant.open)
                ▼
          Agent Dan on Agentplace (Luna, custom CRT UI built through the Builder)
                │  tool calls (REST, described by openapi.json)
                ▼
          Facts API on Vercel (TypeScript, Express)  ──  data/facts.json, data/games.json
                │                                   ──  Postgres (Neon): messages for me
                ▼
          /inbox (behind a token): where I read messages visitors asked Agent Dan to pass on
```

- **The agent holds no facts of its own.** Every answer about me comes from 13 tools: profile, projects, timeline, search, availability, CV, draft and send a message, quiz, incidents. The same registry serves REST, MCP and `openapi.json`, so the three can't drift apart.
- **Every fact has a source** (my CV, my site, or something I confirmed) and is either `verified` or `dan-to-confirm`. Only verified facts are served.

## Why it depends on the API

Agentplace's Builder wired the tools in, and the API's request logs show the agent calling them. In my logged-out acceptance run of the 14 questions below, the API logged 37 tool calls: 18 `get_project`, 5 `search_facts`, 4 `list_projects`, 3 `get_timeline`, 2 `get_profile`, 2 `get_availability`. Every number on a project card (5,342 products, 30,000+ customers, 118 sections) comes from a tool result.

## Guardrails

- **Truth rules in the agent's instructions:** facts only from the tools; no pay; no customer data; Basketeer is a client; the contact step drafts before it saves.
- **A banned-claims check in the API:** for example no Shopify Plus claim, no degree, no revenue or pay figures. Every response is scanned before it's sent, and a response that would make a banned claim is refused and logged. The check matches affirmations, not topic words, so an honest "Basketeer isn't on Shopify Plus" passes.
- **"Message Dan" works in two steps:** a preview that saves nothing, then a send that saves only the exact text the visitor confirmed (a signed, expiring token). It's idempotent, limited per visitor and overall, never emailed, and I read it in a private inbox.
- **Acceptance test against the published agent:** `scripts/e2e/acceptance.mts`, a headless logged-out browser, the brief's 14 questions with the honest ones ("rates?", "degree?", "Python?", "customer list?", "conversion lift?"). Latest run: 14 of 14 correct and honest, 0 banned claims (`agentplace/acceptance/2026-11-27.md`).
- **Test-backed checks:** 37 API tests, including a real MCP client. The key checks were proven by breaking the code on purpose and watching the test fail; that caught two real bugs before release. I build production tool-calling agents for a client (Basil, Basketeer's sales assistant on LINE, web chat and email) and used the same ideas here. Basil is not connected to Agent Dan.

## Where I hit Agentplace's limits

| Needed | What happened | How I'd build it |
|---|---|---|
| Connect my own MCP server | The Builder said its MCP connection "does not accept the owner's arbitrary MCP URL", so it used my REST API through `openapi.json` instead. That works, but the docs only mention Composio and "compatible MCP tools". | A "custom MCP server" connector: URL, transport, optional auth header, then a tool-list preview the owner approves before the Builder uses it. |
| Test in the Builder | The preview panel stayed on "Error occurred while starting development server" for the whole build; one recovery attempt got HTTP 429. **Open in tab** worked every time. | Fall back to the tab automatically, and surface the dev-server error and its cause in the panel. |
| Put the agent on my site | The publish dialog offers an embed script that the docs don't mention, with a real API (`init`, `open`, `close`, `setContext`, placement floating or inline). But `open()` always takes the **full screen**, there's no corner-panel size, the embedded view drops the custom layout the agent page has, and the `on()` listeners logged no events in my test. | A `panel` placement with a width and height, an option to embed the agent's own layout, and documented events so the host page can react to open, close and replies. |
| A UI that matches the CV site | **This worked, and impressed me.** Through the Builder I got custom front-end code, my own Lottie animation (mood changes as the agent thinks and talks), a pixel web font, a canvas mini-game and a two-column layout. Rough edges: the Builder once said an attached file "was not present" and re-implemented it; it invented a header label ("DANSTONER.ONLINE", not my domain); and it added links my API didn't return. | Keep attachments as project files the Builder can read again, and check generated copy against the instructions before writing it into the UI. |
| Luna is free | 1,000 credits went to 994 on one Builder turn that included attachments. Every other turn used none. | Show what used credits on each turn. |
| Custom domain | Offered in the publish dialog; the pricing page lists it under Pro. Not tested. | — |

The Builder deserves credit for one thing: it reported honestly what it could not verify, and kept "routes I expect" separate from "calls I observed".

## What I'd change for production

- **Run the agent's eval in CI:** the acceptance script runs against a staging agent before every republish. Publish only on 14/14 and 0 banned claims.
- **One tool-call trace per conversation:** API logs with a request id passed from the agent, so a wrong answer can be traced to the tool result behind it.
- **A staging agent** next to the published one; today preview and published share one API.
- **Facts editing with review:** a small admin form that writes `facts.json` through a pull request, so a new project is reviewed like code.
- **Notifications and consent for messages:** a LINE or email ping when a message lands, a consent line in the form, and a retention period.
- **Monitoring:** uptime on `/api/health` and an alert on any `blocked_claim`.
- **MCP as the main door** once a custom MCP connector exists; it's already served at `/mcp`.

## What wasn't tested

- The custom domain.
- Voice ("Speak").
- The embed's `on()` events, beyond the one test above.
- How Agentplace shows a tool error to a visitor. My API returns clear errors, but I didn't force one on the live agent.
