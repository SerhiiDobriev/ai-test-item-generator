// Счёт OpenAI: разбор ответа, страницы, ошибки, частота запросов и влияние на лимит.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { openDb } from '../lib/db.js';
import { demoModel } from '../lib/demo.js';
import { nachaloMesyaca, schetOpenAI } from '../lib/rashody.js';
import { sozdatPrilozhenie } from '../server.js';
import { OTVETY, zagruzitDemoBazu, zagruzitDemoUchebnik } from './dannye.js';

const korzina = (...summy) => ({ object: 'bucket', results: summy.map(v => ({ object: 'organization.costs.result', amount: { value: v, currency: 'usd' } })) });
const otvet = (telo, status = 200) => ({ ok: status < 400, status, json: async () => telo });

function zagruzkaIz(otvety) {
  const vyzovy = [];
  const f = async (url, opcii) => {
    vyzovy.push({ url: new URL(url), opcii });
    return otvety.shift();
  };
  f.vyzovy = vyzovy;
  return f;
}

test('сумма за месяц со всех страниц, ключ в заголовке, начало месяца по UTC', async () => {
  const seychas = Date.UTC(2026, 10, 6, 12, 0);
  const z = zagruzkaIz([
    otvet({ data: [korzina(0.1, 0.05), korzina()], has_more: true, next_page: 'p2' }),
    otvet({ data: [korzina(0.14)], has_more: false }),
  ]);
  const s = schetOpenAI({ adminKey: 'ADM', zagruzka: z, seychas: () => seychas });
  assert.equal(s.usd(), null);
  await s.obnovit();
  assert.ok(Math.abs(s.usd() - 0.29) < 1e-9);
  assert.equal(z.vyzovy.length, 2);
  assert.equal(z.vyzovy[0].opcii.headers.authorization, 'Bearer ADM');
  assert.equal(z.vyzovy[0].url.searchParams.get('start_time'), String(Date.UTC(2026, 10, 1) / 1000));
  assert.equal(z.vyzovy[1].url.searchParams.get('page'), 'p2');
  assert.equal(nachaloMesyaca(seychas), Date.UTC(2026, 10, 1) / 1000);
});

test('не чаще раза в 10 минут; ошибка оставляет прошлое значение; новый месяц сбрасывает', async () => {
  let t = Date.UTC(2026, 10, 30, 23, 0);
  const z = zagruzkaIz([
    otvet({ data: [korzina(1)] }),
    otvet({ error: { message: 'bad key' } }, 401),
  ]);
  const s = schetOpenAI({ adminKey: 'ADM', zagruzka: z, seychas: () => t });
  await s.obnovit();
  await s.obnovit();
  assert.equal(z.vyzovy.length, 1);
  t += 11 * 60 * 1000;
  await s.obnovit();
  assert.equal(z.vyzovy.length, 2);
  assert.equal(s.usd(), 1);
  assert.match(s.sostoyanie().oshibka, /не підходить \(401\)/);
  t = Date.UTC(2026, 11, 1, 0, 30); // наступил декабрь: ноябрьская сумма больше не считается
  assert.equal(s.usd(), null);
});

test('лимит считается по большей сумме: счёт OpenAI выше подсчёта сайта', async () => {
  const db = openDb(':memory:');
  const osnova = demoModel(OTVETY, 0);
  const provayder = { ...osnova, rezhim: 'api', paragrafy: 'vse', modeli: [{ id: 'gpt-6.1-terra', nazvanie: 'T', vhod: 0.5, vyhod: 2.5 }], sozdat: () => osnova };
  let schet = 8;
  const fakeSchet = { usd: () => schet, obnovit: async () => {}, sostoyanie: () => ({ usd: schet, obnovleno: new Date().toISOString(), oshibka: null }) };
  const server = sozdatPrilozhenie({
    db, provayder, limitUsd: 7, parol: 'p-test-rashody', schetOpenAI: fakeSchet, modeliOpenAI: ['gpt-6.1-terra'],
    baza: zagruzitDemoBazu(),
    uchebnik: zagruzitDemoUchebnik(),
    instrukcii: { avtor: '', fakty: '', metodist: '', redaktor: '' },
  });
  await new Promise(r => server.listen(0, '127.0.0.1', r));
  const url = `http://127.0.0.1:${server.address().port}`;
  try {
    const vhod = await fetch(url + '/api/vhod', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ parol: 'p-test-rashody' }) });
    const cookie = vhod.headers.get('set-cookie').split(';')[0];
    const post = telo => fetch(url + '/api/zakazy', { method: 'POST', headers: { cookie, 'content-type': 'application/json' }, body: JSON.stringify(telo) });
    const st = await (await fetch(url + '/api/sostoyanie', { headers: { cookie } })).json();
    assert.equal(st.potracheno, 8);
    assert.equal(st.schetOpenAI.usd, 8);
    assert.equal(st.schetOpenAI.sayt, 0);
    assert.equal((await post({ model: 'gpt-6.1-terra', chasti: [{ par: 1, skolko: 1 }] })).status, 402);
    schet = 1; // счёт ниже лимита — заказ проходит
    assert.equal((await post({ model: 'gpt-6.1-terra', chasti: [{ par: 1, skolko: 1 }] })).status, 201);
  } finally {
    for (let i = 0; i < 300 && (db.idetPartiya() || db.estOchered()); i++) await new Promise(r => setTimeout(r, 10));
    await new Promise(r => server.close(r));
    db.close();
  }
});
