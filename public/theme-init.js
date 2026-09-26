(function(){
  try {
    var html = document.documentElement;
    var theme = localStorage.getItem('theme') || 'system';
    var isDark = theme === 'dark' || (theme === 'system' && window.matchMedia('(prefers-color-scheme: dark)').matches);
    html.classList.toggle('dark', isDark);
    html.classList.toggle('light', !isDark);
  } catch(e) {}
})();