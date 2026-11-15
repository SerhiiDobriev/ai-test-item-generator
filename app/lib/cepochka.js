// Цепочка: автор, проверка кодом, проверка фактов, методист, правки и повторные проверки.
import { plain } from './baza.js';
import { proveritZadanie } from './proverka.js';

export const ETAPY = [
  { kod: 'avtor', nazvanie: 'Автор' },
  { kod: 'kod', nazvanie: 'Перевірка кодом' },
  { kod: 'fakty', nazvanie: 'Перевірка фактів' },
  { kod: 'metodist', nazvanie: 'Методист' },
  { kod: 'pravki', nazvanie: 'Правки' },
];

export async function zapustitCepochku(partiyaId, { db, model, uchebnik, baza, instrukcii }) {
  const p = db.partiya(partiyaId);
  try {
    const { tekst, stranicy } = uchebnik.paragraf(p.par);
    const opisanie = uchebnik.spisok.find(x => x.par === p.par);
    const kontekst = { par: p.par, skolko: p.skolko, tekst, opisanie };
    const proverit = z => proveritZadanie(z, { stranicy, baza, biblioteka: db.otpechatkiBiblioteki(), paragraf: db.otpechatkiParagrafa(p.par) });
    // Не повторять задания этого параграфа: принятые, ждущие проверки и сделанные прошлыми партиями заказа.
    const uzhe = db.voprosyParagrafa(p.par).map(plain);

    db.etap(partiyaId, 'avtor');
    const zadaniya = await model.avtor({ ...kontekst, uzhe, instrukciya: instrukcii.avtor });
    if (!Array.isArray(zadaniya) || !zadaniya.length) throw new Error('Автор не повернув завдань');

    db.etap(partiyaId, 'kod');
    const kod = zadaniya.map(z => ({ n: z.n, ...proverit(z) }));

    db.etap(partiyaId, 'fakty');
    let fakty = await model.fakty({ ...kontekst, zadaniya, instrukciya: instrukcii.fakty });

    db.etap(partiyaId, 'metodist');
    const metodist = await model.metodist({ ...kontekst, zadaniya, instrukciya: instrukcii.metodist });

    db.etap(partiyaId, 'pravki');
    const itog = await model.redaktor({ ...kontekst, zadaniya, kod, fakty, metodist, instrukciya: instrukcii.redaktor });

    // Какие задания редактор изменил: методист оценивал их первую версию (сайт покажет «виправлено»).
    const pervye = new Map(zadaniya.map(z => [z.n, JSON.stringify(z)]));
    const izmenennye = itog.filter(r => JSON.stringify(r.zadanie) !== pervye.get(r.n)).map(r => r.zadanie);
    const izmenenoN = new Set(izmenennye.map(z => z.n));

    // Правка могла внести новую ошибку, поэтому изменённые задания проверяем ещё раз (факты).
    if (model.pereproveryat) {
      if (izmenennye.length) {
        const povtor = await model.fakty({ ...kontekst, zadaniya: izmenennye, instrukciya: instrukcii.fakty });
        const novye = new Map(povtor.map(r => [r.n, r]));
        fakty = fakty.map(f => novye.get(f.n) ?? f);
      }
      fakty = fakty.map(f => ({ ...f, ostatochno: true }));
    }

    const poNomeru = (spisok, n) => spisok.find(r => r.n === n) ?? null;
    for (const r of itog) {
      db.dobavitZadanie(partiyaId, p.par, {
        dannye: r.zadanie,
        kod: proverit(r.zadanie),
        fakty: poNomeru(fakty, r.n),
        metodist: poNomeru(metodist, r.n) ? { ...poNomeru(metodist, r.n), izmeneno: izmenenoN.has(r.n) } : null,
        izmeneniya: r.izmeneniya,
      });
    }
    db.gotova(partiyaId, model.cena?.() ?? null, model.schet?.() ?? null);
  } catch (e) {
    console.error('Партия', partiyaId, e.message);
    db.oshibka(partiyaId, e.message, model.cena?.() ?? null, model.schet?.() ?? null);
  }
}
