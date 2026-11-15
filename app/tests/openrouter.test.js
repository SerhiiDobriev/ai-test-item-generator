// Проверка подключения к OpenRouter на поддельных ответах: денег не тратит, в интернет не ходит.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { claudeProvayder } from '../lib/claude.js';
import { openrouterModel, openrouterProvayder } from '../lib/openrouter.js';
import { obedinitProvayderov } from '../lib/roli.js';

const k = { par: 9, skolko: 1, tekst: 'ТЕКСТ', instrukciya: 'ІНСТРУКЦІЯ', opisanie: { razdel: 'ІІІ', title: 'Русь' } };
const zadanie = {
  vid_voprosa: 'подія', quest: 'Запитання?', ansa: 'а', ansb: 'б', ansc: 'в', ansd: 'г', result: 'c',
  poyasnenie: 'Пояснення.', opora: { str: 60, citata: 'цитата' },
};
const otvetOk = (obj, usage = { cost: 0.002, prompt_tokens: 1000, completion_tokens: 100, prompt_tokens_details: { cached_tokens: 400 } }) => ({
  ok: true, status: 200, json: async () => ({ choices: [{ finish_reason: 'stop', message: { content: JSON.stringify(obj) } }], usage }),
});
const plokho = (status, code = status, message = 'x') => ({ ok: false, status, json: async () => ({ error: { code, message } }) });
const zagruzkaIz = otvety => {
  const vyzovy = [];
  const f = async (url, opcii) => {
    vyzovy.push({ url, opcii, telo: JSON.parse(opcii.body) });
    const o = otvety.shift();
    if (o instanceof Error) throw o;
    return o;
  };
  f.vyzovy = vyzovy;
  return f;
};

test('запрос: схема, учебник первым, только провайдеры со схемой, ключ в заголовке', async () => {
  const z = zagruzkaIz([otvetOk({ zadaniya: [zadanie] })]);
  const m = openrouterModel('openai/gpt-6-luna', { apiKey: 'K', zagruzka: z, zhdat: 0 });
  const [t] = await m.avtor(k);
  const { url, opcii, telo } = z.vyzovy[0];
  assert.equal(url, 'https://openrouter.ai/api/v1/chat/completions');
  assert.equal(opcii.headers.authorization, 'Bearer K');
  assert.equal(telo.model, 'openai/gpt-6-luna');
  assert.equal(telo.response_format.type, 'json_schema');
  assert.equal(telo.response_format.json_schema.strict, true);
  assert.equal(telo.provider.require_parameters, true);
  assert.ok(telo.messages[0].content.indexOf('ТЕКСТ') < telo.messages[0].content.indexOf('ІНСТРУКЦІЯ'));
  assert.match(t.explanation, /ТЕМА: Розділ ІІІ\. Русь/);
  assert.match(t.explanation, /Відповідь – В\./);
  assert.equal(t.quest, '<p>Запитання?</p>');
});

test('цена берётся из ответа OpenRouter, кеш считается отдельно', async () => {
  const z = zagruzkaIz([otvetOk({ zadaniya: [zadanie] })]);
  const m = openrouterModel('openai/gpt-6-luna', { apiKey: 'K', zagruzka: z, zhdat: 0 });
  await m.avtor(k);
  const s = m.schet();
  assert.equal(m.cena(), 0.002);
  assert.equal(s.vhod, 600);
  assert.equal(s.kesh, 400);
  assert.equal(s.vyhod, 100);
  assert.equal(s.po_rolyam.avtor.zaprosov, 1);
});

test('временные сбои повторяются, а ошибки ключа и денег нет', async () => {
  const z = zagruzkaIz([plokho(500), plokho(429), otvetOk({ zadaniya: [zadanie] })]);
  await openrouterModel('m', { apiKey: 'K', zagruzka: z, zhdat: 0 }).avtor(k);
  assert.equal(z.vyzovy.length, 3);

  const z401 = zagruzkaIz([plokho(401)]);
  await assert.rejects(openrouterModel('m', { apiKey: 'K', zagruzka: z401, zhdat: 0 }).avtor(k), /Ключ OpenRouter не підходить/);
  assert.equal(z401.vyzovy.length, 1);

  const z402 = zagruzkaIz([plokho(402)]);
  await assert.rejects(openrouterModel('m', { apiKey: 'K', zagruzka: z402, zhdat: 0 }).avtor(k), /закінчилися кошти/);
  assert.equal(z402.vyzovy.length, 1);

  const zSet = zagruzkaIz([new Error('a'), new Error('b'), new Error('c')]);
  await assert.rejects(openrouterModel('m', { apiKey: 'K', zagruzka: zSet, zhdat: 0 }).avtor(k), /Немає зв’язку/);
});

test('ошибка внутри ответа 200, отказ, обрыв и плохой JSON дают понятное сообщение', async () => {
  const sObrazcom = o => openrouterModel('m', { apiKey: 'K', zagruzka: zagruzkaIz([o]), zhdat: 0 }).avtor(k);
  await assert.rejects(sObrazcom({ ok: true, status: 200, json: async () => ({ error: { code: 400, message: 'bad' } }) }), /Помилка OpenRouter 400: bad/);
  await assert.rejects(sObrazcom({ ok: true, status: 200, json: async () => ({ choices: [{ message: { refusal: 'ні' } }], usage: {} }) }), /відмовилася/);
  await assert.rejects(sObrazcom({ ok: true, status: 200, json: async () => ({ choices: [{ finish_reason: 'length', message: { content: '{' } }], usage: {} }) }), /не вмістилася/);
  await assert.rejects(sObrazcom({ ok: true, status: 200, json: async () => ({ choices: [{ finish_reason: 'stop', message: { content: 'не json' } }], usage: {} }) }), /некоректну/);
});

function potok(stroki) {
  const k = new TextEncoder();
  return new Response(new ReadableStream({
    start(c) {
      for (const s of stroki) c.enqueue(k.encode(s));
      c.close();
    },
  }), { status: 200, headers: { 'content-type': 'text/event-stream' } });
}

test('потоковый ответ: служебные строки, части JSON на границе кусков, цена в конце', async () => {
  const json = JSON.stringify({ zadaniya: [zadanie] });
  const dat = o => `data: ${JSON.stringify(o)}\n\n`;
  const celoe = [
    ': OPENROUTER PROCESSING\n\n',
    dat({ choices: [{ delta: { content: json.slice(0, 20) } }] }),
    dat({ choices: [{ delta: { content: json.slice(20) }, finish_reason: 'stop' }] }),
    dat({ choices: [], usage: { cost: 0.01, prompt_tokens: 50, completion_tokens: 10 } }),
    'data: [DONE]\n\n',
  ].join('');
  const z = zagruzkaIz([potok([celoe.slice(0, 37), celoe.slice(37)])]);
  const m = openrouterModel('m', { apiKey: 'K', zagruzka: z, zhdat: 0 });
  const [t] = await m.avtor(k);
  assert.equal(t.quest, '<p>Запитання?</p>');
  assert.equal(m.cena(), 0.01);
  assert.equal(z.vyzovy[0].telo.stream, true);
});

test('обрыв потока повторяется, фильтр цитат и ошибка в потоке не считаются пустым ответом', async () => {
  const pustoy = () => potok([': OPENROUTER PROCESSING\n\n']);
  const dat = o => `data: ${JSON.stringify(o)}\n\n`;
  const ok = potok([dat({ choices: [{ delta: { content: JSON.stringify({ zadaniya: [zadanie] }) }, finish_reason: 'stop' }], usage: { cost: 0.01 } })]);
  const z = zagruzkaIz([pustoy(), ok]);
  await openrouterModel('m', { apiKey: 'K', zagruzka: z, zhdat: 0 }).avtor(k);
  assert.equal(z.vyzovy.length, 2);

  const z3 = zagruzkaIz([pustoy(), pustoy(), pustoy()]);
  await assert.rejects(openrouterModel('m', { apiKey: 'K', zagruzka: z3, zhdat: 0 }).avtor(k), /обірвалася/);
  assert.equal(z3.vyzovy.length, 3);

  const zr = zagruzkaIz([potok([dat({ choices: [{ delta: { content: '{"a' }, finish_reason: 'error', native_finish_reason: 'RECITATION' }] })])]);
  await assert.rejects(openrouterModel('m', { apiKey: 'K', zagruzka: zr, zhdat: 0 }).avtor(k), /некоректну/);
  assert.equal(zr.vyzovy.length, 1);

  const zo = zagruzkaIz([potok([dat({ error: { code: 402, message: 'нет денег' }, choices: [{ finish_reason: 'error' }] })])]);
  await assert.rejects(openrouterModel('m', { apiKey: 'K', zagruzka: zo, zhdat: 0 }).avtor(k), /закінчилися кошти/);
});

test('общий список моделей: по цене, каждая идёт к своему источнику', () => {
  const p = obedinitProvayderov([
    claudeProvayder({ klient: {} }),
    openrouterProvayder({ apiKey: 'K' }),
  ]);
  assert.equal(p.modeli.length, 8);
  const ceny = p.modeli.map(m => m.vhod + m.vyhod);
  assert.deepEqual(ceny, [...ceny].sort((a, b) => a - b));
  assert.ok(p.sozdat('openai/gpt-6-luna'));
  assert.ok(p.sozdat('claude-haiku-5-5'));
  assert.throws(() => p.sozdat('нет-такой'), /Невідома модель/);
});
