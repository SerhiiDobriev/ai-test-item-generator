// Приводит задание к формату базы заказчика: абзацы, строка ТЕМА, строка «Відповідь».
export const BUKVY = { a: 'А', b: 'Б', c: 'В', d: 'Г' };

export function tekstVHtml(s) {
  return String(s ?? '').replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;');
}

export function sobratZadanie(osnova, { quest, ansa, ansb, ansc, ansd, result, poyasnenie, tema }) {
  const trim = x => String(x ?? '').trim();
  const temaHtml = tema !== undefined
    ? tekstVHtml(trim(tema))
    : /<p><strong>(ТЕМА:[\s\S]*?)<\/strong><\/p>/.exec(osnova.explanation ?? '')?.[1] ?? 'ТЕМА:';
  const abzacy = trim(poyasnenie).split(/\n\s*\n|\n/).map(a => `<p>${tekstVHtml(a.trim())}</p>`).join('\r\n\r\n');
  return {
    ...osnova,
    quest: `<p>${tekstVHtml(trim(quest))}</p>`,
    ansa: tekstVHtml(trim(ansa)),
    ansb: tekstVHtml(trim(ansb)),
    ansc: tekstVHtml(trim(ansc)),
    ansd: tekstVHtml(trim(ansd)),
    result,
    explanation: `<p><strong>${temaHtml}</strong></p>\r\n\r\n${abzacy}\r\n\r\n<p><strong>Відповідь – ${BUKVY[result]}.</strong></p>\r\n`,
  };
}
