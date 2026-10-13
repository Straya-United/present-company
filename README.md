# Present Company

**Gift ideas from what they already love.** Describe the person you're buying for: the bands, shows, books, games, brands and hobbies they're into. Present Company asks [Qloo](https://www.qloo.com)'s taste graph what fans of those things also love, then turns the strongest matches into concrete gift ideas, each one traceable to a Qloo result.

Built for the [Qloo Agentic Hackathon](https://qloo.devpost.com/).

## How it works

```
 "My brother loves AC/DC, Bluey and fishing,        ┌──────────── agent (src/agent.mjs) ────────────┐
  lives in Mackay, about $80"           ──────────▶ │ 1. Plan     model reads the description:      │
                                                    │             loves, vibes, budget, location,    │
                                                    │             which categories to search         │
                                                    │ 2. Resolve  qloo_describe each favourite       │
                                                    │             → exact Qloo entity IDs            │
                                                    │ 3. Explore  qloo_recommend per category, in    │
                                                    │             parallel (books, music, brands,    │
                                                    │             games, TV, local places…)          │
                                                    │ 4. Compose  model turns matches into gifts;    │
                                                    │             every idea must cite a Qloo        │
                                                    │             entity_id or it is dropped         │
                                                    └────────────────────────────────────────────────┘
                                                      + "Check my ideas": qloo_rank on your own shortlist
```

- **Qloo is the engine, not decoration.** Gift ideas only come from entities Qloo returned for this person's tastes. The server checks every idea against the candidate list, and the page shows the Qloo match, its affinity score and which favourite it links to.
- **Agentic, but bounded.** The model plans which Qloo searches to run and writes the final list. Qloo calls run in parallel, retry once without vague "vibe" tags if they make a request ambiguous, and stream to the page live (open **Show Qloo calls**).
- **Check my ideas.** Already have a shortlist? `qloo_rank` scores your own options against the same taste profile.
- **Steer it.** Cheaper, more experiences, less obvious, or your own words. The list is rewritten from the same Qloo results without new searches.

## Qloo workflows used

| Step | Tool | Why |
|---|---|---|
| Resolve favourites | `qloo_describe` | Turns "AC/DC" or "Bluey" into exact Qloo entities, so recommendations use IDs, not guesses. Shown to the user as "Qloo matched". |
| Find gift candidates | `qloo_recommend` with `signals`, `signal_tags`, `demographic`, `filter_location` | "Fans of these also like…" for each chosen category; local places only when a location is given. |
| Check a shortlist | `qloo_rank` | Ranks the giver's own ideas against the same taste signals. |

Qloo is called through the event-supported route: the official `@qloo/qloo-harness` MCP server (`qloo mcp`), started once by the Node server and called with the MCP SDK client. The key lives only in the server's environment.

## Privacy and limits

- Only the cultural favourites in the description are sent to Qloo. The planning step strips personal names, and nothing about the person is stored beyond a two-hour in-memory session.
- Qloo describes aggregate affinities (what fans of something tend to like). It doesn't know the person, and the page says so.
- Prices are rough Australian estimates written by the model, not live prices. "Find it" opens a shop search.

## Run it

Requires Node.js 22.19 or newer.

```bash
npm install
npm run dev:mock        # no keys needed: mock Qloo + mock model, http://localhost:8790
npm test                # agent tests against the mock layer

# live
export QLOO_API_KEY=...      # event-issued Qloo key
export OPENAI_API_KEY=...    # language model for planning and writing
npm start
```

Deploy: any host that runs a long-lived Node process (the Qloo harness doesn't run in serverless functions). `render.yaml` is a ready Render blueprint; set `QLOO_API_KEY` and `OPENAI_API_KEY` as secrets.

## Credits

Taste data from [Qloo](https://www.qloo.com). Built by Treyn at AppForge Digital, with Claude as an AI coding partner. MIT licence.
