/* style/main.js
   Landing interactions:
   - pricing rendering
   - buy buttons -> WhatsApp prefill (number set below)
   - lazy youtube
   - gallery lightbox (image / youtube / local mp4)
   - demo chat modal (typewriter)
   - offer popup (appears after OFFER_DELAY_MS)
   - price badge reveal when hero is out of view
   - smooth scroll + reveal on scroll
*/

/* =====================
   Config (edita si necesitas)
   ===================== */
const WHATSAPP_NUMBER = "3156279342"; // number provided
const OFFER_DELAY_MS = 9000; // 9 seconds (popup delay)
const OFFER_SHOWN_KEY = "luci_offer_shown_v1";

/* =====================
   Helpers
   ===================== */
const $ = s => document.querySelector(s);
const $$ = s => Array.from(document.querySelectorAll(s));
function formatCOP(n){ return new Intl.NumberFormat('es-CO').format(n); }

/* =====================
   Render pricing amounts (handles multipack offers)
   ===================== */
function renderPricingAmounts(){
  document.querySelectorAll('.js-amount').forEach(el=>{
    const base = Number(el.dataset.base || 80000);
    const pay = Number(el.dataset.pay || 1);
    const get = Number(el.dataset.get || pay);
    const total = base * pay;
    el.innerHTML = `${formatCOP(total)} <span class="currency">COP</span>`;
    const saving = (get - pay) * base;
    const meta = el.closest('.price-card')?.querySelector('.price-meta');
    if (meta && saving > 0) {
      // append savings politely, minimal emphasis
      meta.innerHTML += ` • <span style="color:var(--accent-2);font-weight:600">Ahorra ${formatCOP(saving)} COP</span>`;
    }
  });
}

/* =====================
   Buy buttons -> open WhatsApp with prefilled text
   ===================== */
function hookBuyButtons(){
  $$('[id^="buy-"]').forEach(btn=>{
    btn.addEventListener('click', e=>{
      e.preventDefault();
      const pay = btn.dataset.pay || "1";
      const get = btn.dataset.get || pay;
      const base = 80000;
      const total = base * Number(pay);
      const text = encodeURIComponent(`Hola! Quiero el pack Luci (pago ${pay} / recibo ${get}) - total ${formatCOP(total)} COP`);
      window.open(`https://wa.me/${WHATSAPP_NUMBER}?text=${text}`, '_blank');
    });
  });

  // generic price CTA
  document.querySelectorAll('.price-card .btn.primary[href^="https://wa.me/"]').forEach(a=>{
    a.addEventListener('click', () => {
      // allow default (link) to open. we already have WA link in HTML
    });
  });
}

/* =====================
   Lazy load youtube on poster click
   ===================== */
function setupLazyVideo(){
  const poster = $('#video-poster');
  if (!poster) return;
  poster.addEventListener('click', ()=>{
    const vid = poster.dataset.videoId || 'VIDEO_ID';
    const iframe = document.createElement('iframe');
    iframe.src = `https://www.youtube.com/embed/${vid}?autoplay=1&rel=0&modestbranding=1`;
    iframe.frameBorder = '0';
    iframe.allow = 'autoplay; encrypted-media; fullscreen';
    iframe.width = '100%';
    iframe.height = '520';
    iframe.style.border = '0';
    poster.replaceWith(iframe);
  });
}

/* =====================
   Gallery lightbox
   ===================== */
/* =====================
   Gallery lightbox
   ===================== */
function setupGalleryLightbox(){
  document.querySelectorAll('.gallery-item').forEach(item=>{
    item.addEventListener('click', async ()=>{
      const type = item.dataset.type;
      const src = item.dataset.src;
      const videoId = item.dataset.videoId;
      const poster = item.dataset.poster;
      const modal = document.createElement('div');
      modal.className = 'gl-modal';
      modal.innerHTML = `
        <div class="gl-backdrop"></div>
        <div class="gl-content">
          <button class="gl-close" aria-label="Cerrar">✕</button>
          <div class="gl-body"></div>
        </div>
      `;
      document.body.appendChild(modal);
      const body = modal.querySelector('.gl-body');
      const close = modal.querySelector('.gl-close');

      if (type === 'image') {
        const img = document.createElement('img');
        img.src = src;
        img.loading = 'lazy';
        img.style.maxWidth = '100%';
        img.style.height = 'auto';
        body.appendChild(img);
      } else if (type === 'youtube') {
        const iframe = document.createElement('iframe');
        iframe.src = `https://www.youtube.com/embed/${videoId}?autoplay=1&rel=0`;
        iframe.width = '100%';
        iframe.height = '520';
        iframe.allow = 'autoplay; encrypted-media';
        iframe.style.border = '0';
        body.appendChild(iframe);
      } else if (type === 'video') {
        const video = document.createElement('video');
        video.controls = true;
        video.autoplay = true;
        video.style.width = '100%';
        video.src = src;
        if (poster) video.poster = poster;
        body.appendChild(video);
      }

      function closeModal(){ modal.remove(); }
      close.addEventListener('click', closeModal);
      modal.querySelector('.gl-backdrop').addEventListener('click', closeModal);
      document.addEventListener('keydown', function esc(e){ if (e.key === 'Escape') closeModal(); }, { once:true });
    });
  });
}


/* =====================
   Demo chat modal (typewriter)
   ===================== */
function simulateChatDemo(){
  const btn = document.getElementById('open-demo-chat');
  if (!btn) return;
  btn.addEventListener('click', ()=>{
    if (document.getElementById('demo-chat-modal')) return;
    const modal = document.createElement('div');
    modal.id = 'demo-chat-modal';
    modal.style.position = 'fixed';
    modal.style.inset = '0';
    modal.style.display = 'grid';
    modal.style.placeItems = 'center';
    modal.style.background = 'rgba(2,6,23,0.5)';
    modal.style.zIndex = 2500;
    modal.innerHTML = `
      <div style="width:100%;max-width:780px;background:#fff;border-radius:12px;padding:16px;box-shadow:0 30px 90px rgba(2,6,23,0.6);">
        <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:8px;">
          <strong style="font-size:1rem">Luci — Demo conversacional</strong>
          <button id="close-demo" style="background:transparent;border:none;font-size:20px;cursor:pointer">✕</button>
        </div>
        <div id="demo-chat-box" style="height:320px;border-radius:8px;padding:12px;background:linear-gradient(180deg,#f8fbff,#fff);overflow:auto;"></div>
        <div style="display:flex;gap:.5rem;margin-top:8px;">
          <input id="demo-input" placeholder="Escribe un ejemplo: ¿Cuál fue mi producto más vendido?" style="flex:1;padding:.6rem;border-radius:10px;border:1px solid rgba(15,23,42,0.06)">
          <button id="demo-send" class="btn primary" style="padding:.6rem .9rem">Enviar</button>
        </div>
      </div>
    `;
    document.body.appendChild(modal);
    document.getElementById('close-demo').addEventListener('click', ()=> modal.remove());

    const chatBox = document.getElementById('demo-chat-box');
    const sample = [
      "Hola 👋 Soy Luci. ¿Qué necesitas hoy? Puedo mostrar ventas, inventario o generar reportes.",
      "Tu producto más vendido este mes es Cafetera X — 124 unidades.",
      "En el último mes tus ventas totales fueron $3.250.000 COP. ¿Quieres exportarlas en PDF?"
    ];

    function typeMessage(text, who='luci') {
      const b = document.createElement('div');
      b.style.margin = '8px 0';
      b.innerHTML = `<div style="font-size:.82rem;color:var(--muted)">${who==='user'?'Tú':'Luci'}</div><div style="padding:.5rem .7rem;border-radius:10px;margin-top:6px;background:${who==='user'?'#fff':'#eef6ff'}">${''}</div>`;
      chatBox.appendChild(b);
      const content = b.querySelector('div:nth-child(2)');
      let i=0;
      const interval = setInterval(()=>{
        content.textContent += text[i++] || '';
        chatBox.scrollTop = chatBox.scrollHeight;
        if (i >= text.length) clearInterval(interval);
      }, 16);
    }

    // seed
    setTimeout(()=> typeMessage("Hola 👋", 'user'), 300);
    setTimeout(()=> typeMessage(sample[0], 'luci'), 800);
    setTimeout(()=> typeMessage("Muéstrame mi producto más vendido", 'user'), 2200);
    setTimeout(()=> typeMessage(sample[1], 'luci'), 3000);

    document.getElementById('demo-send').addEventListener('click', ()=>{
      const val = document.getElementById('demo-input').value.trim();
      if (!val) return;
      typeMessage(val, 'user');
      setTimeout(()=> {
        typeMessage("Estoy consultando tus ventas...", 'luci');
        setTimeout(()=> { typeMessage(sample[2], 'luci'); }, 1100);
      }, 500);
      document.getElementById('demo-input').value = '';
    });
  });
}

/* =====================
   Offer popup (appears after OFFER_DELAY_MS)
   - user can close; we store in localStorage to avoid repeated show
   ===================== */
function setupOfferPopup(){
  const existing = document.getElementById('offer-popup');
  if (!existing) return;
  const shown = localStorage.getItem(OFFER_SHOWN_KEY);
  if (shown) return; // don't show again if closed
  setTimeout(()=>{
    existing.classList.remove('hidden');
    existing.classList.add('show');
  }, OFFER_DELAY_MS);

  existing.querySelector('.offer-close')?.addEventListener('click', ()=>{
    existing.classList.remove('show');
    localStorage.setItem(OFFER_SHOWN_KEY, '1');
  });
  existing.querySelector('.offer-no')?.addEventListener('click', ()=>{
    existing.classList.remove('show');
    localStorage.setItem(OFFER_SHOWN_KEY, '1');
  });
}

/* =====================
   Price badge scroll observer
   ===================== */
function setupPriceBadgeScroll(){
  const badge = document.getElementById('price-badge');
  const hero = document.getElementById('hero');
  if (!badge || !hero) return;
  const obs = new IntersectionObserver(entries=>{
    entries.forEach(e=>{
      if (!e.isIntersecting) badge.classList.add('visible');
      else badge.classList.remove('visible');
    });
  }, { threshold: 0.06 });
  obs.observe(hero);
}

/* =====================
   Smooth scroll anchors + reveal on scroll
   ===================== */
function setupUI(){
  // anchors
  document.querySelectorAll('a[href^="#"]').forEach(a=>{
    a.addEventListener('click', (e) => {
      const href = a.getAttribute('href');
      if (!href || href === '#') return;
      const target = document.querySelector(href);
      if (!target) return;
      e.preventDefault();
      target.scrollIntoView({ behavior:'smooth', block:'start' });
    });
  });

  // reveal
  const obs = new IntersectionObserver((entries, ob) => {
    entries.forEach(en => {
      if (en.isIntersecting) {
        en.target.classList.add('reveal-show');
        ob.unobserve(en.target);
      }
    });
  }, { threshold: 0.12 });

  document.querySelectorAll('.card, .feature, .price-card, .hero-copy, .mockup-card, .gallery-item').forEach(el=>{
    el.classList.add('reveal-init');
    obs.observe(el);
  });
}

/* =====================
   Inject some minimal animation styles (used by reveal-init/show)
   ===================== */
function injectRevealStyles(){
  const s = document.createElement('style');
  s.textContent = `
    .reveal-init { opacity:0; transform: translateY(10px); transition: opacity .6s var(--transition-fast), transform .6s var(--transition-fast); }
    .reveal-show { opacity:1; transform: translateY(0); }
  `;
  document.head.appendChild(s);
}

/* =====================
   Boot
   ===================== */
document.addEventListener('DOMContentLoaded', () => {
  renderPricingAmounts();
  hookBuyButtons();
  setupLazyVideo();
  setupGalleryLightbox();
  simulateChatDemo();
  setupOfferPopup();
  setupPriceBadgeScroll();
  setupUI();
  injectRevealStyles();
});
