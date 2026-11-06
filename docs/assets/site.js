const toggle = document.querySelector('#nav-toggle');
const sidebar = document.querySelector('#sidebar');
toggle.addEventListener('click', () => {
  const open = sidebar.classList.toggle('open');
  toggle.setAttribute('aria-expanded', String(open));
});
document.addEventListener('keydown', event => {
  if (event.key === 'Escape' && sidebar.classList.contains('open')) {
    sidebar.classList.remove('open');
    toggle.setAttribute('aria-expanded', 'false');
    toggle.focus();
  }
});
document.querySelector('#focus-mode').addEventListener('click', event => {
  const focused = document.body.classList.toggle('focus');
  event.currentTarget.setAttribute('aria-pressed', String(focused));
  event.currentTarget.textContent = focused ? 'Show navigation' : 'Focus view';
});
document.querySelector('#page-search').addEventListener('input', event => {
  const query = event.target.value.trim().toLowerCase();
  const links = [...sidebar.querySelectorAll('.nav-link')];
  for (const link of links) link.hidden = !link.textContent.toLowerCase().includes(query);
  document.querySelector('#no-pages').hidden = links.some(link => !link.hidden);
});
for (const button of document.querySelectorAll('.copy-code')) {
  button.addEventListener('click', async () => {
    const code = button.previousElementSibling.textContent;
    try {
      await navigator.clipboard.writeText(code);
      button.textContent = 'Copied';
    } catch {
      const selection = window.getSelection();
      const range = document.createRange();
      range.selectNodeContents(button.previousElementSibling);
      selection.removeAllRanges();
      selection.addRange(range);
      button.textContent = 'Selected · copy manually';
    }
  });
}
function progress() {
  const height = document.documentElement.scrollHeight - window.innerHeight;
  document.querySelector('.reading-progress').style.width = `${height > 0 ? 100 * window.scrollY / height : 0}%`;
}
window.addEventListener('scroll', progress, { passive: true });
window.addEventListener('resize', progress);
progress();
