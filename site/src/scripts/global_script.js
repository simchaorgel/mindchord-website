const mobileMenu = document.getElementById('mobile-menu');
const menuBtn = document.getElementById('menu-btn');
function openMobileMenu() {
    mobileMenu.classList.add('is-open'); document.body.classList.add('menu-open');
}
function closeMobileMenu() {
    mobileMenu.classList.remove('is-open'); document.body.classList.remove('menu-open');
}

menuBtn?.addEventListener('click', openMobileMenu);
mobileMenu?.addEventListener('click', (e) => { if (!e.target.closest('a, button')) closeMobileMenu(); });

document.getElementById('back-to-top')?.addEventListener('click', () => window.scrollTo({ top: 0, behavior: 'smooth' }));