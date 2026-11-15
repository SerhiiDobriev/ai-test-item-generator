// Общие данные для тестов: выдуманный демо-учебник, демо-база и готовые ответы агентов из папки demo/.
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { zagruzitBazu } from '../lib/baza.js';
import { zagruzitOtvety } from '../lib/demo.js';
import { vZadanie } from '../lib/roli.js';
import { zagruzitUchebnik } from '../lib/uchebnik.js';

export const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
export const OTVETY = path.join(ROOT, 'demo', 'otvety');
export const FAIL_BAZY = path.join(ROOT, 'demo', 'baza', 'demo_baza.sql');
export const zagruzitDemoBazu = () => zagruzitBazu(FAIL_BAZY);
export const zagruzitDemoUchebnik = () => zagruzitUchebnik(path.join(ROOT, 'demo', 'uchebnik'));

// Готовые задания параграфа в том виде, в каком их сохраняет приложение (до правок редактора).
export function gotovyeZadaniya(par) {
  const uchebnik = zagruzitDemoUchebnik();
  const k = { par, opisanie: uchebnik.spisok.find(x => x.par === par) };
  return zagruzitOtvety(OTVETY).get(par).map((z, i) => vZadanie(z, i + 1, k));
}

// Сырые задания параграфа, как их возвращает модель.
export const syryeZadaniya = par => zagruzitOtvety(OTVETY).get(par);
