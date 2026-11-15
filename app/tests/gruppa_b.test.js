// Удобство: отмена партий в очереди и понятный текст замечания о подсказке в ответе.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { openDb } from '../lib/db.js';
import { demoModel } from '../lib/demo.js';
import { proveritZadanie } from '../lib/proverka.js';
import { sozdatPrilozhenie } from '../server.js';
import { OTVETY, zagruzitDemoBazu, zagruzitDemoUchebnik } from './dannye.js';

const PAROL = 'test-parol-gruppa-b';
const uchebnik = zagruzitDemoUchebnik();
const pauza = ms => new Promise(r => setTimeout(r, ms));

test('партии заказа в очереди можно отменить, начатая доделывается', async () => {
  const db = openDb(':memory:');
  const server = sozdatPrilozhenie({
    db, uchebnik, parol: PAROL, provayder: demoModel(OTVETY, 30),
    baza: zagruzitDemoBazu(),
    instrukcii: { avtor: '', fakty: '', metodist: '', redaktor: '' },
  });
  await new Promise(r => server.listen(0, '127.0.0.1', r));
  const url = `http://127.0.0.1:${server.address().port}`;
  try {
    const vhod = await fetch(url + '/api/vhod', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ parol: PAROL }) });
    const cookie = vhod.headers.get('set-cookie').split(';')[0];
    const post = (put, telo) => fetch(url + put, { method: 'POST', headers: { cookie, 'content-type': 'application/json' }, body: JSON.stringify(telo) }).then(r => r.json());
    const zakaz = await post('/api/zakazy', { chasti: [{ par: 1, skolko: 25 }] });
    assert.equal(zakaz.partii.length, 3);
    assert.equal((await post(`/api/zakazy/${zakaz.id}/skasuvaty`, {})).skasovano, 2);
    for (let i = 0; i < 300 && db.idetPartiya(); i++) await pauza(10);
    const statusy = db.zakaz(zakaz.id).partii.map(p => [p.status, p.oshibka]);
    assert.equal(statusy[0][0], 'gotovo');
    assert.deepEqual(statusy.slice(1).map(s => s[0]), ['oshibka', 'oshibka']);
    assert.match(statusy[1][1], /Скасовано/);
    // Одна партия отменяется так же, но только пока она в очереди.
    assert.equal((await post(`/api/partii/${zakaz.partii[0]}/skasuvaty`, {})).skasovano, 0);
  } finally {
    await new Promise(r => server.close(r));
    db.close();
  }
});

test('замечание о подсказке называет целое слово, а не обрезок', () => {
  const t = {
    quest: '<p>Проти кого повстали кияни, коли Ізяслав відмовився видати зброю?</p>',
    ansa: '<p>Проти Ізяслава</p>', ansb: '<p>Проти половців</p>', ansc: '<p>Проти Всеслава</p>', ansd: '<p>Проти Святослава</p>', result: 'a',
    explanation: '<p>ТЕМА: x</p><p>Відповідь – А.</p>', opora: { str: 60, citata: '' },
  };
  const kod = proveritZadanie(t, { stranicy: uchebnik.paragraf(1).stranicy });
  const z = kod.oshibki.find(o => o.includes('підказати відповідь'));
  assert.ok(z, kod.oshibki.join(' | '));
  assert.match(z, /«Ізяслава»/);
  assert.ok(!/ізясла[,»\s]/.test(z));
});

test('выгрузка: JSON не ставит отметку, правка сбрасывает её; повтор неудачной партии только один раз', async () => {
  const db = openDb(':memory:');
  const server = sozdatPrilozhenie({
    db, uchebnik, parol: PAROL, provayder: demoModel(OTVETY, 1),
    baza: zagruzitDemoBazu(),
    instrukcii: { avtor: '', fakty: '', metodist: '', redaktor: '' },
  });
  await new Promise(r => server.listen(0, '127.0.0.1', r));
  const url = `http://127.0.0.1:${server.address().port}`;
  try {
    const vhod = await fetch(url + '/api/vhod', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ parol: PAROL }) });
    const cookie = vhod.headers.get('set-cookie').split(';')[0];
    const zapros = (put, method = 'GET', telo) => fetch(url + put, { method, headers: { cookie, ...(telo ? { 'content-type': 'application/json' } : {}) }, body: telo ? JSON.stringify(telo) : undefined });
    const { id } = await (await zapros('/api/partii', 'POST', { par: 1, skolko: 2 })).json();
    for (let i = 0; i < 300 && db.idetPartiya(); i++) await pauza(10);
    const [a] = db.zadaniyaPartii(id);
    await zapros(`/api/zadaniya/${a.id}`, 'PATCH', { status: 'prinyato' });

    await (await zapros('/eksport/zavdannia.json')).text();
    assert.equal(db.zadanie(a.id).vygruzheno, null);
    await (await zapros('/eksport/zavdannia.sql?novye=1')).text();
    assert.ok(db.zadanie(a.id).vygruzheno);
    const d = db.zadanie(a.id).dannye;
    const poyasnenie = [...d.explanation.matchAll(/<p>([\s\S]*?)<\/p>/g)].map(m => m[1]).filter(t => !t.startsWith('ТЕМА') && !t.startsWith('Відповідь')).join('\n');
    await zapros(`/api/zadaniya/${a.id}`, 'PATCH', { pravka: { quest: 'Нове запитання про Русь?', ansa: d.ansa.replace(/<\/?p>/g, ''), ansb: d.ansb.replace(/<\/?p>/g, ''), ansc: d.ansc.replace(/<\/?p>/g, ''), ansd: d.ansd.replace(/<\/?p>/g, ''), result: d.result, poyasnenie: poyasnenie || 'Пояснення.' } });
    assert.equal(db.zadanie(a.id).vygruzheno, null);

    // Неудачная партия: повтор создаёт одну новую, второй раз — 409.
    const plohaya = db.novayaPartiya(1, 1, 'demo', null, null);
    db.oshibka(plohaya, 'Модель повернула некоректну відповідь.');
    const r1 = await zapros(`/api/partii/${plohaya}/povtority`, 'POST', {});
    assert.equal(r1.status, 201);
    const { id: nova } = await r1.json();
    assert.equal(db.partiya(plohaya).povtor_id, nova);
    assert.equal((await zapros(`/api/partii/${plohaya}/povtority`, 'POST', {})).status, 409);
    for (let i = 0; i < 300 && (db.idetPartiya() || db.estOchered()); i++) await pauza(10);
  } finally {
    await new Promise(r => server.close(r));
    db.close();
  }
});
