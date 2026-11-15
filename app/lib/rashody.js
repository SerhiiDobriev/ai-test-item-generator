// Настоящие траты из счёта OpenAI за текущий месяц (Costs API, нужен ключ администратора «только чтение»).
// Запрос бесплатный. Счёт OpenAI обновляется с задержкой, поэтому храним последнее значение и
// обновляем его не чаще раза в 10 минут.
const ADRES = 'https://api.openai.com/v1/organization/costs';

export function nachaloMesyaca(ms) {
  const d = new Date(ms);
  return Math.floor(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), 1) / 1000);
}

export function schetOpenAI({ adminKey, zagruzka = fetch, kazhdye = 10 * 60 * 1000, seychas = () => Date.now() }) {
  let posledniy = null; // { usd, obnovleno, mesyac }
  let oshibka = null;
  let idet = null;
  let kogda = 0;

  async function zagruzit() {
    const mesyac = nachaloMesyaca(seychas());
    let usd = 0;
    let stranica = null;
    for (let i = 0; i < 5; i++) {
      const url = new URL(ADRES);
      url.searchParams.set('start_time', String(mesyac));
      url.searchParams.set('bucket_width', '1d');
      url.searchParams.set('limit', '31');
      if (stranica) url.searchParams.set('page', stranica);
      const res = await zagruzka(url.href, { headers: { authorization: `Bearer ${adminKey}` }, signal: AbortSignal.timeout(20000) });
      const dannye = await res.json().catch(() => ({}));
      if (!res.ok) {
        const tekst = String(dannye.error?.message ?? '').slice(0, 200);
        throw new Error(res.status === 401 || res.status === 403
          ? `Ключ адміністратора OpenAI не підходить (${res.status}).`
          : `Рахунок OpenAI недоступний (${res.status}): ${tekst}`);
      }
      for (const korzina of dannye.data ?? []) {
        for (const r of korzina.results ?? []) usd += Number(r.amount?.value ?? 0) || 0;
      }
      if (!dannye.has_more || !dannye.next_page) break;
      stranica = dannye.next_page;
    }
    posledniy = { usd, obnovleno: new Date(seychas()).toISOString(), mesyac };
    oshibka = null;
  }

  // Запускает обновление, если данные устарели. Ошибки не роняют сайт: остаётся прошлое значение.
  function obnovit({ sila = false } = {}) {
    if (idet) return idet;
    if (!sila && seychas() - kogda < kazhdye) return Promise.resolve();
    kogda = seychas();
    idet = zagruzit()
      .catch(e => {
        if (oshibka !== e.message) console.error('Счёт OpenAI:', e.message);
        oshibka = e.message;
      })
      .finally(() => { idet = null; });
    return idet;
  }

  return {
    obnovit,
    // Последнее известное значение за этот месяц или null, если его ещё нет.
    usd() {
      if (!posledniy || posledniy.mesyac !== nachaloMesyaca(seychas())) return null;
      return posledniy.usd;
    },
    sostoyanie() {
      const usd = this.usd();
      return { usd, obnovleno: usd == null ? null : posledniy.obnovleno, oshibka };
    },
  };
}
