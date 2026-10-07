const root = document.documentElement;
const themeButton = document.querySelector('#theme');
const languageButton = document.querySelector('#language');
const systemTheme = matchMedia('(prefers-color-scheme: dark)');
const validLanguage=value=>value==='ko'||value==='en';
const pageUrl=new URL(location.href);
let savedLanguage;
try{savedLanguage=localStorage.getItem('piagent-language');}catch{/* Storage may be disabled. */}
const requestedLanguage=pageUrl.searchParams.get('lang');
let language=validLanguage(requestedLanguage)?requestedLanguage:validLanguage(savedLanguage)?savedLanguage:/^ko(?:[-_]|$)/i.test(navigator.language)?'ko':'en';
let themeOverride = null;
function applyTheme() { root.dataset.theme = themeOverride ?? (systemTheme.matches ? 'dark' : 'light'); }
applyTheme();
systemTheme.addEventListener('change', applyTheme);
themeButton.addEventListener('click', () => { themeOverride = root.dataset.theme === 'dark' ? 'light' : 'dark'; applyTheme(); });
function applyLanguage() {
  root.lang = language;
  for (const element of document.querySelectorAll('[data-ko][data-en]')) {
    // Only static, repository-authored translations; no remote content is inserted.
    element.innerHTML = element.dataset[language];
  }
  languageButton.textContent = language === 'ko' ? 'EN' : '한국어';
  for(const [selector,attribute,suffix]of [['[data-ko-label]','aria-label','Label'],['[data-ko-title]','title','Title'],['[data-ko-content]','content','Content'],['[data-ko-href]','href','Href']]){
    for(const element of document.querySelectorAll(selector))element.setAttribute(attribute,element.dataset[language+suffix]);
  }
}
applyLanguage();
languageButton.addEventListener('click', () => {
  language = language === 'ko' ? 'en' : 'ko';applyLanguage();
  try{localStorage.setItem('piagent-language',language);}catch{/* Language still works without storage. */}
  const url=new URL(location.href);url.searchParams.set('lang',language);
  try{history.replaceState(null,'',url.href);}catch{/* Navigation is optional. */}
});
