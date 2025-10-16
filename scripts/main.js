// --- service icon fallbacks (kept in case images are missing) ---
window.serviceIcon1 = '<div style="padding:28px;color:#a07b28;"><svg viewBox="0 0 24 24" width="64" height="64" fill="none" stroke="currentColor" stroke-width="1.5"><path d="M5 21c8 0 14-6 14-14V3l-4 4C9 7 7 9 7 13c0 4 2 6 6 6"/></svg></div>';
window.serviceIcon2 = '<div style="padding:28px;color:#a07b28;"><svg viewBox="0 0 24 24" width="64" height="64" fill="none" stroke="currentColor" stroke-width="1.5"><path d="M20.8 4.6a5.5 5.5 0 0 0-7.8 0L12 5.6l-1-1a5.5 5.5 0 1 0-7.8 7.8l1 1L12 21l7.8-7.6 1-1a5.5 5.5 0 0 0 0-7.8z"/></svg></div>';
window.serviceIcon3 = '<div style="padding:28px;color:#a07b28;"><svg viewBox="0 0 24 24" width="64" height="64" fill="none" stroke="currentColor" stroke-width="1.5"><path d="M12 2l7 4v6c0 5-3.5 9-7 10-3.5-1-7-5-7-10V6l7-4z"/></svg></div>';

// Mobile nav toggle
const navToggle = document.querySelector('.nav-toggle');
const nav = document.querySelector('#nav');
navToggle?.addEventListener('click', () => {
  const open = nav.classList.toggle('open');
  navToggle.setAttribute('aria-expanded', String(open));
});

// Active section highlight
const sections = [...document.querySelectorAll("main section[id]")];
const links = [...document.querySelectorAll(".nav a[href^='#']")];
const onScroll = () => {
  const y = window.scrollY + 120;
  let current = sections.findLast(s => s.offsetTop <= y) || sections[0];
  links.forEach(a => a.classList.toggle("active", a.getAttribute("href") === `#${current.id}`));
};
document.addEventListener("scroll", onScroll); onScroll();

// Footer year
document.querySelector('#year').textContent = new Date().getFullYear();

// Scroll reveal for .reveal elements
const revealEls = document.querySelectorAll('.reveal');
const io = new IntersectionObserver((entries) => {
  entries.forEach(e => { if (e.isIntersecting) e.target.classList.add('in'); });
}, { threshold: 0.15 });
revealEls.forEach(el => io.observe(el));

// Simple (fake) contact submit UX — swap to Formspree/Netlify for real email
const form = document.querySelector('#contactForm');
const msg = document.querySelector('#formMsg');
form?.addEventListener('submit', async (e) => {
  e.preventDefault();
  msg.className = 'notice';
  const email = form.querySelector('input[type="email"]');
  if (!email.value.includes('@')) {
    msg.textContent = 'Please enter a valid email.';
    msg.classList.add('error');
    return;
  }
  msg.textContent = 'Sending…';
  await new Promise(r => setTimeout(r, 700));
  msg.textContent = 'Thanks — we’ll reach out to book your consultation.';
  msg.classList.add('ok');
  form.reset();
});
