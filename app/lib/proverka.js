// Проверка задания обычным кодом, без ИИ: формат, опора на учебник, сходство с базой и библиотекой.
// Сообщения видит заказчик, поэтому они на украинском.
import { plain, stems, samoePohozhee } from './baza.js';
import { squeeze } from './uchebnik.js';

export const BUKVY = { a: 'А', b: 'Б', c: 'В', d: 'Г' };
export const POROG_BAZA = 0.75;
export const POROG_BIBLIOTEKA = 0.8;

// paragraf — задания того же параграфа, которые ещё ждут проверки (из других партий), чтобы ловить повторы.
export function proveritZadanie(t, { stranicy, baza = [], biblioteka = [], paragraf = [] }) {
  const oshibki = [];
  const ans = ['a', 'b', 'c', 'd'].map(k => plain(t['ans' + k]));
  if (!ans.every(Boolean)) oshibki.push('порожній варіант відповіді');
  if (new Set(ans.map(a => a.toLowerCase())).size !== 4) oshibki.push('варіанти відповіді повторюються');

  const bukva = BUKVY[t.result];
  const poyasnenie = plain(t.explanation);
  if (!bukva) oshibki.push('не вказано правильну відповідь');
  else if (!poyasnenie.includes(`Відповідь – ${bukva}.`)) oshibki.push('літера в поясненні не збігається з відповіддю');
  if (!poyasnenie.includes('ТЕМА:')) oshibki.push('у поясненні немає рядка ТЕМА');

  const q = plain(t.quest);
  if (!q) oshibki.push('порожнє запитання');
  const sVoprosom = q.endsWith('?');
  if (ans.some(a => (sVoprosom ? a.endsWith('.') : a && !a.endsWith('.')))) {
    oshibki.push(sVoprosom ? 'після знака питання варіанти пишуться без крапки' : 'варіанти мають закінчуватися крапкою');
  }

  if (bukva) {
    const dliny = ans.map(a => a.length).sort((x, y) => x - y);
    const pravilnyy = plain(t['ans' + t.result]).length;
    if (pravilnyy === dliny[3] && pravilnyy > dliny[2] * 1.5) oshibki.push('правильний варіант помітно довший за інші');
    const sv = stems(t['ans' + t.result]);
    const obshchie = new Set([...stems(t.quest)].filter(w => sv.has(w)));
    if (obshchie.size) {
      // Показываем целые слова из правильного ответа, а не обрезанные основы («Ізяслав», а не «ізясла»).
      const slova = [...new Set((plain(t['ans' + t.result]).match(/[А-Яа-яІіЇїЄєҐґ'’]+|\d+/g) ?? [])
        .filter(w => [...stems(w)].some(s => obshchie.has(s))))];
      const spisok = (slova.length ? slova : [...obshchie]).map(w => `«${w}»`).join(', ');
      oshibki.push(`${slova.length > 1 ? 'слова' : 'слово'} ${spisok} є і в запитанні, і в правильній відповіді — це може підказати відповідь`);
    }
  }

  const op = t.opora ?? {};
  const citata = squeeze(op.citata);
  if (!citata) oshibki.push('немає цитати з підручника');
  else if (!(stranicy.get(Number(op.str)) ?? '').includes(citata)) {
    const gde = [...stranicy].filter(([, txt]) => txt.includes(citata)).map(([p]) => p);
    oshibki.push(`цитату не знайдено на с. ${op.str}` + (gde.length ? ` (знайдено на с. ${gde.join(', ')})` : ''));
  }
  if (String(op.citata ?? '').trim().split(/\s+/).length > 15) oshibki.push('цитата довша за 15 слів');

  const b = samoePohozhee(t.quest, baza);
  if (b.shodstvo >= POROG_BAZA) oshibki.push(`занадто схоже на завдання бази №${b.zapis.id} (${Math.round(b.shodstvo * 100)}%)`);
  const lib = samoePohozhee(t.quest, biblioteka);
  if (lib.shodstvo >= POROG_BIBLIOTEKA) oshibki.push(`таке завдання вже є в бібліотеці (${Math.round(lib.shodstvo * 100)}%)`);
  const sosed = samoePohozhee(t.quest, paragraf);
  if (sosed.shodstvo >= POROG_BIBLIOTEKA) {
    oshibki.push(`схоже на завдання ${sosed.zapis.n} з партії №${sosed.zapis.partiya} (${Math.round(sosed.shodstvo * 100)}%)`);
  }

  return {
    oshibki,
    shodstvo: b.shodstvo,
    id_bazy: b.zapis?.id ?? null,
    vopros_bazy: b.zapis?.vopros.slice(0, 160) ?? '',
  };
}
