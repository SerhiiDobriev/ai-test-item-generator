// Учебник: список параграфов, их текст и страницы.
import fs from 'node:fs';
import path from 'node:path';

// Учебник теряет дефисы при переносе строк, поэтому сравниваем без них и без пробелов.
export function squeeze(x) {
  return String(x ?? '').replace(/[\s\-–—’'«»]/g, '').toLowerCase();
}

export function razbitNaStranicy(tekst) {
  const pages = new Map();
  const re = /\[стор\. (\d+)\]\n([\s\S]*?)(?=\n\[стор\. |$(?![\s\S]))/g;
  let m;
  while ((m = re.exec(tekst))) pages.set(Number(m[1]), squeeze(m[2]));
  return pages;
}

export function zagruzitUchebnik(papka) {
  const spisok = JSON.parse(fs.readFileSync(path.join(papka, 'index.json'), 'utf8'));
  const kesh = new Map();
  return {
    spisok,
    paragraf(par) {
      const nomer = Number(par);
      if (!spisok.some(p => p.par === nomer)) throw new Error('Немає такого параграфа: ' + par);
      if (!kesh.has(nomer)) {
        const file = path.join(papka, 'paragrafy', `par_${String(nomer).padStart(2, '0')}.txt`);
        const tekst = fs.readFileSync(file, 'utf8').replaceAll('\r\n', '\n');
        kesh.set(nomer, { tekst, stranicy: razbitNaStranicy(tekst) });
      }
      return kesh.get(nomer);
    },
  };
}
