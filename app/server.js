// Веб-сервер генератора заданий. Без внешних библиотек, нужен только Node 24.
import crypto from 'node:crypto';
import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { zagruzitBazu } from './lib/baza.js';
import { zapustitCepochku, ETAPY } from './lib/cepochka.js';
import { openDb } from './lib/db.js';
import { demoModel, zapolnitDemo } from './lib/demo.js';
import { vJson, vSql } from './lib/eksport.js';
import { claudeProvayder } from './lib/claude.js';
import { MODELI_OPENAI, openaiProvayder } from './lib/openai.js';
import { schetOpenAI } from './lib/rashody.js';
import { openrouterProvayder } from './lib/openrouter.js';
import { obedinitProvayderov } from './lib/roli.js';
import { BUKVY, sobratZadanie } from './lib/format.js';
import { proveritZadanie } from './lib/proverka.js';
import { zagruzitUchebnik } from './lib/uchebnik.js';
import { MAKS_CHASTEY, MAKS_ZAKAZ, otsenkaZakaza, razbit } from './lib/zakaz.js';

const APP = path.dirname(fileURLToPath(import.meta.url));
const ROOT = process.env.ROOT_DIR || path.resolve(APP, '..');
const DNEY_SEANSA = 14;
const MAKS_TELO = 64 * 1024;
const STATIKA = {
  '/': ['index.html', 'text/html; charset=utf-8'],
  '/app.js': ['app.js', 'text/javascript; charset=utf-8'],
  '/style.css': ['style.css', 'text/css; charset=utf-8'],
  '/logo.svg': ['logo.svg', 'image/svg+xml'],
  '/tema.js': ['tema.js', 'text/javascript; charset=utf-8'],
  '/robots.txt': ['robots.txt', 'text/plain; charset=utf-8'],
};

class Oshibka extends Error {
  constructor(kod, tekst) { super(tekst); this.kod = kod; }
}

const hashToken = t => crypto.createHash('sha256').update(t).digest('hex');

function paroliRavny(a, b) {
  const x = crypto.createHash('sha256').update(String(a)).digest();
  const y = crypto.createHash('sha256').update(String(b)).digest();
  return crypto.timingSafeEqual(x, y);
}

function cookies(req) {
  return Object.fromEntries((req.headers.cookie ?? '').split(';').map(c => c.trim().split('=')).filter(p => p.length === 2));
}

function chitatTelo(req) {
  return new Promise((resolve, reject) => {
    if (!/^application\/json/.test(req.headers['content-type'] ?? '')) return reject(new Oshibka(415, 'Потрібен JSON'));
    let size = 0;
    const chunks = [];
    req.on('data', c => {
      size += c.length;
      if (size > MAKS_TELO) { reject(new Oshibka(413, 'Завеликий запит')); req.destroy(); return; }
      chunks.push(c);
    });
    req.on('end', () => {
      try { resolve(JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}')); }
      catch { reject(new Oshibka(400, 'Неправильний JSON')); }
    });
    req.on('error', reject);
  });
}

// Человек правит обычный текст, а в базе нужен формат с абзацами и строкой «Відповідь».
export function primenitPravku(staroe, p) {
  const trim = x => String(x ?? '').trim();
  if (!BUKVY[p.result]) throw new Oshibka(400, 'Укажіть правильну відповідь');
  for (const pole of ['quest', 'ansa', 'ansb', 'ansc', 'ansd', 'poyasnenie']) {
    if (!trim(p[pole])) throw new Oshibka(400, 'Заповніть усі поля');
    if (trim(p[pole]).length > 3000) throw new Oshibka(400, 'Занадто довгий текст');
  }
  return sobratZadanie(staroe, p);
}

// demoParol: в демо пароль показывается на странице входа (через /api/info), в рабочем режиме null.
export function sozdatPrilozhenie({ db, provayder, uchebnik, baza, instrukcii, parol, limitUsd = 10, trustProxy = false, publicDir = path.join(APP, 'public'), schetOpenAI = null, modeliOpenAI = [], demoParol = null, eksportTablica }) {
  // Потрачено за месяц. Для моделей OpenAI берём большее: подсчёт сайта или настоящий счёт OpenAI,
  // чтобы лимит не превысился, даже если сайт недосчитал.
  function potracheno() {
    const vse = db.potracheno();
    const schet = schetOpenAI?.usd();
    if (schet == null) return vse;
    return vse + Math.max(0, schet - db.potracheno({ modeli: modeliOpenAI }));
  }

  const popytki = new Map();
  const dostupen = par => provayder.paragrafy === 'vse' || provayder.paragrafy.includes(par);

  function ipKlienta(req) {
    return (trustProxy && req.headers['x-real-ip']) || req.socket.remoteAddress || '';
  }

  function proveritPopytki(ip) {
    const z = popytki.get(ip);
    if (z && z.do > Date.now() && z.n >= 10) throw new Oshibka(429, 'Забагато спроб. Зачекайте 10 хвилин.');
    if (z && z.do <= Date.now()) popytki.delete(ip);
  }

  function otvet(res, kod, data, extra = {}) {
    res.writeHead(kod, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store', ...extra });
    res.end(JSON.stringify(data));
  }

  function vyidti(req, res) {
    const token = cookies(req).seans;
    if (token) db.udalitSeans(hashToken(token));
    const secure = trustProxy ? '; Secure' : '';
    otvet(res, 200, { ok: true }, { 'set-cookie': `seans=; HttpOnly; SameSite=Strict; Path=/; Max-Age=0${secure}` });
  }

  async function vhod(req, res) {
    const ip = ipKlienta(req);
    proveritPopytki(ip);
    const { parol: vvedeno } = await chitatTelo(req);
    if (!paroliRavny(vvedeno ?? '', parol)) {
      const z = popytki.get(ip) ?? { n: 0, do: Date.now() + 10 * 60 * 1000 };
      z.n++;
      popytki.set(ip, z);
      throw new Oshibka(401, 'Неправильний пароль');
    }
    popytki.delete(ip);
    const token = crypto.randomBytes(32).toString('hex');
    db.noviySeans(hashToken(token), Date.now() + DNEY_SEANSA * 86400 * 1000);
    const secure = trustProxy ? '; Secure' : '';
    otvet(res, 200, { ok: true }, { 'set-cookie': `seans=${token}; HttpOnly; SameSite=Strict; Path=/; Max-Age=${DNEY_SEANSA * 86400}${secure}` });
  }

  function partiyaDlyaOtveta(id) {
    const p = db.partiya(id);
    if (!p) throw new Oshibka(404, 'Партію не знайдено');
    return { ...p, schet: p.schet ? JSON.parse(p.schet) : null, zadaniya: p.status === 'gotovo' ? db.zadaniyaPartii(id) : [] };
  }

  function proveritParagraf(par) {
    const nomer = Number(par);
    if (!uchebnik.spisok.some(p => p.par === nomer)) throw new Oshibka(400, 'Оберіть параграф');
    if (!dostupen(nomer)) throw new Oshibka(400, `§ ${nomer} поки недоступний`);
    return nomer;
  }

  function proveritModel(modelId) {
    if (!provayder.modeli.length) return null;
    const m = provayder.modeli.find(x => x.id === modelId);
    if (!m) throw new Oshibka(400, 'Оберіть модель');
    return m;
  }

  // Перед новым заказом подтягиваем счёт OpenAI, если он устарел (не чаще раза в 10 минут).
  async function proveritLimit() {
    await schetOpenAI?.obnovit();
    if (potracheno() >= limitUsd) throw new Oshibka(402, `Досягнуто місячного ліміту витрат: $${limitUsd}.`);
  }

  // Очередь: партии идут по одной. Следующая запускается, когда закончилась предыдущая,
  // и при старте сервера, если очередь осталась с прошлого раза.
  let zanyat = false;
  function zapustitOchered() {
    if (zanyat || db.idetPartiya()) return;
    const p = db.sleduyushchaya();
    if (!p) return;
    schetOpenAI?.obnovit(); // без ожидания: свежий счёт пригодится следующей партии
    if (potracheno() >= limitUsd) {
      db.snyatOchered(`Досягнуто місячного ліміту витрат: $${limitUsd}. Партію не запущено.`);
      return;
    }
    let model;
    try {
      model = provayder.sozdat(p.model ?? undefined);
    } catch (e) {
      db.oshibka(p.id, e.message);
      zapustitOchered();
      return;
    }
    db.nachat(p.id);
    zanyat = true;
    zapustitCepochku(p.id, { db, model, uchebnik, baza, instrukcii }).finally(() => {
      zanyat = false;
      zapustitOchered();
    });
  }

  // Одна партия до 10 заданий. Если что-то уже идёт, новая не встаёт в очередь, а получает 409.
  // Повтор неудачной партии с теми же параметрами, в том же заказе. Только один раз,
  // чтобы два человека не заплатили дважды за одно и то же.
  async function povtoritPartiyu(res, id) {
    const p = db.partiya(id);
    if (!p) throw new Oshibka(404, 'Партію не знайдено');
    if (p.status !== 'oshibka') throw new Oshibka(400, 'Повторити можна лише партію, яка не вдалася');
    const modelId = provayder.modeli.some(m => m.id === p.model) ? p.model
      : (provayder.modeli.find(m => m.pervaya) ?? provayder.modeli[0])?.id ?? null;
    await proveritLimit();
    if (!db.zabronirovatPovtor(id)) throw new Oshibka(409, 'Цю партію вже повторено. Оновіть сторінку.');
    const nova = db.novayaPartiya(p.par, p.skolko, provayder.rezhim, modelId, p.zakaz_id ?? null);
    db.zapisatPovtor(id, nova);
    zapustitOchered();
    otvet(res, 201, { id: nova });
  }

  async function sozdatPartiyu(req, res) {
    const { par, skolko, model: modelId } = await chitatTelo(req);
    const nomer = proveritParagraf(par);
    const n = Number(skolko);
    if (!Number.isInteger(n) || n < 1 || n > provayder.maksimum) throw new Oshibka(400, `Можна від 1 до ${provayder.maksimum} завдань`);
    proveritModel(modelId);
    await proveritLimit();
    if (db.idetPartiya() || db.estOchered()) throw new Oshibka(409, 'Інша партія ще створюється. Дочекайтеся її завершення.');
    const id = db.novayaPartiya(nomer, n, provayder.rezhim, modelId ?? null);
    zapustitOchered();
    otvet(res, 201, { id });
  }

  // Заказ: несколько параграфов, всего до MAKS_ZAKAZ заданий. Делится на партии и встаёт в очередь.
  async function sozdatZakaz(req, res) {
    const { chasti, model: modelId } = await chitatTelo(req);
    if (!Array.isArray(chasti) || !chasti.length) throw new Oshibka(400, 'Додайте хоча б один параграф');
    if (chasti.length > MAKS_CHASTEY) throw new Oshibka(400, `Можна не більше ${MAKS_CHASTEY} параграфів за раз`);
    const spisok = chasti.map(c => {
      const par = proveritParagraf(c?.par);
      const skolko = Number(c?.skolko);
      if (!Number.isInteger(skolko) || skolko < 1 || skolko > MAKS_ZAKAZ) throw new Oshibka(400, `Для § ${par}: можна від 1 до ${MAKS_ZAKAZ} завдань`);
      return { par, skolko };
    });
    const vsego = spisok.reduce((s, c) => s + c.skolko, 0);
    if (vsego > MAKS_ZAKAZ) throw new Oshibka(400, `За один раз можна замовити до ${MAKS_ZAKAZ} завдань, а вибрано ${vsego}`);
    const model = proveritModel(modelId);
    await proveritLimit();
    if (model) {
      const otsenka = otsenkaZakaza(model, spisok, provayder.maksimum);
      const ostalos = limitUsd - potracheno();
      if (otsenka > ostalos) {
        throw new Oshibka(402, `Замовлення орієнтовно коштує $${otsenka.toFixed(2)}, а до місячного ліміту залишилося $${ostalos.toFixed(2)}. Зменште кількість завдань.`);
      }
    }
    const partii = spisok.flatMap(c => razbit(c.skolko, provayder.maksimum).map(n => ({ par: c.par, skolko: n })));
    const zakaz = db.noviyZakaz(modelId ?? null, partii, provayder.rezhim);
    zapustitOchered();
    otvet(res, 201, zakaz);
  }

  setImmediate(zapustitOchered);

  async function izmenitZadanie(req, res, id) {
    const z = db.zadanie(id);
    if (!z) throw new Oshibka(404, 'Завдання не знайдено');
    const telo = await chitatTelo(req);
    if (telo.status !== undefined) {
      if (!['proverka', 'prinyato', 'otkloneno'].includes(telo.status)) throw new Oshibka(400, 'Неправильний стан');
      db.status(id, telo.status);
    }
    if (telo.pravka !== undefined) {
      const dannye = primenitPravku(z.dannye, telo.pravka);
      // Сохранение без изменений не считается правкой человека.
      if (JSON.stringify(dannye) !== JSON.stringify(z.dannye)) {
        const kod = proveritZadanie(dannye, {
          stranicy: uchebnik.paragraf(z.par).stranicy,
          baza,
          biblioteka: db.otpechatkiBiblioteki(id),
          paragraf: db.otpechatkiParagrafa(z.par, id),
        });
        db.pravka(id, dannye, kod);
      }
    }
    otvet(res, 200, db.zadanie(id));
  }

  function skachat(res, imya, tip, tekst) {
    res.writeHead(200, {
      'content-type': tip,
      'content-disposition': `attachment; filename="${imya}"`,
      'cache-control': 'no-store',
    });
    res.end(tekst);
  }

  async function marshrut(req, res) {
    const url = new URL(req.url, 'http://localhost');
    const { pathname: p } = url;
    const m = req.method;

    if (m === 'GET' && STATIKA[p]) {
      const [file, tip] = STATIKA[p];
      res.writeHead(200, { 'content-type': tip, 'cache-control': 'no-cache' });
      return res.end(fs.readFileSync(path.join(publicDir, file)));
    }
    if (m === 'POST' && p === '/api/vhod') return vhod(req, res);
    if (m === 'GET' && p === '/api/info') return otvet(res, 200, demoParol ? { demo: true, parol: demoParol } : { demo: false });

    const token = cookies(req).seans;
    if (!token || !db.seansZhiv(hashToken(token))) throw new Oshibka(401, 'Потрібно увійти');

    if (m === 'POST' && p === '/api/vyhod') return vyidti(req, res);
    if (m === 'GET' && p === '/api/sostoyanie') {
      schetOpenAI?.obnovit(); // без ожидания, обновится к следующему открытию страницы
      return otvet(res, 200, {
        rezhim: provayder.rezhim,
        maksimum: provayder.maksimum,
        maksZakaz: MAKS_ZAKAZ,
        maksChastey: MAKS_CHASTEY,
        modeli: provayder.modeli,
        potracheno: potracheno(),
        limitUsd,
        // Счёт OpenAI и подсчёт сайта по моделям OpenAI: чтобы видеть, насколько они расходятся.
        schetOpenAI: schetOpenAI ? { ...schetOpenAI.sostoyanie(), sayt: db.potracheno({ modeli: modeliOpenAI }) } : null,
        etapy: ETAPY,
        paragrafy: uchebnik.spisok.map(x => ({ par: x.par, title: x.title, pages: x.pages, dostupen: dostupen(x.par) })),
      });
    }
    if (m === 'GET' && p === '/api/partii') {
      const limit = Math.min(Math.max(Number(url.searchParams.get('limit')) || 50, 1), 500);
      return otvet(res, 200, db.partii({ limit }).map(({ schet, ...x }) => x));
    }
    if (m === 'POST' && p === '/api/partii') return sozdatPartiyu(req, res);
    if (m === 'POST' && p === '/api/zakazy') return sozdatZakaz(req, res);
    // Отмена партий, которые ещё стоят в очереди (уже начатая доделается).
    const rp = /^\/api\/partii\/(\d+)\/povtority$/.exec(p);
    if (m === 'POST' && rp) return povtoritPartiyu(res, Number(rp[1]));
    let rs = /^\/api\/(zakazy|partii)\/(\d+)\/skasuvaty$/.exec(p);
    if (m === 'POST' && rs) {
      const n = db.skasovat(rs[1] === 'zakazy' ? { zakaz: Number(rs[2]) } : { partiya: Number(rs[2]) });
      return otvet(res, 200, { skasovano: n });
    }
    let rz = /^\/api\/zakazy\/(\d+)$/.exec(p);
    if (m === 'GET' && rz) {
      const z = db.zakaz(Number(rz[1]));
      if (!z) throw new Oshibka(404, 'Замовлення не знайдено');
      return otvet(res, 200, { ...z, partii: z.partii.map(({ schet, ...x }) => x) });
    }

    let r = /^\/api\/partii\/(\d+)$/.exec(p);
    if (m === 'GET' && r) return otvet(res, 200, partiyaDlyaOtveta(Number(r[1])));

    r = /^\/api\/zadaniya\/(\d+)$/.exec(p);
    if (m === 'PATCH' && r) return izmenitZadanie(req, res, Number(r[1]));

    if (m === 'GET' && p === '/api/biblioteka') {
      const par = Number(url.searchParams.get('par')) || null;
      return otvet(res, 200, db.biblioteka(par));
    }
    // Выгрузка: ?par= — один параграф, ?novye=1 — только ещё не выгружавшиеся. Выгруженные помечаются датой.
    r = /^\/eksport\/zavdannia\.(sql|json)$/.exec(p);
    if (m === 'GET' && r) {
      const par = Number(url.searchParams.get('par')) || null;
      const spisok = db.biblioteka(par, { novye: url.searchParams.get('novye') === '1' });
      const imya = `zavdannia${par ? `-par${par}` : ''}.${r[1]}`;
      const tekst = r[1] === 'sql' ? vSql(spisok, eksportTablica) : vJson(spisok);
      // Отметку ставит только SQL: это выгрузка в базу заказчика. JSON — просто посмотреть.
      if (r[1] === 'sql' && spisok.length) db.otmetitVygruzku(spisok.map(z => z.id));
      return skachat(res, imya, r[1] === 'sql' ? 'application/sql; charset=utf-8' : 'application/json; charset=utf-8', tekst);
    }

    throw new Oshibka(404, 'Не знайдено');
  }

  return http.createServer(async (req, res) => {
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('X-Frame-Options', 'DENY');
    res.setHeader('Referrer-Policy', 'no-referrer');
    res.setHeader('X-Robots-Tag', 'noindex, nofollow');
    res.setHeader('Content-Security-Policy', "default-src 'self'; img-src 'self' data:; base-uri 'none'; form-action 'self'; frame-ancestors 'none'");
    try {
      await marshrut(req, res);
    } catch (e) {
      if (!(e instanceof Oshibka)) console.error(e);
      if (!res.headersSent) otvet(res, e.kod ?? 500, { oshibka: e instanceof Oshibka ? e.message : 'Помилка сервера' });
      else res.end();
    }
  });
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const envFile = path.join(APP, '.env');
  // В демо файл app/.env с настоящими ключами и паролем не читается вовсе.
  if (fs.existsSync(envFile) && process.env.DEMO !== '1') process.loadEnvFile(envFile);
  // DEMO=1: выдуманные данные из папки demo/, готовые ответы вместо ИИ, ключи API не читаются вовсе.
  const DEMO = process.env.DEMO === '1';
  const parol = process.env.APP_PASSWORD || (DEMO ? 'demo' : '');
  if (!parol) {
    console.error('Не задан APP_PASSWORD. Создайте файл app/.env по образцу .env.example (или DEMO=1)');
    process.exit(1);
  }
  const instr = f => fs.readFileSync(path.join(ROOT, 'instrukcii', f), 'utf8');
  const instrukcii = { avtor: instr('avtor.md'), fakty: instr('proveryayushchiy_faktov.md'), metodist: instr('metodist.md'), redaktor: instr('redaktor.md') };
  const istochniki = [];
  if (!DEMO) {
    if (process.env.ANTHROPIC_API_KEY) istochniki.push(claudeProvayder({ apiKey: process.env.ANTHROPIC_API_KEY }));
    if (process.env.OPENROUTER_API_KEY) istochniki.push(openrouterProvayder({ apiKey: process.env.OPENROUTER_API_KEY }));
    if (process.env.OPENAI_API_KEY) istochniki.push(openaiProvayder({ apiKey: process.env.OPENAI_API_KEY }));
    if (!istochniki.length) {
      console.error('Нет ни одного ключа API. Добавьте ключ в app/.env или запустите с DEMO=1');
      process.exit(1);
    }
  }
  const schet = !DEMO && process.env.OPENAI_ADMIN_KEY ? schetOpenAI({ adminKey: process.env.OPENAI_ADMIN_KEY }) : null;
  schet?.obnovit();

  const papkaDannyh = DEMO ? path.join(ROOT, 'demo') : ROOT;
  const papkaBazy = path.join(papkaDannyh, 'baza');
  const failBazy = fs.readdirSync(papkaBazy).find(f => f.endsWith('.sql'));
  const uchebnik = zagruzitUchebnik(path.join(papkaDannyh, 'uchebnik'));
  const baza = zagruzitBazu(path.join(papkaBazy, failBazy));

  // В демо база при каждом запуске создаётся заново и заполняется примерами (сервер перезапускается раз в сутки).
  const failDb = path.join(process.env.DATA_DIR || path.join(APP, 'data'), 'generator.sqlite');
  if (DEMO && process.env.DEMO_RESET === '1') for (const f of [failDb, failDb + '-wal', failDb + '-shm']) fs.rmSync(f, { force: true });
  const db = openDb(failDb);
  if (DEMO && process.env.DEMO_RESET === '1') {
    await zapolnitDemo({ db, uchebnik, baza, instrukcii, papka: path.join(papkaDannyh, 'otvety') });
  }

  const server = sozdatPrilozhenie({
    schetOpenAI: schet,
    modeliOpenAI: MODELI_OPENAI.map(m => m.id),
    db,
    provayder: DEMO ? demoModel(path.join(papkaDannyh, 'otvety')) : obedinitProvayderov(istochniki),
    limitUsd: Number(process.env.LIMIT_USD || 10),
    uchebnik,
    baza,
    instrukcii,
    parol,
    demoParol: DEMO ? parol : null,
    eksportTablica: process.env.EXPORT_TABLE || undefined,
    trustProxy: process.env.TRUST_PROXY === '1',
  });
  const port = Number(process.env.PORT || 8770);
  const host = process.env.HOST || '127.0.0.1';
  server.listen(port, host, () => console.log(`Готово: http://${host}:${port}, режим: ${DEMO ? 'демо' : 'API'}`));
}
