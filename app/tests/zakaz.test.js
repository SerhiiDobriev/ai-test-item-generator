// Большие заказы: разбиение на партии, очередь по одной, лимит, продолжение после перезапуска.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { openDb } from '../lib/db.js';
import { demoModel } from '../lib/demo.js';
import { otsenkaPartii, otsenkaZakaza, razbit } from '../lib/zakaz.js';
import { sozdatPrilozhenie } from '../server.js';
import { OTVETY, zagruzitDemoBazu, zagruzitDemoUchebnik } from './dannye.js';

const DEMO = OTVETY;
const PAROL = 'test-parol-dlya-zakazov';
const baza = zagruzitDemoBazu();
const uchebnik = zagruzitDemoUchebnik();
const instrukcii = { avtor: '', fakty: '', metodist: '', redaktor: '' };
const pauza = ms => new Promise(r => setTimeout(r, ms));

// Поднимает сервер, входит и возвращает функцию запросов.
async function podnyat({ db = openDb(':memory:'), provayder = demoModel(DEMO, 5), limitUsd = 10 } = {}) {
  const server = sozdatPrilozhenie({ db, baza, uchebnik, parol: PAROL, provayder, instrukcii, limitUsd });
  await new Promise(r => server.listen(0, '127.0.0.1', r));
  const url = `http://127.0.0.1:${server.address().port}`;
  const vhod = await fetch(url + '/api/vhod', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ parol: PAROL }) });
  const cookie = vhod.headers.get('set-cookie').split(';')[0];
  const zapros = async (put, telo) => {
    const res = await fetch(url + put, {
      method: telo ? 'POST' : 'GET',
      headers: { cookie, ...(telo ? { 'content-type': 'application/json' } : {}) },
      body: telo ? JSON.stringify(telo) : undefined,
    });
    return { kod: res.status, data: await res.json() };
  };
  const zakryt = async () => {
    // Дождаться конца очереди, чтобы закрытая база не сломала идущую партию.
    for (let i = 0; i < 500 && (db.idetPartiya() || db.estOchered()); i++) await pauza(10);
    await new Promise(r => server.close(r));
    db.close();
  };
  return { zapros, db, zakryt };
}

async function dozhdatsyaZakaza(zapros, id) {
  const vidno = new Set();
  for (let i = 0; i < 500; i++) {
    const z = (await zapros(`/api/zakazy/${id}`)).data;
    // Никогда не идут две партии сразу.
    assert.ok(z.partii.filter(p => p.status === 'idet').length <= 1);
    z.partii.forEach(p => vidno.add(p.status));
    if (!z.partii.some(p => p.status === 'idet' || p.status === 'ochered')) return { z, vidno };
    await pauza(10);
  }
  throw new Error('заказ не закончился');
}

// Провайдер «как настоящий»: есть модель с ценой, любые параграфы. Цена партии и запись того, что видел автор.
function poddelnyy({ cena = 0, vhod = 0.5, vyhod = 2.5 } = {}) {
  const osnova = demoModel(DEMO, 2);
  const videl = [];
  return {
    videl,
    rezhim: 'api',
    paragrafy: 'vse',
    maksimum: 10,
    modeli: [{ id: 'm', nazvanie: 'Модель', vhod, vyhod }],
    sozdat: () => ({
      ...osnova,
      async avtor(k) {
        videl.push(k.uzhe.length);
        return osnova.avtor(k);
      },
      cena: () => cena,
      schet: () => null,
    }),
  };
}

test('разбиение на почти равные партии и примерная цена', () => {
  assert.deepEqual(razbit(23, 10), [8, 8, 7]);
  assert.deepEqual(razbit(10, 10), [10]);
  assert.deepEqual(razbit(3, 10), [3]);
  assert.deepEqual(razbit(50, 10), [10, 10, 10, 10, 10]);
  // Terra через OpenAI Flex: партия из 10 на деле стоила $0,039–0,040.
  const terra = { vhod: 0.5, vyhod: 2.5 };
  assert.ok(Math.abs(otsenkaPartii(terra, 10) - 0.045) < 1e-9);
  assert.ok(Math.abs(otsenkaZakaza(terra, [{ skolko: 23 }, { skolko: 5 }], 10) - (otsenkaPartii(terra, 8) * 2 + otsenkaPartii(terra, 7) + otsenkaPartii(terra, 5))) < 1e-9);
});

test('заказ на 23 задания: три партии по очереди, у каждой ссылка на заказ', async () => {
  const s = await podnyat();
  try {
    const r = await s.zapros('/api/zakazy', { chasti: [{ par: 1, skolko: 23 }] });
    assert.equal(r.kod, 201);
    assert.equal(r.data.partii.length, 3);
    // Пока идёт заказ, отдельная партия не запускается.
    assert.equal((await s.zapros('/api/partii', { par: 1, skolko: 1 })).kod, 409);
    const { z, vidno } = await dozhdatsyaZakaza(s.zapros, r.data.id);
    assert.deepEqual(z.partii.map(p => p.skolko), [8, 8, 7]);
    assert.deepEqual(z.partii.map(p => p.status), ['gotovo', 'gotovo', 'gotovo']);
    assert.deepEqual(z.partii.map(p => p.vsego), [8, 8, 7]);
    assert.ok(z.partii.every(p => p.zakaz_id === r.data.id));
    assert.ok(vidno.has('ochered'));
    const p = (await s.zapros(`/api/partii/${z.partii[1].id}`)).data;
    assert.equal(p.zakaz_id, r.data.id);
    assert.equal((await s.zapros('/api/zakazy/999')).kod, 404);
  } finally {
    await s.zakryt();
  }
});

test('заказ проверяется: параграфы, число заданий, модель', async () => {
  const s = await podnyat();
  try {
    const plokho = async telo => (await s.zapros('/api/zakazy', telo)).kod;
    assert.equal(await plokho({ chasti: [] }), 400);
    assert.equal(await plokho({ chasti: [{ par: 99, skolko: 5 }] }), 400); // нет такого параграфа
    assert.equal(await plokho({ chasti: [{ par: 1, skolko: 51 }] }), 400);
    assert.equal(await plokho({ chasti: [{ par: 1, skolko: 30 }, { par: 1, skolko: 21 }] }), 400);
    assert.equal(await plokho({ chasti: [{ par: 1, skolko: 0 }] }), 400);
    assert.equal(await plokho({ chasti: [{ par: 1, skolko: 2.5 }] }), 400);
    assert.equal(await plokho({ chasti: Array.from({ length: 11 }, () => ({ par: 1, skolko: 1 })) }), 400);
    const st = (await s.zapros('/api/sostoyanie')).data;
    assert.equal(st.maksZakaz, 50);
  } finally {
    await s.zakryt();
  }

  const s2 = await podnyat({ provayder: poddelnyy() });
  try {
    assert.equal((await s2.zapros('/api/zakazy', { chasti: [{ par: 1, skolko: 1 }] })).kod, 400); // нет модели
    assert.equal((await s2.zapros('/api/zakazy', { model: 'drugaya', chasti: [{ par: 1, skolko: 1 }] })).kod, 400);
  } finally {
    await s2.zakryt();
  }
});

test('дорогой заказ не принимается, если не влезает в остаток лимита', async () => {
  const s = await podnyat({ provayder: poddelnyy({ vhod: 200, vyhod: 200 }), limitUsd: 7 });
  try {
    const r = await s.zapros('/api/zakazy', { model: 'm', chasti: [{ par: 1, skolko: 10 }] });
    assert.equal(r.kod, 402);
    assert.match(r.data.oshibka, /орієнтовно коштує \$9\.20.*залишилося \$7\.00/);
    assert.equal(s.db.partii().length, 0);
  } finally {
    await s.zakryt();
  }
});

test('лимит кончился посреди заказа: остальные партии снимаются; автор видит задания прошлых партий', async () => {
  const pr = poddelnyy({ cena: 4 });
  const s = await podnyat({ provayder: pr, limitUsd: 7 });
  try {
    const r = await s.zapros('/api/zakazy', { model: 'm', chasti: [{ par: 1, skolko: 2 }, { par: 1, skolko: 3 }, { par: 1, skolko: 1 }] });
    assert.equal(r.kod, 201);
    const { z } = await dozhdatsyaZakaza(s.zapros, r.data.id);
    assert.deepEqual(z.partii.map(p => p.status), ['gotovo', 'gotovo', 'oshibka']);
    assert.match(z.partii[2].oshibka, /ліміту/);
    // Вторая партия знала о двух заданиях первой.
    assert.deepEqual(pr.videl, [0, 2]);
  } finally {
    await s.zakryt();
  }
});

test('очередь, оставшаяся с прошлого запуска, продолжается сама', async () => {
  const db = openDb(':memory:');
  const id = db.noviyZakaz(null, [{ par: 1, skolko: 2 }, { par: 1, skolko: 1 }], 'demo').id;
  const s = await podnyat({ db });
  try {
    const { z } = await dozhdatsyaZakaza(s.zapros, id);
    assert.deepEqual(z.partii.map(p => p.status), ['gotovo', 'gotovo']);
  } finally {
    await s.zakryt();
  }
});
