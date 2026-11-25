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
  lines.push('', `## ${h.findings}`, '');
  if (final.findings.length === 0) lines.push(h.none);
  for (const f of final.findings) {
    const proof = proofOf.get(f.id);
    const where = f.file ? ` (\`${f.file}${f.line ? `:${f.line}` : ''}\`)` : '';
    lines.push(`- **${h.classes[f.class]}** ${f.title}${where}`);
    if (f.detail) lines.push(`  ${f.detail}`);
    if (proof) lines.push(`  ${h.proof[proof.status]}${proof.status === 'refused' ? `: ${proof.detail}` : ''}`);
    if (f.downgraded) lines.push(`  ${h.downgraded}`);
  }
  if (verdict.read_first?.length) lines.push('', `## ${h.read}`, '', ...verdict.read_first.map((r) => `- ${r}`));
  lines.push('', `${h.reviewer} ${meta.reviewer}: ${meta.model}, effort ${meta.effort}, ${meta.sha.slice(0, 12)}`, '');
  return lines.join('\n');
}
