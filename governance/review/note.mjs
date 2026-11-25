// The note a person reads before deciding: the reviewer's verdict with the kit's proof
// results, in the configured language. The kit writes the headings; the reviewer wrote
// the text. Headings exist in English and Traditional Chinese; other languages get English.

const HEADINGS = {
  en: {
    title: 'Review',
    view: { accept: 'Accept', concerns: 'Concerns', reject: 'Reject' },
    changed: 'What changed',
    criteria: 'Acceptance criteria',
    result: { met: '✅ met', not_met: '❌ not met', unclear: '⚠️ unclear' },
    findings: 'Findings',
    classes: { act_on: 'act on', consider: 'consider', noted: 'noted' },
    proof: { proven: 'proven by a failing test', not_reproduced: 'not reproduced: the test passed', refused: 'reproduction refused', error: 'reproduction did not run' },
    downgraded: 'shown as "consider" because it was not proven',
    scope: 'Scope',
    scopeOk: (n) => `all ${n} changed file(s) are inside the brief's scope`,
    scopeOutside: (n, total) => `${n} of ${total} changed file(s) are outside the brief's scope`,
    forbidden: (glob) => `a path the brief forbids (${glob})`,
    notAllowed: "outside the brief's allowed paths",
    byScope: "proven by the kit's scope check",
    byKit: 'found by the kit',
    none: 'none',
    read: 'Read',
    reviewer: 'Reviewer',
  },
  'zh-TW': {
    title: '審查',
    view: { accept: '可以接受', concerns: '有疑慮', reject: '建議拒絕' },
    changed: '改了什麼',
    criteria: '對照驗收條件',
    result: { met: '✅ 符合', not_met: '❌ 不符合', unclear: '⚠️ 不確定' },
    findings: '發現的問題',
    classes: { act_on: '要處理', consider: '可以考慮', noted: '記錄一下' },
    proof: { proven: '已用失敗的測試證明', not_reproduced: '沒有重現：測試通過了', refused: '重現方式被拒絕執行', error: '重現方式沒有跑成' },
    downgraded: '沒有證明，所以列為「可以考慮」',
    scope: '修改範圍',
    scopeOk: (n) => `改到的 ${n} 個檔案都在任務說明的範圍內`,
    scopeOutside: (n, total) => `改到的 ${total} 個檔案中，有 ${n} 個超出任務說明的範圍`,
    forbidden: (glob) => `任務說明禁止修改的路徑（${glob}）`,
    notAllowed: '不在任務說明允許的路徑內',
    byScope: '已由 kit 的範圍檢查證明',
    byKit: 'kit 找到的',
    none: '沒有',
    read: '只需要看',
    reviewer: 'Reviewer',
  },
};

export const headingsFor = (language) => HEADINGS[language] ?? HEADINGS[language?.split('-')[0]] ?? HEADINGS.en;

/**
 * @param {{ verdict: object, proofs: object[], final: { decision: string, findings: object[] }, meta: object, language: string }} input
 */
export function renderNote({ verdict, final, proofs, meta, language }) {
  const h = headingsFor(language);
  const proofOf = new Map(proofs.map((p) => [p.id, p]));
  const lines = [`# ${h.title}: ${meta.task_id} ${meta.title ?? ''}`.trimEnd(), ''];
  lines.push(`**${h.view[final.decision]}.** ${verdict.summary}`, '');
  if (verdict.changed?.length) {
    lines.push(`## ${h.changed}`, '', ...verdict.changed.map((c) => `- ${c}`), '');
  }
  lines.push(`## ${h.criteria}`, '', '| | |', '|---|---|');
  for (const c of verdict.criteria) lines.push(`| ${c.id} | ${h.result[c.result]}${c.note ? ` ${c.note.replace(/\|/g, '/')}` : ''} |`);
  if (final.scope) {
    const { outside, changed } = final.scope;
    lines.push('', `## ${h.scope}`, '', outside.length ? h.scopeOutside(outside.length, changed) : h.scopeOk(changed));
    for (const o of outside) lines.push(`- \`${o.path}\`: ${o.reason === 'forbidden' ? h.forbidden(o.glob) : h.notAllowed}`);
  }
  lines.push('', `## ${h.findings}`, '');
  if (final.findings.length === 0) lines.push(h.none);
  for (const f of final.findings) {
    const proof = proofOf.get(f.id);
    const where = f.file ? ` (\`${f.file}${f.line ? `:${f.line}` : ''}\`)` : '';
    const title = f.by === 'kit' ? `${h.byKit}: ${f.scope_reason === 'forbidden' ? h.forbidden(final.scope?.outside.find((o) => o.path === f.file)?.glob ?? '') : h.notAllowed}` : f.title;
    lines.push(`- **${h.classes[f.class]}** ${title}${where}`);
    if (f.detail) lines.push(`  ${f.detail}`);
    if (f.proven_by === 'scope') lines.push(`  ${h.byScope}`);
    else if (proof) lines.push(`  ${h.proof[proof.status]}${proof.status === 'refused' ? `: ${proof.detail}` : ''}`);
    if (f.downgraded) lines.push(`  ${h.downgraded}`);
  }
  if (verdict.read_first?.length) lines.push('', `## ${h.read}`, '', ...verdict.read_first.map((r) => `- ${r}`));
  lines.push('', `${h.reviewer} ${meta.reviewer}: ${meta.model}, effort ${meta.effort}, ${meta.sha.slice(0, 12)}`, '');
  return lines.join('\n');
}
