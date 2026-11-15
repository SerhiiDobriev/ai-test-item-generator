// Демо-режим: вместо вызовов модели отдаёт заранее подготовленные ответы агентов из папки demo/otvety.
// Ни одного запроса к платным API. Настоящая модель имеет те же методы: avtor, fakty, metodist, redaktor.
import fs from 'node:fs';
import path from 'node:path';
import { plain } from './baza.js';
import { zapustitCepochku } from './cepochka.js';
import { BUKVY, tekstVHtml } from './format.js';
import { vZadanie } from './roli.js';

const pauza = ms => new Promise(r => setTimeout(r, ms));
const klyuch = quest => plain(`<p>${tekstVHtml(String(quest ?? '').trim())}</p>`).toLowerCase();

// Файлы par_NN.json: { par, zadaniya: [задание в формате ответа модели + fakty, metodist, pravka, izmeneniya] }.
export function zagruzitOtvety(papka) {
  const pul = new Map();
  for (const f of fs.readdirSync(papka).filter(x => /^par_\d+\.json$/.test(x)).sort()) {
    const { par, zadaniya } = JSON.parse(fs.readFileSync(path.join(papka, f), 'utf8'));
    pul.set(Number(par), zadaniya);
  }
  return pul;
}

// Стартовые данные демо, чтобы посетитель сразу видел результат:
// партия § 1 уже проверена человеком (4 принято, 1 отклонено), заказ из § 2 и § 3 ждёт проверки.
export async function zapolnitDemo({ db, uchebnik, baza, instrukcii, papka }) {
  const model = demoModel(papka, 0);
  const sdelat = async id => {
    db.nachat(id);
    await zapustitCepochku(id, { db, model, uchebnik, baza, instrukcii });
  };
  const pervaya = db.novayaPartiya(1, 5, 'demo');
  await sdelat(pervaya);
  db.zadaniyaPartii(pervaya).forEach((z, i) => db.status(z.id, i < 4 ? 'prinyato' : 'otkloneno'));
  const zakaz = db.noviyZakaz(null, [{ par: 2, skolko: 5 }, { par: 3, skolko: 5 }], 'demo');
  for (const id of zakaz.partii) await sdelat(id);
}

export function demoModel(papka, zhdat = 1200) {
  const pul = zagruzitOtvety(papka);
  // Партии идут по одной, поэтому достаточно помнить задания текущей партии по номеру.
  let vybrano = new Map();
  const zapis = n => vybrano.get(n) ?? {};

  return {
    rezhim: 'demo',
    paragrafy: [...pul.keys()],
    maksimum: 10,
    modeli: [],
    // Как у настоящих моделей: изменённые редактором задания ещё раз проходят проверку фактов.
    pereproveryat: true,
    sozdat() { return this; },

    // Сначала задания, которых ещё нет в параграфе, потом уже использованные (тогда сработает проверка на повтор).
    async avtor(k) {
      await pauza(zhdat);
      const vse = pul.get(k.par) ?? [];
      const uzhe = new Set((k.uzhe ?? []).map(q => q.toLowerCase()));
      const ispolzovano = z => uzhe.has(klyuch(z.quest)) || (z.pravka?.quest && uzhe.has(klyuch(z.pravka.quest)));
      const poryadok = [...vse.filter(z => !ispolzovano(z)), ...vse.filter(ispolzovano)].slice(0, k.skolko);
      vybrano = new Map(poryadok.map((z, i) => [i + 1, z]));
      return poryadok.map((z, i) => vZadanie(z, i + 1, k));
    },

    async fakty({ zadaniya }) {
      await pauza(zhdat);
      return zadaniya.map(z => {
        const d = zapis(z.n);
        return {
          n: z.n,
          verdikt: d.fakty?.verdikt ?? 'OK',
          citata: z.opora?.citata ?? '',
          str: z.opora?.str ?? 0,
          zamechaniya: d.fakty?.zamechaniya ?? [`Відповідь ${BUKVY[z.result]} правильна, цитата є на с. ${z.opora?.str}.`],
        };
      });
    },

    async metodist({ zadaniya }) {
      await pauza(zhdat);
      return zadaniya.map(z => {
        const d = zapis(z.n);
        return { n: z.n, verdikt: d.metodist?.verdikt ?? 'OK', zamechaniya: d.metodist?.zamechaniya ?? [] };
      });
    },

    // Редактор применяет подготовленную правку, если она есть.
    async redaktor(k) {
      await pauza(zhdat);
      return k.zadaniya.map(z => {
        const d = zapis(z.n);
        if (!d.pravka) return { n: z.n, zadanie: z, izmeneniya: d.izmeneniya ?? '' };
        return { n: z.n, zadanie: vZadanie({ ...d, ...d.pravka }, z.n, k), izmeneniya: d.izmeneniya ?? '' };
      });
    },
  };
}
