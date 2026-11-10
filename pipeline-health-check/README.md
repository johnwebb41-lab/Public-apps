# Pipeline Health Check

A revenue operations command view for a B2B SaaS sales team: where the quarter will land, how far to trust that, which deals, reps and managers need attention, and what to do next. Built by John Webb with AI.

> **All data is fictitious.** Every company, customer, rep, manager, SDR, competitor, deal and figure was invented for this demo. Any resemblance to real organisations, people or results is purely coincidental. Nothing here is financial advice.

## What it shows

Open `index.html` in any browser. Start with **Start here**, or take the two-minute guided tour.

| Tab | Question it answers |
|---|---|
| Start here | What is this, and why was it built? |
| How it works | How is it calculated, and who sees what? |
| Executive summary | Where will we land, how far can we trust it, and what needs deciding this week? |
| Manager view | How is each rep trending across their last four quarters? Metrics only, and labelled that way. |
| Forecast coverage | Is there enough pipeline, with and without the deals that have problems? |
| Hygiene and next steps | Which deals need attention, and what is the next step on each? |
| Commission | What will each rep and manager earn? Executives see every team; a team lead sees only their own. |
| Activity | Are reps and SDRs doing the work? |
| Marketing | Is marketing feeding the pipeline, which channels pay, and how many leads were dumped or recycled? |
| Renewals | Which customers might not renew, and why? |
| Revenue metrics | GRR, NRR, cohorts, win rates, cycle length, CAC payback, net magic number, Rule of 40, win/loss, deal desk and MEDDPICC. |
| Planning | What if deals slip, and how many hires does next year need? |
| Your data | Would this work on a real pipeline? Load a CRM export as CSV; it never leaves the browser. |
| Definitions | What does each measure, hygiene rule and MEDDPICC element mean? |
| Sample calculations | How is each number worked out, and where do the Good, Watch and Act lines sit? |

The tabs stay pinned at the top as you scroll. Every measure has a **?** beside it: hover or tap for a one-line definition, click for the full entry. The **Show** buttons under the tabs filter rated rows and tiles to Good, Watch, Act or the watch list (Watch and Act together). The deal list on the hygiene tab also filters by issue, team, owner, stage and forecast category.

## What I decided, and why

1. **Answer first, evidence second.** The first screen says where we'll land, how far to trust it and what to decide. Every other tab is the evidence.
2. **Coverage against what's left, at our own win rate**, not against full quota with a blanket 3x.
3. **Show the pipeline with and without its problems.** Raw beside clean coverage is the case for pipeline hygiene in one number.
4. **No red flag without a next step.**
5. **Calibrate before you forecast.** Forecast categories are checked against what actually closed.
6. **Judge people against their tenure.**
7. **Commission is seen only by those entitled to it.**
8. **Nothing goes red without a reason**, and every threshold is written down.
9. **AI builds; people decide.** AI wrote the code and played the reviewer roles. I decided what to measure, what good looks like, who sees what, and what goes in front of an executive.

## How it's built

- `src/engine.js`: the calculation engine. Plain functions with no page code, so every tab draws from the same numbers.
- `src/page.html`: the page.
- `tests/test.js`: 89 automated tests, covering worked examples, edge cases and reconciliation of totals across tabs.
- `build.js`: runs the tests and, only if they all pass, builds `index.html` with the engine and results inlined.
- `fonts/`: Archivo and IBM Plex, both under the SIL Open Font License. They are bundled so the page loads nothing from third parties.

To rebuild after a change:

```
node tests/test.js
node build.js
```

Needs Node.js 18 or later. There are no other dependencies.

## Known limitations

Thresholds are common SaaS rules of thumb or stated demo settings, all held in one place in the engine so every tab uses the same lines. The manager view reads reps from their metrics alone; it can't see leave, territory changes or deal timing. Renewal rates by health band are assumed. Source attribution is single-touch, and commission estimates treat each deal on its own. Access by role is a demo switch; a live system would enforce it at sign-in.
