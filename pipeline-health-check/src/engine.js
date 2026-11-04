// RevOps demo calculation engine v2. Pure functions, no DOM. Works in Node and the browser.
(function (root) {
  const DAY = 86400000;
  const parse = (s) => new Date(s + "T00:00:00Z").getTime();
  const daysBetween = (a, b) => Math.round((parse(b) - parse(a)) / DAY);
  const addDays = (iso, n) => new Date(parse(iso) + n * DAY).toISOString().slice(0, 10);
  const sum = (arr, f = (x) => x) => arr.reduce((a, x, i) => a + f(x, i), 0);
  const median = (arr) => { if (!arr.length) return 0; const s = arr.slice().sort((a, b) => a - b); const m = s.length >> 1; return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2; };

  // ---------- Reference data ----------
  const STAGES = [
    { name: "Discovery", prob: 0.10, allowed: ["Pipeline", "Omitted"], maxAge: 21 },
    { name: "Qualification", prob: 0.20, allowed: ["Pipeline", "Omitted"], maxAge: 30 },
    { name: "Solution", prob: 0.40, allowed: ["Pipeline", "Best Case"], maxAge: 30 },
    { name: "Proposal", prob: 0.60, allowed: ["Best Case", "Commit", "Pipeline"], maxAge: 21 },
    { name: "Negotiation", prob: 0.80, allowed: ["Commit", "Best Case"], maxAge: 21 },
  ];
  const stageOf = (name) => STAGES.find((s) => s.name === name);
  const stageIndex = (name) => STAGES.findIndex((s) => s.name === name);

  // MEDDPICC: 0 = unknown, 1 = partly evidenced, 2 = confirmed. REQ = minimum expected at each stage.
  const MEDDPICC = [
    { key: "M", name: "Metrics", action: "Agree with the buyer the number this deal moves and by how much, and write it into the business case." },
    { key: "E", name: "Economic buyer", action: "Get a meeting with the economic buyer. Ask the champion to sponsor the introduction." },
    { key: "D", name: "Decision criteria", action: "Get the decision criteria in writing and score our fit against each one." },
    { key: "D", name: "Decision process", action: "Map who signs off, in what order and by when. Put it in the mutual action plan." },
    { key: "P", name: "Paper process", action: "Confirm procurement, legal, security review and the named signatory, with dates." },
    { key: "I", name: "Identify pain", action: "Confirm the pain in the buyer's own words and the cost of doing nothing." },
    { key: "C", name: "Champion", action: "Test the champion: ask them to set up a meeting we can't get ourselves." },
    { key: "C", name: "Competition", action: "Find out who else is in the deal, including doing nothing, and position against them." },
  ];
  const MEDDPICC_REQ = {
    Discovery: [0, 0, 0, 0, 0, 1, 0, 0],
    Qualification: [1, 0, 0, 0, 0, 1, 1, 0],
    Solution: [1, 1, 1, 0, 0, 2, 1, 1],
    Proposal: [2, 1, 2, 1, 0, 2, 2, 1],
    Negotiation: [2, 2, 2, 2, 1, 2, 2, 2],
  };

  const DISCOUNT_TIERS = [
    { max: 0.10, approver: "Rep" },
    { max: 0.20, approver: "Sales manager" },
    { max: 0.30, approver: "Deal desk" },
    { max: 1.00, approver: "CFO" },
  ];
  const approverFor = (disc) => DISCOUNT_TIERS.find((t) => (disc || 0) <= t.max + 1e-9).approver;

  // Teams, managers and reps. quotaShare = share of team quota; closedShare = share of closed won so far.
  // ttmAttainment = trailing twelve months attainment against each rep's (ramped) quota.
  const TEAMS = [
    { name: "Enterprise", manager: "Grace Whitfield" },
    { name: "Mid-Market", manager: "Owen Price" },
    { name: "Growth", manager: "Rachel Dunn" },
  ];
  const REPS = [
    { name: "Priya Shah", team: "Enterprise", quotaShare: 0.15, closedShare: 0.18, start: "2021-03-01", ttmAttainment: 1.12 },
    { name: "Marcus Bell", team: "Enterprise", quotaShare: 0.14, closedShare: 0.15, start: "2019-09-01", ttmAttainment: 0.98 },
    { name: "Daniel Osei", team: "Enterprise", quotaShare: 0.13, closedShare: 0.12, start: "2025-06-01", ttmAttainment: 0.94 },
    { name: "Tom Okafor", team: "Mid-Market", quotaShare: 0.12, closedShare: 0.13, start: "2022-01-01", ttmAttainment: 1.04 },
    { name: "Elena Ruiz", team: "Mid-Market", quotaShare: 0.11, closedShare: 0.12, start: "2024-02-01", ttmAttainment: 0.91 },
    { name: "Sofia Marin", team: "Mid-Market", quotaShare: 0.10, closedShare: 0.09, start: "2026-05-01", ttmAttainment: 0.66 },
    { name: "Hannah Kerr", team: "Growth", quotaShare: 0.09, closedShare: 0.08, start: "2023-07-01", ttmAttainment: 0.71 },
    { name: "Liam Carter", team: "Growth", quotaShare: 0.08, closedShare: 0.07, start: "2026-02-01", ttmAttainment: 0.78 },
    { name: "Aisha Rahman", team: "Growth", quotaShare: 0.08, closedShare: 0.06, start: "2025-11-01", ttmAttainment: 0.58 },
  ];
  const OWNERS = REPS.map((r) => r.name);
  const repOf = (name) => REPS.find((r) => r.name === name);
  const inPeriodOf = (c) => (d) => d.closeDate >= c.periodStart && d.closeDate <= c.periodEnd;
  const PLAN = { rates: { "New Business": 0.10, "Expansion": 0.08, "Renewal Uplift": 0.05 }, accelerator: 1.5, closedRate: 0.09, managerOverride: 0.02 };

  // Seeded PRNG (mulberry32) so the made-up data is identical on every load.
  function rng(seed) {
    return function () {
      seed |= 0; seed = (seed + 0x6d2b79f5) | 0;
      let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }

  function randomDiscount(r) {
    const x = r();
    if (x < 0.55) return Math.round(r() * 10) / 100;
    if (x < 0.85) return Math.round(11 + r() * 9) / 100;
    if (x < 0.97) return Math.round(21 + r() * 9) / 100;
    return Math.round(31 + r() * 7) / 100;
  }

  // ---------- Open pipeline (mostly tidy, a few things slightly off) ----------
  function generateDeals(asOf, seed = 41) {
    const r = rng(seed);
    const pick = (arr) => arr[Math.floor(r() * arr.length)];
    const prefixes = ["Halcyon", "Brightwater", "Kestrel", "Oakmere", "Lumen", "Tidewell", "Corvid",
      "Ashby", "Pellam", "Greystone", "Marlowe", "Quillon", "Redfern", "Sablewood", "Vantor", "Wexley", "Thornbury",
      "Calder", "Ferrous", "Harrow", "Juniper", "Linnet", "Mosscroft"];
    const suffixes = ["Logistics", "Health", "Capital", "Retail", "Energy", "Insurance", "Foods", "Group", "Labs", "Freight"];
    const types = ["New Business", "New Business", "Expansion", "Renewal Uplift"];
    const steps = ["Exec sponsor call", "Send revised proposal", "Security review", "Pricing sign-off", "Technical demo", "Legal redlines", "Mutual action plan review"];
    const terms = ["Net 90 payment terms", "Custom liability cap", "Three-year price lock"];
    // Deal size by segment; the Growth team is deliberately less disciplined so the demo has a weak spot to find.
    const SIZE = { Enterprise: [60, 220], "Mid-Market": [30, 120], Growth: [10, 55] };
    const RISK = { Enterprise: 1, "Mid-Market": 1, Growth: 2.6 };
    const deals = [];
    for (let i = 0; i < 66; i++) {
      const owner = OWNERS[i % OWNERS.length], team = repOf(owner).team, k = RISK[team], [lo, hi] = SIZE[team];
      const si = Math.floor(r() * 5), stage = STAGES[si];
      const amount = Math.round((lo + r() * (hi - lo)) * 1000 / 500) * 500;
      const close = addDays(asOf, Math.floor(-6 + r() * 100));
      const quiet = r() < 0.05 * k ? 15 + Math.floor(r() * 12) : Math.floor(r() * 11);
      const age = r() < 0.07 * k ? stage.maxAge + 1 + Math.floor(r() * 12) : Math.floor(r() * (stage.maxAge - 2));
      let fc = pick(stage.allowed); if (r() < 0.02 * k) fc = "Commit";
      const discount = randomDiscount(r);
      const late = si >= 3;
      const ax = r();
      const approval = discount <= 0.10 ? "Not needed" : late ? (ax < 0.6 ? "Approved" : ax < 0.9 ? "Pending" : "Not submitted") : (ax < 0.2 ? "Approved" : "Not submitted");
      const req = MEDDPICC_REQ[stage.name];
      const meddpicc = req.map((q) => { const x = r(); if (q > 0 && x < 0.07 * k) return q - 1; if (x > 0.75) return Math.min(2, q + 1); return q; });
      deals.push({
        id: "OPP-" + (1040 + i), account: pick(prefixes) + " " + pick(suffixes), type: pick(types), owner, team,
        stage: stage.name, amount, closeDate: close, lastActivity: addDays(asOf, -quiet), stageEntered: addDays(asOf, -age),
        nextStep: r() < 0.03 * k ? "" : pick(steps), forecastCategory: fc,
        pushCount: r() < 0.06 * k ? 2 : (r() < 0.3 ? 1 : 0),
        discount, approval, nonStandard: late && r() < 0.12 ? pick(terms) : "", meddpicc,
      });
    }
    // One mild, deliberate example of each issue so every rule shows up in the demo.
    deals[3].closeDate = addDays(asOf, -3);
    deals[7].nextStep = "";
    deals[11].lastActivity = addDays(asOf, -18);
    deals[15].amount = 0;
    Object.assign(deals[19], { stage: "Qualification", forecastCategory: "Commit", stageEntered: addDays(asOf, -9), meddpicc: MEDDPICC_REQ.Qualification.slice() });
    deals[23].pushCount = 2;
    deals[27].stageEntered = addDays(asOf, -(stageOf(deals[27].stage).maxAge + 4));
    return deals;
  }

  // ---------- Hygiene ----------
  const RULES = [
    { id: "pastClose", label: "Close date in the past", weight: 3,
      test: (d, c) => (d.closeDate < c.asOf ? daysBetween(d.closeDate, c.asOf) + " days overdue" : null) },
    { id: "noNextStep", label: "No next step", weight: 2, test: (d) => (d.nextStep === null ? null : !d.nextStep || !d.nextStep.trim() ? "Blank" : null) },
    { id: "stale", label: "No recent activity", weight: 2,
      test: (d, c) => { if (!d.lastActivity) return null; const g = daysBetween(d.lastActivity, c.asOf); return g > c.staleDays ? g + " days quiet" : null; } },
    { id: "noAmount", label: "Missing amount", weight: 3, test: (d) => (!d.amount || d.amount <= 0 ? "£0" : null) },
    { id: "categoryMismatch", label: "Forecast category doesn't fit stage", weight: 2,
      test: (d) => { const s = stageOf(d.stage); return s && !s.allowed.includes(d.forecastCategory) ? d.forecastCategory + " at " + d.stage : null; } },
    { id: "pushed", label: "Close date pushed 2+ times", weight: 1, test: (d) => (d.pushCount >= 2 ? "Pushed " + d.pushCount + "x" : null) },
    { id: "stuck", label: "Stuck in stage", weight: 1,
      test: (d, c) => { if (!d.stageEntered) return null; const s = stageOf(d.stage); const age = daysBetween(d.stageEntered, c.asOf); return s && age > s.maxAge ? age + " days in " + d.stage : null; } },
  ];
  const MAX_WEIGHT = RULES.reduce((a, r) => a + r.weight, 0);

  function checkDeal(deal, ctx) {
    const flags = [];
    for (const rule of RULES) {
      const reason = rule.test(deal, ctx);
      if (reason) flags.push({ id: rule.id, label: rule.label, reason, weight: rule.weight });
    }
    const penalty = flags.reduce((a, f) => a + f.weight, 0);
    return { ...deal, flags, penalty, health: Math.round(100 * (1 - penalty / MAX_WEIGHT)) };
  }

  // ---------- Next steps ----------
  const STUCK_ACTION = {
    Discovery: "Confirm the pain and one measurable outcome this week, or disqualify.",
    Qualification: "Name the champion and a route to the economic buyer, or disqualify.",
    Solution: "Get the decision criteria in writing and book the technical win.",
    Proposal: "Take the proposal to the economic buyer and agree a mutual action plan.",
    Negotiation: "Escalate open redlines through deal desk and fix a signing date.",
  };
  const PLAYBOOK = {
    pastClose: () => "Agree a realistic close date with the buyer and update the record. If they can't name one, move it to Best Case.",
    noNextStep: () => "Book the next meeting with the buyer and log it as a dated next step.",
    stale: (d, c) => daysBetween(d.lastActivity, c.asOf) > 30
      ? "Manager review: is this still live? Close-lose it if the buyer doesn't respond this week."
      : "Re-engage the champion with a short note tied to their pain. No reply in 5 days: go to a second contact.",
    noAmount: () => "Add an amount from the scoped proposal or a comparable deal. It counts as £0 in coverage until then.",
    categoryMismatch: (d) => `Move the forecast category to ${stageOf(d.stage).allowed.slice(0, 2).join(" or ")}, or advance the stage once the evidence is there.`,
    pushed: () => "Walk the buyer through a close plan with dates for legal, security and signature. A third push means it belongs in next quarter.",
    stuck: (d) => STUCK_ACTION[d.stage],
  };
  const PRI = { High: 3, Medium: 2, Low: 1 };

  function meddpiccGaps(deal) {
    if (!deal.meddpicc) return [];
    const req = MEDDPICC_REQ[deal.stage] || [];
    return MEDDPICC.map((m, i) => ({ ...m, i, have: deal.meddpicc ? deal.meddpicc[i] : 0, need: req[i] || 0 })).filter((g) => g.have < g.need);
  }

  function dealDesk(deal) {
    const si = stageIndex(deal.stage);
    const disc = deal.discount || 0;
    const needsApproval = disc > 0.10 || !!deal.nonStandard;
    const approver = deal.nonStandard && disc <= 0.20 ? "Deal desk" : approverFor(disc);
    let action = null;
    if (needsApproval && si >= 3 && deal.approval !== "Approved") {
      const what = [disc > 0.10 ? Math.round(disc * 100) + "% discount" : "", deal.nonStandard].filter(Boolean).join(" and ");
      action = deal.approval === "Pending"
        ? { priority: si === 4 ? "High" : "Medium", text: `Chase ${approver} sign-off on the ${what} before the order form goes out.` }
        : { priority: "High", text: `Submit to deal desk now: the ${what} needs ${approver} sign-off.` };
    }
    return { needsApproval, approver, inQueue: !!action, action };
  }

  function nextSteps(deal, ctx) {
    const d = deal.flags ? deal : checkDeal(deal, ctx);
    const si = stageIndex(d.stage);
    const out = d.flags.map((f) => ({ priority: f.weight >= 3 ? "High" : f.weight === 2 ? "Medium" : "Low", source: f.label, text: PLAYBOOK[f.id](d, ctx) }));
    for (const g of meddpiccGaps(d)) out.push({ priority: si >= 3 ? "High" : si === 2 ? "Medium" : "Low", source: "MEDDPICC: " + g.name, text: g.action });
    const dd = dealDesk(d);
    if (dd.action) out.push({ priority: dd.action.priority, source: "Deal desk", text: dd.action.text });
    return out.sort((a, b) => PRI[b.priority] - PRI[a.priority]);
  }

  function hygieneReport(deals, ctx) {
    const checked = deals.map((d) => { const c = checkDeal(d, ctx); return { ...c, steps: nextSteps(c, ctx) }; });
    const clean = checked.filter((d) => d.flags.length === 0);
    const byRule = RULES.map((r) => {
      const hit = checked.filter((d) => d.flags.some((f) => f.id === r.id));
      return { id: r.id, label: r.label, weight: r.weight, count: hit.length, value: sum(hit, (d) => d.amount || 0) };
    });
    const totalValue = sum(checked, (d) => d.amount || 0), cleanValue = sum(clean, (d) => d.amount || 0);
    const owners = {};
    for (const d of checked) {
      const o = (owners[d.owner] ||= { owner: d.owner, deals: 0, flagged: 0, flags: 0 });
      o.deals++; if (d.flags.length) o.flagged++; o.flags += d.flags.length;
    }
    const actions = [];
    for (const d of checked) for (const s of d.steps) actions.push({ ...s, dealId: d.id, account: d.account, owner: d.owner, stage: d.stage, amount: d.amount, score: PRI[s.priority] * Math.max(d.amount || 0, 20000) });
    actions.sort((a, b) => b.score - a.score);
    return {
      deals: checked, total: checked.length, cleanCount: clean.length, cleanRate: checked.length ? clean.length / checked.length : 1,
      totalValue, cleanValue, cleanValueRate: totalValue ? cleanValue / totalValue : 1, byRule,
      byOwner: Object.values(owners).sort((a, b) => b.flagged / b.deals - a.flagged / a.deals), actions,
    };
  }

  // ---------- Coverage ----------
  function coverage(deals, ctx) {
    const { asOf, periodStart, periodEnd, quota, closedWon, winRate } = ctx;
    const inPeriod = deals.filter((d) => d.closeDate >= periodStart && d.closeDate <= periodEnd);
    const remaining = Math.max(0, quota - closedWon);
    const raw = sum(inPeriod, (d) => d.amount || 0);
    const weighted = sum(inPeriod, (d) => (d.amount || 0) * (stageOf(d.stage)?.prob || 0));
    const clean = sum(inPeriod.map((d) => checkDeal(d, ctx)).filter((d) => d.flags.length === 0), (d) => d.amount);
    const ratio = (x) => (remaining > 0 ? x / remaining : Infinity);
    const required = winRate > 0 ? 1 / winRate : Infinity;
    const byCat = {};
    for (const d of inPeriod) byCat[d.forecastCategory] = (byCat[d.forecastCategory] || 0) + (d.amount || 0);
    return {
      inPeriodCount: inPeriod.length, outOfPeriodCount: deals.length - inPeriod.length,
      remaining, raw, weighted, clean, rawCoverage: ratio(raw), cleanCoverage: ratio(clean), weightedCoverage: ratio(weighted),
      required, pipelineNeeded: remaining * required, gap: Math.max(0, remaining * required - raw), cleanGap: Math.max(0, remaining * required - clean),
      attainmentToDate: quota > 0 ? closedWon / quota : 0, byCategory: byCat, daysLeft: Math.max(0, daysBetween(asOf, periodEnd)),
      verdict: verdictFor(ratio(raw), ratio(clean), required),
    };
  }
  function verdictFor(raw, clean, required) {
    if (!isFinite(raw)) return { level: "good", text: "Quota already met." };
    if (clean >= required) return { level: "good", text: "Covered, even after removing flagged deals." };
    if (raw >= required) return { level: "warn", text: "Covered on paper, but not once flagged deals are removed." };
    return { level: "bad", text: "Not enough pipeline to hit the number at this win rate." };
  }

  // ---------- Commission ----------
  // The part of a deal that fits under remaining quota pays the base rate; the part above pays rate × accelerator.
  function dealCommission(amount, rate, quota, attained, accel) {
    const room = Math.max(0, quota - attained);
    const base = Math.min(amount, room), over = amount - base;
    return base * rate + over * rate * accel;
  }

  function commissionReport(deals, ctx, plan = PLAN) {
    const inP = (d) => d.closeDate >= ctx.periodStart && d.closeDate <= ctx.periodEnd;
    const byDeal = {};
    const reps = OWNERS.map((owner) => {
      const rep = repOf(owner), quota = ctx.quota * rep.quotaShare;
      const closed = ctx.closedWon * rep.closedShare;
      const earned = dealCommission(closed, plan.closedRate, quota, 0, plan.accelerator);
      const mine = deals.filter((d) => d.owner === owner);
      const inQ = mine.filter(inP).sort((a, b) => (a.closeDate < b.closeDate ? -1 : 1));
      let run = closed, potential = 0;
      for (const d of inQ) { potential += dealCommission(d.amount || 0, plan.rates[d.type], quota, run, plan.accelerator); run += d.amount || 0; }
      let expected = 0, atRisk = 0, expBook = 0;
      for (const d of mine) {
        const rate = plan.rates[d.type], inPeriod = inP(d);
        const ifWon = inPeriod ? dealCommission(d.amount || 0, rate, quota, closed, plan.accelerator) : (d.amount || 0) * rate;
        const prob = stageOf(d.stage).prob, flagged = checkDeal(d, ctx).flags.length > 0;
        byDeal[d.id] = { ifWon, expected: ifWon * prob, rate, inPeriod, flagged, accelerated: inPeriod && closed + (d.amount || 0) > quota };
        if (inPeriod) { expected += ifWon * prob; expBook += (d.amount || 0) * prob; if (flagged) atRisk += ifWon; }
      }
      return { owner, team: rep.team, quota, closed, attainment: quota ? closed / quota : 0, earned, potential, expected, atRisk,
        toAccelerator: Math.max(0, quota - closed), expectedBookings: expBook, pipeline: sum(inQ, (d) => d.amount || 0), dealCount: inQ.length };
    });
    return { reps, byDeal, plan, totals: { earned: sum(reps, (r) => r.earned), potential: sum(reps, (r) => r.potential), expected: sum(reps, (r) => r.expected), atRisk: sum(reps, (r) => r.atRisk) } };
  }

  // ---------- History (11 complete quarters, Q1 FY24 to Q3 FY26) ----------
  const qLabel = (i) => "Q" + ((i % 4) + 1) + " FY" + (24 + Math.floor(i / 4));
  const NQ = 11;

  function generateHistory(seed = 7) {
    const r = rng(seed);
    const quarters = [];
    let arr = 12.0e6;
    for (let i = 0; i < NQ; i++) {
      const start = arr;
      const newArr = 0.55e6 * (1 + 0.035 * i) * (0.9 + 0.2 * r());
      const expansion = 0.6e6 * (1 + 0.04 * i) * (0.9 + 0.2 * r());
      const contraction = start * 0.012 * (0.8 + 0.4 * r());
      const churn = start * 0.024 * (1 - 0.025 * i) * (0.85 + 0.3 * r());
      const end = start + newArr + expansion - contraction - churn;
      const bookings = newArr + expansion;
      const renewDue = start * 0.25 * (0.95 + 0.1 * r());
      const renewActual = renewDue - contraction - churn;
      quarters.push({
        label: qLabel(i), start, newArr, expansion, contraction, churn, end, bookings,
        revenue: (start + end) / 2 / 4, gm: 0.75 + 0.004 * i + 0.01 * r(), sm: 1.25e6 * (1 + 0.012 * i) * (0.96 + 0.08 * r()),
        fcfMargin: -0.12 + 0.019 * i + 0.02 * (r() - 0.5),
        forecast: bookings * (1 + (r() - 0.62) * 0.22),
        renewDue, renewActual, renewForecast: renewActual * (1 + (r() - 0.5) * 0.08),
      });
      arr = end;
    }
    const cohorts = [];
    for (let c = 0; c < NQ; c++) {
      const logos = 28 + Math.floor(r() * 16), ret = [1];
      let alive = 1;
      for (let a = 1; a <= NQ - 1 - c; a++) { alive *= 1 - 0.05 * (1 - 0.03 * c) * (a === 1 ? 1.5 : 1) * (0.7 + 0.6 * r()); ret.push(alive); }
      cohorts.push({ label: qLabel(c), logos, ret });
    }
    return { quarters, cohorts };
  }

  // Closed opportunities Q1 FY25 to Q3 FY26, used for funnel, win rate, cycle and time in stage.
  function generateOppHistory(seed = 11) {
    const r = rng(seed);
    const conv = [0.62, 0.66, 0.74, 0.78, 0.80], days = [14, 22, 26, 18, 16];
    const types = ["New Business", "New Business", "Expansion", "Renewal Uplift"];
    const opps = [];
    for (let n = 0; n < 900; n++) {
      const qi = 2 + Math.floor(r() * 9);
      const amount = Math.round((12 + r() * 140) * 1000 / 500) * 500;
      const discount = randomDiscount(r);
      const stageDays = [];
      let reached = 0, won = false;
      for (let s = 0; s < 5; s++) {
        stageDays.push(Math.max(2, Math.round(days[s] * (0.5 + r()))));
        let p = conv[s] + 0.01 * (qi - 4);
        if (s >= 3 && discount > 0.20) p -= 0.12;
        if (r() >= p) break;
        if (s === 4) won = true; else reached = s + 1;
      }
      const cycle = sum(stageDays);
      const closeQi = qi + Math.floor((r() * 91 + cycle) / 91);
      if (closeQi >= NQ) continue;
      opps.push({ qi, closeQi, amount, type: types[Math.floor(r() * 4)], discount, reached, stageDays, won, cycle });
    }
    return opps;
  }

  // ---------- SaaS metrics ----------
  // TTM retention uses ARR four quarters back as the base. Expansion from logos won inside the window is included (a common simplification).
  function saasMetrics(hist) {
    const q = hist.quarters;
    return q.map((x, i) => {
      const o = { label: x.label, arr: x.end, netNew: x.end - x.start, bookings: x.bookings, newArr: x.newArr, expansion: x.expansion, contraction: x.contraction, churn: x.churn };
      if (i >= 3) {
        const w = q.slice(i - 3, i + 1), base = q[i - 3].start;
        const exp = sum(w, (y) => y.expansion), loss = sum(w, (y) => y.contraction + y.churn);
        o.grr = Math.min(1, (base - loss) / base);
        o.nrr = (base + exp - loss) / base;
        o.expansionPerMonth = exp / 12;
        o.expansionRate = exp / base;
      }
      o.expansionQoQ = i ? x.expansion / q[i - 1].expansion - 1 : null;
      if (i >= 1) {
        o.magic = o.netNew / q[i - 1].sm;
        o.payback = q[i - 1].sm / (o.netNew * x.gm / 12);
      }
      if (i >= 4) { o.revGrowth = x.revenue / q[i - 4].revenue - 1; o.ruleOf40 = o.revGrowth + x.fcfMargin; }
      o.fcfMargin = x.fcfMargin; o.sm = x.sm; o.gm = x.gm; o.revenue = x.revenue;
      o.forecast = x.forecast; o.forecastAcc = 1 - Math.abs(x.bookings - x.forecast) / x.bookings; o.forecastBias = (x.forecast - x.bookings) / x.bookings;
      o.renewDue = x.renewDue; o.renewActual = x.renewActual; o.renewForecast = x.renewForecast;
      o.renewAcc = 1 - Math.abs(x.renewActual - x.renewForecast) / x.renewActual;
      return o;
    });
  }

  function funnel(opps) {
    const reached = STAGES.map((_, s) => opps.filter((o) => o.reached >= s).length);
    const won = opps.filter((o) => o.won).length;
    return STAGES.map((st, s) => ({ stage: st.name, count: reached[s], next: s < 4 ? reached[s + 1] : won, conversion: reached[s] ? (s < 4 ? reached[s + 1] : won) / reached[s] : 0, nextLabel: s < 4 ? STAGES[s + 1].name : "Won" }));
  }

  function timeInStage(opps, deals, asOf) {
    return STAGES.map((st, s) => {
      const hist = opps.filter((o) => o.stageDays.length > s).map((o) => o.stageDays[s]);
      const open = deals ? deals.filter((d) => d.stage === st.name).map((d) => daysBetween(d.stageEntered, asOf)) : [];
      return { stage: st.name, avg: hist.length ? sum(hist) / hist.length : 0, median: median(hist), openAvg: open.length ? sum(open) / open.length : null, openCount: open.length, limit: st.maxAge };
    });
  }

  // Win rate = won ÷ (won + lost) for deals that reached Qualification, i.e. excluding early disqualification.
  function winRates(opps) {
    const out = [];
    for (let qi = 4; qi < NQ; qi++) {
      const closed = opps.filter((o) => o.closeQi === qi && o.reached >= 1);
      const won = closed.filter((o) => o.won);
      out.push({ label: qLabel(qi), closed: closed.length, won: won.length, rate: closed.length ? won.length / closed.length : 0,
        valueRate: sum(closed, (o) => o.amount) ? sum(won, (o) => o.amount) / sum(closed, (o) => o.amount) : 0,
        cycleMedian: median(won.map((o) => o.cycle)), avgWon: won.length ? sum(won, (o) => o.amount) / won.length : 0 });
    }
    return out;
  }

  function ttmWinRate(opps) {
    const closed = opps.filter((o) => o.closeQi >= NQ - 4 && o.reached >= 1);
    return closed.length ? closed.filter((o) => o.won).length / closed.length : 0;
  }
  function ttmCycle(opps) { return median(opps.filter((o) => o.closeQi >= NQ - 4 && o.won).map((o) => o.cycle)); }

  function discountBands(opps) {
    const bands = [[0, 0.10, "0–10%"], [0.10, 0.20, "11–20%"], [0.20, 0.30, "21–30%"], [0.30, 1, "Over 30%"]];
    return bands.map(([lo, hi, label]) => {
      const c = opps.filter((o) => o.reached >= 3 && o.discount > lo - 1e-9 && o.discount <= hi + 1e-9 && !(lo > 0 && o.discount <= lo + 1e-9));
      const w = c.filter((o) => o.won).length;
      return { label, deals: c.length, winRate: c.length ? w / c.length : 0 };
    });
  }

  // Pipeline velocity: £ of bookings the open pipeline produces per day.
  function pipelineVelocity(deals, winRate, cycleDays) {
    const q = deals.filter((d) => stageIndex(d.stage) >= 1 && d.amount > 0);
    const avg = q.length ? sum(q, (d) => d.amount) / q.length : 0;
    return { opps: q.length, avgDeal: avg, winRate, cycleDays, perDay: cycleDays > 0 ? (q.length * avg * winRate) / cycleDays : 0 };
  }

  function meddpiccByStage(deals) {
    return STAGES.map((st) => {
      const ds = deals.filter((d) => d.stage === st.name);
      const scores = MEDDPICC.map((_, i) => (ds.length ? sum(ds, (d) => d.meddpicc[i]) / ds.length : 0));
      const complete = ds.length ? sum(ds, (d) => sum(d.meddpicc)) / (ds.length * 16) : 0;
      const gapDeals = ds.filter((d) => meddpiccGaps(d).length > 0).length;
      return { stage: st.name, deals: ds.length, scores, complete, gapDeals };
    });
  }

  // ---------- Trend and projection (least squares with a 95% prediction band) ----------
  const T95 = [0, 12.71, 4.30, 3.18, 2.78, 2.57, 2.45, 2.36, 2.31, 2.26, 2.23];
  function linearTrend(ys, ahead = 4) {
    const n = ys.length, xs = ys.map((_, i) => i);
    const mx = sum(xs) / n, my = sum(ys) / n;
    const sxx = sum(xs, (x) => (x - mx) ** 2), sxy = sum(xs, (x) => (x - mx) * (ys[x] - my));
    const slope = sxx ? sxy / sxx : 0, intercept = my - slope * mx;
    const fit = xs.map((x) => intercept + slope * x);
    const ssr = sum(ys, (y, i) => (y - fit[i]) ** 2), sst = sum(ys, (y) => (y - my) ** 2);
    const se = n > 2 ? Math.sqrt(ssr / (n - 2)) : 0;
    const t = T95[n - 2] || 2.0;
    const projection = [];
    for (let k = 0; k < ahead; k++) {
      const x = n + k, y = intercept + slope * x;
      const half = t * se * Math.sqrt(1 + 1 / n + (sxx ? (x - mx) ** 2 / sxx : 0));
      projection.push({ x, y, lo: y - half, hi: y + half });
    }
    return { slope, intercept, fit, r2: sst ? 1 - ssr / sst : 1, se, projection };
  }

  // ---------- Benchmarks (common rules of thumb, not laws) ----------
  const BENCH = {
    nrr: { good: 1.10, ok: 1.00, up: true }, grr: { good: 0.90, ok: 0.85, up: true }, payback: { good: 18, ok: 30, up: false },
    magic: { good: 0.75, ok: 0.50, up: true }, ruleOf40: { good: 0.40, ok: 0.25, up: true }, winRate: { good: 0.30, ok: 0.20, up: true },
    forecastAcc: { good: 0.95, ok: 0.90, up: true }, renewAcc: { good: 0.97, ok: 0.93, up: true },
  };
  function rate(key, v) {
    const b = BENCH[key]; if (!b || v == null || !isFinite(v)) return "warn";
    if (b.up) return v >= b.good ? "good" : v >= b.ok ? "warn" : "bad";
    return v <= b.good ? "good" : v <= b.ok ? "warn" : "bad";
  }

  // ---------- Landing forecast ----------
  // Category conversion rates; flagged deals are halved. Floor <= likely <= stretch by construction.
  const CAT_RATE = { Commit: 0.85, "Best Case": 0.45, Pipeline: 0.15, Omitted: 0 };
  function landing(deals, ctx) {
    const R = ctx.catRates || CAT_RATE;
    let floor = 0, likely = 0, stretch = 0;
    for (const d of deals.filter(inPeriodOf(ctx)).map((x) => checkDeal(x, ctx))) {
      const a = d.amount || 0, flagged = d.flags.length > 0, rate = R[d.forecastCategory] || 0;
      if (d.forecastCategory === "Commit" && !flagged) floor += a * R.Commit;
      likely += a * rate * (flagged ? 0.5 : 1);
      stretch += d.forecastCategory === "Commit" || d.forecastCategory === "Best Case" ? a : a * rate;
    }
    const c = ctx.closedWon, q = ctx.quota;
    return { closed: c, floor: c + floor, likely: c + likely, stretch: c + stretch, quota: q,
      floorPct: q ? (c + floor) / q : 0, likelyPct: q ? (c + likely) / q : 0, stretchPct: q ? (c + stretch) / q : 0 };
  }

  // ---------- Pipeline confidence (0-100) ----------
  function confidence(deals, ctx, forecastAcc) {
    const clamp = (v) => Math.max(0, Math.min(1, v));
    const cv = coverage(deals, ctx), ld = landing(deals, ctx);
    const inQ = deals.filter(inPeriodOf(ctx)).map((d) => checkDeal(d, ctx));
    const val = sum(inQ, (d) => d.amount || 0), cleanVal = sum(inQ.filter((d) => !d.flags.length), (d) => d.amount || 0);
    const late = inQ.filter((d) => d.forecastCategory === "Commit" || d.forecastCategory === "Best Case");
    const lateVal = sum(late, (d) => d.amount || 0), evVal = sum(late.filter((d) => meddpiccGaps(d).length === 0), (d) => d.amount || 0);
    const rem = cv.remaining;
    const parts = [
      { key: "coverage", label: "Clean coverage against what's needed", weight: 30, value: rem > 0 ? clamp(cv.cleanCoverage / cv.required) : 1 },
      { key: "hygiene", label: "In-quarter value with no hygiene issues", weight: 20, value: val ? cleanVal / val : 0 },
      { key: "evidence", label: "Commit and Best Case value with full MEDDPICC", weight: 20, value: lateVal ? evVal / lateVal : 0 },
      { key: "track", label: "Forecast accuracy, last four quarters", weight: 15, value: clamp((forecastAcc - 0.8) / 0.2) },
      { key: "commit", label: "Quota still to find already in clean Commit", weight: 15, value: rem > 0 ? clamp((ld.floor - ld.closed) / rem) : 1 },
    ];
    const score = Math.round(sum(parts, (p) => p.weight * p.value));
    return { score, level: score >= 75 ? "High" : score >= 55 ? "Medium" : "Low", parts };
  }

  // ---------- Tenure ----------
  const RAMP_MONTHS = 9;
  function tenureMonths(start, asOf) {
    const a = new Date(start + "T00:00:00Z"), b = new Date(asOf + "T00:00:00Z");
    return (b.getUTCFullYear() - a.getUTCFullYear()) * 12 + (b.getUTCMonth() - a.getUTCMonth()) - (b.getUTCDate() < a.getUTCDate() ? 1 : 0);
  }
  // Expected attainment rises from 40% at hire to 100% at 12 months.
  const tenureExpectation = (m) => (m >= 12 ? 1 : Math.min(1, 0.4 + (m / 12) * 0.6));
  function repTenure(rep, asOf) {
    const months = tenureMonths(rep.start, asOf), expected = tenureExpectation(months), ratio = rep.ttmAttainment / expected;
    const verdict = ratio >= 1.1 ? "Ahead for tenure" : ratio >= 0.9 ? "In line for tenure" : "Behind for tenure";
    return { months, expected, ratio, verdict, level: ratio >= 1.1 ? "good" : ratio >= 0.9 ? "warn" : "bad", ramping: months < RAMP_MONTHS };
  }

  // ---------- Teams ----------
  function teamReport(deals, ctx) {
    return TEAMS.map((t) => {
      const reps = REPS.filter((r) => r.team === t.name);
      const quota = ctx.quota * sum(reps, (r) => r.quotaShare), closed = ctx.closedWon * sum(reps, (r) => r.closedShare);
      const td = deals.filter((d) => repOf(d.owner).team === t.name);
      const tctx = { ...ctx, quota, closedWon: closed };
      const cv = coverage(td, tctx), ld = landing(td, tctx);
      const checked = td.map((d) => checkDeal(d, ctx));
      const cleanRate = checked.length ? checked.filter((d) => !d.flags.length).length / checked.length : 1;
      const gapDeals = td.filter((d) => stageIndex(d.stage) >= 2 && meddpiccGaps(d).length).length;
      const highActions = sum(checked, (d) => nextSteps(d, ctx).filter((s) => s.priority === "High").length);
      const people = reps.map((r) => ({ ...r, ...repTenure(r, ctx.asOf), q4Attainment: quota ? (ctx.closedWon * r.closedShare) / (ctx.quota * r.quotaShare) : 0 }));
      const behind = people.filter((r) => r.level === "bad");
      const flags = [];
      if (ld.likelyPct < 0.9) flags.push({ key: "land", text: "Likely to land at " + Math.round(ld.likelyPct * 100) + "% of quota" });
      if (cv.remaining > 0 && cv.cleanCoverage < cv.required) flags.push({ key: "coverage", text: "Clean coverage " + cv.cleanCoverage.toFixed(1) + "x against " + cv.required.toFixed(1) + "x needed" });
      if (cleanRate < 0.6) flags.push({ key: "hygiene", text: "Only " + Math.round(cleanRate * 100) + "% of deals free of hygiene issues" });
      if (behind.length >= 2) flags.push({ key: "tenure", text: behind.length + " of " + people.length + " reps behind for tenure" });
      return { ...t, reps: people, quota, closed, attainment: quota ? closed / quota : 0, coverage: cv, landing: ld, cleanRate, gapDeals, highActions,
        flags, status: flags.length >= 3 ? "bad" : flags.length ? "warn" : "good", dealCount: td.length, pipeline: cv.raw };
    });
  }

  // ---------- Cohorts ----------
  // Logo-weighted average retention at each age, using only cohorts old enough to have reached it.
  function cohortSummary(cohorts) {
    const maxAge = Math.max(...cohorts.map((c) => c.ret.length)) - 1, out = [];
    for (let a = 0; a <= maxAge; a++) {
      const cs = cohorts.filter((c) => c.ret.length > a), w = sum(cs, (c) => c.logos);
      out.push({ age: a, retained: w ? sum(cs, (c) => c.logos * c.ret[a]) / w : null, cohorts: cs.length, logos: w });
    }
    return out;
  }

  // ---------- Marketing: SDRs, MQLs and deal sources ----------
  const SDRS = [
    { name: "Ella Thompson", team: "Enterprise", start: "2025-03-01", touch: [2, 12] },
    { name: "Jacob Reid", team: "Mid-Market", start: "2024-09-01", touch: [1, 9] },
    { name: "Maya Patel", team: "Growth", start: "2025-10-01", touch: [3, 26] },
    { name: "Noah Fletcher", team: "Growth", start: "2026-06-01", touch: [8, 60] },
  ];
  const CHANNELS = [
    { name: "Demo request", spend: 38000 }, { name: "Webinar", spend: 24000 }, { name: "Paid search", spend: 52000 },
    { name: "Content download", spend: 30000 }, { name: "Events", spend: 46000 }, { name: "Partner referral", spend: 12000 },
  ];
  // Channel mix differs by outcome, so channels genuinely differ in quality.
  const CH_WEIGHTS = { sql: [6, 3, 2, 1, 3, 2], dq: [1, 2, 4, 6, 2, 1], rec: [1, 3, 2, 4, 3, 1], open: [2, 2, 3, 3, 2, 1] };
  const DQ_REASONS = ["Too small or wrong fit", "Competitor or student", "Duplicate record", "No budget", "Bad contact data"];
  const RECYCLE_REASONS = ["Timing: not this year", "No response after six touches", "Budget next financial year", "Early research only"];
  const REJECT_REASONS = ["No active project", "Already in an open deal"];
  const SOURCES = ["Marketing", "SDR outbound", "AE self-sourced", "Partner"];
  const LEAD_START = "2026-07-01";
  const SEG_SIZE = { Enterprise: [60, 220], "Mid-Market": [30, 120], Growth: [10, 55] };

  // Adds source and SDR to each deal using its own seed, so existing deal data is untouched.
  function attributeDeals(deals, seed = 23) {
    const r = rng(seed);
    return deals.map((d) => {
      const team = repOf(d.owner).team, x = r();
      const mkt = team === "Growth" ? 0.55 : team === "Mid-Market" ? 0.42 : 0.3;
      const source = x < mkt ? "Marketing" : x < mkt + 0.18 ? "SDR outbound" : x < mkt + 0.28 ? "Partner" : "AE self-sourced";
      const pool = SDRS.filter((s) => s.team === team), y = r();
      return { ...d, source, sdr: source === "Marketing" || source === "SDR outbound" ? pool[Math.floor(y * pool.length)].name : "" };
    });
  }

  function generateLeads(asOf, attributed, seed = 29) {
    const r = rng(seed);
    const span = daysBetween(LEAD_START, asOf);
    const leads = [];
    const wpick = (w) => { let x = r() * sum(w); for (let i = 0; i < w.length; i++) { x -= w[i]; if (x < 0) return CHANNELS[i].name; } return CHANNELS[w.length - 1].name; };
    const teamPick = () => { const x = r(); return x < 0.25 ? "Enterprise" : x < 0.55 ? "Mid-Market" : "Growth"; };
    const sdrFor = (team) => { const p = SDRS.filter((s) => s.team === team); return p[Math.floor(r() * p.length)].name; };
    const amt = (team) => { const [lo, hi] = SEG_SIZE[team]; return Math.round((lo + r() * (hi - lo)) * 1000 / 500) * 500; };
    const add = (o) => {
      const sdr = SDRS.find((s) => s.name === o.sdr);
      const firstTouchHours = o.status === "New" ? null : Math.round(sdr.touch[0] + r() * (sdr.touch[1] - sdr.touch[0]));
      leads.push({ id: "MQL-" + (5001 + leads.length), reason: "", dealId: "", amount: 0, oppStatus: "", ...o, firstTouchHours });
    };
    // 1. Open opportunities: one MQL per marketing-sourced open deal.
    for (const d of attributed.filter((x) => x.source === "Marketing")) {
      const room = Math.max(1, daysBetween(LEAD_START, d.stageEntered) - 3);
      add({ team: repOf(d.owner).team, sdr: d.sdr, channel: wpick(CH_WEIGHTS.sql), created: addDays(LEAD_START, Math.floor(r() * room)), status: "Opportunity", oppStatus: "Open", dealId: d.id, amount: d.amount });
    }
    // 2. Won and lost opportunities since 1 July.
    for (const [n, st] of [[14, "Won"], [12, "Lost"]]) for (let i = 0; i < n; i++) {
      const team = teamPick();
      add({ team, sdr: sdrFor(team), channel: wpick(CH_WEIGHTS.sql), created: addDays(LEAD_START, Math.floor(r() * (span - 30))), status: "Opportunity", oppStatus: st, amount: amt(team) });
    }
    // 3. SQLs the AE turned down.
    for (let i = 0; i < 9; i++) { const team = teamPick(); add({ team, sdr: sdrFor(team), channel: wpick(CH_WEIGHTS.sql), created: addDays(LEAD_START, Math.floor(r() * span)), status: "Rejected by AE", reason: REJECT_REASONS[Math.floor(r() * 2)] }); }
    // 4. Leads that never became SQLs. Growth gets more volume and more disqualification.
    for (let i = 0; i < 160; i++) {
      const team = teamPick(), x = r() - (team === "Growth" ? 0.08 : 0);
      const status = x < 0.40 ? "Disqualified" : x < 0.70 ? "Recycled" : x < 0.92 ? "Working" : "New";
      const w = { Disqualified: CH_WEIGHTS.dq, Recycled: CH_WEIGHTS.rec, Working: CH_WEIGHTS.open, New: CH_WEIGHTS.open }[status];
      const created = status === "New" ? addDays(asOf, -Math.floor(r() * 7)) : addDays(LEAD_START, Math.floor(r() * span));
      const reason = status === "Disqualified" ? DQ_REASONS[Math.floor(r() * DQ_REASONS.length)] : status === "Recycled" ? RECYCLE_REASONS[Math.floor(r() * RECYCLE_REASONS.length)] : "";
      add({ team, sdr: sdrFor(team), channel: wpick(w), created, status, reason });
    }
    return leads;
  }

  const isSAL = (l) => l.status !== "New";
  const isSQL = (l) => l.status === "Opportunity" || l.status === "Rejected by AE";
  const isOpp = (l) => l.status === "Opportunity";

  // What happened to pipeline that started as an MQL. Open deals split by the same rules as the landing forecast.
  function leadOutcomes(leads, dealsById, ctx) {
    const o = { landed: 0, likely: 0, atRisk: 0, lost: 0, expected: 0, total: 0 };
    for (const l of leads.filter(isOpp)) {
      if (l.oppStatus === "Won") { o.landed += l.amount; o.expected += l.amount; }
      else if (l.oppStatus === "Lost") o.lost += l.amount;
      else {
        const d = checkDeal(dealsById[l.dealId], ctx), a = d.amount || 0, flagged = d.flags.length > 0;
        if (!flagged && (d.forecastCategory === "Commit" || d.forecastCategory === "Best Case")) o.likely += a; else o.atRisk += a;
        o.expected += a * ((ctx.catRates || CAT_RATE)[d.forecastCategory] || 0) * (flagged ? 0.5 : 1);
      }
    }
    o.total = o.landed + o.likely + o.atRisk + o.lost;
    return o;
  }

  function marketingReport(leads, attributed, ctx) {
    const byId = Object.fromEntries(attributed.map((d) => [d.id, d]));
    const funnelOf = (ls) => {
      const c = { mql: ls.length, sal: ls.filter(isSAL).length, sql: ls.filter(isSQL).length, opp: ls.filter(isOpp).length, won: ls.filter((l) => l.oppStatus === "Won").length };
      return { ...c, salRate: c.mql ? c.sal / c.mql : 0, sqlRate: c.sal ? c.sql / c.sal : 0, oppRate: c.sql ? c.opp / c.sql : 0, winRate: c.opp ? c.won / c.opp : 0, mqlToSql: c.mql ? c.sql / c.mql : 0 };
    };
    const disp = (ls) => ({ disqualified: ls.filter((l) => l.status === "Disqualified").length, recycled: ls.filter((l) => l.status === "Recycled").length,
      working: ls.filter((l) => l.status === "Working").length, unworked: ls.filter((l) => l.status === "New").length, rejected: ls.filter((l) => l.status === "Rejected by AE").length,
      staleNew: ls.filter((l) => l.status === "New" && daysBetween(l.created, ctx.asOf) > 2).length });
    const reasons = (status) => { const m = {}; for (const l of leads.filter((x) => x.status === status)) m[l.reason] = (m[l.reason] || 0) + 1; return Object.entries(m).map(([reason, count]) => ({ reason, count })).sort((a, b) => b.count - a.count); };
    const touch = (ls) => median(ls.filter((l) => l.firstTouchHours != null).map((l) => l.firstTouchHours));
    const pipeOf = (ls) => sum(ls.filter(isOpp), (l) => (l.oppStatus === "Open" ? byId[l.dealId].amount || 0 : l.amount));
    const byTeam = TEAMS.map((t) => { const ls = leads.filter((l) => l.team === t.name); return { team: t.name, manager: t.manager, ...funnelOf(ls), ...disp(ls), outcomes: leadOutcomes(ls, byId, ctx), touchHours: touch(ls) }; });
    const bySdr = SDRS.map((s) => {
      const ls = leads.filter((l) => l.sdr === s.name), out = attributed.filter((d) => d.source === "SDR outbound" && d.sdr === s.name);
      return { sdr: s.name, team: s.team, start: s.start, ...funnelOf(ls), ...disp(ls), touchHours: touch(ls), pipeline: pipeOf(ls), wonValue: sum(ls.filter((l) => l.oppStatus === "Won"), (l) => l.amount),
        outboundOpps: out.length, outboundValue: sum(out, (d) => d.amount || 0) };
    });
    const byChannel = CHANNELS.map((c) => {
      const ls = leads.filter((l) => l.channel === c.name), f = funnelOf(ls), pipe = pipeOf(ls);
      return { channel: c.name, spend: c.spend, ...f, pipeline: pipe, wonValue: sum(ls.filter((l) => l.oppStatus === "Won"), (l) => l.amount),
        costPerMql: f.mql ? c.spend / f.mql : 0, costPerSql: f.sql ? c.spend / f.sql : null, pipelinePerPound: c.spend ? pipe / c.spend : 0 };
    });
    const total = sum(attributed, (d) => d.amount || 0);
    const bySource = SOURCES.map((src) => { const ds = attributed.filter((d) => d.source === src), v = sum(ds, (d) => d.amount || 0);
      return { source: src, deals: ds.length, value: v, share: total ? v / total : 0, inQuarter: sum(ds.filter(inPeriodOf(ctx)), (d) => d.amount || 0) }; });
    return { funnel: funnelOf(leads), disp: disp(leads), dqReasons: reasons("Disqualified"), recycleReasons: reasons("Recycled"), rejectReasons: reasons("Rejected by AE"),
      outcomes: leadOutcomes(leads, byId, ctx), byTeam, bySdr, byChannel, bySource, touchHours: touch(leads), pipeline: pipeOf(leads), spend: sum(CHANNELS, (c) => c.spend), since: LEAD_START };
  }

  // ---------- Win/loss, competitors and category calibration (own seed; history untouched) ----------
  const COMPETITORS = ["Rival A", "Rival B", "Rival C"];
  const LOSS_EARLY = ["No decision / stalled", "No budget", "Not a fit"];
  const LOSS_LATE = ["Price", "No decision / stalled", "Timing pushed out", "Champion left", "Product gap"];
  function enrichOpps(opps, seed = 31) {
    const r = rng(seed);
    return opps.map((o) => {
      const c = r(), comp = o.won ? (c < 0.22 ? "Rival A" : c < 0.42 ? "Rival B" : c < 0.60 ? "Rival C" : "")
                                  : (c < 0.38 ? "Rival A" : c < 0.58 ? "Rival B" : c < 0.66 ? "Rival C" : "");
      let lossReason = "";
      if (!o.won) {
        if (o.reached >= 2 && comp && r() < 0.5) lossReason = "Lost to competitor";
        else { const list = o.reached >= 2 ? LOSS_LATE : LOSS_EARLY; lossReason = list[Math.floor(r() * list.length)]; }
      }
      let category = "";
      if (o.reached >= 2) { const y = r(); category = o.won ? (y < 0.6 ? "Commit" : y < 0.9 ? "Best Case" : "Pipeline") : (y < 0.12 ? "Commit" : y < 0.45 ? "Best Case" : "Pipeline"); }
      return { ...o, competitor: comp, lossReason, category };
    });
  }
  function winLoss(opps) {
    const closed = opps.filter((o) => o.reached >= 1), lost = closed.filter((o) => !o.won);
    const m = {};
    for (const o of lost) { const k = o.lossReason; (m[k] ||= { reason: k, count: 0, value: 0, byStage: STAGES.map(() => 0) }); m[k].count++; m[k].value += o.amount; m[k].byStage[o.reached]++; }
    const reasons = Object.values(m).sort((a, b) => b.value - a.value);
    const comps = COMPETITORS.concat([""]).map((c) => {
      const cs = closed.filter((o) => o.competitor === c), w = cs.filter((o) => o.won);
      return { competitor: c || "No competitor identified", deals: cs.length, won: w.length, winRate: cs.length ? w.length / cs.length : 0,
        lostValue: sum(cs.filter((o) => !o.won), (o) => o.amount), lostToThem: cs.filter((o) => o.lossReason === "Lost to competitor").length };
    });
    return { closed: closed.length, lost: lost.length, lostValue: sum(lost, (o) => o.amount), reasons, competitors: comps,
      overallWinRate: closed.length ? closed.filter((o) => o.won).length / closed.length : 0 };
  }
  // Calibrated category rates: of history deals that sat in each category, how many were won.
  function calibrateRates(opps) {
    const out = { Omitted: 0 }, counts = {};
    for (const cat of ["Commit", "Best Case", "Pipeline"]) {
      const cs = opps.filter((o) => o.category === cat), w = cs.filter((o) => o.won).length;
      out[cat] = cs.length ? w / cs.length : CAT_RATE[cat]; counts[cat] = { deals: cs.length, won: w };
    }
    return { rates: out, counts };
  }

  // ---------- Scenario planner ----------
  // choices: id -> "won" (closes this quarter), "lost" (drops out), "pull" (next-quarter deal moved into this quarter at its normal rate).
  function scenario(deals, ctx, choices = {}) {
    const inP = inPeriodOf(ctx), adj = [], wonByRep = {};
    let won = 0;
    for (const d of deals) {
      const ch = choices[d.id];
      if (ch === "won") { won += d.amount || 0; (wonByRep[d.owner] ||= []).push(d); continue; }
      if (ch === "lost") continue;
      adj.push(ch === "pull" && !inP(d) ? { ...d, closeDate: ctx.periodEnd } : d);
    }
    const base = landing(deals, ctx), sc = landing(adj, { ...ctx, closedWon: ctx.closedWon + won });
    const reps = Object.entries(wonByRep).map(([owner, ds]) => {
      const rep = repOf(owner), quota = ctx.quota * rep.quotaShare, before = ctx.closedWon * rep.closedShare;
      let run = before, comm = 0;
      for (const d of ds) { comm += dealCommission(d.amount || 0, PLAN.rates[d.type] || 0.1, quota, run, PLAN.accelerator); run += d.amount || 0; }
      return { owner, team: rep.team, won: run - before, commission: comm, attainmentBefore: quota ? before / quota : 0, attainmentAfter: quota ? run / quota : 0 };
    });
    return { base, scenario: sc, wonValue: won, delta: sc.likely - base.likely, reps, commission: sum(reps, (r) => r.commission) };
  }

  // ---------- Capacity and hiring (FY27) ----------
  // Productive capacity ramps 0% for months 0-2, 33% for 3-5, 66% for 6-8, 100% from month 9.
  const rampFactor = (t) => (t < 3 ? 0 : t < 6 ? 0.33 : t < 9 ? 0.66 : 1);
  function capacityPlan(p) {
    const avgQuota = (p.quarterQuota * 4) / REPS.length;
    const monthDate = (m) => "2027-" + String(m + 1).padStart(2, "0") + "-15";
    const survive = (m) => Math.pow(1 - p.attrition, (m + 0.5) / 12);
    const perHireMonth = (m, startMonth) => { const t = m + 1 - startMonth; return t < 0 ? 0 : (avgQuota / 12) * rampFactor(t) * p.productivity * Math.pow(1 - p.attrition, (t + 0.5) / 12); };
    const run = (hires) => {
      const rows = [];
      for (let m = 0; m < 12; m++) {
        let existing = 0;
        for (const r of REPS) existing += ((p.quarterQuota * 4 * r.quotaShare) / 12) * rampFactor(tenureMonths(r.start, monthDate(m))) * p.productivity * survive(m);
        const hired = hires * perHireMonth(m, p.hireMonth);
        rows.push({ month: ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"][m] + " 27", existing, hired, total: existing + hired });
      }
      return rows;
    };
    const rows = run(p.hires), total = sum(rows, (x) => x.total), existing = sum(rows, (x) => x.existing);
    const perHire = sum(Array.from({ length: 12 }, (_, m) => perHireMonth(m, p.hireMonth)));
    let hiresNeeded = null;
    for (let h = 0; h <= 40; h++) if (sum(run(h), (x) => x.total) >= p.target) { hiresNeeded = h; break; }
    return { rows, existing, hired: total - existing, total, target: p.target, gap: p.target - total, perHire, hiresNeeded, avgQuota };
  }

  // ---------- Activity (last 30 days) ----------
  const ACT_FACTOR = {
    "Priya Shah": [1.05, 1.1, 1.2], "Marcus Bell": [0.9, 1, 1.05], "Daniel Osei": [1, 1, 1], "Tom Okafor": [1.1, 1, 1.1], "Elena Ruiz": [1, 1, 0.95],
    "Sofia Marin": [1.2, 1.1, 0.8], "Hannah Kerr": [0.8, 1.2, 0.6], "Liam Carter": [1, 1, 0.85], "Aisha Rahman": [0.55, 1.3, 0.55],
    "Ella Thompson": [1, 1, 1.05], "Jacob Reid": [1.1, 1, 1.1], "Maya Patel": [0.9, 1, 0.9], "Noah Fletcher": [0.6, 1.6, 0.6],
  };
  function generateActivity(seed = 37) {
    const r = rng(seed), n = () => 0.92 + r() * 0.16;
    const reps = REPS.map((p) => { const [c, e, m] = ACT_FACTOR[p.name];
      return { name: p.name, team: p.team, calls: Math.round(120 * c * n()), emails: Math.round(260 * e * n()), meetings: Math.round(22 * m * n()), ttmAttainment: p.ttmAttainment }; });
    const sdrs = SDRS.map((p) => { const [c, e, m] = ACT_FACTOR[p.name], calls = Math.round(900 * c * n()), booked = Math.round(28 * m * n());
      return { name: p.name, team: p.team, calls, emails: Math.round(1400 * e * n()), connects: Math.round(calls * 0.085 * m * n()), booked, held: Math.round(booked * (0.7 + 0.12 * m) * n()) }; });
    return { reps, sdrs, days: 30 };
  }

  // ---------- Renewals and account health ----------
  function healthScore(a) {
    const drivers = [];
    const hit = (pts, why) => { drivers.push({ pts, why }); };
    if (a.usageTrend < -0.2) hit(30, "Usage down " + Math.round(-a.usageTrend * 100) + "% in 90 days"); else if (a.usageTrend < -0.05) hit(15, "Usage down " + Math.round(-a.usageTrend * 100) + "% in 90 days");
    if (a.p1Tickets) hit(Math.min(24, a.p1Tickets * 8), a.p1Tickets + " priority-1 support ticket" + (a.p1Tickets > 1 ? "s" : ""));
    if (!a.sponsorEngaged) hit(15, "No engaged executive sponsor");
    if (a.nps != null && a.nps < 0) hit(15, "NPS " + a.nps); else if (a.nps != null && a.nps < 30) hit(5, "NPS " + a.nps);
    if (a.latePayment) hit(10, "Late payment");
    if (a.championLeft) hit(20, "Champion has left");
    const score = Math.max(0, 100 - sum(drivers, (d) => d.pts));
    return { score, band: score >= 70 ? "Healthy" : score >= 45 ? "At risk" : "Critical", drivers: drivers.sort((x, y) => y.pts - x.pts) };
  }
  const RENEW_RATE = { Healthy: 0.97, "At risk": 0.8, Critical: 0.5 };
  const RENEW_ACTION = {
    "Usage": "Run an adoption review with the admin and agree three use cases to switch on before renewal.",
    "priority-1": "Get support leadership on a call to close out the open P1s and show the fix plan.",
    "No engaged": "Book an executive business review with the economic buyer before the renewal conversation.",
    "NPS": "Follow up the survey response personally and agree what would change the score.",
    "Late payment": "Have finance and the account owner agree a payment plan before renewal paperwork goes out.",
    "Champion": "Map the new stakeholders and find a replacement champion this month.",
  };
  function generateRenewals(asOf, seed = 43) {
    const r = rng(seed), out = [];
    const names = ["Abbotsford", "Birchley", "Cobalt Mill", "Dunmore", "Elsworth", "Fairhaven", "Glenrock", "Hollins", "Ivybridge", "Jarrow Point", "Kingsmead", "Larchfield",
      "Millbrook", "Netherby", "Orchard Vale", "Penrose", "Quarry Bank", "Rookwood", "Saltmarsh", "Tamworth Ridge", "Upton Lea", "Verity Hall", "Westcombe", "Yardley", "Ashdown", "Bramhall", "Coldharbour", "Driftwood", "Easterly", "Foxglove"];
    const sfx = ["Holdings", "Partners", "Health", "Logistics", "Retail", "Services", "Group", "Energy"];
    const seg = { Enterprise: [120, 420], "Mid-Market": [40, 140], Growth: [10, 45] };
    for (let i = 0; i < 30; i++) {
      const x = r(), team = x < 0.3 ? "Enterprise" : x < 0.62 ? "Mid-Market" : "Growth", [lo, hi] = seg[team];
      const risky = r() < 0.4;
      const a = {
        id: "ACC-" + (310 + i), account: names[i] + " " + sfx[Math.floor(r() * sfx.length)], team, owner: REPS.filter((p) => p.team === team)[Math.floor(r() * 3)].name,
        arr: Math.round((lo + r() * (hi - lo)) * 1000 / 500) * 500, renewalDate: addDays(asOf, 5 + Math.floor(r() * 165)),
        usageTrend: risky ? -0.35 + r() * 0.35 : -0.08 + r() * 0.35, p1Tickets: risky && r() < 0.5 ? 1 + Math.floor(r() * 3) : 0,
        sponsorEngaged: risky ? r() < 0.45 : r() < 0.9, nps: r() < 0.15 ? null : Math.round(risky ? -20 + r() * 50 : 15 + r() * 55),
        latePayment: r() < (risky ? 0.25 : 0.04), championLeft: r() < (risky ? 0.3 : 0.03),
      };
      const h = healthScore(a);
      const top = h.drivers[0];
      const actionKey = top ? Object.keys(RENEW_ACTION).find((k) => top.why.includes(k)) : null;
      out.push({ ...a, ...h, expectedRate: RENEW_RATE[h.band], action: actionKey ? RENEW_ACTION[actionKey] : "Confirm renewal terms and look for expansion." });
    }
    return out.sort((x, y) => (x.renewalDate < y.renewalDate ? -1 : 1));
  }
  function renewalReport(accts) {
    const arr = sum(accts, (a) => a.arr), forecast = sum(accts, (a) => a.arr * a.expectedRate);
    const bands = ["Healthy", "At risk", "Critical"].map((b) => { const as = accts.filter((a) => a.band === b); return { band: b, accounts: as.length, arr: sum(as, (a) => a.arr) }; });
    return { accounts: accts.length, arr, forecast, forecastGrr: arr ? forecast / arr : 1, atRiskArr: sum(accts.filter((a) => a.band !== "Healthy"), (a) => a.arr), bands };
  }

  // ---------- Multi-touch attribution ----------
  // Every opportunity from an MQL gets a journey of 2-6 touches; the last touch is the MQL's converting channel.
  function generateTouches(leads, seed = 47) {
    const r = rng(seed), first = [1, 3, 4, 5, 2, 1], any = [2, 3, 3, 3, 2, 1];
    const wpick = (w) => { let x = r() * sum(w); for (let i = 0; i < w.length; i++) { x -= w[i]; if (x < 0) return CHANNELS[i].name; } return CHANNELS[0].name; };
    const out = {};
    for (const l of leads.filter(isOpp)) {
      const n = 2 + Math.floor(r() * 5), t = [wpick(first)];
      for (let k = 1; k < n - 1; k++) t.push(wpick(any));
      t.push(l.channel); out[l.id] = t;
    }
    return out;
  }
  const MODELS = {
    first: (n) => Array.from({ length: n }, (_, i) => (i === 0 ? 1 : 0)),
    last: (n) => Array.from({ length: n }, (_, i) => (i === n - 1 ? 1 : 0)),
    linear: (n) => Array.from({ length: n }, () => 1 / n),
    position: (n) => (n === 1 ? [1] : n === 2 ? [0.5, 0.5] : Array.from({ length: n }, (_, i) => (i === 0 || i === n - 1 ? 0.4 : 0.2 / (n - 2)))),
  };
  function attribution(leads, dealsById, touches) {
    const res = CHANNELS.map((c) => ({ channel: c.name, spend: c.spend, first: 0, last: 0, linear: 0, position: 0 }));
    let total = 0;
    for (const l of leads.filter(isOpp)) {
      const v = l.oppStatus === "Open" ? dealsById[l.dealId].amount || 0 : l.amount, t = touches[l.id];
      total += v;
      for (const [model, fn] of Object.entries(MODELS)) fn(t.length).forEach((w, i) => { res.find((x) => x.channel === t[i])[model] += v * w; });
    }
    return { channels: res, total, avgTouches: sum(Object.values(touches), (t) => t.length) / (Object.keys(touches).length || 1) };
  }

  // ---------- CSV import ----------
  function parseCsv(text) {
    const rows = []; let row = [], f = "", q = false;
    for (let i = 0; i < text.length; i++) {
      const ch = text[i];
      if (q) { if (ch === '"') { if (text[i + 1] === '"') { f += '"'; i++; } else q = false; } else f += ch; }
      else if (ch === '"') q = true;
      else if (ch === ",") { row.push(f); f = ""; }
      else if (ch === "\n" || ch === "\r") { if (ch === "\r" && text[i + 1] === "\n") i++; row.push(f); f = ""; if (row.some((c) => c.trim() !== "")) rows.push(row); row = []; }
      else f += ch;
    }
    row.push(f); if (row.some((c) => c.trim() !== "")) rows.push(row);
    return rows;
  }
  const HEADER_ALIASES = {
    id: ["id", "opportunityid", "oppid", "dealid", "recordid"], account: ["account", "accountname", "opportunityname", "dealname", "name", "company"],
    owner: ["owner", "opportunityowner", "dealowner", "rep", "salesrep"], stage: ["stage", "dealstage", "opportunitystage"], amount: ["amount", "value", "dealvalue", "acv", "arr"],
    closeDate: ["closedate", "expectedclosedate", "close"], lastActivity: ["lastactivity", "lastactivitydate", "lastcontacted"], stageEntered: ["stageentered", "stagechangedate", "datestageentered", "laststagechangedate"],
    nextStep: ["nextstep", "nextsteps"], forecastCategory: ["forecastcategory", "forecast", "category"], pushCount: ["pushcount", "closedatepushes", "pushes"], type: ["type", "opportunitytype", "dealtype"],
  };
  function toIsoDate(v) {
    v = (v || "").trim(); if (!v) return "";
    let m = v.match(/^(\d{4})-(\d{1,2})-(\d{1,2})/); if (m) return m[1] + "-" + m[2].padStart(2, "0") + "-" + m[3].padStart(2, "0");
    m = v.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/); if (m) return m[3] + "-" + m[2].padStart(2, "0") + "-" + m[1].padStart(2, "0"); // UK day/month/year
    return null;
  }
  function importDeals(text) {
    const rows = parseCsv(text), errors = [], deals = [];
    if (rows.length < 2) return { deals, errors: [{ row: 0, message: "Need a header row and at least one deal." }], mapped: {} };
    const norm = (h) => h.toLowerCase().replace(/[^a-z]/g, "");
    const idx = {};
    rows[0].forEach((h, i) => { const n = norm(h); for (const [k, al] of Object.entries(HEADER_ALIASES)) if (al.includes(n) && idx[k] == null) idx[k] = i; });
    const required = ["id", "owner", "stage", "amount", "closeDate", "forecastCategory"];
    const missing = required.filter((k) => idx[k] == null);
    if (missing.length) return { deals, errors: [{ row: 1, message: "Missing column" + (missing.length > 1 ? "s" : "") + ": " + missing.map((k) => ({ id: "id", owner: "owner", stage: "stage", amount: "amount", closeDate: "close date", forecastCategory: "forecast category" })[k]).join(", ") }], mapped: idx };
    const stageNames = STAGES.map((s) => s.name.toLowerCase()), cats = ["Commit", "Best Case", "Pipeline", "Omitted"];
    rows.slice(1).forEach((r, k) => {
      const rowNo = k + 2, get = (key) => (idx[key] == null ? "" : (r[idx[key]] || "").trim()), errs = [];
      const si = stageNames.indexOf(get("stage").toLowerCase()); if (si < 0) errs.push("stage '" + get("stage") + "' isn't one of " + STAGES.map((s) => s.name).join(", "));
      const amount = parseFloat(get("amount").replace(/[£$€,\s]/g, "")); if (!isFinite(amount) || amount < 0) errs.push("amount '" + get("amount") + "' isn't a number");
      const cat = cats.find((c) => c.toLowerCase() === get("forecastCategory").toLowerCase()); if (!cat) errs.push("forecast category '" + get("forecastCategory") + "' isn't Commit, Best Case, Pipeline or Omitted");
      const dates = {};
      for (const key of ["closeDate", "lastActivity", "stageEntered"]) { const v = toIsoDate(get(key)); if (v === null) errs.push(key + " '" + get(key) + "' isn't a date (use YYYY-MM-DD or DD/MM/YYYY)"); dates[key] = v || ""; }
      if (!dates.closeDate && !errs.some((e) => e.startsWith("closeDate"))) errs.push("close date is blank");
      if (!get("id")) errs.push("id is blank");
      if (errs.length) { errors.push({ row: rowNo, message: errs.join("; ") }); return; }
      const push = parseInt(get("pushCount"), 10);
      deals.push({ id: get("id"), account: get("account") || get("id"), owner: get("owner") || "Unassigned", type: PLAN.rates[get("type")] ? get("type") : "New Business",
        stage: STAGES[si].name, amount, closeDate: dates.closeDate, lastActivity: dates.lastActivity, stageEntered: dates.stageEntered, nextStep: idx.nextStep == null ? null : get("nextStep"),
        forecastCategory: cat, pushCount: isFinite(push) ? push : 0, discount: 0, approval: "Not needed", nonStandard: "", meddpicc: null });
    });
    const skipped = [];
    if (idx.nextStep == null) skipped.push("No next step (no next-step column)");
    if (idx.lastActivity == null) skipped.push("No recent activity (no last-activity column)");
    if (idx.stageEntered == null) skipped.push("Stuck in stage (no stage-change date column)");
    if (idx.pushCount == null) skipped.push("Close date pushed 2+ times (no push-count column)");
    skipped.push("MEDDPICC and deal desk checks (not in the import format)");
    return { deals, errors, mapped: idx, skipped };
  }
  function importedReport(deals, ctx) {
    const h = hygieneReport(deals, ctx), cv = coverage(deals, ctx), l = landing(deals, ctx);
    const owners = {};
    for (const d of h.deals) { const o = (owners[d.owner] ||= { owner: d.owner, deals: 0, value: 0, flagged: 0 }); o.deals++; o.value += d.amount; if (d.flags.length) o.flagged++; }
    return { hygiene: h, coverage: cv, landing: l, owners: Object.values(owners).sort((a, b) => b.value - a.value) };
  }

  // ---------- Commission by team ----------
  // Managers earn an override on their team's bookings: closed so far, plus the same expected and at-risk views as their reps.
  function commissionByTeam(com, ctx) {
    const ov = com.plan.managerOverride;
    return TEAMS.map((t) => {
      const rs = com.reps.filter((r) => r.team === t.name), s = (k) => sum(rs, (r) => r[k]);
      const quota = s("quota"), closed = s("closed"), pipeline = s("pipeline");
      const repEarned = s("earned"), repExpected = s("expected");
      const expectedBookings = sum(rs, (r) => r.expectedBookings || 0);
      return { team: t.name, manager: t.manager, reps: rs.length, quota, closed, attainment: quota ? closed / quota : 0, pipeline,
        repEarned, repExpected, repPotential: s("potential"), repAtRisk: s("atRisk"),
        overrideEarned: closed * ov, overrideExpected: expectedBookings * ov,
        totalEarned: repEarned + closed * ov, costOfSales: closed ? (repEarned + closed * ov) / closed : 0 };
    });
  }

  const api = {
    STAGES, RULES, MAX_WEIGHT, MEDDPICC, MEDDPICC_REQ, DISCOUNT_TIERS, OWNERS, REPS, TEAMS, PLAN, BENCH, NQ, CAT_RATE, RAMP_MONTHS,
    repOf, landing, confidence, commissionByTeam, COMPETITORS, enrichOpps, winLoss, calibrateRates, scenario, rampFactor, capacityPlan, generateActivity, healthScore, generateRenewals, renewalReport, RENEW_RATE, generateTouches, MODELS, attribution, parseCsv, toIsoDate, importDeals, importedReport, SDRS, CHANNELS, SOURCES, LEAD_START, attributeDeals, generateLeads, leadOutcomes, marketingReport, isSAL, isSQL, isOpp, tenureMonths, tenureExpectation, repTenure, teamReport, cohortSummary,
    generateDeals, checkDeal, hygieneReport, nextSteps, meddpiccGaps, dealDesk, approverFor, coverage,
    dealCommission, commissionReport, generateHistory, generateOppHistory, saasMetrics, funnel, timeInStage,
    winRates, ttmWinRate, ttmCycle, discountBands, pipelineVelocity, meddpiccByStage, linearTrend, rate,
    daysBetween, stageOf, stageIndex, median, qLabel,
  };
  if (typeof module !== "undefined" && module.exports) module.exports = api; else root.RevEngine = api;
})(this);
