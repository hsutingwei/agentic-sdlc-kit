// Scoring a regression run: which planted defects each reviewer found, how sure it was
// (act_on, and proven), and what it raised on the clean changes.

export const LINE_WINDOW = 5;

const norm = (p) => String(p ?? '').replace(/\\/g, '/').replace(/^\.\//, '');
const base = (p) => norm(p).split('/').at(-1);

/** Whether a finding points at a defect: the same file and a nearby line or one of its words. */
export function matches(finding, defect, where, window = LINE_WINDOW) {
  const text = `${finding.title ?? ''} ${finding.detail ?? ''}`.toLowerCase();
  const worded = defect.keywords.some((k) => text.includes(k.toLowerCase()));
  if (finding.file) {
    if (norm(finding.file) !== norm(defect.file)) return false;
    const near = where && typeof finding.line === 'number' && Math.abs(finding.line - where.line) <= window;
    return near || worded;
  }
  // No file named: the words must name both the file and the defect.
  return worded && text.includes(base(defect.file).toLowerCase());
}

/**
 * @param {object[]} entries  [{ case, variant, defects (where), suite, result }]
 */
export function scoreRun(entries) {
  const cases = new Map();
  const totals = { defects: 0, hit: 0, act_on: 0, proven: 0, missed: 0, clean: 0, clean_accepted: 0, false_alarms: 0, seeded: 0, seeded_flagged: 0, not_reviewed: 0, cost_usd: 0 };
  for (const e of entries) {
    const row = cases.get(e.case) ?? { case: e.case };
    const r = e.result;
    totals.cost_usd += r?.cost_usd ?? 0;
    if (!r || r.status !== 'done') {
      totals.not_reviewed++;
      row[e.variant] = { status: r?.status ?? 'missing', problem: r?.problem };
      if (e.variant === 'seeded') {
        totals.defects += e.suite.defects.length;
        totals.missed += e.suite.defects.length;
      }
      cases.set(e.case, row);
      continue;
    }
    const findings = r.final.findings;
    if (e.variant === 'seeded') {
      totals.seeded++;
      if (r.final.decision !== 'accept') totals.seeded_flagged++;
      const defects = e.suite.defects.map((d) => {
        const hits = findings.filter((f) => matches(f, d, e.defects[d.id]));
        const out = { id: d.id, hit: hits.length > 0, act_on: hits.some((f) => f.class === 'act_on'), proven: hits.some((f) => f.proven) };
        totals.defects++;
        if (out.hit) totals.hit++;
        else totals.missed++;
        if (out.act_on) totals.act_on++;
        if (out.proven) totals.proven++;
        return out;
      });
      row.seeded = { status: 'done', decision: r.final.decision, defects };
    } else {
      totals.clean++;
      const alarms = findings.filter((f) => f.class === 'act_on').length;
      if (r.final.decision === 'accept') totals.clean_accepted++;
      totals.false_alarms += alarms;
      row.real = { status: 'done', decision: r.final.decision, false_alarms: alarms, stated_act_on: r.verdict.findings.filter((f) => f.class === 'act_on').length };
    }
    cases.set(e.case, row);
  }
  totals.cost_usd = Math.round(totals.cost_usd * 100) / 100;
  return { totals, cases: [...cases.values()].sort((a, b) => (a.case < b.case ? -1 : 1)) };
}

/** What got worse since the baseline: defects found then and missed now, more false alarms. */
export function compareScores(baseline, current) {
  const found = new Map();
  for (const c of current.cases) for (const d of c.seeded?.defects ?? []) found.set(`${c.case}/${d.id}`, d);
  const regressions = [];
  for (const [key, was] of Object.entries(baseline.defects ?? {})) {
    const now = found.get(key);
    if (was.hit && !now?.hit) regressions.push(`${key} was found, now missed`);
    else if (was.act_on && now && !now.act_on) regressions.push(`${key} was act_on, now only ${now.hit ? 'consider or noted' : 'missed'}`);
  }
  for (const c of current.cases) {
    const was = baseline.false_alarms?.[c.case] ?? 0;
    const now = c.real?.false_alarms ?? 0;
    if (now > was) regressions.push(`${c.case} clean change: ${now} false alarm(s), was ${was}`);
  }
  return regressions;
}

/** The part of a score that a baseline keeps: per defect and per clean change, numbers only. */
export function baselineOf(score, meta) {
  const defects = {};
  const falseAlarms = {};
  for (const c of score.cases) {
    for (const d of c.seeded?.defects ?? []) defects[`${c.case}/${d.id}`] = { hit: d.hit, act_on: d.act_on, proven: d.proven };
    if (c.real?.status === 'done') falseAlarms[c.case] = c.real.false_alarms;
  }
  return { schema_version: 1, ...meta, totals: score.totals, defects, false_alarms: falseAlarms };
}

export function scoreMarkdown(score, meta) {
  const t = score.totals;
  const pct = (a, b) => (b ? `${Math.round((100 * a) / b)} %` : '–');
  const lines = [
    `# Skill regression: ${meta.label ?? meta.model}`,
    '',
    `Reviewer \`${meta.reviewer_sha256.slice(0, 12)}\` (reviewer.md), ${meta.model} at ${meta.effort} effort, Claude Code ${meta.claude_version ?? 'unknown'}, kit ${meta.kit_commit?.slice(0, 7) ?? 'unknown'}, ${meta.date}.`,
    '',
    '| | |',
    '|---|---|',
    `| Planted defects found | ${t.hit} of ${t.defects} (${pct(t.hit, t.defects)}) |`,
    `| … as act_on | ${t.act_on} |`,
    `| … proven by a reproduction | ${t.proven} |`,
    `| Seeded changes not accepted | ${t.seeded_flagged} of ${t.seeded} |`,
    `| Clean changes accepted | ${t.clean_accepted} of ${t.clean} |`,
    `| False alarms (act_on on a clean change, after proofs) | ${t.false_alarms} |`,
    `| Runs without a usable verdict | ${t.not_reviewed} |`,
    `| List price, USD | ${t.cost_usd.toFixed(2)} |`,
    '',
    '| Case | Seeded decision | Defects (✓ found, ! act_on, ★ proven) | Clean decision | False alarms |',
    '|---|---|---|---|---|',
  ];
  for (const c of score.cases) {
    const d = c.seeded?.defects?.map((x) => `${x.id} ${x.hit ? '✓' : '✗'}${x.act_on ? '!' : ''}${x.proven ? '★' : ''}`).join(', ') ?? c.seeded?.status ?? '–';
    lines.push(`| ${c.case} | ${c.seeded?.decision ?? c.seeded?.status ?? '–'} | ${d} | ${c.real?.decision ?? c.real?.status ?? '–'} | ${c.real?.false_alarms ?? '–'} |`);
  }
  lines.push('');
  return lines.join('\n');
}
