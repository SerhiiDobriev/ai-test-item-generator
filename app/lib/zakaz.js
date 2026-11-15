// Большие заказы: разбиение на партии и примерная цена.

// Сколько заданий можно заказать за один раз, на все параграфы вместе.
export const MAKS_ZAKAZ = 50;
// Сколько разных параграфов в одном заказе.
export const MAKS_CHASTEY = 10;

// 23 задания при партии до 10 → [8, 8, 7]: партии почти равные, так задания получаются ровнее.
export function razbit(n, maks) {
  const k = Math.ceil(n / maks);
  const osnova = Math.floor(n / k);
  return Array.from({ length: k }, (_, i) => osnova + (i < n % k ? 1 : 0));
}

// Примерная цена партии по тарифу модели за 1 млн токенов. Подобрано по партиям Terra:
// учебник уходит в каждом из пяти запросов (около 35 тыс. токенов входа на партию),
// на задание около 1 тыс. токенов ответа. Для моделей с долгими размышлениями выйдет дороже.
// Та же формула есть в public/app.js для подсказки до запуска.
export function otsenkaPartii(model, n) {
  return (35000 * model.vhod + (1000 * n + 1000) * model.vyhod) / 1e6;
}

export function otsenkaZakaza(model, chasti, maks) {
  return chasti.flatMap(c => razbit(c.skolko, maks)).reduce((s, n) => s + otsenkaPartii(model, n), 0);
}
