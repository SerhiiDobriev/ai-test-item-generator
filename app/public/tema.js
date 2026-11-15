// Тема выбирается до отрисовки страницы, чтобы она не мигала. Без доступа к хранилищу — светлая.
try {
  if (localStorage.getItem('zno-tema') === 'temna') document.documentElement.dataset.tema = 'temna';
} catch { /* не страшно */ }
