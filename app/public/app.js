// Сторінки генератора: вхід, створення партії, перевірка завдань, бібліотека.
const ekran = document.getElementById('ekran');
const BUKVY = { a: 'А', b: 'Б', c: 'В', d: 'Г' };
const FAKTY = { OK: ['добре', 'ok'], ZAMECHANIE: ['увага', 'vn'], OSHIBKA: ['помилка', 'pl'] };
const METODIST = { OK: ['добре', 'ok'], PRAVKA: ['правка', 'vn'], ZAMENIT: ['замінити', 'pl'] };
const PODSKAZKA_SHODSTVA = 'Наскільки запитання схоже на найближче із 2911 завдань бази. Від 75% — попередження.';
const STATUSY = { prinyato: 'Прийнято', otkloneno: 'Відхилено', proverka: 'На перевірці' };
let sostoyanie = null;
let taymer = null;
let pokolenie = 0; // щоб відповідь зі старої сторінки не потрапила на нову

// Колосок прямо в странице (не картинкой), чтобы его цвет менялся с темой: в светлой темнее, в тёмной как был.
const LOGO_SVG = '<svg viewBox="0 0 32 32" width="52" height="52" aria-hidden="true"><g transform="rotate(28 16 16)" fill="currentColor">'
  + '<path d="M9.6 23.4L16 28.2V6" fill="none" stroke="currentColor" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round"/>'
  + '<ellipse cx="12.6" cy="17" rx="2.1" ry="3.9" transform="rotate(-32 12.6 17)"/><ellipse cx="19.4" cy="17" rx="2.1" ry="3.9" transform="rotate(32 19.4 17)"/>'
  + '<ellipse cx="12.9" cy="11.2" rx="2" ry="3.6" transform="rotate(-30 12.9 11.2)"/><ellipse cx="19.1" cy="11.2" rx="2" ry="3.6" transform="rotate(30 19.1 11.2)"/>'
  + '<ellipse cx="16" cy="4.6" rx="1.9" ry="3.3"/></g></svg>';
function logotip(klass) {
  const el = h('span', { className: klass });
  el.innerHTML = LOGO_SVG;
  return el;
}

// Режим для тестов запоминается в этом браузере. Без доступа к хранилищу просто выключен.
const KLYUCH_TESTOV = 'zno-rezhim-testiv';
function rezhimTestov() {
  try { return localStorage.getItem(KLYUCH_TESTOV) === '1'; } catch { return false; }
}
function zapomnitRezhimTestov(vkl) {
  try { if (vkl) localStorage.setItem(KLYUCH_TESTOV, '1'); else localStorage.removeItem(KLYUCH_TESTOV); } catch { /* не страшно */ }
}

function h(tag, svoystva = {}, ...deti) {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(svoystva)) {
    if (v === undefined || v === null || v === false) continue;
    if (k.startsWith('on')) el.addEventListener(k.slice(2), v);
    else if (k in el && k !== 'list') el[k] = v;
    else el.setAttribute(k, v);
  }
  for (const d of deti.flat(Infinity)) if (d !== null && d !== undefined && d !== false) el.append(d);
  return el;
}

// У завданнях дозволено лише прості теги без атрибутів. Усе інше показується як текст.
function bezopasno(html) {
  return String(html ?? '').replace(/<(?!\/?(?:p|strong|em|b|i|br|sub|sup)\s*\/?>)/gi, '&lt;');
}

function izHtml(tag, html, svoystva = {}) {
  const el = h(tag, svoystva);
  el.innerHTML = bezopasno(html);
  return el;
}

function vTekst(html) {
  const el = document.createElement('div');
  el.innerHTML = bezopasno(html).replace(/<br\s*\/?>/gi, '\n');
  return el.textContent.trim();
}

async function api(put, { method = 'GET', telo } = {}) {
  const res = await fetch(put, {
    method,
    headers: telo !== undefined ? { 'content-type': 'application/json' } : {},
    body: telo !== undefined ? JSON.stringify(telo) : undefined,
  });
  const data = await res.json().catch(() => ({}));
  if (res.status === 401 && put !== '/api/vhod') {
    pokazatVhod();
    throw new Error('Потрібно увійти');
  }
  if (!res.ok) throw new Error(data.oshibka || 'Щось пішло не так. Спробуйте ще раз.');
  return data;
}

// Пока новая страница грузится, показываем «Завантаження…», а не пустой экран (медленный школьный интернет).
function ochistit() {
  clearTimeout(taymer);
  pokolenie++;
  ekran.replaceChildren(h('p', { className: 'pusto zagruzka', role: 'status' }, 'Завантаження…'));
  return pokolenie;
}

function otmetitNav(kto) {
  document.querySelectorAll('[data-nav]').forEach(a => a.classList.toggle('tut', a.dataset.nav === kto));
}

function pokazatVhod() {
  ochistit();
  sostoyanie = null;
  document.getElementById('shapka').hidden = true;
  document.title = 'Вхід · Генератор завдань';
  const parol = h('input', { type: 'password', id: 'parol', autocomplete: 'current-password', required: true,
    oninput: () => parol.classList.remove('nevernoe') });
  const oshibka = h('p', { className: 'oshibka', role: 'alert', hidden: true });
  const knopka = h('button', { className: 'glavnaya', type: 'submit' }, 'Увійти');
  // В демо пароль открыт: показываем его и сразу подставляем в поле.
  const demoVhod = h('div', { className: 'demo-vhod', hidden: true });
  api('/api/info').then(info => {
    if (!info?.demo) return;
    demoVhod.replaceChildren(
      h('strong', {}, 'Демо-версія'), h('br'),
      'Пароль: ', h('code', {}, info.parol), ' — уже введено, натисніть «Увійти».', h('br'),
      h('span', { lang: 'en' }, `Demo version. Password: ${info.parol} (already filled in). All data is fictional; AI calls are replaced with prerecorded responses.`));
    demoVhod.hidden = false;
    if (!parol.value) parol.value = info.parol;
  }).catch(() => {});
  ekran.replaceChildren(h('form', {
    className: 'panel vhod',
    onsubmit: async e => {
      e.preventDefault();
      knopka.disabled = true;
      oshibka.hidden = true;
      try {
        await api('/api/vhod', { method: 'POST', telo: { parol: parol.value } });
        await zapusk();
      } catch (err) {
        oshibka.textContent = err.message;
        oshibka.hidden = false;
        parol.classList.add('nevernoe');
        knopka.disabled = false;
      }
    },
  }, logotip('vhod-logo'),
    h('h1', {}, 'Генератор завдань'), h('p', { className: 'vhod-pod' }, 'Історія України · 7 клас'),
    demoVhod, h('label', { htmlFor: 'parol' }, 'Пароль'), parol, oshibka, knopka));
  parol.focus();
}

function nazvaniePar(par) {
  const p = sostoyanie.paragrafy.find(x => x.par === par);
  return p ? `§ ${p.par}. ${p.title}` : `§ ${par}`;
}

function demoZametka() {
  if (sostoyanie.rezhim !== 'demo') return null;
  return h('div', { className: 'panel demo' },
    h('strong', {}, 'Демо-версія. '),
    'Усі дані вигадані. Замість ІІ-агентів сайт показує заздалегідь підготовлені відповіді, тому нічого не платить; перевірка кодом працює по-справжньому. Дані скидаються щодоби.',
    h('br'), h('span', { lang: 'en', className: 'en' },
      'Demo: fictional data. AI agents are replaced with prerecorded responses, so nothing is paid for; the code checks are real. Data resets daily.'));
}

function dataVremya(iso) {
  return new Date(iso).toLocaleString('uk-UA', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });
}

// Примерная цена партии, та же формула, что в lib/zakaz.js.
const otsenkaPartii = (m, n) => (35000 * m.vhod + (1000 * n + 1000) * m.vyhod) / 1e6;
function razbit(n, maks) {
  const k = Math.ceil(n / maks);
  const osnova = Math.floor(n / k);
  return Array.from({ length: k }, (_, i) => osnova + (i < n % k ? 1 : 0));
}
const MINUT_NA_PARTIYU = 2.5;

function slovo(n, odno, dva, pyat) {
  const d = n % 10, s = n % 100;
  if (d === 1 && s !== 11) return odno;
  if (d >= 2 && d <= 4 && (s < 12 || s > 14)) return dva;
  return pyat;
}

// Настоящие траты из счёта OpenAI. Счёт приходит с задержкой, поэтому показываем время обновления.
function strokaSchetaOpenAI() {
  const s = sostoyanie.schetOpenAI;
  if (!s) return null;
  const testy = rezhimTestov();
  if (s.usd == null) {
    return testy && s.oshibka ? h('p', { className: 'podskazka' }, `Рахунок OpenAI: ${s.oshibka}`) : null;
  }
  const chas = new Date(s.obnovleno).toLocaleTimeString('uk-UA', { hour: '2-digit', minute: '2-digit' });
  const raznica = s.sayt > 0 ? Math.round((s.usd / s.sayt - 1) * 100) : null;
  return h('p', { className: 'podskazka' },
    `За рахунком OpenAI цього місяця: $${s.usd.toFixed(2)} (дані на ${chas}, рахунок оновлюється із запізненням до години).`
    + (testy ? ` Сайт нарахував за моделі OpenAI $${s.sayt.toFixed(3)}${raznica != null ? `, різниця ${raznica > 0 ? '+' : ''}${raznica}%` : ''}.` : '')
    + (testy && s.oshibka ? ` Останнє оновлення не вдалося: ${s.oshibka}` : ''));
}

async function ekranSozdat() {
  const moe = ochistit();
  otmetitNav('sozdat');
  document.title = 'Створити · Генератор завдань';
  sostoyanie = await api('/api/sostoyanie');
  if (moe !== pokolenie) return;
  // Для заказчика только основная модель; все модели и цены за токены — в режиме для тестов.
  const testy = rezhimTestov();
  const osnovnye = sostoyanie.modeli.filter(m => m.pervaya);
  const modeli = testy || !osnovnye.length ? sostoyanie.modeli : osnovnye;
  const vyborModeli = modeli.length > 1 ? h('select', { id: 'model', onchange: () => obnovit() }, modeli.map((m, i) =>
    h('option', { value: m.id, selected: i === 0 }, testy ? `${m.nazvanie} ($${m.vhod} / $${m.vyhod} за 1 млн токенів)` : m.nazvanie)))
    : modeli.length ? { value: modeli[0].id, odna: modeli[0] } : null;
  const pervyy = sostoyanie.paragrafy.find(x => x.dostupen)?.par;
  const MAKS = sostoyanie.maksZakaz;
  const stroki = h('div', { className: 'chasti' });
  const dobavit = h('button', { type: 'button', className: 'tiho dobavit', onclick: () => { novayaStroka(); obnovit(); } }, '+ Ще параграф');
  const itog = h('p', { className: 'itog-zakaza', role: 'status' });
  const podskazka = h('p', { className: 'podskazka', hidden: true },
    'Деякі параграфи поки недоступні: у демо-режимі є готові відповіді лише для частини параграфів.');
  const oshibka = h('p', { className: 'oshibka', role: 'alert', hidden: true });
  const knopka = h('button', { className: 'glavnaya', type: 'submit' }, 'Створити завдання');
  const spisok = h('div', {});

  function novayaStroka() {
    const nomer = stroki.children.length + 1;
    const zanyato = new Set([...stroki.querySelectorAll('select')].map(s => Number(s.value)));
    const svobodnyy = sostoyanie.paragrafy.find(x => x.dostupen && !zanyato.has(x.par))?.par ?? pervyy;
    const par = h('select', { 'aria-label': `Параграф ${nomer}`, onchange: () => obnovit() }, sostoyanie.paragrafy.map(p =>
      h('option', { value: p.par, selected: p.par === svobodnyy }, `§ ${p.par}. ${p.title}`)));
    // Новой строке — остаток до предела заказа (не больше 10), чтобы не выходить за 50 «само собой».
    const uzhe = chasti().reduce((s, c) => s + (Number.isInteger(c.skolko) && c.skolko > 0 ? c.skolko : 0), 0);
    const poUmolchaniyu = Math.max(1, Math.min(10, MAKS - uzhe));
    const skolko = h('input', { type: 'number', min: 1, max: MAKS, value: poUmolchaniyu, required: true, 'aria-label': `Завдань для параграфа ${nomer}`, oninput: () => obnovit() });
    const stroka = h('div', { className: 'chast' }, par, skolko);
    const ubrat = h('button', { type: 'button', className: 'tiho ubrat', title: 'Прибрати параграф', 'aria-label': 'Прибрати параграф',
      onclick: () => { stroki.removeChild(stroka); obnovit(); } }, '×');
    stroka.append(ubrat);
    stroki.append(stroka);
  }

  function chasti() {
    return [...stroki.children].map(s => ({ par: Number(s.querySelector('select').value), skolko: Number(s.querySelector('input').value) }));
  }

  function obnovit() {
    oshibka.hidden = true;
    const spisokChastey = chasti();
    stroki.querySelectorAll('.ubrat').forEach(b => { b.hidden = spisokChastey.length === 1; });
    const nedostupen = spisokChastey.some(c => !sostoyanie.paragrafy.find(x => x.par === c.par)?.dostupen);
    podskazka.hidden = !nedostupen;
    const goden = c => Number.isInteger(c.skolko) && c.skolko > 0 && c.skolko <= MAKS;
    // Неверное число в строке подсвечиваем и называем прямо, а не молча выкидываем из итога.
    const plohie = [];
    [...stroki.children].forEach((s, i) => {
      const pole = s.querySelector('input');
      const zle = !goden(spisokChastey[i]);
      pole.classList.toggle('nevernoe', zle);
      pole.setAttribute('aria-invalid', String(zle));
      if (zle) plohie.push(spisokChastey[i].par);
    });
    const poPar = new Map();
    for (const c of spisokChastey) poPar.set(c.par, (poPar.get(c.par) ?? 0) + 1);
    const dvazhdy = [...poPar].filter(([, n]) => n > 1).map(([par]) => par);
    [...stroki.children].forEach((s, i) => s.querySelector('select').classList.toggle('dubl', dvazhdy.includes(spisokChastey[i].par)));
    const vsego = spisokChastey.reduce((s, c) => s + (goden(c) ? c.skolko : 0), 0);
    // Когда уже набрано 50 заданий или 10 параграфов, новую строку добавить нельзя.
    dobavit.hidden = spisokChastey.length >= sostoyanie.maksChastey || vsego >= MAKS;
    const partii = spisokChastey.flatMap(c => (goden(c) ? razbit(c.skolko, sostoyanie.maksimum) : []));
    const model = sostoyanie.modeli.find(m => m.id === vyborModeli?.value);
    const cena = model ? partii.reduce((s, n) => s + otsenkaPartii(model, n), 0) : null;
    const minut = Math.ceil(partii.length * MINUT_NA_PARTIYU);
    const problema = plohie.length
      ? `Для ${plohie.map(p => `§ ${p}`).join(', ')} вкажіть ціле число від 1 до ${MAKS}.`
      : vsego > MAKS ? `Разом ${vsego} ${slovo(vsego, 'завдання', 'завдання', 'завдань')}, а за один раз можна до ${MAKS} — зменште на ${vsego - MAKS}.`
        : null;
    itog.className = 'itog-zakaza' + (problema ? ' oshibka' : '');
    itog.textContent = problema
      ?? `Разом ${vsego} ${slovo(vsego, 'завдання', 'завдання', 'завдань')} · ${partii.length} ${slovo(partii.length, 'партія', 'партії', 'партій')}`
        + (cena != null ? ` · орієнтовно $${cena.toFixed(2)}` : '')
        + (sostoyanie.rezhim === 'demo' ? ` · близько ${partii.length * 5} с (демо)` : ` · близько ${minut} хв`)
        + (dvazhdy.length ? ` · ${dvazhdy.map(p => `§ ${p}`).join(', ')} вибрано двічі — можна об’єднати в один рядок` : '');
    knopka.disabled = nedostupen || !!problema || vsego < 1;
  }

  novayaStroka();
  obnovit();

  ekran.replaceChildren(
    demoZametka() ?? '',
    h('form', {
      className: 'panel',
      onsubmit: async e => {
        e.preventDefault();
        knopka.disabled = true;
        oshibka.hidden = true;
        try {
          const z = await api('/api/zakazy', { method: 'POST', telo: { chasti: chasti(), model: vyborModeli?.value } });
          location.hash = z.partii.length === 1 ? `#/partiya/${z.partii[0]}` : `#/zakaz/${z.id}`;
        } catch (err) {
          oshibka.textContent = err.message;
          oshibka.hidden = false;
          knopka.disabled = false;
        }
      },
    },
    h('h1', {}, 'Нове замовлення'),
    vyborModeli && !vyborModeli.odna ? h('div', { className: 'pole-modeli-zakaz' }, h('label', { htmlFor: 'model' }, 'Модель'), vyborModeli) : null,
    h('div', { className: 'chasti-zag', 'aria-hidden': 'true' }, h('span', {}, 'Параграф підручника'), h('span', {}, 'Завдань')),
    stroki,
    h('div', { className: 'zakaz-niz' }, dobavit, itog, knopka),
    podskazka,
    oshibka,
    h('p', { className: 'podskazka' }, (vyborModeli?.odna ? `Модель: ${vyborModeli.odna.nazvanie}. ` : '')
      + `Понад ${sostoyanie.maksimum} завдань сайт сам ділить на партії і робить їх по черзі. Автор не повторює завдання, які вже є з цього параграфа.`
      + (sostoyanie.rezhim === 'api' ? ` Витрачено цього місяця: $${sostoyanie.potracheno.toFixed(2)} із $${sostoyanie.limitUsd}.` : ''),
      ' ', h('a', { href: '#/dovidka' }, 'Як користуватися')),
    sostoyanie.rezhim === 'api' ? strokaSchetaOpenAI() : null),
    spisok);

  // Список партий: сначала 30 последних, «Показати ще» добавляет по 30.
  let skolkoPokazat = 30;
  const sekciya = h('section', { className: 'panel' });
  async function pokazatPartii() {
    const partii = await api(`/api/partii?limit=${skolkoPokazat}`);
    if (moe !== pokolenie) return;
    if (!partii.length) {
      sekciya.remove();
      return;
    }
    const eshche = partii.length >= skolkoPokazat
      ? h('button', { type: 'button', className: 'tiho eshche', onclick: () => { skolkoPokazat += 30; pokazatPartii(); } }, 'Показати ще')
      : null;
    sekciya.replaceChildren(h('h2', { style: 'margin-top:0' }, 'Створені партії'), tablicaPartiy(partii), eshche ?? '');
  }
  sekciya.append(h('p', { className: 'pusto' }, 'Завантаження…'));
  spisok.append(sekciya);
  await pokazatPartii();
}

function nazvanieModeli(id) {
  const m = sostoyanie.modeli.find(x => x.id === id);
  return m ? `${m.nazvanie} · ` : id ? `${id} · ` : '';
}

// Список партий таблицей: каждая цифра в своём столбце, партии заказа собраны под строкой заказа.
const STAN = {
  gotovo: ['готово', 'ok'], idet: ['створюється', 'vn'], ochered: ['у черзі', 'ny'], oshibka: ['не вдалося', 'pl'],
  skasovano: ['скасовано', 'ny'], limit: ['ліміт', 'vn'], povtoreno: ['повторено', 'ny'],
};
// Отмена, месячный лимит и уже повторённая партия — не сбой ИИ, показываем их отдельно.
function stanPartii(p) {
  if (p.status !== 'oshibka') return p.status;
  if (/^Скасовано/.test(p.oshibka ?? '')) return 'skasovano';
  if (/місячного ліміту/.test(p.oshibka ?? '')) return 'limit';
  if (p.povtor_id > 0) return 'povtoreno';
  return 'oshibka';
}
const ostalos = p => (p.status === 'gotovo' ? Math.max(p.vsego - p.prinyato - p.otkloneno, 0) : 0);
const cenaKorotko = usd => (usd == null ? '—' : usd > 0 && usd < 0.01 ? '<$0.01' : `$${usd.toFixed(2)}`);

function yacheyki(p, { nomer, nazva, model, stan, data }) {
  const ost = ostalos(p);
  const gotova = p.status === 'gotovo';
  return [
    h('span', { className: 'sp-n' }, nomer),
    h('span', { className: 'sp-par' }, nazva),
    model !== undefined ? h('span', { className: 'sp-model', 'data-pole': 'Модель' }, model) : null,
    h('span', { className: 'sp-stan', 'data-pole': 'Стан' }, stan),
    h('span', { className: 'sp-c' + (ost ? ' sp-treba' : ''), 'data-pole': 'Перевірити' }, gotova || p.zbir ? String(ost) : '—'),
    h('span', { className: 'sp-c', 'data-pole': 'Прийнято' }, gotova || p.zbir ? String(p.prinyato) : '—'),
    h('span', { className: 'sp-c', 'data-pole': 'Відхилено' }, gotova || p.zbir ? String(p.otkloneno) : '—'),
    h('span', { className: 'sp-c', 'data-pole': 'Ціна' }, p.cena_usd ? cenaKorotko(p.cena_usd) : '—'),
    h('span', { className: 'sp-data', 'data-pole': 'Дата' }, data),
  ];
}

function strokaPartii(p, { model, vlozhena = false }) {
  const [tekst, cvet] = STAN[stanPartii(p)] ?? [p.status, 'ny'];
  return h('a', { href: `#/partiya/${p.id}`, className: `sp-stroka st-${p.status}${vlozhena ? ' sp-vlozh' : ''}` },
    yacheyki(p, {
      nomer: `${vlozhena ? '↳ ' : ''}${p.id}`,
      nazva: nazvaniePar(p.par),
      model: model ? nazvanieModeli(p.model).replace(/ · $/, '') : undefined,
      stan: h('span', { className: `sv ${cvet}` }, tekst),
      data: dataVremya(p.sozdana),
    }));
}

// Строка заказа: суммы по его партиям, ссылка на страницу заказа.
function strokaZakaza(id, partii, { model }) {
  const idet = partii.some(p => p.status === 'idet' || p.status === 'ochered');
  const sboi = partii.filter(p => stanPartii(p) === 'oshibka').length;
  const svod = {
    zbir: true, status: 'gotovo',
    vsego: partii.reduce((s, p) => s + p.vsego, 0),
    prinyato: partii.reduce((s, p) => s + p.prinyato, 0),
    otkloneno: partii.reduce((s, p) => s + p.otkloneno, 0),
    cena_usd: partii.reduce((s, p) => s + (p.cena_usd ?? 0), 0),
  };
  const gotovo = partii.filter(p => p.status === 'gotovo').length;
  const stan = idet ? ['іде', 'vn'] : sboi ? [`збоїв: ${sboi}`, 'pl'] : ['готово', 'ok'];
  const zadaniy = partii.reduce((s, p) => s + p.skolko, 0);
  return h('a', { href: `#/zakaz/${id}`, className: 'sp-stroka sp-zakaz' },
    yacheyki({ ...svod, vsego: partii.filter(p => p.status === 'gotovo').reduce((s, p) => s + p.vsego, 0) }, {
      nomer: '',
      nazva: h('span', {}, h('b', {}, `Замовлення №${id}`), ` · ${partii.length} ${slovo(partii.length, 'партія', 'партії', 'партій')}, ${zadaniy} ${slovo(zadaniy, 'завдання', 'завдання', 'завдань')}`
        + (idet ? `, готово ${gotovo}` : '')),
      model: model ? '' : undefined,
      stan: h('span', { className: `sv ${stan[1]}` }, stan[0]),
      data: dataVremya(partii[partii.length - 1].sozdana),
    }));
}

// partii — от новых к старым. gruppirovat: собрать партии одного заказа (из двух и больше) под его строкой.
function tablicaPartiy(partii, { gruppirovat = true, filtry = true } = {}) {
  const model = rezhimTestov();
  const FILTRY = [
    ['vse', 'Усі', () => true],
    ['treba', 'Треба перевірити', p => ostalos(p) > 0],
    ['idut', 'Створюються', p => p.status === 'idet' || p.status === 'ochered'],
    ['zboi', 'Не вдалися', p => stanPartii(p) === 'oshibka'],
  ];
  // Выбранный фильтр помним, пока открыта вкладка: методист ходит в партию и обратно.
  const KLYUCH_FILTRA = 'zno-filtr-partiy';
  let filtr = 'vse';
  if (filtry) {
    try {
      const bylo = sessionStorage.getItem(KLYUCH_FILTRA);
      const usl = FILTRY.find(f => f[0] === bylo)?.[2];
      if (usl && partii.some(usl)) filtr = bylo;
    } catch { /* не страшно */ }
  }
  const telo = h('div', {});
  const pusto = h('p', { className: 'pusto', hidden: true }, 'За цим фільтром партій немає.');
  const chipy = h('div', { className: 'filtry', role: 'group', 'aria-label': 'Фільтр партій' });

  const poZakazu = new Map();
  for (const p of partii) if (p.zakaz_id) poZakazu.set(p.zakaz_id, [...(poZakazu.get(p.zakaz_id) ?? []), p]);

  function risovat() {
    const usl = FILTRY.find(f => f[0] === filtr)[2];
    const stroki = [];
    const uzhe = new Set();
    for (const p of partii) {
      const gruppa = gruppirovat && p.zakaz_id && poZakazu.get(p.zakaz_id).length > 1 ? poZakazu.get(p.zakaz_id) : null;
      if (gruppa) {
        if (uzhe.has(p.zakaz_id)) continue;
        uzhe.add(p.zakaz_id);
        const vidimye = gruppa.filter(usl);
        if (!vidimye.length) continue;
        stroki.push(h('div', { className: 'sp-gruppa' }, strokaZakaza(p.zakaz_id, gruppa, { model }),
          vidimye.map(x => strokaPartii(x, { model, vlozhena: true }))));
      } else if (usl(p)) {
        stroki.push(strokaPartii(p, { model }));
      }
    }
    telo.replaceChildren(...stroki);
    pusto.hidden = stroki.length > 0;
    chipy.querySelectorAll('button').forEach(b => {
      const on = b.dataset.f === filtr;
      b.classList.toggle('tut', on);
      b.setAttribute('aria-pressed', String(on));
    });
  }

  for (const [k, nazva, usl] of FILTRY) {
    const n = partii.filter(usl).length;
    if (k !== 'vse' && !n) continue;
    const podpis = k === 'vse' ? `${nazva}: ${n}` : `${nazva}: ${n} ${slovo(n, 'партія', 'партії', 'партій')}`;
    chipy.append(h('button', {
      type: 'button', 'data-f': k,
      onclick: () => {
        filtr = k;
        try { sessionStorage.setItem(KLYUCH_FILTRA, k); } catch { /* не страшно */ }
        risovat();
      },
    }, podpis));
  }
  risovat();
  return h('div', { className: 'spisok-partiy' + (model ? ' s-model' : '') },
    filtry ? chipy : null,
    h('div', { className: 'sp-tablica' },
      h('div', { className: 'sp-stroka sp-zag', 'aria-hidden': 'true' },
        h('span', {}, '№'), h('span', {}, 'Параграф'), model ? h('span', {}, 'Модель') : null, h('span', {}, 'Стан'),
        h('span', { className: 'sp-c' }, 'Перевірити'), h('span', { className: 'sp-c' }, 'Прийнято'), h('span', { className: 'sp-c' }, 'Відхилено'),
        h('span', { className: 'sp-c' }, 'Ціна'), h('span', {}, 'Дата')),
      telo),
    pusto);
}

// Заказ из нескольких партий: ход работы и ссылки на каждую партию.
async function ekranZakaz(id) {
  const moe = ochistit();
  otmetitNav('sozdat');
  document.title = `Замовлення ${id} · Генератор завдань`;
  const obnovit = async () => {
    let z;
    try {
      z = await api(`/api/zakazy/${id}`);
    } catch (err) {
      if (moe === pokolenie) ekran.replaceChildren(h('a', { className: 'nazad', href: '#/' }, '← До списку'), h('p', { className: 'oshibka' }, err.message));
      return;
    }
    if (moe !== pokolenie) return;
    const p = z.partii;
    const gotovo = p.filter(x => x.status === 'gotovo').length;
    const sboev = p.filter(x => stanPartii(x) === 'oshibka').length;
    const idet = p.some(x => x.status === 'idet' || x.status === 'ochered');
    const zadaniy = p.reduce((s, x) => s + x.vsego, 0);
    const zakazano = p.reduce((s, x) => s + x.skolko, 0);
    const prinyato = p.reduce((s, x) => s + x.prinyato, 0);
    const cena = p.reduce((s, x) => s + (x.cena_usd ?? 0), 0);
    const pokazatel = (znachenie, podpis) => h('div', {}, h('b', {}, znachenie), h('small', {}, podpis));
    const sostoyanieTekst = idet
      ? `Партії створюються по черзі: готово ${gotovo} з ${p.length}. Сторінку можна не оновлювати, а завдання готових партій уже можна перевіряти.`
      : sboev ? `Готово. ${sboev} ${slovo(sboev, 'партія', 'партії', 'партій')} не ${sboev === 1 ? 'вдалася' : 'вдалися'}: відкрийте її, щоб побачити причину.` : 'Готово. Відкрийте партію, щоб перевірити завдання.';
    ekran.replaceChildren(
      h('a', { className: 'nazad', href: '#/' }, '← До списку партій'),
      demoZametka() ?? '',
      h('div', { className: 'zagolovok-partii' }, h('h1', {}, `Замовлення №${z.id}`), h('span', { className: 'podskazka' }, nazvanieModeli(z.model).replace(/ · $/, ''))),
      h('div', { className: 'itogi' },
        pokazatel(`${gotovo} / ${p.length}`, 'партій готово'),
        pokazatel(`${zadaniy} / ${zakazano}`, 'завдань створено'),
        pokazatel(String(p.filter(x => x.status === 'gotovo').reduce((s, x) => s + Math.max(x.vsego - x.prinyato - x.otkloneno, 0), 0)), 'на перевірці'),
        pokazatel(String(prinyato), 'прийнято'),
        pokazatel(`$${cena.toFixed(3)}`, 'витрачено, приблизно')),
      h('p', { className: 'podskazka', role: 'status' }, sostoyanieTekst),
      knopkaOtmeny(`/api/zakazy/${z.id}/skasuvaty`, p.filter(x => x.status === 'ochered').length, obnovit) ?? '',
      h('section', { className: 'panel' }, tablicaPartiy(p, { gruppirovat: false, filtry: false })));
    if (idet) taymer = setTimeout(obnovit, 2000);
  };
  await obnovit();
}

function shagi(etap) {
  const i = sostoyanie.etapy.findIndex(e => e.kod === etap);
  return h('ol', { className: 'shagi', 'aria-label': 'Хід роботи' }, sostoyanie.etapy.map((e, k) =>
    h('li', { className: k < i ? 'sdelano' : k === i ? 'seychas' : '', 'aria-current': k === i ? 'step' : undefined }, e.nazvanie)));
}

async function ekranPartiya(id) {
  const moe = ochistit();
  otmetitNav('sozdat');
  document.title = `Партія ${id} · Генератор завдань`;
  const obnovit = async () => {
    let p;
    try {
      p = await api(`/api/partii/${id}`);
    } catch (err) {
      if (moe === pokolenie) ekran.replaceChildren(h('a', { className: 'nazad', href: '#/' }, '← До списку'), h('p', { className: 'oshibka' }, err.message));
      return;
    }
    if (moe !== pokolenie) return;
    risovatPartiyu(p);
    if (p.status === 'idet') taymer = setTimeout(obnovit, 800);
    else if (p.status === 'ochered') taymer = setTimeout(obnovit, 2000);
  };
  await obnovit();
}

function risovatPartiyu(p) {
  const nazad = p.zakaz_id
    ? h('a', { className: 'nazad', href: `#/zakaz/${p.zakaz_id}` }, `← Замовлення №${p.zakaz_id}`)
    : h('a', { className: 'nazad', href: '#/' }, '← До списку партій');
  const zagolovok = h('h1', {}, `Партія №${p.id}. ${nazvaniePar(p.par)}`);
  if (p.status === 'ochered') {
    ekran.replaceChildren(nazad, h('div', { className: 'panel', role: 'status' }, zagolovok,
      h('p', { style: 'margin:0' }, `У черзі: ${p.skolko} ${slovo(p.skolko, 'завдання', 'завдання', 'завдань')}. Почнеться, коли закінчаться попередні партії.`),
      knopkaOtmeny(`/api/partii/${p.id}/skasuvaty`, 1, () => marshrut())));
    return;
  }
  if (p.status === 'idet') {
    ekran.replaceChildren(nazad, demoZametka() ?? '', h('div', { className: 'panel', role: 'status' }, zagolovok,
      h('p', { style: 'margin:0' }, 'Створюємо завдання. Сторінку можна не оновлювати.'), shagi(p.etap)));
    return;
  }
  if (p.status === 'oshibka') {
    ekran.replaceChildren(nazad, h('div', { className: 'panel' }, zagolovok, ...prichinaSboya(p)));
    return;
  }
  const z = p.zadaniya;
  const pokazatel = (id, podpis) => h('div', {}, h('b', { id }), h('small', {}, podpis));
  // «На перевірці» — сколько осталось посмотреть; цена за принятое задание нужна только для сравнения моделей.
  const testy = rezhimTestov();
  const itogi = h('div', { className: 'itogi' },
    pokazatel('nap', 'на перевірці'),
    pokazatel('pr', 'прийнято'),
    pokazatel('zam', 'із зауваженнями'),
    pokazatel('cena', p.cena_usd != null ? 'ціна партії, приблизно' : p.rezhim === 'demo' ? 'ціна партії: $0 у демо (готові відповіді)' : 'ціна партії: невідома'),
    testy ? pokazatel('zaod', 'за прийняте завдання') : null);
  const zapolnit = id => itogi.querySelector('#' + id);
  const pereschet = () => {
    const prinyato = z.filter(x => x.status === 'prinyato').length;
    const naProverke = z.filter(x => x.status === 'proverka').length;
    zapolnit('nap').textContent = String(naProverke);
    zapolnit('nap').classList.toggle('akc', naProverke > 0);
    zapolnit('pr').textContent = `${prinyato} / ${z.length}`;
    const nZam = z.filter(x => x.status === 'proverka' && estZamechaniya(x)).length;
    zapolnit('zam').textContent = String(nZam);
    zapolnit('zam').classList.toggle('est', nZam > 0);
    zapolnit('cena').textContent = p.cena_usd == null ? '—' : `$${p.cena_usd.toFixed(3)}`;
    if (testy) zapolnit('zaod').textContent = p.cena_usd != null && prinyato ? `$${(p.cena_usd / prinyato).toFixed(4)}` : '—';
  };
  pereschet();
  ekran.replaceChildren(
    nazad,
    demoZametka() ?? '',
    h('div', { className: 'zagolovok-partii' }, zagolovok, h('span', { className: 'podskazka' }, nazvanieModeli(p.model).replace(/ · $/, ''))),
    itogi,
    vytraty(p) ?? '',
    tablicaZadaniy(z, { filtry: true, naIzmenenie: pereschet }),
    p.zakaz_id ? sleduyushchayaPartiya(p) : '');
}

// Отменить партии, которые ещё ждут в очереди: если заказали больше, чем нужно. Начатая партия доделается.
function knopkaOtmeny(put, skolko, posle) {
  if (!skolko) return null;
  return h('button', {
    type: 'button', className: 'otmena',
    onclick: async e => {
      if (!confirm(`Скасувати ${skolko} ${slovo(skolko, 'партію', 'партії', 'партій')} у черзі? Гроші за них не витрачаться.`)) return;
      e.currentTarget.disabled = true;
      try {
        await api(put, { method: 'POST', telo: {} });
      } catch (err) {
        alert(err.message);
      }
      posle();
    },
  }, skolko === 1 && put.includes('/partii/') ? 'Скасувати цю партію' : `Скасувати партії в черзі: ${skolko}`);
}

// Под партией заказа — переход к следующей партии того же заказа, чтобы не возвращаться каждый раз.
function sleduyushchayaPartiya(p) {
  const mesto = h('div', { className: 'sleduyushchaya' });
  api(`/api/zakazy/${p.zakaz_id}`).then(z => {
    const dalee = z.partii.find(x => x.id > p.id);
    mesto.replaceChildren(dalee
      ? h('a', { className: 'knopka', href: `#/partiya/${dalee.id}` }, `Наступна партія: №${dalee.id}. ${nazvaniePar(dalee.par)} →`)
      : h('a', { href: `#/zakaz/${p.zakaz_id}` }, `Це остання партія. ← До замовлення №${p.zakaz_id}`));
  }).catch(() => {});
  return mesto;
}

// Неудачная партия: понятная причина простыми словами и кнопка «Спробувати ще раз» с теми же параметрами.
function prichinaSboya(p) {
  const tekst = p.oshibka || '';
  const limit = /місячного ліміту/.test(tekst);
  const skasovano = /Скасовано/.test(tekst);
  const prostymi = limit || skasovano ? tekst
    : /не вмістилася в ліміт/.test(tekst) ? 'ШІ дав надто довгу відповідь, і вона обірвалася.'
      : /некоректну відповідь/.test(tekst) ? 'ШІ повернув відповідь у неправильному форматі.'
        : /перезапустився/.test(tekst) ? 'Сервер перезапустився, поки створювалася партія.'
          : /зв’язку|не встигла/.test(tekst) ? 'Не вдалося дочекатися відповіді ШІ.'
            : 'Не вдалося створити завдання через збій ШІ.';
  const oshibka = h('p', { className: 'oshibka', role: 'alert', hidden: true });
  const povtor = limit || skasovano ? null : p.povtor_id > 0
    ? h('a', { className: 'knopka', href: `#/partiya/${p.povtor_id}` }, `Уже повторено: партія №${p.povtor_id} →`)
    : h('button', {
    type: 'button', className: 'glavnaya',
    onclick: async e => {
      const knopka = e.currentTarget;
      knopka.disabled = true;
      oshibka.hidden = true;
      try {
        const nova = await api(`/api/partii/${p.id}/povtority`, { method: 'POST', telo: {} });
        location.hash = `#/partiya/${nova.id}`;
      } catch (err) {
        oshibka.textContent = err.message;
        oshibka.hidden = false;
        knopka.disabled = false;
      }
    },
  }, `Спробувати ще раз: ${p.skolko} ${slovo(p.skolko, 'завдання', 'завдання', 'завдань')}`);
  return [
    h('p', { className: 'oshibka', style: 'font-size:14px' }, prostymi),
    !limit && !skasovano && !(p.povtor_id > 0) ? h('p', { className: 'podskazka pered-knopkoy' }, 'Зазвичай друга спроба вдається. ' + (p.cena_usd ? `За невдалу спробу витрачено $${p.cena_usd.toFixed(3)}.` : 'Грошей за спробу не витрачено.')) : null,
    povtor, oshibka,
    rezhimTestov() && tekst && tekst !== prostymi ? h('p', { className: 'podskazka' }, `Технічно: ${tekst}`) : null,
  ];
}

function vytraty(p) {
  if (!p.schet) return null;
  const NAZVY = { avtor: 'Автор', fakty: 'Перевірка фактів', metodist: 'Методист', redaktor: 'Редактор' };
  const s = p.schet;
  // Токены по ролям нужны только для сравнения моделей, заказчику — только отзыв методиста.
  const testy = rezhimTestov();
  if (!testy && !s.partiya) return null;
  return h('details', { className: 'podrobno', style: 'margin:8px 0 0' },
    h('summary', {}, testy ? 'Витрати і зауваження до партії' : 'Методист про всю партію'),
    testy ? h('ul', {}, Object.entries(s.po_rolyam).map(([rol, r]) =>
      h('li', {}, `${NAZVY[rol] ?? rol}: $${r.usd.toFixed(4)}, токени: вхід ${r.vhod}, запис у кеш ${r.zapis}, читання кешу ${r.kesh}, вихід ${r.vyhod}`))) : null,
    testy && s.zapasnaya ? h('p', {}, `Частину запитів виконала запасна модель ${s.zapasnaya}, тому ціна неточна.`) : null,
    testy && s.bezFlex ? h('p', {}, 'Режим Flex був зайнятий, частина запитів пройшла за звичайною ціною.') : null,
    s.partiya ? [testy ? h('h3', {}, 'Методист про всю партію') : null, h('p', {}, s.partiya)] : []);
}

// Методист оценивает первую версию. Если редактор её изменил, старая пометка уже не про это задание.
// Для старых партий без отметки судим по тексту правок редактора.
function metodistPoPervoy(z) {
  if (!z.metodist || z.metodist.verdikt === 'OK') return false;
  if (typeof z.metodist.izmeneno === 'boolean') return z.metodist.izmeneno;
  return !!z.izmeneniya && !/^без змін/i.test(z.izmeneniya.trim());
}

function estZamechaniya(z) {
  return z.kod.oshibki.length > 0 || (z.fakty && z.fakty.verdikt !== 'OK')
    || (z.metodist && z.metodist.verdikt !== 'OK' && !metodistPoPervoy(z));
}

function metkaMetodista(z) {
  if (!z.metodist) return svetofor(['—', 'ny']);
  if (metodistPoPervoy(z)) {
    const bylo = (METODIST[z.metodist.verdikt] ?? ['зауваження'])[0];
    return h('span', { className: 'sv ny', title: `Методист оцінював першу версію («${bylo}»), редактор її виправив за його зауваженнями.` }, 'виправлено');
  }
  return svetofor(METODIST[z.metodist.verdikt] ?? ['невідомо', 'vn']);
}

// Похожесть на базу: от 75% — жёлтая метка, ниже 60% — бледно (это обычный уровень, не повтор).
function metkaShodstva(z) {
  const pct = Math.round(z.kod.shodstvo * 100);
  if (z.kod.shodstvo >= 0.75) return h('span', { className: 'sv vn', title: PODSKAZKA_SHODSTVA }, `${pct}%`);
  return h('span', { className: 'proc' + (z.kod.shodstvo < 0.6 ? ' nizko' : ''), title: PODSKAZKA_SHODSTVA }, `${pct}%`);
}

function svetofor([tekst, vid]) {
  return h('span', { className: `sv ${vid}` }, tekst);
}

function podrobnosti(z) {
  const razdel = (zagolovok, spisok) => (spisok?.length
    ? [h('h3', {}, zagolovok), h('ul', {}, spisok.map(t => h('li', {}, String(t))))]
    : []);
  const vse = [
    z.pravil_chelovek ? h('p', { className: 'vn-tekst' }, 'Відредаговано вручну, ШІ після цього не перевіряв.') : null,
    z.izmeneniya && !/^без змін/i.test(z.izmeneniya.trim()) ? [h('h3', {}, 'Що виправили після перевірки'), h('p', {}, z.izmeneniya)] : [],
    razdel('Перевірка кодом', z.kod.oshibki),
    razdel(z.fakty?.ostatochno ? 'Перевірка фактів' : 'Перевірка фактів (про першу версію)', z.fakty?.zamechaniya),
    razdel(metodistPoPervoy(z) ? 'Методист (про першу версію, редактор її виправив)' : 'Методист', z.metodist?.zamechaniya),
    // Найсхожее из базы показываем, только когда оно правда похоже: ниже 60% это случайный вопрос на другую тему.
    z.kod.id_bazy && z.kod.shodstvo >= 0.6
      ? [h('h3', {}, `Найсхожіше в базі, №${z.kod.id_bazy}, ${Math.round(z.kod.shodstvo * 100)}%`), h('p', {}, z.kod.vopros_bazy + (z.kod.vopros_bazy.length >= 160 ? '…' : ''))]
      : [],
  ];
  return h('div', { className: 'zamechaniya' }, vse);
}

// Одна строка таблицы и её раскрывающаяся часть.
function gruppaZadaniya(z, { naIzmenenie, pokazatPar }) {
  const koren = h('div', { className: 'gruppa' });
  let otkryto = false;
  let pravka = false;
  const oshibka = h('p', { className: 'oshibka', role: 'alert', hidden: true });
  const izmenit = async telo => {
    const novoe = await api(`/api/zadaniya/${z.id}`, { method: 'PATCH', telo });
    Object.assign(z, novoe);
    pravka = false;
    risovat();
    naIzmenenie?.();
  };
  const sObrabotkoy = fn => async e => {
    const knopka = e.currentTarget;
    knopka.disabled = true;
    oshibka.hidden = true;
    try {
      await fn();
    } catch (err) {
      oshibka.textContent = err.message;
      oshibka.hidden = false;
      knopka.disabled = false;
    }
  };
  const prinyat = sObrabotkoy(async () => {
    // Предупреждаем обо всём серьёзном, особенно о фактической ошибке.
    const preduprezhdeniya = [
      z.fakty?.verdikt === 'OSHIBKA' ? 'Перевірка фактів вважає, що відповідь не підтверджується підручником.' : null,
      z.metodist?.verdikt === 'ZAMENIT' && !metodistPoPervoy(z) ? 'Методист радить замінити це завдання.' : null,
      z.kod.oshibki.length ? 'Перевірка кодом має зауваження до цього завдання.' : null,
    ].filter(Boolean);
    if (preduprezhdeniya.length && !confirm(`${preduprezhdeniya.join('\n')}\n\nУсе одно прийняти?`)) {
      risovat();
      return;
    }
    await izmenit({ status: 'prinyato' });
  });
  const otklonit = sObrabotkoy(() => izmenit({ status: 'otkloneno' }));
  const vernut = sObrabotkoy(() => izmenit({ status: 'proverka' }));

  function stroka() {
    const t = z.dannye;
    const nKod = z.kod.oshibki.length;
    const knopki = z.status === 'proverka'
      ? [h('button', { className: 'da', type: 'button', onclick: prinyat }, 'Прийняти'),
        h('button', { className: 'net', type: 'button', onclick: otklonit, 'aria-label': `Відхилити завдання ${z.n}`, title: 'Відхилити' }, h('span', { className: 'znak' }, '✕'), h('span', { className: 'slovo' }, 'Відхилити'))]
      : [        h('span', { className: `st ${z.status}` }, STATUSY[z.status]),
        h('button', { type: 'button', onclick: vernut, 'aria-label': `Повернути на перевірку завдання ${z.n}`, title: z.status === 'prinyato' ? 'Повернути на перевірку (прибрати з бібліотеки)' : 'Повернути на перевірку' }, h('span', { className: 'znak' }, '↺'), h('span', { className: 'slovo' }, 'Повернути'))];
    return h('div', {
      className: `stroka ${z.status}`,
      onclick: e => {
        if (e.target.closest('button,a,input,textarea,select,label')) return;
        otkryto = !otkryto;
        risovat();
      },
    },
    h('span', { className: 'num' }, pokazatPar ? `§ ${z.par}` : String(z.n)),
    h('button', {
      className: 'vop', type: 'button', 'aria-expanded': String(otkryto),
      onclick: () => { otkryto = !otkryto; risovat(); },
    }, izHtml('span', t.quest, { className: 'vop-tekst' }),
    h('small', {}, `${BUKVY[t.result]}. `, izHtml('span', t['ans' + t.result])),
    z.status === 'prinyato' && z.vygruzheno ? h('span', { className: 'vygr', title: `Файл SQL із цим завданням скачано ${dataVremya(z.vygruzheno)}` }, `вивантажено ${new Date(z.vygruzheno).toLocaleDateString('uk-UA', { day: 'numeric', month: 'short' })}`) : null),
    h('span', { className: 'svs' },
      h('span', { 'data-pole': 'Код' }, svetofor(nKod ? [`${nKod} ${slovo(nKod, 'зауваження', 'зауваження', 'зауважень')}`, 'vn'] : ['добре', 'ok'])),
      h('span', { 'data-pole': 'Факти' }, z.fakty ? svetofor(FAKTY[z.fakty.verdikt] ?? ['невідомо', 'vn']) : svetofor(['—', 'ny'])),
      h('span', { 'data-pole': 'Методист' }, metkaMetodista(z)),
      h('span', { className: 'proc-yach', 'data-pole': 'Схожість з базою' }, metkaShodstva(z))),
    h('span', { className: 'kn' }, knopki));
  }

  function razvorot() {
    const t = z.dannye;
    return h('div', { className: 'razv' },
      h('div', {},
        h('ol', { className: 'varianty' }, Object.keys(BUKVY).map(k =>
          h('li', { className: t.result === k ? 'verno' : '' }, h('b', {}, BUKVY[k]), izHtml('span', t['ans' + k])))),
        izHtml('div', t.explanation, { className: 'poyasnenie' }),
        t.opora ? h('p', { className: 'opora' }, h('b', {}, `Підручник, с. ${t.opora.str}: `), `«${t.opora.citata}»`) : null),
      h('div', {},
        podrobnosti(z),
        z.status !== 'otkloneno' ? h('button', { type: 'button', onclick: () => {
          if (z.vygruzheno && !confirm(`Це завдання вже вивантажене у вашу базу (${dataVremya(z.vygruzheno)}). Після збереження воно знову буде серед нових: завантажте його ще раз і замініть у базі старий варіант.`)) return;
          pravka = true;
          risovat();
        } }, 'Виправити') : null));
  }

  function forma() {
    const t = z.dannye;
    const abzacy = [...t.explanation.matchAll(/<p>([\s\S]*?)<\/p>/g)].map(m => vTekst(m[1]))
      .filter(a => !a.startsWith('ТЕМА:') && !/^Відповідь\s*–/.test(a));
    const vopros = h('textarea', { id: `q${z.id}`, value: vTekst(t.quest), required: true, rows: 2 });
    const poyasnenie = h('textarea', { id: `e${z.id}`, value: abzacy.join('\n'), required: true, rows: 3 });
    const otvety = {};
    const stroki = Object.keys(BUKVY).map(k => {
      const radio = h('input', { type: 'radio', name: `r${z.id}`, value: k, checked: t.result === k, required: true });
      otvety[k] = h('input', { value: vTekst(t['ans' + k]), required: true, 'aria-label': `Варіант ${BUKVY[k]}` });
      return h('div', { className: 'otvet' }, h('label', {}, radio, BUKVY[k]), otvety[k]);
    });
    const soobshchenie = h('p', { className: 'oshibka', role: 'alert', hidden: true });
    const sohranit = h('button', { className: 'glavnaya', type: 'submit' }, 'Зберегти');
    return h('form', {
      className: 'forma razv-forma',
      // Запоминаем, что человек что-то менял: тогда «Скасувати» переспросит.
      oninput: e => { e.currentTarget.dataset.tronuto = '1'; },
      onchange: e => { e.currentTarget.dataset.tronuto = '1'; },
      onsubmit: async e => {
        e.preventDefault();
        sohranit.disabled = true;
        soobshchenie.hidden = true;
        try {
          await izmenit({
            pravka: {
              quest: vopros.value, ansa: otvety.a.value, ansb: otvety.b.value, ansc: otvety.c.value, ansd: otvety.d.value,
              result: e.target.querySelector('input[type=radio]:checked')?.value,
              poyasnenie: poyasnenie.value,
            },
          });
        } catch (err) {
          soobshchenie.textContent = err.message;
          soobshchenie.hidden = false;
          sohranit.disabled = false;
        }
      },
    },
    // Пока правишь, перед глазами то, что надо исправить: цитата из учебника и замечания проверок.
    h('details', { className: 'forma-kontekst', open: !matchMedia('(max-width: 640px)').matches },
      h('summary', {}, 'Цитата й зауваження'),
      t.opora ? h('p', { className: 'opora' }, h('b', {}, `Підручник, с. ${t.opora.str}: `), `«${t.opora.citata}»`) : null,
      podrobnosti(z)),
    h('div', {}, h('label', { htmlFor: vopros.id }, `Завдання ${z.n}: запитання`), vopros),
    h('div', {}, h('label', {}, 'Варіанти. Позначте правильний'), h('div', { className: 'forma' }, stroki)),
    h('div', {}, h('label', { htmlFor: poyasnenie.id }, 'Пояснення. Рядки «ТЕМА» і «Відповідь» додадуться самі'), poyasnenie),
    h('div', { className: 'deystviya' }, sohranit, h('button', { type: 'button', onclick: e => {
      if (e.currentTarget.form.dataset.tronuto && !confirm('Скасувати зміни в цьому завданні?')) return;
      pravka = false;
      risovat();
    } }, 'Скасувати')),
    soobshchenie);
  }

  function risovat() {
    koren.replaceChildren(stroka(), oshibka, ...(pravka ? [forma()] : otkryto ? [razvorot()] : []));
    if (pravka) koren.querySelector('textarea')?.focus();
  }
  risovat();
  return { koren, risovat };
}

// Таблица заданий: фильтры, массовое принятие и строки.
// Пояснения к столбцам над таблицей. Открыты, пока человек сам их не свернёт (запоминается в браузере).
const KLYUCH_LEGENDY = 'zno-legenda-zgornuta';
function legenda() {
  let zgornuta = false;
  let sohraneno = null;
  try { sohraneno = localStorage.getItem(KLYUCH_LEGENDY); } catch { /* не страшно */ }
  zgornuta = sohraneno === '1' || (sohraneno === null && (matchMedia('(max-width: 780px)').matches || innerHeight < 900));
  const punkt = (nazva, opys) => h('div', {}, h('b', {}, nazva), ' — ', opys);
  // Запоминаем только нажатие человека: браузер сам шлёт «toggle» при первом показе раскрытого блока.
  const blok = h('details', { className: 'legenda', open: !zgornuta },
    h('summary', {
      onclick: () => setTimeout(() => { try { localStorage.setItem(KLYUCH_LEGENDY, blok.open ? '0' : '1'); } catch { /* не страшно */ } }),
    }, 'Що означають стовпці'),
  h('div', { className: 'legenda-punkty' },
    punkt('Код', 'перевірка програмою, без ШІ: формат завдання, чи є цитата на вказаній сторінці підручника, чи немає підказок. «добре» або кількість зауважень.'),
    punkt('Факти', 'ШІ звіряє правильну відповідь і пояснення з текстом підручника. «добре»; «увага» — неточність; «помилка» — відповідь не підтверджується.'),
    punkt('Методист', 'ШІ оцінює якість: зрозумілість, неправильні варіанти, підказки. «добре»; «правка» — варто покращити; «замінити» — завдання слабке; «виправлено» — редактор уже виправив завдання за зауваженнями методиста.'),
    punkt('Схожість з базою', 'наскільки запитання схоже на найближче з 2911 завдань вашої бази. Від 75% — жовта позначка: можливий повтор, перевірте.')),
  h('p', { className: 'podskazka' }, 'Натисніть на завдання, щоб побачити варіанти, пояснення, цитату й усі зауваження. ', h('a', { href: '#/dovidka' }, 'Докладніше')));
  return blok;
}

function tablicaZadaniy(spisok, { filtry = false, vidno = () => true, naIzmenenie, pokazatPar = false }) {
  const VARIANTY = [
    ['vse', 'Усі', () => true],
    ['proverka', 'На перевірці', z => z.status === 'proverka'],
    ['zam', 'Із зауваженнями', estZamechaniya],
    ['prinyato', 'Прийняті', z => z.status === 'prinyato'],
    ['otkloneno', 'Відхилені', z => z.status === 'otkloneno'],
  ];
  let filtr = 'vse';
  const chipy = h('div', { className: 'filtry', role: 'group', 'aria-label': 'Фільтр завдань' });
  const pusto = h('p', { className: 'pusto', hidden: true }, 'За цим фільтром завдань немає.');
  const massovo = h('button', { type: 'button', className: 'vse' });
  const grupy = new Map();

  function chistye() {
    return spisok.filter(z => z.status === 'proverka' && !estZamechaniya(z));
  }
  function primenit() {
    const usl = VARIANTY.find(v => v[0] === filtr)[2];
    let n = 0;
    for (const z of spisok) {
      const vid = vidno(z) && usl(z);
      grupy.get(z.id).koren.hidden = !vid;
      if (vid) n++;
    }
    pusto.hidden = n > 0;
    if (filtry) {
      chipy.querySelectorAll('button[data-f]').forEach(b => {
        const on = b.dataset.f === filtr;
        b.classList.toggle('tut', on);
        b.setAttribute('aria-pressed', String(on));
        b.textContent = `${b.dataset.t} ${spisok.filter(VARIANTY.find(v => v[0] === b.dataset.f)[2]).length}`;
      });
      const c = chistye().length;
      massovo.textContent = `Прийняти всі без зауважень: ${c}`;
      massovo.hidden = c === 0;
    }
  }
  const izmeneno = () => {
    primenit();
    naIzmenenie?.();
  };
  for (const z of spisok) grupy.set(z.id, gruppaZadaniya(z, { naIzmenenie: izmeneno, pokazatPar }));

  if (filtry) {
    for (const [k, nazv] of VARIANTY) {
      chipy.append(h('button', { type: 'button', 'data-f': k, 'data-t': nazv, onclick: () => { filtr = k; primenit(); } }, nazv));
    }
    massovo.addEventListener('click', async () => {
      const spisokChistyh = chistye();
      if (!confirm(`Прийняти завдань: ${spisokChistyh.length}? Перевірки могли пропустити помилки, тому краще переглянути завдання.`)) return;
      massovo.disabled = true;
      for (const z of spisokChistyh) {
        try {
          Object.assign(z, await api(`/api/zadaniya/${z.id}`, { method: 'PATCH', telo: { status: 'prinyato' } }));
          grupy.get(z.id).risovat();
        } catch (err) {
          alert(err.message);
          break;
        }
      }
      izmeneno();
    });
  }
  primenit();
  // «Прийняти всі без зауважень» — под таблицей: сначала посмотреть задания, потом принимать.
  return h('div', {},
    filtry ? chipy : '',
    legenda(),
    h('div', { className: 'tablica' },
      h('div', { className: 'stroka zag' }, h('span', {}, pokazatPar ? '§' : '№'), h('span', {}, 'Запитання і правильна відповідь'),
        h('span', { className: 'svs' }, h('span', {}, 'Код'), h('span', {}, 'Факти'), h('span', {}, 'Методист'), h('span', { className: 'proc', title: 'Схожість з базою. ' + PODSKAZKA_SHODSTVA }, 'Схожість')), h('span', {})),
      ...spisok.map(z => grupy.get(z.id).koren)),
    pusto,
    filtry ? h('div', { className: 'massovo' }, massovo) : '');
}

async function ekranBiblioteka() {
  const moe = ochistit();
  otmetitNav('biblioteka');
  document.title = 'Бібліотека · Генератор завдань';
  let vse = await api('/api/biblioteka');
  if (moe !== pokolenie) return;
  const spisok = h('div', {});
  const schet = h('p', { className: 'podskazka', role: 'status', style: 'margin:0 0 8px' });
  const pary = [...new Set(vse.map(z => z.par))].sort((a, b) => a - b);
  const vybor = h('select', { id: 'filtr', onchange: pokazat },
    h('option', { value: '' }, 'Усі параграфи'), pary.map(p => h('option', { value: p }, nazvaniePar(p))));
  // Главная кнопка всегда выгружает только новое: выбирать ничего не нужно, а дублей в базе не будет.
  // Полный файл — мелкой ссылкой рядом, на случай если прошлый файл потерялся.
  const knopkaNovye = h('a', { className: 'knopka glavnaya-ssylka' });
  const ssylkaVse = h('a', { className: 'vse-ssylka' });
  const knopkaJson = rezhimTestov() ? h('a', { className: 'knopka' }) : null;
  const proshlaya = h('p', { className: 'podskazka', style: 'margin:4px 0 0' });
  // Фильтр: что уже отдали заказчику, а что ещё нет.
  let vygFiltr = 'vse';
  const chipyVyg = h('div', { className: 'filtry', role: 'group', 'aria-label': 'Фільтр за вивантаженням' });
  function obnovitChipy() {
    const par = Number(vybor.value);
    const baza = vse.filter(z => z.status === 'prinyato' && (!par || z.par === par));
    const VARIANTY = [['vse', 'Усі', baza.length], ['ni', 'Ще не вивантажені', baza.filter(z => !z.vygruzheno).length], ['tak', 'Вивантажені', baza.filter(z => z.vygruzheno).length]];
    chipyVyg.replaceChildren(...VARIANTY.map(([k, nazva, n]) => h('button', {
      type: 'button', className: k === vygFiltr ? 'tut' : '', 'aria-pressed': String(k === vygFiltr),
      onclick: () => { vygFiltr = k; pokazat(); },
    }, `${nazva}: ${n}`)));
  }
  const prinyatye = () => {
    const par = Number(vybor.value);
    return vse.filter(z => z.status === 'prinyato' && (!par || z.par === par));
  };

  function ssylka(el, tip, novye, tekst, n) {
    const par = Number(vybor.value);
    const parametry = new URLSearchParams();
    if (par) parametry.set('par', String(par));
    if (novye) parametry.set('novye', '1');
    el.textContent = tekst;
    if (n) {
      el.href = `/eksport/zavdannia.${tip}?${parametry}`;
      el.setAttribute('download', `zavdannia${par ? `-par${par}` : ''}.${tip}`);
      el.removeAttribute('aria-disabled');
    } else {
      el.removeAttribute('href');
      el.setAttribute('aria-disabled', 'true');
    }
  }

  function obnovitVygruzku() {
    const vsegoP = prinyatye();
    const novye = vsegoP.filter(z => !z.vygruzheno).length;
    const par = Number(vybor.value);
    const gde = par ? `§ ${par}: ` : '';
    ssylka(knopkaNovye, 'sql', true, novye
      ? `Вивантажити ${novye} ${slovo(novye, 'нове завдання', 'нові завдання', 'нових завдань')}${par ? ` з § ${par}` : ''} (SQL)`
      : `Нових завдань для бази ${par ? `з § ${par} ` : ''}немає`, novye);
    ssylka(ssylkaVse, 'sql', false, `завантажити всі прийняті (${vsegoP.length})`, vsegoP.length);
    ssylkaVse.hidden = vsegoP.length === novye;
    if (knopkaJson) ssylka(knopkaJson, 'json', false, `JSON для тестів (${vsegoP.length})`, vsegoP.length);
    const daty = vse.map(z => z.vygruzheno).filter(Boolean).sort();
    const posl = daty[daty.length - 1];
    const nPosl = daty.filter(d => d === posl).length;
    proshlaya.textContent = posl
      ? `Останнє вивантаження: ${dataVremya(posl)}, ${nPosl} ${slovo(nPosl, 'завдання', 'завдання', 'завдань')}.`
      : 'Ще нічого не вивантажували.';
  }

  // После скачивания сервер отмечает задания выгруженными — подтягиваем свежие отметки.
  const posleSkachivaniya = () => setTimeout(async () => {
    try {
      vse = await api('/api/biblioteka');
      if (moe === pokolenie) pokazat();
    } catch { /* не страшно */ }
  }, 1200);
  knopkaNovye.addEventListener('click', posleSkachivaniya);
  ssylkaVse.addEventListener('click', posleSkachivaniya);

  function pokazat() {
    const par = Number(vybor.value);
    const uslovie = z => z.status === 'prinyato' && (!par || z.par === par)
      && (vygFiltr === 'vse' || (vygFiltr === 'ni' ? !z.vygruzheno : !!z.vygruzheno));
    obnovitChipy();
    const obnovitSchet = () => {
      schet.textContent = `Прийнятих завдань: ${vse.filter(uslovie).length}`;
      obnovitVygruzku();
    };
    obnovitSchet();
    if (!vse.length) {
      spisok.replaceChildren(h('p', { className: 'pusto' }, 'Тут з’являться завдання, які ви приймете в партіях. ', h('a', { href: '#/' }, 'Створити партію')));
      return;
    }
    spisok.replaceChildren(tablicaZadaniy(vse, { vidno: uslovie, naIzmenenie: obnovitSchet, pokazatPar: true }));
  }

  ekran.replaceChildren(
    h('h1', {}, 'Бібліотека'),
    h('div', { className: 'filtr' },
      h('div', { className: 'vybor' }, h('label', { htmlFor: 'filtr' }, 'Параграф'), vybor),
      h('div', { className: 'vygruzka' }, knopkaNovye, ssylkaVse, knopkaJson ?? '')),
    h('div', { className: 'panel vygruzka-info' },
      proshlaya,
      h('p', { className: 'podskazka', style: 'margin:2px 0 0' },
        'Файл SQL — для завантаження у вашу базу завдань. Кнопка бере лише ті завдання, яких ще не вивантажували, тож повторів у базі не буде. Номер тесту й розділу у файлі — 0, призначте їх під час завантаження.')),
    chipyVyg,
    schet,
    spisok);
  pokazat();
}

// Довідка для замовника: як створювати, перевіряти й вивантажувати завдання.
function ekranDovidka({ pokazatTesty = false } = {}) {
  ochistit();
  otmetitNav('dovidka');
  document.title = 'Довідка · Генератор завдань';
  const li = (...d) => h('li', {}, ...d);
  const b = t => h('b', {}, t);
  const pereklyuchatel = h('input', { type: 'checkbox', id: 'testy', checked: rezhimTestov(),
    onchange: e => zapomnitRezhimTestov(e.target.checked) });
  const ryadok = (nazva, ...opys) => h('div', { className: 'ryadok' }, h('span', {}, b(nazva)), h('span', {}, ...opys));
  const m = (tekst, vid) => svetofor([tekst, vid]);
  ekran.replaceChildren(h('div', { className: 'dovidka' },
    h('h1', {}, 'Як користуватися'),
    h('section', { className: 'panel' },
      h('h2', {}, 'Створити завдання'),
      h('ul', {},
        li('Оберіть параграф підручника і кількість завдань. Кнопка ', b('«+ Ще параграф»'), ` додає ще один параграф: до ${sostoyanie.maksChastey} параграфів і до ${sostoyanie.maksZakaz} завдань за раз.`),
        li(`До запуску видно орієнтовну ціну і час. Сайт ділить замовлення на партії до ${sostoyanie.maksimum} завдань і робить їх по черзі, приблизно 2–3 хвилини на партію.`),
        li('Сторінку можна закрити: завдання створюються на сервері. Готові партії можна перевіряти, поки інші ще створюються.'),
        li('Автор не повторює завдань, які вже є з цього параграфа, крім відхилених.'))),
    h('section', { className: 'panel' },
      h('h2', {}, 'Як перевіряється кожне завдання'),
      h('ol', {},
        li(b('Автор'), ' пише завдання й пояснення лише за текстом параграфа і вказує сторінку та цитату.'),
        li(b('Перевірка кодом'), ' без ШІ: формат, чи є цитата на вказаній сторінці, підказки, схожість із базою.'),
        li(b('Перевірка фактів'), ': відповідь і пояснення звіряються тільки з підручником.'),
        li(b('Методист'), ' оцінює зрозумілість, неправильні варіанти і підказки.'),
        li(b('Редактор'), ' виправляє зауваження. Виправлені завдання ще раз перевіряються кодом і на факти. Методист оцінює першу версію, тому після виправлення в його стовпці стоїть «виправлено».')),
      h('p', { className: 'podskazka' }, 'Перевірки ШІ можуть помилятися, тому остаточне рішення за вами.')),
    h('section', { className: 'panel' },
      h('h2', {}, 'Позначки в таблиці'),
      h('div', { className: 'ryadky' },
        ryadok('Код', m('добре', 'ok'), ' або ', m('2 зауваження', 'vn'), ' — скільки зауважень знайшла перевірка кодом.'),
        ryadok('Факти', m('добре', 'ok'), '; ', m('увага', 'vn'), ' — неточність; ', m('помилка', 'pl'), ' — відповідь не підтверджується підручником.'),
        ryadok('Методист', m('добре', 'ok'), '; ', m('правка', 'vn'), ' — варто покращити; ', m('замінити', 'pl'), ' — завдання слабке; ', m('виправлено', 'ny'), ' — редактор уже виправив за зауваженнями методиста.'),
        ryadok('Схожість з базою', 'наскільки запитання схоже на найближче з 2911 завдань бази. Від 75% — жовта позначка: можливий повтор.')),
      h('p', { className: 'podskazka' }, 'Натисніть на рядок, щоб побачити варіанти, пояснення, цитату з підручника і всі зауваження.')),
    h('section', { className: 'panel' },
      h('h2', {}, 'Що робити із завданням'),
      h('ul', {},
        li(b('Прийняти'), ' — завдання потрапляє в Бібліотеку.'),
        li(b('Виправити'), ' — змінити запитання, варіанти, правильну відповідь чи пояснення. Після цього завдання знову перевіряється кодом.'),
        li(b('Відхилити'), ' (на вузькому екрані ', b('✕'), ') — завдання не потрапить у бібліотеку; ', b('Повернути'), ' (', b('↺'), ') — знову на перевірку.'),
        li(b('«Прийняти всі без зауважень»'), ' приймає завдання партії, у яких усі перевірки «добре». Краще все одно їх переглянути.'))),
    h('section', { className: 'panel' },
      h('h2', {}, 'Бібліотека і вивантаження'),
      h('ul', {},
        li('У ', h('a', { href: '#/biblioteka' }, 'Бібліотеці'), ' всі прийняті завдання, з фільтром за параграфом.'),
        li(b('«Завантажити SQL»'), ' — файл у форматі вашої бази завдань: вивантажується те, що вибрано у фільтрі. Номер тесту і розділу в ньому поки 0, їх треба призначити під час завантаження в базу.'),
        li(b('«Лише ще не вивантажені»'), ' — увімкнено одразу: те, що вже вивантажували, вдруге не потрапить у файл, і в базі не буде повторів.'),
        li(b('«Завантажити JSON»'), ' — ті самі завдання для інших програм.'))),
    h('section', { className: 'panel' },
      h('h2', {}, 'Що робити, якщо…'),
      h('ul', {},
        li(b('«Факти: помилка»'), ' — відповідь не підтверджується підручником. Відкрийте завдання, звірте з цитатою і виправте або відхиліть. Сайт перепитає, якщо ви натиснете «Прийняти».'),
        li(b('«Методист: замінити»'), ' — завдання слабке. Найчастіше простіше відхилити й замовити нове.'),
        li(b('«Схожість з базою» жовта'), ' — запитання дуже схоже на наявне у вашій базі. Порівняйте з ним у розгорнутому завданні.'),
        li(b('«Схоже на завдання … з партії №…»'), ' — таке запитання вже є серед неперевірених. Залиште одне з двох.'),
        li(b('Партія «не вдалася»'), ' — це збій ШІ. Відкрийте партію і натисніть «Спробувати ще раз»: зазвичай друга спроба вдається.'),
        li(b('Замовили забагато'), ' — на сторінці замовлення є кнопка «Скасувати партії в черзі». Ті, що вже почалися, буде завершено.'))),
    h('section', { className: 'panel' },
      h('h2', {}, 'Витрати'),
      h('ul', {},
        li('Ціна кожної партії видна в списку партій і на її сторінці.'),
        li(sostoyanie.rezhim === 'api'
          ? `Коли за місяць витрачено $${sostoyanie.limitUsd}, нові партії не запускаються. Зараз витрачено $${sostoyanie.potracheno.toFixed(2)}.`
          : 'У демо-режимі нічого не витрачається.'),
        li(sostoyanie.schetOpenAI
          ? 'Ціна партії на сайті приблизна. Нижче форми видно точну суму з рахунку OpenAI, вона оновлюється із запізненням до години. Ліміт рахується за більшою з двох сум.'
          : 'Суми на сайті приблизні. Точні — у кабінеті постачальника ШІ.'))),
    // Служебная галочка для разработчиков: видна по адресу #/dovidka?testy или когда режим уже включён.
    pokazatTesty ? h('section', { className: 'panel testy' },
      h('label', { htmlFor: 'testy', className: 'galochka' }, pereklyuchatel, ' Режим для тестів'),
      h('p', { className: 'podskazka' }, 'Показує всі моделі з цінами за токени і витрати кожної ролі в партії. Потрібен лише для порівняння моделей. Запам’ятовується в цьому браузері.')) : null));
}

function marshrut() {
  if (!sostoyanie) return;
  const hash = location.hash || '#/';
  const m = /^#\/partiya\/(\d+)$/.exec(hash);
  if (m) return ekranPartiya(Number(m[1]));
  const mz = /^#\/zakaz\/(\d+)$/.exec(hash);
  if (mz) return ekranZakaz(Number(mz[1]));
  if (hash === '#/biblioteka') return ekranBiblioteka();
  if (hash === '#/dovidka' || hash === '#/dovidka?testy') return ekranDovidka({ pokazatTesty: hash.endsWith('?testy') || rezhimTestov() });
  return ekranSozdat();
}

async function zapusk() {
  try {
    sostoyanie = await api('/api/sostoyanie');
  } catch {
    return;
  }
  document.getElementById('shapka').hidden = false;
  document.getElementById('rezhim').hidden = sostoyanie.rezhim !== 'demo';
  marshrut();
}

// Браузер показывает подсказки на своём языке, поэтому задаём украинский текст сами.
document.addEventListener('invalid', e => {
  const el = e.target;
  const v = el.validity;
  const tekst = v.valueMissing ? 'Заповніть це поле.'
    : v.badInput ? 'Введіть число.'
      : v.rangeOverflow ? `Можна не більше ${el.max}.`
        : v.rangeUnderflow ? `Можна не менше ${el.min}.`
          : v.stepMismatch ? 'Введіть ціле число.'
            : '';
  if (tekst) el.setCustomValidity(tekst);
}, true);
document.addEventListener('input', e => e.target.setCustomValidity?.(''), true);

// Переключатель темы: светлая по умолчанию, выбор запоминается в браузере.
const knopkaTemy = document.getElementById('tema');
function pokazatTemu() {
  const podpis = document.documentElement.dataset.tema === 'temna' ? 'Світла тема' : 'Темна тема';
  knopkaTemy.setAttribute('aria-label', podpis);
  knopkaTemy.title = podpis;
}
knopkaTemy.addEventListener('click', () => {
  const temna = document.documentElement.dataset.tema !== 'temna';
  if (temna) document.documentElement.dataset.tema = 'temna';
  else delete document.documentElement.dataset.tema;
  try { if (temna) localStorage.setItem('zno-tema', 'temna'); else localStorage.removeItem('zno-tema'); } catch { /* не страшно */ }
  pokazatTemu();
});
pokazatTemu();

document.getElementById('vyhod').addEventListener('click', async () => {
  await api('/api/vyhod', { method: 'POST', telo: {} }).catch(() => {});
  location.hash = '#/';
  pokazatVhod();
});
window.addEventListener('hashchange', () => marshrut()?.catch?.(() => {}));
zapusk();
