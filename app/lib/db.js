// База приложения: партии, задания, сеансы входа.
import fs from 'node:fs';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { otpechatok } from './baza.js';

export function openDb(file) {
  if (file !== ':memory:') fs.mkdirSync(path.dirname(file), { recursive: true });
  const db = new DatabaseSync(file);
  db.exec(`
    PRAGMA journal_mode = WAL;
    PRAGMA foreign_keys = ON;
    CREATE TABLE IF NOT EXISTS partii (
      id INTEGER PRIMARY KEY,
      par INTEGER NOT NULL,
      skolko INTEGER NOT NULL,
      rezhim TEXT NOT NULL,
      status TEXT NOT NULL,
      etap TEXT,
      oshibka TEXT,
      cena_usd REAL,
      sozdana TEXT NOT NULL,
      gotova TEXT
    );
    CREATE TABLE IF NOT EXISTS zadaniya (
      id INTEGER PRIMARY KEY,
      partiya_id INTEGER NOT NULL REFERENCES partii(id),
      n INTEGER NOT NULL,
      par INTEGER NOT NULL,
      status TEXT NOT NULL DEFAULT 'proverka',
      dannye TEXT NOT NULL,
      kod TEXT NOT NULL,
      fakty TEXT,
      metodist TEXT,
      izmeneniya TEXT,
      pravil_chelovek INTEGER NOT NULL DEFAULT 0,
      obnovleno TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS zadaniya_partiya ON zadaniya(partiya_id);
    CREATE INDEX IF NOT EXISTS zadaniya_status ON zadaniya(status);
    CREATE TABLE IF NOT EXISTS seansy (
      hash TEXT PRIMARY KEY,
      do_kogda INTEGER NOT NULL
    );
    CREATE TABLE IF NOT EXISTS zakazy (
      id INTEGER PRIMARY KEY,
      model TEXT,
      sozdan TEXT NOT NULL
    );
  `);
  const stolbcy = db.prepare('PRAGMA table_info(partii)').all().map(c => c.name);
  if (!stolbcy.includes('model')) db.exec('ALTER TABLE partii ADD COLUMN model TEXT');
  if (!stolbcy.includes('schet')) db.exec('ALTER TABLE partii ADD COLUMN schet TEXT');
  if (!stolbcy.includes('zakaz_id')) db.exec('ALTER TABLE partii ADD COLUMN zakaz_id INTEGER REFERENCES zakazy(id)');
  // Неудачную партию повторяют один раз: здесь номер новой партии.
  if (!stolbcy.includes('povtor_id')) db.exec('ALTER TABLE partii ADD COLUMN povtor_id INTEGER');
  // Когда задание последний раз выгружали в SQL/JSON: чтобы предлагать «лише нові» и не плодить дубли у заказчика.
  if (!db.prepare('PRAGMA table_info(zadaniya)').all().some(c => c.name === 'vygruzheno')) db.exec('ALTER TABLE zadaniya ADD COLUMN vygruzheno TEXT');
  // Партия не может продолжиться после перезапуска сервера. Партии в очереди (ochered) остаются и запустятся снова.
  db.prepare(`UPDATE partii SET status='oshibka', oshibka='Сервер перезапустився під час роботи', gotova=? WHERE status='idet'`)
    .run(new Date().toISOString());
  return wrap(db);
}

function zadanieIzStroki(r) {
  return {
    id: r.id, partiya_id: r.partiya_id, n: r.n, par: r.par, status: r.status,
    dannye: JSON.parse(r.dannye),
    kod: JSON.parse(r.kod),
    fakty: r.fakty ? JSON.parse(r.fakty) : null,
    metodist: r.metodist ? JSON.parse(r.metodist) : null,
    izmeneniya: r.izmeneniya ?? '',
    pravil_chelovek: !!r.pravil_chelovek,
    vygruzheno: r.vygruzheno ?? null,
  };
}

function wrap(db) {
  const now = () => new Date().toISOString();
  return {
    raw: db,
    close: () => db.close(),

    // Новая партия встаёт в очередь; запускает её сервер, по одной за раз.
    novayaPartiya(par, skolko, rezhim, model = null, zakaz = null) {
      const r = db.prepare(`INSERT INTO partii (par, skolko, rezhim, model, zakaz_id, status, sozdana) VALUES (?, ?, ?, ?, ?, 'ochered', ?)`)
        .run(par, skolko, rezhim, model, zakaz, now());
      return Number(r.lastInsertRowid);
    },
    // Заказ и все его партии создаются вместе или не создаются вовсе.
    noviyZakaz(model, partii, rezhim) {
      db.exec('BEGIN');
      try {
        const id = Number(db.prepare(`INSERT INTO zakazy (model, sozdan) VALUES (?, ?)`).run(model, now()).lastInsertRowid);
        const nomera = partii.map(p => this.novayaPartiya(p.par, p.skolko, rezhim, model, id));
        db.exec('COMMIT');
        return { id, partii: nomera };
      } catch (e) {
        db.exec('ROLLBACK');
        throw e;
      }
    },
    zakaz(id) {
      const z = db.prepare(`SELECT * FROM zakazy WHERE id=?`).get(id);
      if (!z) return null;
      return { ...z, partii: this.partii({ zakaz: id }).reverse() };
    },
    idetPartiya: () => db.prepare(`SELECT id FROM partii WHERE status='idet' LIMIT 1`).get()?.id ?? null,
    estOchered: () => !!db.prepare(`SELECT 1 FROM partii WHERE status='ochered' LIMIT 1`).get(),
    sleduyushchaya: () => db.prepare(`SELECT * FROM partii WHERE status='ochered' ORDER BY id LIMIT 1`).get() ?? null,
    nachat: id => db.prepare(`UPDATE partii SET status='idet', etap='avtor' WHERE id=? AND status='ochered'`).run(id),
    // Повтор бронируется одной командой: из двух одновременных нажатий пройдёт только одно.
    zabronirovatPovtor: id => Number(db.prepare(`UPDATE partii SET povtor_id=-1 WHERE id=? AND povtor_id IS NULL`).run(id).changes) === 1,
    zapisatPovtor: (id, novaya) => db.prepare(`UPDATE partii SET povtor_id=? WHERE id=?`).run(novaya, id),
    // Человек отменил ещё не начатые партии: заказа целиком или одну. Возвращает, сколько отменено.
    skasovat({ zakaz, partiya }) {
      const tekst = 'Скасовано до початку, гроші не витрачено.';
      const r = zakaz
        ? db.prepare(`UPDATE partii SET status='oshibka', oshibka=?, gotova=? WHERE status='ochered' AND zakaz_id=?`).run(tekst, now(), zakaz)
        : db.prepare(`UPDATE partii SET status='oshibka', oshibka=?, gotova=? WHERE status='ochered' AND id=?`).run(tekst, now(), partiya);
      return Number(r.changes);
    },
    // Снять с очереди все ждущие партии, например при достижении лимита.
    snyatOchered: tekst => db.prepare(`UPDATE partii SET status='oshibka', oshibka=?, gotova=? WHERE status='ochered'`).run(tekst, now()),
    etap: (id, etap) => db.prepare(`UPDATE partii SET etap=? WHERE id=?`).run(etap, id),
    gotova: (id, cena, schet) => db.prepare(`UPDATE partii SET status='gotovo', etap=NULL, cena_usd=?, schet=?, gotova=? WHERE id=?`).run(cena ?? null, schet ? JSON.stringify(schet) : null, now(), id),
    oshibka: (id, tekst, cena, schet) => db.prepare(`UPDATE partii SET status='oshibka', oshibka=?, cena_usd=?, schet=?, gotova=? WHERE id=?`).run(String(tekst).slice(0, 500), cena ?? null, schet ? JSON.stringify(schet) : null, now(), id),
    // Сколько потрачено с начала текущего месяца (время UTC).
    // modeli — только эти модели (например, модели OpenAI, чтобы сравнить со счётом OpenAI).
    potracheno({ modeli } = {}) {
      const d = new Date();
      const nachalo = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), 1)).toISOString();
      if (modeli) {
        if (!modeli.length) return 0;
        return db.prepare(`SELECT COALESCE(SUM(cena_usd), 0) s FROM partii WHERE sozdana >= ? AND model IN (${modeli.map(() => '?').join(',')})`)
          .get(nachalo, ...modeli).s;
      }
      return db.prepare(`SELECT COALESCE(SUM(cena_usd), 0) s FROM partii WHERE sozdana >= ?`).get(nachalo).s;
    },
    partiya: id => db.prepare(`SELECT * FROM partii WHERE id=?`).get(id) ?? null,
    // limit — сколько последних партий отдать (для «Показати ще»).
    partii: ({ zakaz, limit = 50 } = {}) => db.prepare(`
      SELECT p.*,
        (SELECT COUNT(*) FROM zadaniya z WHERE z.partiya_id=p.id) vsego,
        (SELECT COUNT(*) FROM zadaniya z WHERE z.partiya_id=p.id AND z.status='prinyato') prinyato,
        (SELECT COUNT(*) FROM zadaniya z WHERE z.partiya_id=p.id AND z.status='otkloneno') otkloneno
      FROM partii p ${zakaz ? 'WHERE p.zakaz_id=?' : ''} ORDER BY p.id DESC LIMIT ?`).all(...(zakaz ? [zakaz] : []), limit),
    // Вопросы, которые автор не должен повторять: всё по параграфу, кроме отклонённого. Свежие первыми.
    voprosyParagrafa: (par, skolko = 80) => db.prepare(`SELECT dannye FROM zadaniya WHERE par=? AND status!='otkloneno' ORDER BY id DESC LIMIT ?`)
      .all(par, skolko).map(r => JSON.parse(r.dannye).quest),

    dobavitZadanie(partiyaId, par, z) {
      db.prepare(`INSERT INTO zadaniya (partiya_id, n, par, dannye, kod, fakty, metodist, izmeneniya, obnovleno) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`)
        .run(partiyaId, z.dannye.n, par, JSON.stringify(z.dannye), JSON.stringify(z.kod),
          z.fakty ? JSON.stringify(z.fakty) : null, z.metodist ? JSON.stringify(z.metodist) : null, z.izmeneniya ?? '', now());
    },
    zadaniyaPartii: id => db.prepare(`SELECT * FROM zadaniya WHERE partiya_id=? ORDER BY n`).all(id).map(zadanieIzStroki),
    zadanie(id) {
      const r = db.prepare(`SELECT * FROM zadaniya WHERE id=?`).get(id);
      return r ? zadanieIzStroki(r) : null;
    },
    status: (id, status) => db.prepare(`UPDATE zadaniya SET status=?, obnovleno=? WHERE id=?`).run(status, now(), id),
    // Исправленное задание снова считается не выгруженным: новая версия должна попасть в следующую выгрузку.
    pravka: (id, dannye, kod) => db.prepare(`UPDATE zadaniya SET dannye=?, kod=?, pravil_chelovek=1, vygruzheno=NULL, obnovleno=? WHERE id=?`)
      .run(JSON.stringify(dannye), JSON.stringify(kod), now(), id),
    // novye — только ещё не выгружавшиеся.
    biblioteka(par, { novye = false } = {}) {
      const usl = ["status='prinyato'", ...(par ? ['par=?'] : []), ...(novye ? ['vygruzheno IS NULL'] : [])].join(' AND ');
      return db.prepare(`SELECT * FROM zadaniya WHERE ${usl} ORDER BY par, id`).all(...(par ? [par] : [])).map(zadanieIzStroki);
    },
    otmetitVygruzku(ids) {
      const kogda = now();
      const zapros = db.prepare(`UPDATE zadaniya SET vygruzheno=? WHERE id=?`);
      db.exec('BEGIN');
      try {
        for (const id of ids) zapros.run(kogda, id);
        db.exec('COMMIT');
      } catch (e) {
        db.exec('ROLLBACK');
        throw e;
      }
      return kogda;
    },
    // Задания этого параграфа, которые ещё ждут проверки: чтобы ловить повторы между партиями.
    otpechatkiParagrafa(par, krome) {
      return db.prepare(`SELECT id, n, partiya_id, dannye FROM zadaniya WHERE par=? AND status='proverka' AND id IS NOT ?`).all(par, krome ?? null).map(r => {
        const quest = JSON.parse(r.dannye).quest;
        return { id: r.id, n: r.n, partiya: r.partiya_id, vopros: quest, fp: otpechatok(quest) };
      });
    },
    // Принятые задания в виде, удобном для сравнения. Текущее задание можно исключить.
    otpechatkiBiblioteki(krome) {
      return db.prepare(`SELECT id, dannye FROM zadaniya WHERE status='prinyato' AND id IS NOT ?`).all(krome ?? null).map(r => {
        const quest = JSON.parse(r.dannye).quest;
        return { id: r.id, vopros: quest, fp: otpechatok(quest) };
      });
    },

    noviySeans(hash, doKogda) {
      db.prepare(`DELETE FROM seansy WHERE do_kogda < ?`).run(Date.now());
      db.prepare(`INSERT INTO seansy (hash, do_kogda) VALUES (?, ?)`).run(hash, doKogda);
    },
    seansZhiv: hash => !!db.prepare(`SELECT 1 FROM seansy WHERE hash=? AND do_kogda > ?`).get(hash, Date.now()),
    udalitSeans: hash => db.prepare(`DELETE FROM seansy WHERE hash=?`).run(hash),
  };
}
