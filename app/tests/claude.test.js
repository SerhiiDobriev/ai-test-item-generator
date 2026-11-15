// Проверка настоящей цепочки на поддельном клиенте: денег не тратит, в интернет не ходит.
import assert from 'node:assert/strict';
import { after, before, test } from 'node:test';
import Anthropic from '@anthropic-ai/sdk';
import { plain } from '../lib/baza.js';
import { cenaZaprosa, claudeProvayder } from '../lib/claude.js';
import { openDb } from '../lib/db.js';
import { sozdatPrilozhenie } from '../server.js';
import { syryeZadaniya as demoSyrye, zagruzitDemoUchebnik } from './dannye.js';

const PAROL = 'test-parol-dlya-proverok';
const uchebnik = zagruzitDemoUchebnik();
const obrazcy = demoSyrye(1);
const INSTR = { avtor: 'РОЛЬ-АВТОР', fakty: 'РОЛЬ-ФАКТЫ', metodist: 'РОЛЬ-МЕТОДИСТ', redaktor: 'РОЛЬ-РЕДАКТОР' };

const syryeZadaniya = n => obrazcy.slice(0, n).map(t => ({
  vid_voprosa: t.vid_voprosa,
  quest: plain(t.quest), ansa: plain(t.ansa), ansb: plain(t.ansb), ansc: plain(t.ansc), ansd: plain(t.ansd),
  result: t.result, poyasnenie: 'Пояснення своїми словами.', opora: t.opora,
}));

const zaprosy = [];
let povedenie = {};

function otvetDlya(p) {
  zaprosy.push(p);
  const rol = Object.keys(INSTR).find(k => p.system[1].text === INSTR[k]);
  if (povedenie.oshibka === rol) throw povedenie.isklyuchenie;
  const usage = { input_tokens: 100, cache_creation_input_tokens: 1000, cache_read_input_tokens: 2000, output_tokens: 500 };
  if (povedenie.otkaz === rol) return { model: p.model, stop_reason: 'refusal', content: [], usage };
  const dannye = {
    avtor: () => ({ zadaniya: syryeZadaniya(3) }),
    fakty: () => {
      const spisok = JSON.parse(p.messages[0].content.split('\n').slice(1).join('\n'));
      return { proverki: spisok.map(z => ({ n: z.n, verdikt: 'OK', citata: 'ц', str: 60, zamechaniya: z.quest.includes('ВИПРАВЛЕНО') ? ['перевірено після правки'] : ['до правки'] })) };
    },
    metodist: () => ({ zadaniya: [1, 2, 3].map(n => ({ n, verdikt: n === 2 ? 'PRAVKA' : 'OK', zamechaniya: [] })), partiya: 'Загалом добре.' }),
    redaktor: () => ({
      zadaniya: syryeZadaniya(3).map((z, i) => ({ n: i + 1, ...z, poyasnenie: 'Пояснення своїми словами.', quest: i === 1 ? `${z.quest.replace('?', '')} ВИПРАВЛЕНО?` : z.quest, izmeneniya: i === 1 ? 'Виправлено запитання.' : 'Без змін.' })),
    }),
  }[rol]();
  return { model: p.model, stop_reason: 'end_turn', content: [{ type: 'text', text: JSON.stringify(dannye) }], usage };
}

const pot = p => ({ finalMessage: async () => otvetDlya(p) });
const klient = { messages: { stream: pot }, beta: { messages: { stream: pot } } };

let server, url, db, cookie;

async function zapros(put, { method = 'GET', telo } = {}) {
  const res = await fetch(url + put, {
    method,
    headers: { ...(telo !== undefined ? { 'content-type': 'application/json' } : {}), ...(cookie ? { cookie } : {}) },
    body: telo !== undefined ? JSON.stringify(telo) : undefined,
  });
  return { kod: res.status, headers: res.headers, data: await res.json() };
}

async function partiya(telo) {
  const r = await zapros('/api/partii', { method: 'POST', telo });
  assert.equal(r.kod, 201, JSON.stringify(r.data));
  for (let i = 0; i < 200; i++) {
    const p = await zapros(`/api/partii/${r.data.id}`);
    if (p.data.status !== 'idet') return p.data;
    await new Promise(k => setTimeout(k, 5));
  }
  throw new Error('партия не закончилась');
}

before(async () => {
  db = openDb(':memory:');
  server = sozdatPrilozhenie({ db, baza: [], uchebnik, parol: PAROL, limitUsd: 1, instrukcii: INSTR, provayder: claudeProvayder({ klient }) });
  await new Promise(r => server.listen(0, '127.0.0.1', r));
  url = `http://127.0.0.1:${server.address().port}`;
  cookie = (await zapros('/api/vhod', { method: 'POST', telo: { parol: PAROL } })).headers.get('set-cookie').split(';')[0];
});

after(async () => {
  await new Promise(r => server.close(r));
  db.close();
});

test('цена считается по официальным ставкам, с кешем', () => {
  const u = { input_tokens: 1e6, cache_creation_input_tokens: 1e6, cache_read_input_tokens: 1e6, output_tokens: 1e6 };
  assert.equal(cenaZaprosa('claude-haiku-5-5', u), 0.1 + 0.125 + 0.01 + 0.5);
  assert.equal(cenaZaprosa('claude-sonnet-5-5', u), 2 + 2.5 + 0.1 + 10);
  assert.equal(cenaZaprosa('claude-opus-5-5', u), 4 + 5 + 0.2 + 20);
  assert.throws(() => cenaZaprosa('gpt', u));
});

test('в настоящем режиме доступны все параграфы и нужна модель', async () => {
  const s = (await zapros('/api/sostoyanie')).data;
  assert.equal(s.rezhim, 'api');
  assert.ok(s.paragrafy.every(p => p.dostupen));
  assert.equal(s.modeli.length, 3);
  assert.equal((await zapros('/api/partii', { method: 'POST', telo: { par: 1, skolko: 3 } })).kod, 400);
  assert.equal((await zapros('/api/partii', { method: 'POST', telo: { par: 1, skolko: 3, model: 'gpt-6' } })).kod, 400);
});

test('цепочка: формат базы, повторная проверка правок, учёт цены и запросы к API', async () => {
  zaprosy.length = 0;
  const p = await partiya({ par: 1, skolko: 3, model: 'claude-sonnet-5-5' });
  assert.equal(p.status, 'gotovo', p.oshibka);
  assert.equal(p.model, 'claude-sonnet-5-5');
  assert.equal(p.zadaniya.length, 3);

  const [z1, z2] = p.zadaniya;
  assert.match(z1.dannye.quest, /^<p>.*<\/p>$/);
  assert.match(z1.dannye.explanation, /^<p><strong>ТЕМА: Розділ І\. Як виникла держава Русь<\/strong><\/p>/);
  assert.match(z1.dannye.explanation, /Відповідь – Б\./);
  assert.deepEqual(z1.kod.oshibki, []);
  assert.equal(z1.dannye.klass, 7);

  // Изменено только задание 2: его факты проверены второй раз, остальные нет.
  assert.equal(zaprosy.length, 5);
  assert.deepEqual(z2.fakty.zamechaniya, ['перевірено після правки']);
  assert.deepEqual(z1.fakty.zamechaniya, ['до правки']);
  assert.equal(z2.fakty.ostatochno, true);
  assert.equal(z2.izmeneniya, 'Виправлено запитання.');
  assert.equal(p.schet.partiya, 'Загалом добре.');

  const odin = cenaZaprosa('claude-sonnet-5-5', { input_tokens: 100, cache_creation_input_tokens: 1000, cache_read_input_tokens: 2000, output_tokens: 500 });
  assert.ok(Math.abs(p.cena_usd - odin * 5) < 1e-9);
  assert.equal(p.schet.po_rolyam.fakty.zaprosov, 2);

  // Учебник один для всех ролей и кешируется; ответ задан схемой; температуры нет.
  for (const q of zaprosy) {
    assert.deepEqual(q.system[0].cache_control, { type: 'ephemeral' });
    assert.ok(q.system[0].text.includes('Як виникла держава Русь'));
    assert.equal(q.output_config.format.type, 'json_schema');
    assert.equal(q.temperature, undefined);
    assert.equal(q.fallbacks, 'default');
    assert.deepEqual(q.betas, ['server-side-fallback-2026-07-01']);
  }
});

test('у Haiku нет запасной модели', async () => {
  zaprosy.length = 0;
  const p = await partiya({ par: 1, skolko: 1, model: 'claude-haiku-5-5' });
  assert.equal(p.status, 'gotovo', p.oshibka);
  assert.equal(p.zadaniya.length, 1);
  assert.ok(zaprosy.every(q => q.fallbacks === undefined && q.betas === undefined));
});

test('отказ и ошибка ключа дают понятное сообщение, потраченное учитывается', async () => {
  povedenie = { otkaz: 'metodist' };
  let p = await partiya({ par: 1, skolko: 1, model: 'claude-haiku-5-5' });
  assert.equal(p.status, 'oshibka');
  assert.match(p.oshibka, /відмовилася/);
  assert.ok(p.cena_usd > 0);

  povedenie = { oshibka: 'avtor', isklyuchenie: new Anthropic.AuthenticationError(401, {}, 'invalid x-api-key', new Headers()) };
  p = await partiya({ par: 1, skolko: 1, model: 'claude-haiku-5-5' });
  assert.equal(p.status, 'oshibka');
  assert.match(p.oshibka, /Ключ API не підходить/);
  povedenie = {};
});

test('месячный лимит останавливает новые партии', async () => {
  db.raw.prepare(`UPDATE partii SET cena_usd = 5 WHERE id = (SELECT MAX(id) FROM partii)`).run();
  const r = await zapros('/api/partii', { method: 'POST', telo: { par: 1, skolko: 1, model: 'claude-haiku-5-5' } });
  assert.equal(r.kod, 402);
  assert.match(r.data.oshibka, /ліміту витрат: \$1\./);
});
