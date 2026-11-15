// Правильность работы: отметка «изменено» для методиста, выгрузка по фильтру и «только новые», повторы между партиями.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { otpechatok, parseDump } from '../lib/baza.js';
import { openDb } from '../lib/db.js';
import { demoModel } from '../lib/demo.js';
import { proveritZadanie } from '../lib/proverka.js';
import { sozdatPrilozhenie } from '../server.js';
import { OTVETY, zagruzitDemoBazu, zagruzitDemoUchebnik } from './dannye.js';

const DEMO = OTVETY;
const PAROL = 'test-parol-gruppa-a';
const baza = zagruzitDemoBazu();
const uchebnik = zagruzitDemoUchebnik();
const pauza = ms => new Promise(r => setTimeout(r, ms));

async function podnyat(provayder) {
  const db = openDb(':memory:');
  const server = sozdatPrilozhenie({ db, baza, uchebnik, parol: PAROL, provayder, instrukcii: { avtor: '', fakty: '', metodist: '', redaktor: '' } });
  await new Promise(r => server.listen(0, '127.0.0.1', r));
  const url = `http://127.0.0.1:${server.address().port}`;
  const vhod = await fetch(url + '/api/vhod', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ parol: PAROL }) });
  const cookie = vhod.headers.get('set-cookie').split(';')[0];
  const zapros = async (put, { method = 'GET', telo } = {}) => {
    const res = await fetch(url + put, { method, headers: { cookie, ...(telo ? { 'content-type': 'application/json' } : {}) }, body: telo ? JSON.stringify(telo) : undefined });
    const tip = res.headers.get('content-type') ?? '';
    return { kod: res.status, headers: res.headers, data: tip.includes('json') && !put.startsWith('/eksport') ? await res.json() : await res.text() };
  };
  const dozhdatsya = async id => {
    for (let i = 0; i < 300; i++) {
      const p = (await zapros(`/api/partii/${id}`)).data;
      if (p.status !== 'idet' && p.status !== 'ochered') return p;
      await pauza(10);
    }
    throw new Error('партия не закончилась');
  };
  const zakryt = async () => {
    for (let i = 0; i < 300 && (db.idetPartiya() || db.estOchered()); i++) await pauza(10);
    await new Promise(r => server.close(r));
    db.close();
  };
  return { zapros, dozhdatsya, zakryt, db };
}

test('методист: задание, которое редактор изменил, отмечено izmeneno', async () => {
  const osnova = demoModel(DEMO, 1);
  const provayder = {
    ...osnova,
    sozdat: () => ({
      ...osnova,
      // Редактор меняет только задание 1.
      async redaktor(k) {
        const r = await osnova.redaktor(k);
        return r.map(x => (x.n === 1 ? { ...x, zadanie: { ...x.zadanie, quest: '<p>Уточнене запитання редактора?</p>' } } : x));
      },
    }),
  };
  const s = await podnyat(provayder);
  try {
    const { id } = (await s.zapros('/api/partii', { method: 'POST', telo: { par: 1, skolko: 3 } })).data;
    const p = await s.dozhdatsya(id);
    assert.equal(p.status, 'gotovo');
    assert.equal(p.zadaniya.find(z => z.n === 1).metodist.izmeneno, true);
    assert.equal(p.zadaniya.find(z => z.n === 2).metodist.izmeneno, false);
  } finally {
    await s.zakryt();
  }
});

test('выгрузка: по параграфу, «только новые» и отметка о выгрузке', async () => {
  const s = await podnyat(demoModel(DEMO, 1));
  try {
    const { id } = (await s.zapros('/api/partii', { method: 'POST', telo: { par: 1, skolko: 3 } })).data;
    const p = await s.dozhdatsya(id);
    for (const z of p.zadaniya.slice(0, 2)) await s.zapros(`/api/zadaniya/${z.id}`, { method: 'PATCH', telo: { status: 'prinyato' } });

    assert.equal(parseDump((await s.zapros('/eksport/zavdannia.sql?par=2')).data).length, 0);
    const pervaya = await s.zapros('/eksport/zavdannia.sql?par=1&novye=1');
    assert.match(pervaya.headers.get('content-disposition'), /zavdannia-par1\.sql/);
    assert.equal(parseDump(pervaya.data).length, 2);
    // Те же задания второй раз как «новые» не выгружаются, а без фильтра — выгружаются.
    assert.equal(parseDump((await s.zapros('/eksport/zavdannia.sql?par=1&novye=1')).data).length, 0);
    assert.equal(JSON.parse((await s.zapros('/eksport/zavdannia.json')).data).length, 2);
    const lib = (await s.zapros('/api/biblioteka')).data;
    assert.ok(lib.every(z => z.vygruzheno));

    // Новое принятое задание выгружается как новое.
    await s.zapros(`/api/zadaniya/${p.zadaniya[2].id}`, { method: 'PATCH', telo: { status: 'prinyato' } });
    assert.equal(parseDump((await s.zapros('/eksport/zavdannia.sql?novye=1')).data).length, 1);
  } finally {
    await s.zakryt();
  }
});

test('повтор между партиями: проверка кодом называет партию и номер', () => {
  const t = {
    quest: '<p>Що безпосередньо спричинило повстання киян проти Ізяслава в 1068 р.?</p>',
    ansa: '<p>а</p>', ansb: '<p>б</p>', ansc: '<p>в</p>', ansd: '<p>г</p>', result: 'a',
    explanation: '<p>ТЕМА: x</p><p>Відповідь – А.</p>', opora: { str: 60, citata: '' },
  };
  const { stranicy } = uchebnik.paragraf(1);
  const takoyZhe = { id: 5, n: 2, partiya: 15, vopros: 'x', fp: otpechatok('Що безпосередньо спричинило повстання киян проти Ізяслава в 1068 р.?') };
  const drugoy = { id: 6, n: 4, partiya: 15, vopros: 'y', fp: otpechatok('Хто заснував Києво-Печерську лавру?') };
  const s = proveritZadanie(t, { stranicy, paragraf: [drugoy, takoyZhe] });
  assert.ok(s.oshibki.some(o => /схоже на завдання 2 з партії №15 \(\d+%\)/.test(o)));
  const bez = proveritZadanie(t, { stranicy, paragraf: [drugoy] });
  assert.ok(!bez.oshibki.some(o => o.includes('з партії')));
});
