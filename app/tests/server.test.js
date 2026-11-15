import assert from 'node:assert/strict';
import fs from 'node:fs';
import { after, before, test } from 'node:test';
import { parseDump, plain } from '../lib/baza.js';
import { openDb } from '../lib/db.js';
import { demoModel } from '../lib/demo.js';
import { POROG_BAZA, proveritZadanie } from '../lib/proverka.js';
import { sozdatPrilozhenie } from '../server.js';
import { FAIL_BAZY, OTVETY, gotovyeZadaniya, zagruzitDemoBazu, zagruzitDemoUchebnik } from './dannye.js';

const PAROL = 'test-parol-dlya-proverok';
const baza = zagruzitDemoBazu();
const uchebnik = zagruzitDemoUchebnik();
const demoZadaniya = gotovyeZadaniya(1);

let server, url, db, cookie;

async function zapros(put, { method = 'GET', telo, sCookie = true } = {}) {
  const res = await fetch(url + put, {
    method,
    headers: { ...(telo !== undefined ? { 'content-type': 'application/json' } : {}), ...(sCookie && cookie ? { cookie } : {}) },
    body: telo !== undefined ? JSON.stringify(telo) : undefined,
  });
  const tip = res.headers.get('content-type') ?? '';
  return { kod: res.status, headers: res.headers, data: tip.includes('json') ? await res.json() : await res.text() };
}

async function dozhdatsya(id) {
  for (let i = 0; i < 200; i++) {
    const r = await zapros(`/api/partii/${id}`);
    if (r.data.status !== 'idet') return r.data;
    await new Promise(k => setTimeout(k, 10));
  }
  throw new Error('партия не закончилась');
}

before(async () => {
  db = openDb(':memory:');
  server = sozdatPrilozhenie({
    db, baza, uchebnik, parol: PAROL,
    // Небольшая пауза: иначе партия может успеть закончиться до проверки «другая партия ещё идёт».
    // Автор здесь не пропускает уже использованные задания: так последняя проверка увидит повтор из библиотеки.
    provayder: (() => {
      const osnova = demoModel(OTVETY, 40);
      return { ...osnova, sozdat: () => ({ ...osnova, avtor: k => osnova.avtor({ ...k, uzhe: [] }) }) };
    })(),
    instrukcii: { avtor: '', fakty: '', metodist: '' },
  });
  await new Promise(r => server.listen(0, '127.0.0.1', r));
  url = `http://127.0.0.1:${server.address().port}`;
});

after(async () => {
  await new Promise(r => server.close(r));
  db.close();
});

test('база читается целиком', () => {
  assert.equal(baza.length, 20);
});

test('проверка кодом: готовая партия проходит, как и в старой проверке', () => {
  const { stranicy } = uchebnik.paragraf(1);
  for (const t of demoZadaniya) {
    const r = proveritZadanie(t, { stranicy, baza });
    assert.deepEqual(r.oshibki, [], `задание ${t.n}`);
    assert.ok(r.shodstvo < POROG_BAZA, `задание ${t.n}: сходство ${r.shodstvo}`);
  }
});

test('проверка кодом находит копию из базы и ломаные задания', () => {
  const { stranicy } = uchebnik.paragraf(1);
  const t = demoZadaniya[0];
  const obrazec = parseDump(fs.readFileSync(FAIL_BAZY, 'utf8'))[5];
  const kopiya = proveritZadanie({ ...t, quest: obrazec.quest }, { stranicy, baza });
  assert.ok(kopiya.oshibki.some(o => o.includes('занадто схоже на завдання бази')));
  assert.equal(kopiya.id_bazy, obrazec.id);

  const lomanoe = proveritZadanie({ ...t, result: 'a', opora: { str: t.opora.str, citata: 'такой фразы в учебнике нет совсем' } }, { stranicy, baza });
  assert.ok(lomanoe.oshibki.some(o => o.includes('літера в поясненні')));
  assert.ok(lomanoe.oshibki.some(o => o.includes('цитату не знайдено')));
  const naDrugoy = proveritZadanie({ ...t, opora: { ...t.opora, str: t.opora.str + 1 } }, { stranicy, baza });
  assert.ok(naDrugoy.oshibki.some(o => o.includes(`знайдено на с. ${t.opora.str}`)));
});

test('без входа данных нет, неверный пароль не пускает', async () => {
  assert.equal((await zapros('/api/partii', { sCookie: false })).kod, 401);
  assert.equal((await zapros('/eksport/zavdannia.sql', { sCookie: false })).kod, 401);
  assert.equal((await zapros('/api/vhod', { method: 'POST', telo: { parol: 'неверно' } })).kod, 401);
  const r = await zapros('/api/vhod', { method: 'POST', telo: { parol: PAROL } });
  assert.equal(r.kod, 200);
  const sc = r.headers.get('set-cookie');
  assert.match(sc, /HttpOnly/);
  assert.match(sc, /SameSite=Strict/);
  cookie = sc.split(';')[0];
});

test('нельзя заказать несуществующий параграф или больше 10 заданий', async () => {
  assert.equal((await zapros('/api/partii', { method: 'POST', telo: { par: 99, skolko: 5 } })).kod, 400);
  assert.equal((await zapros('/api/partii', { method: 'POST', telo: { par: 1, skolko: 11 } })).kod, 400);
  assert.equal((await zapros('/api/partii', { method: 'POST', telo: { par: 199, skolko: 1 } })).kod, 400);
});

test('партия, проверка, правка, библиотека и выгрузка', async () => {
  const r1 = await zapros('/api/partii', { method: 'POST', telo: { par: 1, skolko: 3 } });
  assert.equal(r1.kod, 201);
  const zanyato = await zapros('/api/partii', { method: 'POST', telo: { par: 1, skolko: 3 } });
  assert.equal(zanyato.kod, 409);
  const p = await dozhdatsya(r1.data.id);
  assert.equal(p.status, 'gotovo');
  assert.equal(p.rezhim, 'demo');
  assert.equal(p.zadaniya.length, 3);
  assert.deepEqual(p.zadaniya[0].kod.oshibki, []);
  assert.equal(p.zadaniya[0].fakty.verdikt, 'ZAMECHANIE');
  assert.equal(p.zadaniya[0].metodist.verdikt, 'PRAVKA');
  assert.match(p.zadaniya[0].izmeneniya, /^Уточнено пояснення/);
  assert.match(p.zadaniya[0].fakty.zamechaniya[0], /^Відповідь Б правильна/);
  assert.match(p.zadaniya[0].metodist.zamechaniya[0], /^Варіант Г/);

  const [a, b, c] = p.zadaniya;
  assert.equal((await zapros(`/api/zadaniya/${a.id}`, { method: 'PATCH', telo: { status: 'neizvestno' } })).kod, 400);
  assert.equal((await zapros(`/api/zadaniya/${a.id}`, { method: 'PATCH', telo: { status: 'prinyato' } })).data.status, 'prinyato');
  assert.equal((await zapros(`/api/zadaniya/${c.id}`, { method: 'PATCH', telo: { status: 'otkloneno' } })).data.status, 'otkloneno');

  const plokhaya = { quest: 'Вопрос?', ansa: 'а', ansb: 'б', ansc: 'в', ansd: 'г', result: 'x', poyasnenie: 'Текст' };
  assert.equal((await zapros(`/api/zadaniya/${b.id}`, { method: 'PATCH', telo: { pravka: plokhaya } })).kod, 400);
  assert.equal((await zapros(`/api/zadaniya/${b.id}`, { method: 'PATCH', telo: { pravka: { ...plokhaya, result: 'c', ansa: ' ' } } })).kod, 400);

  const bezIzmeneniy = await zapros(`/api/zadaniya/${a.id}`, {
    method: 'PATCH',
    telo: {
      pravka: {
        quest: plain(a.dannye.quest),
        ansa: plain(a.dannye.ansa), ansb: plain(a.dannye.ansb), ansc: plain(a.dannye.ansc), ansd: plain(a.dannye.ansd), result: a.dannye.result,
        poyasnenie: [...a.dannye.explanation.matchAll(/<p>([^<]*)<\/p>/g)].map(m => plain(m[1])).join('\n'),
      },
    },
  });
  assert.equal(bezIzmeneniy.data.pravil_chelovek, false);

  const pravka = await zapros(`/api/zadaniya/${b.id}`, {
    method: 'PATCH',
    telo: { status: 'prinyato', pravka: { quest: "Яке ім'я <script>x</script>?", ansa: 'перший', ansb: 'другий', ansc: 'третій', ansd: "п'ятий \\ кінець", result: 'c', poyasnenie: 'Перший абзац.\nДругий абзац.' } },
  });
  assert.equal(pravka.kod, 200);
  const d = pravka.data.dannye;
  assert.equal(pravka.data.pravil_chelovek, true);
  assert.ok(!d.quest.includes('<script>'));
  assert.equal(d.result, 'c');
  assert.match(d.explanation, /ТЕМА: Розділ І. Як виникла держава Русь/);
  assert.match(d.explanation, /<p>Другий абзац\.<\/p>/);
  assert.match(d.explanation, /Відповідь – В\./);

  const lib = await zapros('/api/biblioteka');
  assert.equal(lib.data.length, 2);
  assert.equal((await zapros('/api/biblioteka?par=2')).data.length, 0);

  // Выгрузка читается тем же разбором, что и база заказчика.
  const sql = await zapros('/eksport/zavdannia.sql');
  assert.equal(sql.kod, 200);
  assert.match(sql.headers.get('content-disposition'), /attachment/);
  const stroki = parseDump(sql.data);
  assert.equal(stroki.length, 2);
  assert.equal(stroki[1].ansd, d.ansd);
  assert.equal(stroki[1].explanation, d.explanation);
  assert.equal(stroki[0].anscount, '4');
  assert.equal(stroki[0].id, undefined);
  const json = await zapros('/eksport/zavdannia.json');
  assert.equal(json.data.length, 2);

  // Новая партия с тем же заданием предупреждает о повторе.
  const r2 = await zapros('/api/partii', { method: 'POST', telo: { par: 1, skolko: 1 } });
  const p2 = await dozhdatsya(r2.data.id);
  assert.ok(p2.zadaniya[0].kod.oshibki.some(o => o.includes('вже є в бібліотеці')));
  assert.equal((await zapros('/api/partii')).data[0].id, r2.data.id);
});

test('после выхода сеанс не действует, а частые попытки блокируются', async () => {
  const star = cookie;
  assert.equal((await zapros('/api/vyhod', { method: 'POST' })).kod, 200);
  cookie = star;
  assert.equal((await zapros('/api/partii')).kod, 401);
  let posledniy;
  for (let i = 0; i < 12; i++) posledniy = await zapros('/api/vhod', { method: 'POST', telo: { parol: 'неверно' }, sCookie: false });
  assert.equal(posledniy.kod, 429);
});
