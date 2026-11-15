// Модели других компаний через OpenRouter: один ключ и один счёт. Цену считает сам OpenRouter (usage.cost).
import { NACHALO_UCHEBNIKA, SHEMY, dobavitRashod, noviySchet, sozdatRoli } from './roli.js';

const ADRES = 'https://openrouter.ai/api/v1/chat/completions';
const VSEGO_MS = 12 * 60 * 1000;
const TISHINA_MS = 3 * 60 * 1000;
const POPYTOK = 3;

// Читает потоковый ответ и собирает его в обычный. Служебные строки-комментарии только продлевают ожидание.
export async function prochitatPotok(res, naDannye) {
  const itog = { choices: [{ message: { content: '' }, finish_reason: null, native_finish_reason: null }] };
  const vybor = itog.choices[0];
  const dekoder = new TextDecoder();
  const chitatel = res.body.getReader();
  let bufer = '';
  for (;;) {
    const { done, value } = await chitatel.read();
    if (done) break;
    naDannye();
    bufer += dekoder.decode(value, { stream: true });
    const stroki = bufer.split('\n');
    bufer = stroki.pop();
    for (const stroka of stroki) {
      if (!stroka.startsWith('data:')) continue;
      const tekst = stroka.slice(5).trim();
      if (!tekst || tekst === '[DONE]') continue;
      let chast;
      try {
        chast = JSON.parse(tekst);
      } catch {
        continue;
      }
      if (chast.error) itog.error = chast.error;
      if (chast.usage) itog.usage = chast.usage;
      if (chast.provider) itog.provider = chast.provider;
      if (chast.service_tier) itog.service_tier = chast.service_tier;
      const c = chast.choices?.[0];
      if (!c) continue;
      if (c.delta?.content) vybor.message.content += c.delta.content;
      if (c.delta?.refusal) vybor.message.refusal = c.delta.refusal;
      if (c.finish_reason) vybor.finish_reason = c.finish_reason;
      if (c.native_finish_reason) vybor.native_finish_reason = c.native_finish_reason;
    }
  }
  return itog;
}

// Цены за 1 млн токенов из списка OpenRouter на 05.11.2026, только для показа в меню.
export const MODELI_OR = [
  { id: 'openai/gpt-6-luna', nazvanie: 'GPT-6 Luna (OpenRouter)', vhod: 0.1, vyhod: 0.5 },
  { id: 'deepseek/deepseek-v4.1-flash', nazvanie: 'DeepSeek V4.1 Flash (OpenRouter)', vhod: 0.045, vyhod: 0.5 },
  { id: 'moonshotai/kimi-k2.6', nazvanie: 'Kimi K2.6 (OpenRouter)', vhod: 0.65, vyhod: 3.41 },
  { id: 'google/gemini-3.8-flash', nazvanie: 'Gemini 3.8 Flash (OpenRouter)', vhod: 0.75, vyhod: 3.75 },
  { id: 'openai/gpt-6.1-terra', nazvanie: 'GPT-6.1 Terra (OpenRouter)', vhod: 1, vyhod: 5 },
];

const pauza = ms => new Promise(r => setTimeout(r, ms));

function oshibkaPoKodu(kod, tekst) {
  if (kod === 401) return new Error('Ключ OpenRouter не підходить. Перевірте файл .env.');
  if (kod === 402) return new Error('На рахунку OpenRouter або в ліміті ключа закінчилися кошти.');
  if (kod === 403) return new Error('OpenRouter не пропустив запит: ' + tekst);
  if (kod === 404) return new Error('Для цієї моделі немає постачальника з потрібними можливостями: ' + tekst);
  if (kod === 429) return new Error('Перевищено ліміт запитів. Спробуйте пізніше.');
  return new Error(`Помилка OpenRouter ${kod}: ${tekst}`);
}

export function openrouterModel(modelId, { apiKey, zagruzka = fetch, zhdat = 2000 }) {
  const schet = noviySchet(modelId);

  async function otpravit(telo) {
    for (let i = 1; ; i++) {
      // Общий предел на запрос и отдельный предел на молчание: модель может думать долго, но не бесконечно.
      const upravlenie = new AbortController();
      const vsego = setTimeout(() => upravlenie.abort(new Error('vsego')), VSEGO_MS);
      let tishina;
      const sbros = () => {
        clearTimeout(tishina);
        tishina = setTimeout(() => upravlenie.abort(new Error('tishina')), TISHINA_MS);
      };
      sbros();
      try {
        const res = await zagruzka(ADRES, {
          method: 'POST',
          headers: { authorization: `Bearer ${apiKey}`, 'content-type': 'application/json' },
          body: JSON.stringify(telo),
          signal: upravlenie.signal,
        });
        const dannye = res.headers?.get?.('content-type')?.includes('text/event-stream')
          ? await prochitatPotok(res, sbros)
          : await res.json().catch(() => ({}));
        const vybor = dannye.choices?.[0];
        // Фильтр цитат: повторять бесполезно, разбирается как некорректный ответ.
        if (vybor?.native_finish_reason === 'RECITATION') return dannye;
        if (res.ok && !dannye.error) {
          if (vybor?.message?.content || vybor?.message?.refusal || vybor?.finish_reason) return dannye;
          throw new Error('obryv');
        }
        const kod = dannye.error?.code ?? res.status;
        // Временные сбои повторяем, ошибки ключа и денег нет.
        if ((kod === 429 || kod >= 500) && i < POPYTOK) { await pauza(zhdat * i); continue; }
        throw Object.assign(oshibkaPoKodu(kod, String(dannye.error?.message ?? '').slice(0, 300)), { konechnaya: true });
      } catch (e) {
        if (upravlenie.signal.reason?.message === 'vsego') throw new Error(`Модель не встигла відповісти за ${VSEGO_MS / 60000} хвилин.`);
        if (e.konechnaya) throw e;
        console.error('Сбой связи с OpenRouter:', modelId, e.cause?.code ?? '', upravlenie.signal.reason?.message ?? e.message);
        if (i < POPYTOK) { await pauza(zhdat * i); continue; }
        throw new Error('Немає зв’язку з OpenRouter або відповідь обірвалася. Спробуйте пізніше.');
      } finally {
        clearTimeout(vsego);
        clearTimeout(tishina);
      }
    }
  }

  async function zapros(rol, tekstUchebnika, instrukciya, soobshchenie) {
    const otvet = await otpravit({
      model: modelId,
      max_tokens: 32000,
      stream: true,
      // Учебник идёт первым: одинаковое начало запроса дешевле там, где есть кеш.
      messages: [
        { role: 'system', content: NACHALO_UCHEBNIKA + tekstUchebnika + '\n\n' + instrukciya },
        { role: 'user', content: soobshchenie },
      ],
      response_format: { type: 'json_schema', json_schema: { name: rol, strict: true, schema: SHEMY[rol] } },
      provider: { require_parameters: true },
    });

    const u = otvet.usage ?? {};
    const kesh = u.prompt_tokens_details?.cached_tokens ?? 0;
    const zapis = u.prompt_tokens_details?.cache_write_tokens ?? 0;
    dobavitRashod(schet, rol, {
      usd: u.cost ?? 0,
      vhod: Math.max((u.prompt_tokens ?? 0) - kesh - zapis, 0),
      zapis,
      kesh,
      vyhod: u.completion_tokens ?? 0,
    });

    const vybor = otvet.choices?.[0];
    if (vybor?.message?.refusal) throw new Error('Модель відмовилася виконувати запит.');
    if (vybor?.finish_reason === 'length') throw new Error('Відповідь моделі не вмістилася в ліміт.');
    try {
      return JSON.parse(vybor?.message?.content ?? '');
    } catch {
      console.error('Некорректный ответ OpenRouter:', modelId, rol, 'причина:', vybor?.finish_reason ?? '', vybor?.native_finish_reason ?? '', 'длина:', vybor?.message?.content?.length ?? 0);
      throw new Error('Модель повернула некоректну відповідь.');
    }
  }

  return sozdatRoli(zapros, schet);
}

export function openrouterProvayder({ apiKey, zagruzka, zhdat }) {
  return {
    rezhim: 'api',
    paragrafy: 'vse',
    maksimum: 10,
    modeli: MODELI_OR,
    sozdat: id => openrouterModel(id, { apiKey, zagruzka, zhdat }),
  };
}
