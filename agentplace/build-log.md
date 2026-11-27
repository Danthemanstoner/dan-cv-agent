# Agentplace build log

What the Builder did, allowed and refused, as it happened. Raw material for NOTE.md.

## 26 Nov 2026

**13:35 First Builder message** (`builder-prompt.md`, via the prefilled `?create_new=true&autosend=false&instruction=` link; GPT-6 Luna pre-selected in the model picker).
- Named the agent, set the terminal colours, monospace and square corners, and set the model route `openai.gpt-6-luna`.
- Said the platform guide calls Luna fast and cheap but "doesn't confirm that it's free" (the public docs and pricing page do say Luna is free).
- Preview was unavailable, so it could not confirm the build.
- Asked for the instructions and "the non-secret MCP connection details or authorization flow", and said not to paste keys.

**~13:45 Second message** (`builder-message-2.md`: MCP details, look, 13 test prompts, don't publish, report back, then the instructions word for word).
- 13:44:34 the Builder fetched `GET /openapi.json` from the API (seen in Vercel request logs). No other requests from Agentplace.
- **MCP not connected.** Builder: "the available MCP connection interface does not accept the owner's arbitrary MCP URL; I did not edit .agent/mcp.json." It wired the tools through the REST fallback (`POST /api/tools/<name>`) instead.
- Instructions saved to the agent's `instruction.md` as supplied.
- Terminal styling, project cards and the message card implemented, but it "could not inspect how they render".
- It ran its own tool tests: operation names, request method and body for a project lookup, draft-only messaging, and safe handling of an upstream error. It said these do **not** verify live API responses.
- **Preview blocked:** the preview iframe stayed disconnected; "Who is Dan?" was accepted but no response came back, no conversation history or trace. The preview pane shows "Error occurred while starting development server".
- Nothing sent, nothing published. Luna configured; "whether it is free-eligible remains unverified".

Observations: the agent is a code project (`instruction.md`, `.agent/mcp.json`). The Builder reports honestly what it could not verify, and separates expected routes from observed calls.

**13:56 Preview** never loads inside the Builder's panel ("Error occurred while starting development server"), but **Open in tab** works: `qwnwhg1uzhqp-preview.run.agentplace.io/agent/qwnwhg1uzhqp/preview`. Terminal styling, first message and a "Speak" voice button are there.

**13:58 First live tool calls** (Vercel request logs): "Who is Dan?" → `get_profile`; "What did he do for Basketeer?" → `list_projects`, then four parallel `get_project` calls. Cards show the API's numbers exactly. Small miss: it added a basketeer.com link to the Basil and DanShopPro cards, which the API doesn't return.

**Layout:** each answer replaces the page (a page per turn), with small markers on the right edge to step back through earlier answers. Not a scrolling chat log.

**27 Nov 08:36:** "What are his rates?" declined ("Dan discusses those directly") with a link to send a message. Quiz shows question 1 with four tappable options. "Message Dan" shows a form (name, reply-to email, message) and says nothing is sent or stored until the visitor confirms.

**08:43** Attached the mockup HTML, the Lottie JSON and the player JS (the message text didn't go with them). The Builder read them correctly: "a 512×512 Lottie animation with idle, greeting, thinking, and talking markers", the visitor view, inbox mock, prompts and the "Order Catcher" game. It asked whether to use them as references or incorporate them, and noted it had not stored the files. **Credits went from 1,000 to 994** on this turn, although Luna is meant to be free.

**09:17 Restyle to the mockup** (`builder-message-3b.md` plus the attached mockup, Lottie and player). Worked for 14 min 48 s. Credits unchanged at 994. Builder: "The supplied Lottie and arcade font are bundled locally; the page has the CRT monitor, continuous transcript, fixed ten quick replies, API-backed quiz/incident choices, and a local 30-second Order Catcher." Build 0 errors, 0 warnings. **So Agentplace allows custom front-end code, a bundled Lottie animation, a custom web font, a canvas game and a two-column layout.** Its in-panel Preview still fails (one recovery attempt got HTTP 429); "Open in tab" works.
- Live tool calls 09:16–09:17: `list_projects`, 4× `get_project`, `share_cv`, `quiz_question`.
- Issues seen: it invented a header label "DANSTONER.ONLINE" (not Dan's domain); chips overlap the log; quiz needs two steps; the "not Dan himself" note was replaced; mood stuck on idle; "Play a game" skipped the arcade menu.

**09:30 After fix round 1** (`builder-message-4.md`): the Builder reimplemented the player in TypeScript ("the requested dan-agent-player.js was not present in the project"). Header now shows the real site, the first message is verbatim, the "not Dan himself" note is back, chips sit above the input, the quiz answers in one click, "Play a game" shows the INSERT COIN menu with three games, and Order catcher opens as a pop-up cabinet with Close, Pause, Reset and on-screen Left/Right buttons. Basil and DanShopPro cards no longer get an invented link. Still open: chips and input overlap the last card; the Order catcher player is a generic figure, not the pixel Agent Dan; the mood line stays on "idle".

**09:36 Published.** Public, Require sign-in off, Allow duplication off (custom domain offered in the dialog; Pro plan per pricing). Public URL: https://qwnwhg1uzhqp.run.agentplace.io/
- The publish dialog offers things the public docs don't mention:
  - **An embed script for other websites:** `<script src="https://agentplace.io/admin/embed/v1.js" data-agent-url="https://qwnwhg1uzhqp.run.agentplace.io/" data-controls="input" async>`.
  - **A Claude Code plugin install** (`claude plugin marketplace add …agentplace…/marketplace.json`, `claude plugin install agent-dan-qwnwhg1uzhqp@agentplace`).
  - **Share-post templates** for Reddit, X, LinkedIn and email.
- Embed script (v1.js, 17 KB) read: `window.AgentplaceAssistant.init({ agentUrl, controls: 'input'|'voice'|'compact', persistence: 'session'|'none', placement: floating bottom-left/right or inline in a container })`. Commands: open, close, sendMessage, setContext (website context, at most 32 keys and 8 KB), stopVoice, destroy. Events: ready, expanded, collapsed, height, session, voice, error. It needs HTTPS or a local server.
- The public page sends no X-Frame-Options or CSP frame-ancestors header, so it can also be framed.
- Logged-out headless check: the page loads with the CRT monitor and mood "greeting"; at 500 px the monitor collapses to a top strip and there is no horizontal scroll.

**09:45 Acceptance run** (logged out, headless, `scripts/e2e/acceptance.mts`): 14/14 answers correct and honest, 0 banned claims, 37 tool calls in the API logs. Mood line shows thinking, and talking on longer answers. Chips still overlap the last card. Results: `agentplace/acceptance/2026-11-27.md`.

**~09:50 Embed tested** (scratch page on localhost; the embed refuses file:// pages and needs HTTPS or a local server). `controls: 'compact'` collapsed is a 400×108 "Ask Agent Dan" pill plus a voice button, bottom right; `inline` collapsed is an input bar inside the container. **In both modes `open()` makes a full-viewport modal** (1280×800 at that window size) that locks page scrolling: there is no corner-panel mode. The embedded view is a simplified conversation (title, log, input); the custom CRT monitor panel only appears on the agent's own page. The `on()` listeners logged no events in this test; open state is visible as `html.agentplace-embed-open`.

**10:0x CV site launcher LIVE** (dan-stoner-cv-site commit af30681, Vercel deployment dan-stoner-cv-site-4tqm67ce8). Corner button with the Lottie face opens Agent Dan through `AgentplaceAssistant.init({ controls:'compact', placement:{ kind:'floating', position:'bottom-right' } }).open()`, with `setContext({ site, section })`. Agentplace's own collapsed pill is hidden with one CSS rule. If the embed isn't ready in 8 s, the agent opens in a new tab. Live test, desktop 1440 and phone 390: hidden during the intro, visible after; face loads; open is full screen; close returns focus; no horizontal scroll. Reduced motion: still face. 97 KB gzipped, loaded after page load.
