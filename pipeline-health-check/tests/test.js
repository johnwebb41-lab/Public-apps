const E = require("../src/engine.js");
let pass = 0, fail = 0; const results = [];
function t(name, fn) {
  try { fn(); pass++; results.push(["PASS", name]); }
  catch (e) { fail++; results.push(["FAIL", name + " :: " + e.message]); }
}
const eq = (a, b, m) => { if (a !== b) throw new Error(`${m || ""} expected ${b}, got ${a}`); };
const near = (a, b, m) => { if (Math.abs(a - b) > 1e-9 * Math.max(1, Math.abs(b))) throw new Error(`${m || ""} expected ${b}, got ${a}`); };

const ctx = { asOf: "2026-11-04", staleDays: 14, periodStart: "2026-10-01", periodEnd: "2026-12-31", quota: 1000000, closedWon: 400000, winRate: 0.25 };
const clean = { id: "X", owner: "A", stage: "Proposal", amount: 100000, closeDate: "2026-12-01", lastActivity: "2026-11-01", stageEntered: "2026-10-25", nextStep: "Call", forecastCategory: "Commit", pushCount: 0 };

t("Clean deal has no flags and health 100", () => { const d = E.checkDeal(clean, ctx); eq(d.flags.length, 0); eq(d.health, 100); });
t("Past close date flagged with days overdue", () => { const d = E.checkDeal({ ...clean, closeDate: "2026-10-30" }, ctx); eq(d.flags[0].id, "pastClose"); eq(d.flags[0].reason, "5 days overdue"); });
t("Close date today is not overdue", () => eq(E.checkDeal({ ...clean, closeDate: "2026-11-04" }, ctx).flags.length, 0));
t("Whitespace next step counts as blank", () => eq(E.checkDeal({ ...clean, nextStep: "   " }, ctx).flags[0].id, "noNextStep"));
t("Stale boundary: 14 days passes, 15 fails", () => {
  eq(E.checkDeal({ ...clean, lastActivity: "2026-10-21" }, ctx).flags.length, 0);
  eq(E.checkDeal({ ...clean, lastActivity: "2026-10-20" }, ctx).flags[0].id, "stale");
});
t("Zero amount flagged", () => eq(E.checkDeal({ ...clean, amount: 0 }, ctx).flags[0].id, "noAmount"));
t("Commit at Discovery is a category mismatch", () => eq(E.checkDeal({ ...clean, stage: "Discovery", stageEntered: "2026-11-01", forecastCategory: "Commit" }, ctx).flags[0].id, "categoryMismatch"));
t("Pushed twice flagged, once not", () => {
  eq(E.checkDeal({ ...clean, pushCount: 1 }, ctx).flags.length, 0);
  eq(E.checkDeal({ ...clean, pushCount: 2 }, ctx).flags[0].id, "pushed");
});
t("Health score: all rules hit gives 0", () => {
  const bad = { ...clean, stage: "Discovery", amount: 0, closeDate: "2026-10-01", lastActivity: "2026-09-01", stageEntered: "2026-08-01", nextStep: "", forecastCategory: "Commit", pushCount: 3 };
  const d = E.checkDeal(bad, ctx); eq(d.flags.length, 7); eq(d.health, 0);
});

// Coverage, worked by hand.
// Remaining = 1,000,000 - 400,000 = 600,000. Required = 1/0.25 = 4x -> need 2.4m.
const deals = [
  { ...clean, id: "A", amount: 800000, stage: "Negotiation" },            // clean, in period, prob .8
  { ...clean, id: "B", amount: 400000, stage: "Solution", forecastCategory: "Best Case", nextStep: "" }, // flagged, prob .4
  { ...clean, id: "C", amount: 300000, closeDate: "2027-01-15" },          // outside period
];
t("Coverage worked example", () => {
  const c = E.coverage(deals, ctx);
  eq(c.inPeriodCount, 2); eq(c.outOfPeriodCount, 1);
  eq(c.remaining, 600000); eq(c.raw, 1200000); eq(c.clean, 800000);
  near(c.weighted, 800000 * 0.8 + 400000 * 0.4); // 800,000
  near(c.rawCoverage, 2); near(c.cleanCoverage, 800000 / 600000); near(c.required, 4);
  eq(c.pipelineNeeded, 2400000); eq(c.gap, 1200000); eq(c.cleanGap, 1600000);
  eq(c.verdict.level, "bad");
});
t("Quota already met gives infinite coverage and 'good'", () => {
  const c = E.coverage(deals, { ...ctx, closedWon: 1200000 });
  eq(c.remaining, 0); eq(c.rawCoverage, Infinity); eq(c.verdict.level, "good"); eq(c.gap, 0);
});
t("Covered on paper but not clean gives 'warn'", () => {
  const c = E.coverage(deals, { ...ctx, winRate: 0.5 }); // need 2x; raw 2x, clean 1.33x
  eq(c.verdict.level, "warn");
});
t("Zero win rate does not crash", () => { const c = E.coverage(deals, { ...ctx, winRate: 0 }); eq(c.required, Infinity); });
t("Empty pipeline", () => { const c = E.coverage([], ctx); eq(c.raw, 0); eq(c.rawCoverage, 0); eq(c.verdict.level, "bad"); });
t("Generator is deterministic", () => eq(JSON.stringify(E.generateDeals("2026-11-04")), JSON.stringify(E.generateDeals("2026-11-04"))));
t("Generated data exercises every rule", () => {
  const rep = E.hygieneReport(E.generateDeals("2026-11-04"), ctx);
  for (const r of rep.byRule) if (r.count === 0) throw new Error("rule never fires: " + r.id);
  if (rep.cleanCount === 0) throw new Error("no clean deals at all");
});
t("Hygiene totals add up", () => {
  const rep = E.hygieneReport(E.generateDeals("2026-11-04"), ctx);
  eq(rep.byOwner.reduce((a, o) => a + o.deals, 0), rep.total);
  near(rep.totalValue, rep.deals.reduce((a, d) => a + d.amount, 0));
});

// ---------- v2 ----------
t("Calmer data: at least 60% of deals clean, every rule still shows once", () => {
  const rep = E.hygieneReport(E.generateDeals("2026-11-04"), ctx);
  if (rep.cleanRate < 0.6) throw new Error("clean rate " + rep.cleanRate.toFixed(2));
  for (const r of rep.byRule) if (r.count === 0) throw new Error("rule never fires: " + r.id);
});
t("Every flagged deal gets a next step for each flag", () => {
  const rep = E.hygieneReport(E.generateDeals("2026-11-04"), ctx);
  for (const d of rep.deals) for (const f of d.flags) if (!d.steps.some((s) => s.source === f.label)) throw new Error(d.id + " missing step for " + f.id);
});
t("Stuck at Proposal gives the Proposal play", () => {
  const s = E.nextSteps({ ...clean, stageEntered: "2026-10-01", meddpicc: E.MEDDPICC_REQ.Proposal.slice() }, ctx);
  eq(s.length, 1); eq(s[0].priority, "Low"); if (!/mutual action plan/.test(s[0].text)) throw new Error(s[0].text);
});
t("Stale over 30 days escalates to manager review", () => {
  const s = E.nextSteps({ ...clean, lastActivity: "2026-09-20", meddpicc: E.MEDDPICC_REQ.Proposal.slice() }, ctx);
  if (!/Manager review/.test(s[0].text)) throw new Error(s[0].text);
});
t("MEDDPICC: missing economic buyer at Negotiation is a High gap", () => {
  const m = E.MEDDPICC_REQ.Negotiation.slice(); m[1] = 1;
  const g = E.meddpiccGaps({ ...clean, stage: "Negotiation", meddpicc: m });
  eq(g.length, 1); eq(g[0].name, "Economic buyer");
  eq(E.nextSteps({ ...clean, stage: "Negotiation", meddpicc: m }, ctx)[0].priority, "High");
});
t("Deal desk tiers: 10% rep, 15% manager, 25% deal desk, 35% CFO", () => {
  eq(E.approverFor(0.10), "Rep"); eq(E.approverFor(0.15), "Sales manager"); eq(E.approverFor(0.25), "Deal desk"); eq(E.approverFor(0.35), "CFO");
});
t("Deal desk: pending 25% discount at Negotiation is a High chase", () => {
  const dd = E.dealDesk({ ...clean, stage: "Negotiation", discount: 0.25, approval: "Pending", nonStandard: "" });
  eq(dd.inQueue, true); eq(dd.action.priority, "High"); if (!/Deal desk/.test(dd.action.text)) throw new Error(dd.action.text);
  eq(E.dealDesk({ ...clean, stage: "Negotiation", discount: 0.25, approval: "Approved" }).inQueue, false);
  eq(E.dealDesk({ ...clean, stage: "Solution", discount: 0.25, approval: "Not submitted" }).inQueue, false);
});
t("Commission: deal straddling quota splits base and accelerated", () => {
  // quota 300k, attained 250k, deal 100k at 10%, 1.5x: 50k×10% + 50k×15% = 5,000 + 7,500
  near(E.dealCommission(100000, 0.10, 300000, 250000, 1.5), 12500);
  near(E.dealCommission(100000, 0.10, 300000, 0, 1.5), 10000);
  near(E.dealCommission(100000, 0.10, 300000, 400000, 1.5), 15000);
});
t("Commission report: sequential potential and expected add up", () => {
  const c2 = { ...ctx, quota: 1000000, closedWon: 0 };
  const ds = [{ ...clean, id: "A", owner: "Priya Shah", type: "New Business", amount: 150000, closeDate: "2026-11-10", stage: "Negotiation" },
              { ...clean, id: "B", owner: "Priya Shah", type: "Expansion", amount: 100000, closeDate: "2026-12-10", stage: "Proposal" }];
  const r = E.commissionReport(ds, c2).reps.find((x) => x.owner === "Priya Shah");
  // Priya's quota = 15% of 1m = 150k: A 150k×10% = 15,000 fills quota; B 100k×8%×1.5 = 12,000
  near(r.potential, 27000);
  // ifWon each alone on top of 0 closed: A 15,000×0.8, B fits under quota: 8,000×0.6
  near(r.expected, 15000 * 0.8 + 8000 * 0.6);
  eq(r.atRisk, 0);
});
t("Trend: exact line gives exact slope, R² 1, zero band", () => {
  const tr = E.linearTrend([10, 12, 14, 16, 18], 2);
  near(tr.slope, 2); near(tr.intercept, 10); near(tr.r2, 1); near(tr.projection[0].y, 20); near(tr.projection[1].hi - tr.projection[1].lo, 0);
});
t("Trend: noisy data gives a band that widens further out", () => {
  const tr = E.linearTrend([10, 13, 13, 17, 18, 19], 3);
  const w = tr.projection.map((p) => p.hi - p.lo);
  if (!(w[0] > 0 && w[2] > w[0])) throw new Error(w.join(","));
});
t("GRR/NRR/magic/payback/Rule of 40 on a hand-made history", () => {
  const q = (o) => ({ start: 100, newArr: 10, expansion: 5, contraction: 1, churn: 2, end: 112, bookings: 15, revenue: 25, gm: 0.8, sm: 20, fcfMargin: 0.1, forecast: 15, renewDue: 25, renewActual: 22, renewForecast: 22, label: "Q", ...o });
  const h = { quarters: [q({}), q({ start: 112, end: 124 }), q({ start: 124, end: 136 }), q({ start: 136, end: 148, revenue: 30 }), q({ start: 148, end: 160, revenue: 35 })] };
  const m = E.saasMetrics(h);
  // TTM at i=3: base 100, expansion 20, losses 12 -> GRR 88%, NRR 108%
  near(m[3].grr, 0.88); near(m[3].nrr, 1.08);
  // i=1: net new 12, prior S&M 20 -> magic 0.6; payback 20 / (12×0.8/12) = 25 months
  near(m[1].magic, 0.6); near(m[1].payback, 25);
  // i=4: revenue growth 35/25-1 = 40%, + FCF 10% = 50%
  near(m[4].ruleOf40, 0.5);
  near(m[0].renewAcc, 1);
});
t("Funnel conversions on a hand-made set", () => {
  const o = (reached, won) => ({ reached, won, stageDays: Array(reached + 1).fill(10), closeQi: 10, amount: 1000, cycle: 10 });
  const f = E.funnel([o(0, false), o(1, false), o(4, true), o(4, false)]);
  eq(f[0].count, 4); near(f[0].conversion, 0.75); near(f[4].conversion, 0.5);
});
t("Pipeline velocity: 10 deals × £50k × 30% ÷ 60 days = £2,500/day", () => {
  const ds = Array.from({ length: 10 }, () => ({ stage: "Solution", amount: 50000 }));
  near(E.pipelineVelocity(ds, 0.3, 60).perDay, 2500);
});
t("Generated history is sane", () => {
  const m = E.saasMetrics(E.generateHistory());
  const last = m[m.length - 1];
  if (!(last.nrr > 1 && last.nrr < 1.2)) throw new Error("NRR " + last.nrr);
  if (!(last.grr > 0.8 && last.grr <= 1)) throw new Error("GRR " + last.grr);
  if (!(last.payback > 6 && last.payback < 60)) throw new Error("payback " + last.payback);
  const wr = E.ttmWinRate(E.generateOppHistory());
  if (!(wr > 0.2 && wr < 0.45)) throw new Error("win rate " + wr);
});

// ---------- Data integrity: the generated data must be internally consistent ----------
const D = E.generateDeals("2026-11-04"), H = E.generateHistory(), O = E.generateOppHistory(), MM = E.saasMetrics(H);
const dctx = { ...ctx, quota: 2200000, closedWon: 1150000, winRate: E.ttmWinRate(O) };
const iso = /^\d{4}-\d{2}-\d{2}$/;
t("Data: 66 deals, unique IDs, valid owners, stages and categories", () => {
  eq(D.length, 66); eq(new Set(D.map((d) => d.id)).size, 66);
  const cats = ["Pipeline", "Best Case", "Commit", "Omitted"];
  for (const d of D) {
    if (!E.OWNERS.includes(d.owner)) throw new Error("owner " + d.owner);
    if (!E.stageOf(d.stage)) throw new Error("stage " + d.stage);
    if (!cats.includes(d.forecastCategory)) throw new Error("category " + d.forecastCategory);
    if (!(d.type in E.PLAN.rates)) throw new Error("type " + d.type);
  }
});
t("Data: dates are valid, amounts and discounts in range, MEDDPICC scores 0–2", () => {
  for (const d of D) {
    for (const k of ["closeDate", "lastActivity", "stageEntered"]) if (!iso.test(d[k]) || isNaN(Date.parse(d[k]))) throw new Error(d.id + " " + k);
    if (d.lastActivity > "2026-11-04" || d.stageEntered > "2026-11-04") throw new Error(d.id + " date in future");
    if (d.amount < 0 || d.amount > 250000) throw new Error(d.id + " amount " + d.amount);
    if (d.discount < 0 || d.discount > 0.4) throw new Error(d.id + " discount " + d.discount);
    if (d.meddpicc.length !== 8 || d.meddpicc.some((v) => ![0, 1, 2].includes(v))) throw new Error(d.id + " meddpicc");
    if (d.discount <= 0.10 && d.approval !== "Not needed") throw new Error(d.id + " approval");
  }
});
t("Data: rep quota and closed shares each sum to 100%; every rep is on a real team", () => {
  near(E.REPS.reduce((a, r) => a + r.quotaShare, 0), 1); near(E.REPS.reduce((a, r) => a + r.closedShare, 0), 1);
  for (const r of E.REPS) if (!E.TEAMS.some((tm) => tm.name === r.team)) throw new Error(r.name);
  for (const d of D) eq(d.team, E.repOf(d.owner).team);
});
t("Data: ARR bridge reconciles every quarter and links to the next", () => {
  H.quarters.forEach((q, i) => {
    near(q.end, q.start + q.newArr + q.expansion - q.contraction - q.churn, "bridge " + q.label);
    if (i) near(q.start, H.quarters[i - 1].end, "link " + q.label);
    if ([q.newArr, q.expansion, q.contraction, q.churn, q.sm].some((v) => v < 0)) throw new Error("negative " + q.label);
  });
});
t("Data: renewals reconcile to churn and contraction", () => {
  for (const q of H.quarters) { near(q.renewActual, q.renewDue - q.contraction - q.churn); if (q.renewActual > q.renewDue) throw new Error(q.label); }
});
t("Data: GRR never above 100% or above NRR", () => {
  for (const m of MM) if (m.grr != null && (m.grr > 1 || m.grr > m.nrr)) throw new Error(m.label);
});
t("Data: cohorts start at 100% and never grow back", () => {
  for (const c of H.cohorts) {
    eq(c.ret[0], 1, c.label);
    for (let a = 1; a < c.ret.length; a++) if (c.ret[a] > c.ret[a - 1] || c.ret[a] <= 0) throw new Error(c.label + " age " + a);
  }
});
t("Data: opportunity history is consistent (stage path, wins, close after create)", () => {
  for (const o of O) {
    eq(o.stageDays.length, o.reached + 1);
    if (o.won && o.reached !== 4) throw new Error("won without Negotiation");
    if (o.closeQi < o.qi) throw new Error("closed before created");
    near(o.cycle, o.stageDays.reduce((a, b) => a + b, 0));
  }
  const f = E.funnel(O);
  for (let s = 1; s < 5; s++) if (f[s].count > f[s - 1].count) throw new Error("funnel grows at " + f[s].stage);
});
t("Data: coverage reconciles to the deal list", () => {
  const c = E.coverage(D, dctx);
  const inQ = D.filter((d) => d.closeDate >= dctx.periodStart && d.closeDate <= dctx.periodEnd);
  near(c.raw, inQ.reduce((a, d) => a + d.amount, 0));
  near(Object.values(c.byCategory).reduce((a, b) => a + b, 0), c.raw);
  if (c.clean > c.raw || c.weighted > c.raw) throw new Error("clean/weighted above raw");
});
t("Data: hygiene counts reconcile", () => {
  const h = E.hygieneReport(D, dctx);
  eq(h.cleanCount + h.deals.filter((d) => d.flags.length).length, h.total);
  eq(h.actions.length, h.deals.reduce((a, d) => a + d.steps.length, 0));
});
t("Data: commission reconciles and stays inside plan limits", () => {
  const cr = E.commissionReport(D, dctx);
  near(cr.totals.potential, cr.reps.reduce((a, r) => a + r.potential, 0));
  for (const r of cr.reps) {
    const inQ = D.filter((d) => d.owner === r.owner && d.closeDate >= dctx.periodStart && d.closeDate <= dctx.periodEnd);
    const lo = inQ.reduce((a, d) => a + d.amount * E.PLAN.rates[d.type], 0);
    if (r.potential < lo - 1e-6 || r.potential > lo * E.PLAN.accelerator + 1e-6) throw new Error(r.owner + " potential out of range");
    if (r.expected > r.potential + 1e-6 && r.closed < r.quota) throw new Error(r.owner + " expected above potential");
  }
});
t("Data: no NaN, undefined or infinite numbers in any output", () => {
  const scan = (v, path) => {
    if (typeof v === "number" && !isFinite(v) && v !== Infinity) throw new Error("NaN at " + path);
    if (v === undefined) throw new Error("undefined at " + path);
    if (v && typeof v === "object") for (const [k, x] of Object.entries(v)) if (!(path.endsWith("]") && x === undefined && /grr|nrr|magic|payback|revGrowth|ruleOf40|expansion/.test(k))) scan(x, path + "." + k);
  };
  scan(E.hygieneReport(D, dctx), "hygiene"); scan(E.coverage(D, dctx), "coverage"); scan(E.commissionReport(D, dctx), "commission");
  scan(E.funnel(O), "funnel"); scan(E.winRates(O), "winRates"); scan(E.timeInStage(O, D, "2026-11-04"), "tis");
  scan(MM.slice(4), "metrics"); scan(E.meddpiccByStage(D), "meddpicc"); scan(E.discountBands(O), "discount");
});

// ---------- v5: landing, confidence, tenure, teams, cohorts ----------
t("Landing worked example: floor, likely, stretch", () => {
  const c = { ...ctx, quota: 1000000, closedWon: 400000 };
  const ds = [
    { ...clean, id: "A", amount: 100000, forecastCategory: "Commit" },                       // clean Commit
    { ...clean, id: "B", amount: 100000, forecastCategory: "Commit", nextStep: "" },          // flagged Commit
    { ...clean, id: "C", amount: 100000, forecastCategory: "Best Case" },
    { ...clean, id: "D", amount: 100000, forecastCategory: "Pipeline" },
    { ...clean, id: "E", amount: 100000, forecastCategory: "Commit", closeDate: "2027-02-01" }, // next quarter
  ];
  const l = E.landing(ds, c);
  near(l.floor, 400000 + 85000);
  near(l.likely, 400000 + 85000 + 42500 + 45000 + 15000);
  near(l.stretch, 400000 + 100000 + 100000 + 100000 + 15000);
  near(l.likelyPct, 0.5875);
});
t("Landing: floor <= likely <= stretch on the demo data, for every team", () => {
  for (const tm of E.teamReport(D, dctx)) { const l = tm.landing; if (!(l.floor <= l.likely + 1e-6 && l.likely <= l.stretch + 1e-6)) throw new Error(tm.name); }
  const l = E.landing(D, dctx); if (!(l.floor <= l.likely && l.likely <= l.stretch)) throw new Error("all");
});
t("Confidence: perfect pipeline scores 100; weights add to 100", () => {
  const ds = [{ ...clean, amount: 2000000, forecastCategory: "Commit", meddpicc: E.MEDDPICC_REQ.Proposal.slice() }];
  const cf = E.confidence(ds, { ...ctx, quota: 1000000, closedWon: 400000, winRate: 0.5 }, 1);
  eq(cf.parts.reduce((a, p) => a + p.weight, 0), 100); eq(cf.score, 100); eq(cf.level, "High");
});
t("Confidence: empty pipeline scores low", () => {
  const cf = E.confidence([], { ...ctx, quota: 1000000, closedWon: 400000 }, 0.85);
  if (cf.score > 40) throw new Error("score " + cf.score); eq(cf.level, "Low");
});
t("Tenure: months and expectation", () => {
  eq(E.tenureMonths("2026-05-01", "2026-11-04"), 6); eq(E.tenureMonths("2026-05-10", "2026-11-04"), 5); eq(E.tenureMonths("2021-03-01", "2026-11-04"), 68);
  near(E.tenureExpectation(0), 0.4); near(E.tenureExpectation(6), 0.7); near(E.tenureExpectation(24), 1);
  eq(E.repTenure({ start: "2026-05-01", ttmAttainment: 0.8 }, "2026-11-04").verdict, "Ahead for tenure");
  eq(E.repTenure({ start: "2020-01-01", ttmAttainment: 0.7 }, "2026-11-04").verdict, "Behind for tenure");
  eq(E.repTenure({ start: "2026-05-01", ttmAttainment: 0.5 }, "2026-11-04").ramping, true);
});
t("Teams reconcile to the whole: quota, closed, pipeline and deal counts", () => {
  const T = E.teamReport(D, dctx), cv = E.coverage(D, dctx);
  near(T.reduce((a, x) => a + x.quota, 0), dctx.quota); near(T.reduce((a, x) => a + x.closed, 0), dctx.closedWon);
  near(T.reduce((a, x) => a + x.pipeline, 0), cv.raw); eq(T.reduce((a, x) => a + x.dealCount, 0), D.length);
  near(T.reduce((a, x) => a + x.landing.likely, 0), E.landing(D, dctx).likely);
});
t("Demo story: Growth is the team flagged for support", () => {
  const T = E.teamReport(D, dctx), g = T.find((x) => x.name === "Growth");
  if (g.status === "good") throw new Error("Growth not flagged"); if (!g.flags.some((f) => f.key === "tenure")) throw new Error("tenure flag missing");
});
t("Cohort summary: logo-weighted average on a hand-made set", () => {
  const s = E.cohortSummary([{ logos: 10, ret: [1, 0.9, 0.8] }, { logos: 30, ret: [1, 0.7] }]);
  near(s[1].retained, (10 * 0.9 + 30 * 0.7) / 40); near(s[2].retained, 0.8); eq(s[2].cohorts, 1);
});

// ---------- v6: marketing ----------
const AD = E.attributeDeals(D), LD = E.generateLeads("2026-11-04", AD), MR = E.marketingReport(LD, AD, dctx);
t("Attribution leaves deal data untouched and is deterministic", () => {
  AD.forEach((d, i) => { const { source, sdr, ...rest } = d; eq(JSON.stringify(rest), JSON.stringify(D[i])); });
  eq(JSON.stringify(E.attributeDeals(D)), JSON.stringify(AD));
  for (const d of AD) { if (!E.SOURCES.includes(d.source)) throw new Error(d.source); if ((d.source === "Marketing" || d.source === "SDR outbound") !== !!d.sdr) throw new Error(d.id + " sdr"); if (d.sdr && E.SDRS.find((s) => s.name === d.sdr).team !== d.team) throw new Error(d.id + " SDR team"); }
});
t("Leads: unique IDs; every marketing deal has exactly one MQL; no MQL links to anything else", () => {
  eq(new Set(LD.map((l) => l.id)).size, LD.length);
  for (const d of AD.filter((x) => x.source === "Marketing")) eq(LD.filter((l) => l.dealId === d.id).length, 1, d.id);
  for (const l of LD.filter((x) => x.dealId)) eq(AD.find((d) => d.id === l.dealId).source, "Marketing");
});
t("Leads: SDR on each lead belongs to the lead's team; untouched leads have no first-touch time", () => {
  for (const l of LD) { if (E.SDRS.find((s) => s.name === l.sdr).team !== l.team) throw new Error(l.id); if ((l.status === "New") !== (l.firstTouchHours == null)) throw new Error(l.id + " touch"); }
});
t("Leads: dates fall between 1 July and today; MQL created before its deal entered its stage", () => {
  for (const l of LD) { if (l.created < E.LEAD_START || l.created > "2026-11-04") throw new Error(l.id + " " + l.created);
    if (l.dealId && l.created > AD.find((d) => d.id === l.dealId).stageEntered) throw new Error(l.id + " after deal"); }
});
t("Funnel never grows: MQL ≥ SAL ≥ SQL ≥ opportunity ≥ won", () => {
  const f = MR.funnel; if (!(f.mql >= f.sal && f.sal >= f.sql && f.sql >= f.opp && f.opp >= f.won)) throw new Error(JSON.stringify(f));
});
t("Every MQL is accounted for exactly once", () => {
  const d = MR.disp; eq(d.disqualified + d.recycled + d.working + d.unworked + d.rejected + MR.funnel.opp, MR.funnel.mql);
});
t("Marketing outcomes add up: landed + likely + at risk + lost = all MQL-sourced pipeline", () => {
  const o = MR.outcomes; near(o.landed + o.likely + o.atRisk + o.lost, o.total); near(o.total, MR.pipeline);
  if (!(o.expected >= o.landed && o.expected <= o.landed + o.likely + o.atRisk)) throw new Error("expected out of range");
});
t("Marketing splits reconcile: teams, SDRs and channels each sum to the total", () => {
  for (const k of ["mql", "sql", "opp", "won"]) { eq(MR.byTeam.reduce((a, x) => a + x[k], 0), MR.funnel[k], "team " + k); eq(MR.bySdr.reduce((a, x) => a + x[k], 0), MR.funnel[k], "sdr " + k); eq(MR.byChannel.reduce((a, x) => a + x[k], 0), MR.funnel[k], "channel " + k); }
  near(MR.byTeam.reduce((a, x) => a + x.outcomes.total, 0), MR.outcomes.total); near(MR.byChannel.reduce((a, x) => a + x.pipeline, 0), MR.pipeline);
});
t("Pipeline by source covers the whole open pipeline", () => {
  near(MR.bySource.reduce((a, x) => a + x.share, 0), 1); near(MR.bySource.reduce((a, x) => a + x.value, 0), AD.reduce((a, d) => a + d.amount, 0)); eq(MR.bySource.reduce((a, x) => a + x.deals, 0), AD.length);
});
t("Lead outcomes worked example", () => {
  const ds = { A: { ...clean, id: "A", amount: 100000, forecastCategory: "Commit" }, B: { ...clean, id: "B", amount: 50000, forecastCategory: "Pipeline" }, C: { ...clean, id: "C", amount: 80000, forecastCategory: "Commit", nextStep: "" } };
  const ls = [{ status: "Opportunity", oppStatus: "Open", dealId: "A" }, { status: "Opportunity", oppStatus: "Open", dealId: "B" }, { status: "Opportunity", oppStatus: "Open", dealId: "C" },
    { status: "Opportunity", oppStatus: "Won", amount: 30000 }, { status: "Opportunity", oppStatus: "Lost", amount: 20000 }, { status: "Recycled" }];
  const o = E.leadOutcomes(ls, ds, ctx);
  eq(o.landed, 30000); eq(o.likely, 100000); eq(o.atRisk, 130000); eq(o.lost, 20000); eq(o.total, 280000);
  near(o.expected, 30000 + 85000 + 7500 + 34000);
});

// ---------- v7: eight modules ----------
const OH = E.generateOppHistory(), OE = E.enrichOpps(OH);
t("Win/loss enrichment leaves history untouched; only lost deals have a loss reason", () => {
  OE.forEach((o, i) => { const { competitor, lossReason, category, ...rest } = o; eq(JSON.stringify(rest), JSON.stringify(OH[i])); if (!!lossReason === o.won) throw new Error("reason on won deal"); });
  for (const o of OE) if (o.lossReason === "Lost to competitor" && !o.competitor) throw new Error("lost to nobody");
});
t("Win/loss reasons and competitor splits reconcile", () => {
  const W = E.winLoss(OE);
  eq(W.reasons.reduce((a, r) => a + r.count, 0), W.lost); eq(W.competitors.reduce((a, c) => a + c.deals, 0), W.closed);
  for (const r of W.reasons) eq(r.byStage.reduce((a, b) => a + b, 0), r.count);
});
t("Calibration worked example and real-data sanity", () => {
  const c = E.calibrateRates([{ category: "Commit", won: true }, { category: "Commit", won: true }, { category: "Commit", won: false }, { category: "Pipeline", won: false }]);
  near(c.rates.Commit, 2 / 3); near(c.rates.Pipeline, 0); near(c.rates["Best Case"], E.CAT_RATE["Best Case"]); // falls back when no history
  const r = E.calibrateRates(OE).rates; if (!(r.Commit > r["Best Case"] && r["Best Case"] > r.Pipeline)) throw new Error("rates out of order");
});
t("Landing accepts calibrated rates", () => {
  const ds = [{ ...clean, amount: 100000, forecastCategory: "Commit" }];
  near(E.landing(ds, { ...ctx, quota: 1e6, closedWon: 0, catRates: { Commit: 0.5, "Best Case": 0.2, Pipeline: 0.1, Omitted: 0 } }).likely, 50000);
});
t("Scenario: no choices = base; won/lost/pull move the landing by the right amount", () => {
  const c = { ...ctx, quota: 1000000, closedWon: 400000 };
  const ds = [{ ...clean, id: "A", owner: "Priya Shah", amount: 100000, forecastCategory: "Commit" },
              { ...clean, id: "B", owner: "Tom Okafor", amount: 50000, forecastCategory: "Best Case" },
              { ...clean, id: "C", owner: "Tom Okafor", amount: 80000, forecastCategory: "Commit", closeDate: "2027-02-01" }];
  near(E.scenario(ds, c, {}).delta, 0);
  near(E.scenario(ds, c, { A: "won" }).delta, 100000 - 85000);
  near(E.scenario(ds, c, { B: "lost" }).delta, -22500);
  near(E.scenario(ds, c, { C: "pull" }).delta, 68000);
  near(E.scenario(ds, c, { C: "won" }).delta, 80000);
  const s = E.scenario(ds, c, { A: "won" }); eq(s.reps.length, 1); near(s.reps[0].won, 100000);
  // Priya quota 15% of 1m = 150k; closed 18% of 400k = 72k; room 78k at 10% + 22k at 15%
  near(s.commission, 78000 * 0.1 + 22000 * 0.15);
});
t("Capacity: ramp steps; fully ramped reps with no attrition give quota × productivity", () => {
  eq(E.rampFactor(0), 0); eq(E.rampFactor(3), 0.33); eq(E.rampFactor(9), 1);
  const p = { target: 0, attrition: 0, hires: 0, hireMonth: 1, productivity: 1, quarterQuota: 1000000 };
  const cap = E.capacityPlan(p);
  // Every rep is ramped by Feb 2027 except those still in months 0-8 in January; check against an explicit sum.
  let expect = 0; for (const r of E.REPS) for (let m = 0; m < 12; m++) expect += (4e6 * r.quotaShare / 12) * E.rampFactor(E.tenureMonths(r.start, "2027-" + String(m + 1).padStart(2, "0") + "-15"));
  near(cap.total, expect);
});
t("Capacity: more hires never reduce capacity, and hiresNeeded closes the gap", () => {
  const base = { target: 9500000, attrition: 0.15, hires: 0, hireMonth: 2, productivity: 0.95, quarterQuota: 2200000 };
  let prev = -1; for (let h = 0; h < 8; h++) { const c = E.capacityPlan({ ...base, hires: h }).total; if (c < prev) throw new Error("drops at " + h); prev = c; }
  const need = E.capacityPlan(base).hiresNeeded; if (need == null) throw new Error("no answer");
  if (E.capacityPlan({ ...base, hires: need }).total < base.target) throw new Error("not enough");
  if (need > 0 && E.capacityPlan({ ...base, hires: need - 1 }).total >= base.target) throw new Error("one fewer would do");
});
t("Activity: one row per rep and SDR, all counts positive, held ≤ booked, connects ≤ calls", () => {
  const A = E.generateActivity(); eq(A.reps.length, E.REPS.length); eq(A.sdrs.length, E.SDRS.length);
  for (const x of A.reps) if (!(x.calls > 0 && x.emails > 0 && x.meetings > 0)) throw new Error(x.name);
  for (const x of A.sdrs) if (!(x.held <= x.booked && x.connects <= x.calls)) throw new Error(x.name);
});
t("Health score worked example", () => {
  const h = E.healthScore({ usageTrend: -0.3, p1Tickets: 2, sponsorEngaged: false, nps: -5, latePayment: true, championLeft: false });
  eq(h.score, 100 - 30 - 16 - 15 - 15 - 10); eq(h.band, "Critical"); eq(h.drivers[0].pts, 30);
  eq(E.healthScore({ usageTrend: 0.1, p1Tickets: 0, sponsorEngaged: true, nps: 50, latePayment: false, championLeft: false }).score, 100);
});
t("Renewals: dates in the next six months, forecast within ARR, bands reconcile", () => {
  const RN = E.generateRenewals("2026-11-04"), rr = E.renewalReport(RN);
  for (const a of RN) if (a.renewalDate <= "2026-11-04" || a.renewalDate > "2027-05-10") throw new Error(a.id);
  if (!(rr.forecast <= rr.arr && rr.forecast > 0)) throw new Error("forecast"); eq(rr.bands.reduce((a, b) => a + b.accounts, 0), rr.accounts); near(rr.bands.reduce((a, b) => a + b.arr, 0), rr.arr);
});
t("Attribution: every model credits exactly the total pipeline; last touch matches the channel table", () => {
  const byId = Object.fromEntries(AD.map((d) => [d.id, d])), T = E.generateTouches(LD), at = E.attribution(LD, byId, T);
  near(at.total, MR.pipeline);
  for (const m of ["first", "last", "linear", "position"]) near(at.channels.reduce((a, c) => a + c[m], 0), at.total, m);
  for (const c of at.channels) near(c.last, MR.byChannel.find((x) => x.channel === c.channel).pipeline, c.channel);
  for (const n of [1, 2, 3, 6]) for (const fn of Object.values(E.MODELS)) near(fn(n).reduce((a, b) => a + b, 0), 1);
});
t("CSV: quotes, embedded commas, £ amounts, UK dates and header aliases", () => {
  const r = E.importDeals('Opportunity ID,Account Name,Opportunity Owner,Stage,Amount,Close Date,Forecast Category\r\nA1,"Smith, Jones & Co",Jo Bloggs,Negotiation,"£12,500.50",31/12/2026,Best Case\r\n');
  eq(r.errors.length, 0); eq(r.deals[0].account, "Smith, Jones & Co"); near(r.deals[0].amount, 12500.5); eq(r.deals[0].closeDate, "2026-12-31"); eq(r.deals[0].forecastCategory, "Best Case");
});
t("CSV: bad rows are reported by row number and the good rows still load", () => {
  const r = E.importDeals("id,owner,stage,amount,closeDate,forecastCategory\nA,Jo,Proposal,1000,2026-12-01,Commit\nB,Jo,Bogus,abc,13/13/2026,Maybe\n");
  eq(r.deals.length, 1); eq(r.errors.length, 1); eq(r.errors[0].row, 3); if (!/stage/.test(r.errors[0].message) || !/amount/.test(r.errors[0].message) || !/category/.test(r.errors[0].message)) throw new Error(r.errors[0].message);
});
t("CSV: missing required columns are named", () => {
  const r = E.importDeals("id,owner,amount\nA,Jo,10\n"); eq(r.deals.length, 0); if (!/stage/.test(r.errors[0].message)) throw new Error(r.errors[0].message);
});
t("CSV: imported deals without dates or MEDDPICC run cleanly through hygiene, coverage and landing", () => {
  const r = E.importDeals("id,owner,stage,amount,closeDate,forecastCategory\nA,Jo,Proposal,1000,2026-12-01,Commit\nB,Al,Discovery,500,2026-10-20,Pipeline\n");
  const rep = E.importedReport(r.deals, { ...ctx, quota: 10000, closedWon: 0 });
  eq(rep.hygiene.total, 2); eq(rep.hygiene.deals[0].flags.length, 0); eq(rep.hygiene.deals[1].flags[0].id, "pastClose");
  near(rep.landing.likely, 1000 * 0.85 + 500 * 0.15 * 0.5); eq(rep.owners.length, 2);
  if (rep.hygiene.deals.some((d) => d.steps.some((s) => /MEDDPICC/.test(s.source)))) throw new Error("MEDDPICC steps without data");
  if (!r.skipped.some((x) => /next step/.test(x))) throw new Error("skipped checks not reported");
});

t("Commission by team: reps, quota, closed and payouts reconcile to the company; override is 2% of closed", () => {
  const cr = E.commissionReport(AD, dctx), T = E.commissionByTeam(cr, dctx);
  eq(T.length, 3); eq(T.reduce((a, x) => a + x.reps, 0), E.REPS.length);
  near(T.reduce((a, x) => a + x.quota, 0), dctx.quota); near(T.reduce((a, x) => a + x.closed, 0), dctx.closedWon);
  near(T.reduce((a, x) => a + x.repEarned, 0), cr.totals.earned); near(T.reduce((a, x) => a + x.repExpected, 0), cr.totals.expected);
  for (const x of T) { near(x.overrideEarned, x.closed * 0.02); near(x.totalEarned, x.repEarned + x.overrideEarned); if (!(x.costOfSales > 0 && x.costOfSales < 0.2)) throw new Error(x.team + " cost " + x.costOfSales); }
});


// ---------- v2: thresholds, manager view, definitions, sample calculations ----------
t("MEDDPICC: every element has a unique code and short label; the three decision elements are distinct", () => {
  const codes = E.MEDDPICC.map((m) => m.code), shorts = E.MEDDPICC.map((m) => m.short);
  eq(new Set(codes).size, 8, "codes"); eq(new Set(shorts).size, 8, "short labels");
  const dec = E.MEDDPICC.filter((m) => /Economic buyer|Decision/.test(m.name)).map((m) => m.code).join(",");
  eq(dec, "EB,DC,DP");
});
t("Thresholds: Good, Watch and Act boundaries work both ways (higher-is-better and lower-is-better)", () => {
  eq(E.level("nrr", 1.10), "good"); eq(E.level("nrr", 1.0999), "warn"); eq(E.level("nrr", 1.00), "warn"); eq(E.level("nrr", 0.999), "bad");
  eq(E.level("payback", 18), "good"); eq(E.level("payback", 18.1), "warn"); eq(E.level("payback", 30), "warn"); eq(E.level("payback", 30.1), "bad");
  eq(E.level("firstTouch", 12), "good"); eq(E.level("firstTouch", 25), "bad"); eq(E.rate("grr", 0.9), "good");
});
t("Thresholds: every line has a label, a reason and an example that classifies", () => {
  for (const [k, th] of Object.entries(E.THRESHOLDS)) {
    if (!th.label || !th.why || th.example == null) throw new Error(k + " incomplete");
    if (!(th.up ? th.good > th.ok : th.good < th.ok)) throw new Error(k + " lines out of order");
    if (!["good", "warn", "bad"].includes(E.level(k, th.example))) throw new Error(k);
  }
});
t("Thresholds: confidence, tenure and account health words come from the shared lines", () => {
  const rep = { ...E.REPS[0], ttmAttainment: 1.2 }; eq(E.repTenure(rep, "2026-11-04").verdict, "Ahead for tenure");
  eq(E.healthScore({ usageTrend: -0.25, p1Tickets: 1, sponsorEngaged: false, nps: 40 }).band, "At risk");
  eq(E.healthScore({ usageTrend: 0.1, p1Tickets: 0, sponsorEngaged: true, nps: 50 }).band, "Healthy");
});
t("Manager view: each rep's quarters average exactly to their TTM attainment", () => {
  for (const r of E.repQuarters()) { const v = r.quarters.filter((q) => q.attainment != null).map((q) => q.attainment);
    near(v.reduce((a, b) => a + b, 0) / v.length, E.repOf(r.name).ttmAttainment, r.name);
    if (v.some((x) => x < 0.2 || x > 1.6)) throw new Error(r.name + " out of range"); }
});
t("Manager view: quarters before a rep started are blank, not zero", () => {
  const q = Object.fromEntries(E.repQuarters().map((r) => [r.name, r.quarters.map((x) => x.attainment)]));
  eq(q["Sofia Marin"][0], null); eq(q["Sofia Marin"][1], null); if (q["Sofia Marin"][2] == null) throw new Error("Sofia Q2");
  eq(q["Liam Carter"][0], null); if (q["Priya Shah"].some((x) => x == null)) throw new Error("Priya");
});
t("Rep trend: 4 points a quarter either way is the line; fewer than two quarters is too early", () => {
  eq(E.trendOf([0.92, 0.85, 0.78, 0.70]).label, "Declining"); eq(E.trendOf([0.6, 0.7, 0.8]).label, "Improving");
  eq(E.trendOf([1.0, 1.02, 0.99, 1.01]).label, "Steady"); eq(E.trendOf([0.7]).label, "Too early");
  near(E.slopeOf([0.92, 0.85, 0.78, 0.70]), -0.073);
});
t("Manager view: rep deals and wins add up to the company's TTM, so rep win rates reconcile with the metrics tab", () => {
  const opps = E.generateOppHistory(), mv = E.managerView(opps, E.attributeDeals(E.generateDeals("2026-11-04")), { ...ctx, quota: 2200000, closedWon: 1150000 });
  const C = opps.filter((o) => o.closeQi >= E.NQ - 4 && o.reached >= 1), W = C.filter((o) => o.won).length;
  eq(mv.reps.reduce((a, r) => a + r.closed, 0), C.length); eq(mv.reps.reduce((a, r) => a + r.won, 0), W);
  eq(mv.reps.length, E.REPS.length); eq(new Set(mv.reps.map((r) => r.rank)).size, E.REPS.length);
  for (const r of mv.reps) if (r.won > r.closed) throw new Error(r.name);
  eq(mv.teams.length, 3); eq(mv.teams.reduce((a, t) => a + t.reps.length, 0), E.REPS.length);
});
t("Definitions: unique keys, and every link to a threshold or worked example resolves", () => {
  eq(new Set(E.GLOSSARY.map((g) => g.key)).size, E.GLOSSARY.length);
  const calcs = new Set(E.SAMPLE_CALCS.map((c) => c.key));
  for (const g of E.GLOSSARY) {
    if (!E.GROUPS.includes(g.group)) throw new Error(g.key + " group");
    if (g.calc && !calcs.has(g.calc)) throw new Error(g.key + " calc"); if (g.threshold && !E.THRESHOLDS[g.threshold]) throw new Error(g.key + " threshold");
    if (!g.short || g.short.length > 260) throw new Error(g.key + " hover text");
  }
  for (const m of E.MEDDPICC) if (!E.GLOSS["mp_" + m.code]) throw new Error("no definition for " + m.name);
  for (const r of E.RULES) if (!E.GLOSS["rule_" + r.id]) throw new Error("no definition for " + r.label);
  for (const c of E.SAMPLE_CALCS) if (!E.GLOSSARY.some((g) => g.calc === c.key)) throw new Error(c.key + " unlinked");
});
t("Sample calculations: every example runs, and the worked figures are right", () => {
  const R = Object.fromEntries(E.SAMPLE_CALCS.map((c) => [c.key, c.run()]));
  for (const [k, r] of Object.entries(R)) if (!r.steps || !r.steps.length) throw new Error(k);
  const cv = R.coverage.out; near(cv.rawCoverage, 3); near(cv.cleanCoverage, 2); near(cv.required, 4); near(cv.pipelineNeeded, 2400000);
  const l = R.landing.out; near(l.floor, 640000); near(l.likely, 965000); near(l.stretch, 1360000);
  near(R.weightedCoverage.value, 760000 / 600000); eq(R.health.value, 64); near(R.retention.value, 1.06);
  near(R.efficiency.value, 1200000 / (900000 * 0.78 / 12)); eq(R.confidence.value, 60); near(R.tenure.value, 0.66 / 0.7);
  eq(R.cycle.value, 82); near(R.velocity.value, 40 * 50000 * 0.3 / 90); eq(E.dealCommission(50000, 0.1, 200000, 180000, 1.5), 6500);
});
t("Definitions: every term says where the data usually lives, with other places it may be", () => {
  for (const g of E.GLOSSARY) { if (!g.where || !g.where.usual || !g.where.others) throw new Error("no 'where to find it' for " + g.key);
    if (g.where.others.split(",").length < 2) throw new Error(g.key + " needs more than one other place"); }
  eq(Object.keys(E.WHERE).length, E.GLOSSARY.length, "no stray entries");
});
t("Definitions: each hygiene rule states its real weight, and the health entry lists all seven", () => {
  for (const r of E.RULES) { const g = E.GLOSS["rule_" + r.id]; if (!g.short.includes(`Weight ${r.weight} of ${E.MAX_WEIGHT}.`)) throw new Error(r.id + ": " + g.short);
    if (!/changed at any time/.test(g.more)) throw new Error(r.id + " caveat"); if ((g.short.match(/Weight \d/g) || []).length !== 1) throw new Error(r.id + " weight stated twice"); }
  const h = E.GLOSS.health.more; for (const r of E.RULES) if (!h.includes(r.label.toLowerCase() + " (" + r.weight + ")")) throw new Error("health entry missing " + r.id);
});
t("Page: every ? icon points at a term that has a definition", () => {
  const page = require("fs").readFileSync(require("path").join(__dirname, "../src/page.html"), "utf8");
  const used = [...page.matchAll(/data-def="([A-Za-z_]+)"/g), ...page.matchAll(/help\("([A-Za-z_]+)"\)/g)].map((m) => m[1]);
  for (const k of used) if (!E.GLOSS[k]) throw new Error("no definition for " + k);
});

results.forEach((r) => console.log(r[0], r[1]));
console.log(`\n${pass} passed, ${fail} failed`);
const rep = E.hygieneReport(E.generateDeals("2026-11-04"), ctx);
console.log("sample:", rep.total, "deals,", rep.cleanCount, "clean;", rep.byRule.map(r => r.id + "=" + r.count).join(" "));
const cov = E.coverage(E.generateDeals("2026-11-04"), { ...ctx, quota: 2400000, closedWon: 1150000, winRate: 0.28 });
console.log("cov:", cov.inPeriodCount, Math.round(cov.raw), cov.rawCoverage.toFixed(2), cov.cleanCoverage.toFixed(2), cov.verdict.level);
process.exit(fail ? 1 : 0);
