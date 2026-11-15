// Проверка прямого подключения к OpenAI на поддельных ответах: денег не тратит, в интернет не ходит.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { cenaZaprosa, openaiModel, openaiProvayder } from '../lib/openai.js';
import { openrouterProvayder } from '../lib/openrouter.js';
import { obedinitProvayderov } from '../lib/roli.js';

const k = { par: 9, skolko: 1, tekst: 'ТЕКСТ', instrukciya: 'ІНСТРУКЦІЯ', opisanie: { razdel: 'ІІІ', title: 'Русь' } };
const zadanie = {
  vid_voprosa: 'подія', quest: 'Запитання?', ansa: 'а', ansb: 'б', ansc: 'в', ansd: 'г', result: 'c',
  poyasnenie: 'Пояснення.', opora: { str: 60, citata: 'цитата' },
};
const USAGE = { prompt_tokens: 1_000_000, completion_tokens: 100_000, prompt_tokens_details: { cached_tokens: 400_000 } };
const otvetOk = (obj, { usage = USAGE, service_tier } = {}) => ({
  ok: true, status: 200,
  json: async () => ({ choices: [{ finish_reason: 'stop', message: { content: JSON.stringify(obj) } }], usage, service_tier }),
});
const plokho = (status, code = '', message = 'x') => ({ ok: false, status, json: async () => ({ error: { code, message } }) });
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
const model = z => openaiModel('gpt-6.1-terra', { apiKey: 'K', zagruzka: z, zhdat: 0 });

test('запрос идёт в OpenAI в режиме Flex, со схемой и учебником первым', async () => {
  const z = zagruzkaIz([otvetOk({ zadaniya: [zadanie] }, { service_tier: 'flex' })]);
  const [t] = await model(z).avtor(k);
  const { url, opcii, telo } = z.vyzovy[0];
  assert.equal(url, 'https://api.openai.com/v1/chat/completions');
  assert.equal(opcii.headers.authorization, 'Bearer K');
  assert.equal(telo.model, 'gpt-6.1-terra');
  assert.equal(telo.service_tier, 'flex');
  assert.equal(telo.max_completion_tokens, 32000);
  assert.equal(telo.stream_options.include_usage, true);
  assert.equal(telo.response_format.json_schema.strict, true);
  assert.equal(telo.provider, undefined);
  assert.ok(telo.messages[0].content.indexOf('ТЕКСТ') < telo.messages[0].content.indexOf('ІНСТРУКЦІЯ'));
  assert.equal(t.quest, '<p>Запитання?</p>');
});

test('цена по тарифу: Flex вдвое дешевле, кеш отдельно', () => {
  // 600 тыс. обычного входа * $1 + 400 тыс. кеша * $0.05 + 100 тыс. выхода * $5 = $1.12
  assert.equal(Number(cenaZaprosa('gpt-6.1-terra', USAGE, 'default').toFixed(6)), 1.12);
  assert.equal(Number(cenaZaprosa('gpt-6.1-terra', USAGE, 'flex').toFixed(6)), 0.56);
  assert.throws(() => cenaZaprosa('chto-to', USAGE, 'flex'), /Невідома модель/);
});

test('счёт партии: цена по фактическому режиму из ответа', async () => {
  const m = model(zagruzkaIz([otvetOk({ zadaniya: [zadanie] }, { service_tier: 'default' })]));
  await m.avtor(k);
  assert.equal(Number(m.cena().toFixed(6)), 1.12);
  const s = m.schet();
  assert.equal(s.vhod, 600_000);
  assert.equal(s.kesh, 400_000);
  assert.equal(s.vyhod, 100_000);
});

test('Flex занят: одна пауза, потом обычный режим до конца партии', async () => {
  const z = zagruzkaIz([
    plokho(429, 'resource_unavailable'), plokho(429, 'resource_unavailable'),
    otvetOk({ zadaniya: [zadanie] }), otvetOk({ proverki: [] }),
  ]);
  const m = model(z);
  await m.avtor(k);
  await m.fakty({ ...k, zadaniya: [] });
  assert.deepEqual(z.vyzovy.map(v => v.telo.service_tier), ['flex', 'flex', 'default', 'default']);
  assert.equal(m.schet().bezFlex, true);
  // Режим не указан в ответе: считаем по тому, что просили, то есть по обычному тарифу.
  assert.equal(Number(m.schet().po_rolyam.avtor.usd.toFixed(6)), 1.12);
});

test('Flex не поддержан для модели: сразу обычный режим', async () => {
  const z = zagruzkaIz([plokho(400, 'invalid_value', "Unsupported value: 'service_tier' flex"), otvetOk({ zadaniya: [zadanie] })]);
  await model(z).avtor(k);
  assert.deepEqual(z.vyzovy.map(v => v.telo.service_tier), ['flex', 'default']);
});

test('нет денег, плохой ключ и плохой запрос не повторяются', async () => {
  for (const [o, tekst] of [
    [plokho(429, 'insufficient_quota'), /закінчилися кошти/],
    [plokho(401, 'invalid_api_key'), /Ключ OpenAI не підходить/],
    [plokho(404, 'model_not_found', 'no model'), /недоступна для ключа/],
  ]) {
    const z = zagruzkaIz([o]);
    await assert.rejects(model(z).avtor(k), tekst);
    assert.equal(z.vyzovy.length, 1);
  }
  const z400 = zagruzkaIz([plokho(400, 'invalid_value', 'bad schema'), plokho(400, 'invalid_value', 'bad schema')]);
  // Первый 400 без упоминания Flex: ошибка сразу, без перехода в обычный режим.
  await assert.rejects(model(z400).avtor(k), /OpenAI відхилив запит: bad schema/);
  assert.equal(z400.vyzovy.length, 1);
});

test('сбои сервера и связи повторяются, потом понятная ошибка', async () => {
  const z = zagruzkaIz([plokho(500), plokho(408), otvetOk({ zadaniya: [zadanie] })]);
  await model(z).avtor(k);
  assert.equal(z.vyzovy.length, 3);

  const zSet = zagruzkaIz([new Error('a'), new Error('b'), new Error('c')]);
  await assert.rejects(model(zSet).avtor(k), /Немає зв’язку з OpenAI/);
});

function potok(stroki) {
  const kod = new TextEncoder();
  return new Response(new ReadableStream({
    start(c) {
      for (const s of stroki) c.enqueue(kod.encode(s));
      c.close();
    },
  }), { status: 200, headers: { 'content-type': 'text/event-stream' } });
}

test('потоковый ответ: режим и расход приходят в последних частях', async () => {
  const json = JSON.stringify({ zadaniya: [zadanie] });
  const dat = o => `data: ${JSON.stringify(o)}\n\n`;
  const celoe = [
    dat({ service_tier: 'flex', choices: [{ delta: { content: json.slice(0, 25) } }] }),
    dat({ service_tier: 'flex', choices: [{ delta: { content: json.slice(25) }, finish_reason: 'stop' }] }),
    dat({ service_tier: 'flex', choices: [], usage: USAGE }),
    'data: [DONE]\n\n',
  ].join('');
  const m = model(zagruzkaIz([potok([celoe.slice(0, 41), celoe.slice(41)])]));
  const [t] = await m.avtor(k);
  assert.equal(t.quest, '<p>Запитання?</p>');
  assert.equal(Number(m.cena().toFixed(6)), 0.56);
});

test('модель OpenAI появляется в общем списке рядом с OpenRouter', () => {
  const p = obedinitProvayderov([openrouterProvayder({ apiKey: 'A' }), openaiProvayder({ apiKey: 'B' })]);
  const m = p.modeli.find(x => x.id === 'gpt-6.1-terra');
  assert.equal(m.nazvanie, 'GPT-6.1 Terra (OpenAI, Flex)');
  // Основная модель первая, хотя DeepSeek дешевле; остальные по цене.
  assert.equal(p.modeli[0].id, 'gpt-6.1-terra');
  assert.equal(p.modeli[1].id, 'deepseek/deepseek-v4.1-flash');
  assert.ok(p.modeli.some(x => x.id === 'openai/gpt-6.1-terra'));
  assert.equal(typeof p.sozdat('gpt-6.1-terra').avtor, 'function');
});
