// Выгрузка принятых заданий.

function sqlStroka(x) {
  const s = String(x ?? '')
    .replaceAll('\\', '\\\\')
    .replaceAll("'", "\\'")
    .replaceAll('\r', '\\r')
    .replaceAll('\n', '\\n');
  return `'${s}'`;
}

const STOLBCY = ['znotest', 'section', 'tip', 'marker', 'ansimg', 'img_html', 'anscount', 'quest', 'explanation',
  'ansa', 'ansb', 'ansc', 'ansd', 'anse', 'ansf', 'ansg', 'ansh', 'result'];

// Столбцы как в базе заказчика. Номер теста и раздела назначает заказчик, поэтому здесь 0.
export function vSql(zadaniya, tablica = 'quest_items') {
  const shapka = [
    '-- Прийняті завдання. Формат таблиці як у базі замовника.',
    '-- znotest і section = 0: номер тесту й розділу призначає замовник.',
    '-- id не вказано: база замовника видає його сама (AUTO_INCREMENT).',
    '',
  ];
  if (!zadaniya.length) return shapka.join('\n') + '-- Поки немає прийнятих завдань.\n';
  const stroki = zadaniya.map(({ dannye: t }) => {
    const v = [0, 0, Number(t.tip ?? 1), 1, 0, "''", 4,
      sqlStroka(t.quest), sqlStroka(t.explanation),
      sqlStroka(t.ansa), sqlStroka(t.ansb), sqlStroka(t.ansc), sqlStroka(t.ansd),
      "''", "''", "''", "''", sqlStroka(t.result)];
    return `(${v.join(', ')})`;
  });
  const kolonki = STOLBCY.map(c => '`' + c + '`').join(', ');
  return shapka.join('\n') + `INSERT INTO \`${tablica}\` (${kolonki}) VALUES\n${stroki.join(',\n')};\n`;
}

export function vJson(zadaniya) {
  return JSON.stringify(zadaniya.map(z => ({ ...z.dannye, id_prilozheniya: z.id, pravil_chelovek: z.pravil_chelovek })), null, 1);
}
