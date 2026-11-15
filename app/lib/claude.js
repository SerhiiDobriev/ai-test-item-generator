// Настоящие вызовы Claude через официальную библиотеку.
import Anthropic from '@anthropic-ai/sdk';
import { NACHALO_UCHEBNIKA, SHEMY, dobavitRashod, noviySchet, sozdatRoli } from './roli.js';

// Цены за 1 млн токенов, с официальной страницы на 05.11.2026.
export const MODELI = [
  { id: 'claude-haiku-5-5', nazvanie: 'Claude Haiku 5.5', vhod: 0.1, zapis: 0.125, kesh: 0.01, vyhod: 0.5, zapasnaya: false },
  { id: 'claude-sonnet-5-5', nazvanie: 'Claude Sonnet 5.5', vhod: 2, zapis: 2.5, kesh: 0.1, vyhod: 10, zapasnaya: true },
  { id: 'claude-opus-5-5', nazvanie: 'Claude Opus 5.5', vhod: 4, zapis: 5, kesh: 0.2, vyhod: 20, zapasnaya: true },
];

export function cenaZaprosa(model, u) {
  const m = MODELI.find(x => x.id === model);
  if (!m) throw new Error('Невідома модель: ' + model);
  return ((u.input_tokens ?? 0) * m.vhod
    + (u.cache_creation_input_tokens ?? 0) * m.zapis
    + (u.cache_read_input_tokens ?? 0) * m.kesh
    + (u.output_tokens ?? 0) * m.vyhod) / 1e6;
}

function ponyatnayaOshibka(e) {
  if (e instanceof Anthropic.AuthenticationError) return new Error('Ключ API не підходить. Перевірте файл .env.');
  if (e instanceof Anthropic.PermissionDeniedError) return new Error('Цей ключ API не має доступу до вибраної моделі.');
  if (e instanceof Anthropic.RateLimitError) return new Error('Перевищено ліміт запитів або витрат API. Спробуйте пізніше.');
  if (e instanceof Anthropic.BadRequestError) return new Error('API відхилив запит: ' + e.message);
  if (e instanceof Anthropic.APIConnectionError) {
    console.error('Нет связи с API:', e.cause?.cause?.code ?? e.cause?.code ?? '', e.cause?.message ?? e.message);
    return new Error('Немає зв’язку з API. Перевірте інтернет.');
  }
  if (e instanceof Anthropic.APIError) return new Error(`Помилка API ${e.status ?? ''}: ${e.message}`);
  return e;
}

export function claudeModel(modelId, { klient }) {
  const opisanie = MODELI.find(m => m.id === modelId);
  if (!opisanie) throw new Error('Невідома модель: ' + modelId);
  const schet = noviySchet(modelId);

  async function zapros(rol, tekstUchebnika, instrukciya, soobshchenie) {
    const param = {
      model: modelId,
      max_tokens: 32000,
      // Все роли видят один и тот же учебник, поэтому он идёт первым и кешируется.
      system: [
        { type: 'text', text: NACHALO_UCHEBNIKA + tekstUchebnika, cache_control: { type: 'ephemeral' } },
        { type: 'text', text: instrukciya },
      ],
      messages: [{ role: 'user', content: soobshchenie }],
      output_config: { effort: 'medium', format: { type: 'json_schema', schema: SHEMY[rol] } },
    };
    let otvet;
    try {
      // Запасная модель при отказе: у Haiku 5.5 её нет.
      otvet = opisanie.zapasnaya
        ? await klient.beta.messages.stream({ ...param, betas: ['server-side-fallback-2026-07-01'], fallbacks: 'default' }).finalMessage()
        : await klient.messages.stream(param).finalMessage();
    } catch (e) {
      throw ponyatnayaOshibka(e);
    }

    const u = otvet.usage ?? {};
    dobavitRashod(schet, rol, {
      usd: cenaZaprosa(modelId, u),
      vhod: u.input_tokens ?? 0,
      zapis: u.cache_creation_input_tokens ?? 0,
      kesh: u.cache_read_input_tokens ?? 0,
      vyhod: u.output_tokens ?? 0,
    });
    if (otvet.model && otvet.model !== modelId) schet.zapasnaya = otvet.model;

    if (otvet.stop_reason === 'refusal') throw new Error('Модель відмовилася виконувати запит.');
    if (otvet.stop_reason === 'max_tokens') throw new Error('Відповідь моделі не вмістилася в ліміт.');
    const tekst = otvet.content.filter(b => b.type === 'text').map(b => b.text).join('');
    try {
      return JSON.parse(tekst);
    } catch {
      throw new Error('Модель повернула некоректну відповідь.');
    }
  }

  return sozdatRoli(zapros, schet);
}

export function claudeProvayder({ apiKey, klient }) {
  const k = klient ?? new Anthropic({ apiKey });
  return {
    rezhim: 'api',
    paragrafy: 'vse',
    maksimum: 10,
    modeli: MODELI.map(({ id, nazvanie, vhod, vyhod }) => ({ id, nazvanie, vhod, vyhod })),
    sozdat: id => claudeModel(id, { klient: k }),
  };
}
