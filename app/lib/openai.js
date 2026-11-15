// Модели OpenAI напрямую, без OpenRouter. Режим Flex: вдвое дешевле, но медленнее и иногда занят.
// Если Flex занят или недоступен, запрос повторяется в обычном режиме. Цену считаем сами по тарифу.
import { prochitatPotok } from './openrouter.js';
import { NACHALO_UCHEBNIKA, SHEMY, dobavitRashod, noviySchet, sozdatRoli } from './roli.js';

const ADRES = 'https://api.openai.com/v1/chat/completions';
// Flex отвечает дольше обычного, OpenAI советует ждать до 15 минут.
const VSEGO_MS = 15 * 60 * 1000;
const TISHINA_MS = 5 * 60 * 1000;
const POPYTOK = 3;

// Обычный тариф за 1 млн токенов, с developers.openai.com/api/docs/pricing на 06.11.2026.
// В меню показывается цена Flex (половина обычной).
const TARIFY = {
  'gpt-6.1-terra': { vhod: 1, kesh: 0.05, vyhod: 5 },
};
export const MODELI_OPENAI = [
  { id: 'gpt-6.1-terra', nazvanie: 'GPT-6.1 Terra (OpenAI, Flex)', vhod: 0.5, vyhod: 2.5, pervaya: true },
];

const MNOZHITEL = { flex: 0.5, batch: 0.5, priority: 2, fast: 2 };

export function cenaZaprosa(model, u, rezhim) {
  const t = TARIFY[model];
  if (!t) throw new Error('Невідома модель: ' + model);
  const kesh = u.prompt_tokens_details?.cached_tokens ?? 0;
  const vhod = Math.max((u.prompt_tokens ?? 0) - kesh, 0);
  return (vhod * t.vhod + kesh * t.kesh + (u.completion_tokens ?? 0) * t.vyhod) / 1e6 * (MNOZHITEL[rezhim] ?? 1);
}

const pauza = ms => new Promise(r => setTimeout(r, ms));

function oshibkaPoKodu(status, kod, tekst) {
  if (status === 401) return new Error('Ключ OpenAI не підходить. Перевірте файл .env.');
  if (kod === 'insufficient_quota') return new Error('На рахунку OpenAI закінчилися кошти або досягнуто ліміт витрат.');
  if (status === 403) return new Error('OpenAI не пропустив запит: ' + tekst);
  if (status === 404) return new Error('Ця модель недоступна для ключа OpenAI: ' + tekst);
  if (status === 429) return new Error('Перевищено ліміт запитів OpenAI. Спробуйте пізніше.');
  if (status === 400) return new Error('OpenAI відхилив запит: ' + tekst);
  return new Error(`Помилка OpenAI ${status}: ${tekst}`);
}

export function openaiModel(modelId, { apiKey, zagruzka = fetch, zhdat = 2000 }) {
  if (!TARIFY[modelId]) throw new Error('Невідома модель: ' + modelId);
  const schet = noviySchet(modelId);
  // Если Flex отказал, остаток партии идёт в обычном режиме, чтобы не терять время на новые отказы.
  let rezhim = 'flex';

  async function otpravit(telo) {
    let otkazovFlex = 0;
    for (let i = 1; ; i++) {
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
          body: JSON.stringify({ ...telo, service_tier: rezhim }),
          signal: upravlenie.signal,
        });
        const dannye = res.headers?.get?.('content-type')?.includes('text/event-stream')
          ? await prochitatPotok(res, sbros)
          : await res.json().catch(() => ({}));
        const vybor = dannye.choices?.[0];
        if (res.ok && !dannye.error) {
          if (vybor?.message?.content || vybor?.message?.refusal || vybor?.finish_reason) {
            return { ...dannye, rezhim: dannye.service_tier ?? rezhim };
          }
          throw new Error('obryv');
        }
        const status = res.status;
        const kod = dannye.error?.code ?? '';
        const tekst = String(dannye.error?.message ?? '').slice(0, 300);
        if (kod === 'insufficient_quota') throw Object.assign(oshibkaPoKodu(status, kod, tekst), { konechnaya: true });
        if (rezhim === 'flex') {
          // Flex занят (429) или не поддерживается для модели (400 про service_tier): за отказ OpenAI денег не берёт.
          const flexNePodderzhan = status === 400 && /service_tier|flex/i.test(tekst);
          if (status === 429 || flexNePodderzhan) {
            otkazovFlex++;
            if (flexNePodderzhan || otkazovFlex >= 2) {
              console.error('Flex недоступен, переходим на обычный режим:', modelId, status, tekst);
              rezhim = 'default';
              schet.bezFlex = true;
            } else {
              await pauza(zhdat * 5);
            }
            i--;
            continue;
          }
        }
        // Временные сбои повторяем, ошибки ключа, денег и запроса нет.
        if ((status === 408 || status === 429 || status >= 500) && i < POPYTOK) { await pauza(zhdat * i); continue; }
        throw Object.assign(oshibkaPoKodu(status, kod, tekst), { konechnaya: true });
      } catch (e) {
        if (upravlenie.signal.reason?.message === 'vsego') throw new Error(`Модель не встигла відповісти за ${VSEGO_MS / 60000} хвилин.`);
        if (e.konechnaya) throw e;
        console.error('Сбой связи с OpenAI:', modelId, e.cause?.code ?? '', upravlenie.signal.reason?.message ?? e.message);
        if (i < POPYTOK) { await pauza(zhdat * i); continue; }
        throw new Error('Немає зв’язку з OpenAI або відповідь обірвалася. Спробуйте пізніше.');
      } finally {
        clearTimeout(vsego);
        clearTimeout(tishina);
      }
    }
  }

  async function zapros(rol, tekstUchebnika, instrukciya, soobshchenie) {
    const otvet = await otpravit({
      model: modelId,
      max_completion_tokens: 32000,
      stream: true,
      stream_options: { include_usage: true },
      // Учебник идёт первым: одинаковое начало запроса OpenAI кеширует, и оно в 20 раз дешевле.
      messages: [
        { role: 'system', content: NACHALO_UCHEBNIKA + tekstUchebnika + '\n\n' + instrukciya },
        { role: 'user', content: soobshchenie },
      ],
      response_format: { type: 'json_schema', json_schema: { name: rol, strict: true, schema: SHEMY[rol] } },
    });

    const u = otvet.usage ?? {};
    const kesh = u.prompt_tokens_details?.cached_tokens ?? 0;
    dobavitRashod(schet, rol, {
      usd: cenaZaprosa(modelId, u, otvet.rezhim),
      vhod: Math.max((u.prompt_tokens ?? 0) - kesh, 0),
      zapis: 0,
      kesh,
      vyhod: u.completion_tokens ?? 0,
    });

    const vybor = otvet.choices?.[0];
    if (vybor?.message?.refusal) throw new Error('Модель відмовилася виконувати запит.');
    if (vybor?.finish_reason === 'length') throw new Error('Відповідь моделі не вмістилася в ліміт.');
    try {
      return JSON.parse(vybor?.message?.content ?? '');
    } catch {
      console.error('Некорректный ответ OpenAI:', modelId, rol, 'причина:', vybor?.finish_reason ?? '', 'длина:', vybor?.message?.content?.length ?? 0);
      throw new Error('Модель повернула некоректну відповідь.');
    }
  }

  return sozdatRoli(zapros, schet);
}

export function openaiProvayder({ apiKey, zagruzka, zhdat }) {
  return {
    rezhim: 'api',
    paragrafy: 'vse',
    maksimum: 10,
    modeli: MODELI_OPENAI,
    sozdat: id => openaiModel(id, { apiKey, zagruzka, zhdat }),
  };
}
