const root = document.documentElement;
const themeButton = document.querySelector('#theme');
const languageButton = document.querySelector('#language');
const systemTheme = matchMedia('(prefers-color-scheme: dark)');
let language = 'ko';
let themeOverride = null;
function applyTheme() { root.dataset.theme = themeOverride ?? (systemTheme.matches ? 'dark' : 'light'); }
applyTheme();
systemTheme.addEventListener('change', applyTheme);
themeButton.addEventListener('click', () => { themeOverride = root.dataset.theme === 'dark' ? 'light' : 'dark'; applyTheme(); });
languageButton.addEventListener('click', () => {
  language = language === 'ko' ? 'en' : 'ko';
  root.lang = language;
  for (const element of document.querySelectorAll('[data-ko][data-en]')) {
    // Only static, repository-authored translations; no remote content is inserted.
    element.innerHTML = element.dataset[language];
  }
  languageButton.textContent = language === 'ko' ? 'EN' : '한국어';
  themeButton.setAttribute('aria-label', language === 'ko' ? '테마 전환' : 'Toggle theme');
});
