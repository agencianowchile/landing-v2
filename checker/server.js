// Revisor web local: sirve el panel y escanea SEO de cualquier URL.
// Uso: node checker/server.js   →  abre http://localhost:4321
const http = require('http');
const fs = require('fs');
const path = require('path');

const PORT = process.env.PORT || 4321;
const UA = 'Mozilla/5.0 (RevisorWeb local)';

async function get(url, opts = {}) {
  const t0 = Date.now();
  try {
    const r = await fetch(url, { redirect: 'follow', headers: { 'user-agent': UA }, signal: AbortSignal.timeout(15000), ...opts });
    const body = opts.method === 'HEAD' ? '' : await r.text();
    return { ok: r.ok, status: r.status, url: r.url, headers: Object.fromEntries(r.headers), body, ms: Date.now() - t0 };
  } catch (e) {
    return { ok: false, status: 0, error: e.message, body: '', headers: {}, ms: Date.now() - t0 };
  }
}

const attr = (tag, name) => (tag.match(new RegExp(`\\b${name}\\s*=\\s*("([^"]*)"|'([^']*)'|([^\\s>]+))`, 'i')) || [])
  .slice(2).find(v => v !== undefined);
const tags = (html, name) => html.match(new RegExp(`<${name}\\b[^>]*>`, 'gi')) || [];
const text = s => s.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
const meta = (html, key) => {
  const t = tags(html, 'meta').find(m => [attr(m, 'name'), attr(m, 'property')].some(v => v && v.toLowerCase() === key));
  return t ? attr(t, 'content') || '' : null;
};

async function scan(target) {
  const page = await get(target);
  if (!page.status) return { error: `No pude abrir la página: ${page.error}` };
  const html = page.body;
  const base = new URL(page.url);
  const checks = [];
  const add = (group, name, status, detail, fix = '') => checks.push({ group, name, status, detail, fix });

  // Básico
  add('Básico', 'Responde', page.ok ? 'ok' : 'error', `HTTP ${page.status} en ${page.ms} ms`, page.ok ? '' : 'La página no responde 200: revisa el servidor o la ruta.');
  add('Básico', 'Velocidad del servidor', page.ms < 800 ? 'ok' : page.ms < 2000 ? 'warn' : 'error', `${page.ms} ms`, page.ms < 800 ? '' : 'Activa caché/CDN y optimiza el servidor.');
  const kb = Math.round(Buffer.byteLength(html) / 1024);
  add('Básico', 'Peso del HTML', kb < 150 ? 'ok' : 'warn', `${kb} KB`, kb < 150 ? '' : 'HTML pesado: quita código inline o divídelo.');
  const https = base.protocol === 'https:' || ['localhost', '127.0.0.1'].includes(base.hostname);
  add('Básico', 'HTTPS', https ? 'ok' : 'error', base.protocol, https ? '' : 'Activa certificado SSL.');
  const lang = attr(tags(html, 'html')[0] || '', 'lang');
  add('Básico', 'Idioma (lang)', lang ? 'ok' : 'warn', lang || 'falta', lang ? '' : 'Agrega <html lang="es">.');
  const vp = meta(html, 'viewport');
  add('Básico', 'Viewport móvil', vp ? 'ok' : 'error', vp || 'falta', vp ? '' : 'Agrega <meta name="viewport" content="width=device-width, initial-scale=1">.');
  const fav = tags(html, 'link').some(l => /icon/i.test(attr(l, 'rel') || ''));
  add('Básico', 'Favicon', fav ? 'ok' : 'warn', fav ? 'presente' : 'falta', fav ? '' : 'Agrega <link rel="icon">.');

  // SEO on-page
  const title = text((html.match(/<title[^>]*>([\s\S]*?)<\/title>/i) || [])[1] || '');
  add('SEO', 'Título', !title ? 'error' : title.length >= 30 && title.length <= 60 ? 'ok' : 'warn', title ? `"${title}" (${title.length} car.)` : 'falta', title.length >= 30 && title.length <= 60 ? '' : 'Ideal 30–60 caracteres con la palabra clave principal.');
  const desc = meta(html, 'description');
  add('SEO', 'Meta descripción', !desc ? 'error' : desc.length >= 70 && desc.length <= 160 ? 'ok' : 'warn', desc ? `${desc.length} car.` : 'falta', desc && desc.length >= 70 && desc.length <= 160 ? '' : 'Ideal 70–160 caracteres, que invite a hacer clic.');
  const h1s = (html.match(/<h1\b[\s\S]*?<\/h1>/gi) || []).map(text);
  add('SEO', 'H1 único', h1s.length === 1 ? 'ok' : 'error', h1s.length ? `${h1s.length}: ${h1s.join(' | ').slice(0, 120)}` : 'no hay H1', h1s.length === 1 ? '' : 'Debe haber exactamente 1 H1 por página.');
  const levels = (html.match(/<h[1-6]\b/gi) || []).map(h => +h[2]);
  const jump = levels.some((l, i) => i && l - levels[i - 1] > 1);
  add('SEO', 'Orden de títulos', jump ? 'warn' : 'ok', levels.map(l => 'H' + l).join(' ').slice(0, 120) || 'sin títulos', jump ? 'No saltes niveles (ej. H2 → H4).' : '');
  const canon = tags(html, 'link').find(l => (attr(l, 'rel') || '').toLowerCase() === 'canonical');
  add('SEO', 'Canonical', canon ? 'ok' : 'warn', canon ? attr(canon, 'href') : 'falta', canon ? '' : 'Agrega <link rel="canonical" href="URL-oficial">.');
  const robots = meta(html, 'robots') || '';
  add('SEO', 'Indexable', /noindex/i.test(robots) ? 'error' : 'ok', robots || 'sin meta robots (indexable)', /noindex/i.test(robots) ? 'Quita "noindex" antes de publicar.' : '');
  const imgs = tags(html, 'img');
  const noAlt = imgs.filter(i => attr(i, 'alt') === undefined);
  add('SEO', 'Imágenes con alt', noAlt.length ? 'warn' : 'ok', `${imgs.length - noAlt.length}/${imgs.length} con alt`, noAlt.length ? 'Describe cada imagen en su atributo alt.' : '');
  const lazy = imgs.filter(i => /lazy/i.test(attr(i, 'loading') || ''));
  add('SEO', 'Imágenes lazy', imgs.length < 4 || lazy.length ? 'ok' : 'warn', `${lazy.length}/${imgs.length} con loading="lazy"`, imgs.length < 4 || lazy.length ? '' : 'Usa loading="lazy" en imágenes bajo el primer pantallazo.');
  const words = text(html.replace(/<(script|style)[\s\S]*?<\/\1>/gi, '')).split(' ').length;
  add('SEO', 'Cantidad de texto', words > 300 ? 'ok' : 'warn', `${words} palabras`, words > 300 ? '' : 'Poco texto: Google entiende mejor páginas con 300+ palabras útiles.');

  // Redes sociales
  for (const k of ['og:title', 'og:description', 'og:image', 'twitter:card']) {
    const v = meta(html, k);
    add('Redes', k, v ? 'ok' : 'warn', v ? v.slice(0, 80) : 'falta', v ? '' : `Agrega <meta property="${k}"> para que se vea bien al compartir en WhatsApp/Facebook.`);
  }

  // Datos estructurados
  const ld = (html.match(/<script[^>]+application\/ld\+json[^>]*>([\s\S]*?)<\/script>/gi) || []);
  const types = ld.map(s => (s.match(/"@type"\s*:\s*"([^"]+)"/) || [])[1]).filter(Boolean);
  add('Datos estructurados', 'Schema JSON-LD', ld.length ? 'ok' : 'warn', ld.length ? types.join(', ') || 'presente' : 'falta', ld.length ? '' : 'Agrega schema LocalBusiness / AutoDealer / Product para salir mejor en Google.');

  // Archivos del sitio
  const [rb, sm] = await Promise.all([get(new URL('/robots.txt', base)), get(new URL('/sitemap.xml', base))]);
  add('Rastreo', 'robots.txt', rb.ok ? 'ok' : 'warn', rb.ok ? 'existe' : `HTTP ${rb.status}`, rb.ok ? '' : 'Crea /robots.txt con la línea Sitemap: …');
  add('Rastreo', 'sitemap.xml', sm.ok ? 'ok' : 'warn', sm.ok ? 'existe' : `HTTP ${sm.status}`, sm.ok ? '' : 'Crea /sitemap.xml y súbelo a Google Search Console.');
  if (rb.ok && /disallow:\s*\/\s*$/im.test(rb.body)) add('Rastreo', 'robots bloquea todo', 'error', 'Disallow: /', 'Quita "Disallow: /" o Google no verá el sitio.');

  // Seguridad / contenido mixto
  const mixed = base.protocol === 'https:' && /(src|href)=["']http:\/\//i.test(html);
  add('Seguridad', 'Contenido mixto', mixed ? 'warn' : 'ok', mixed ? 'hay recursos http://' : 'sin problemas', mixed ? 'Cambia los enlaces http:// a https://.' : '');
  const blank = tags(html, 'a').filter(a => attr(a, 'target') === '_blank' && !/noopener|noreferrer/i.test(attr(a, 'rel') || ''));
  add('Seguridad', 'Enlaces target=_blank', blank.length ? 'warn' : 'ok', `${blank.length} sin rel="noopener"`, blank.length ? 'Agrega rel="noopener" a enlaces que abren pestaña nueva.' : '');

  // Formularios y accesibilidad
  const inputs = tags(html, 'input').filter(i => !/hidden|submit|button/i.test(attr(i, 'type') || ''));
  const unlabeled = inputs.filter(i => !attr(i, 'aria-label') && !attr(i, 'placeholder') && !(attr(i, 'id') && html.includes(`for="${attr(i, 'id')}"`)));
  add('Accesibilidad', 'Campos con etiqueta', unlabeled.length ? 'warn' : 'ok', `${inputs.length - unlabeled.length}/${inputs.length}`, unlabeled.length ? 'Cada campo necesita <label for> o aria-label.' : '');
  const emptyBtns = (html.match(/<(button|a)\b[^>]*>\s*(<(svg|i|img)\b[\s\S]*?)?<\/\1>/gi) || []).filter(b => !text(b) && !/aria-label/i.test(b));
  add('Accesibilidad', 'Botones con nombre', emptyBtns.length ? 'warn' : 'ok', `${emptyBtns.length} botones/enlaces sin texto`, emptyBtns.length ? 'Agrega aria-label a botones de solo ícono.' : '');

  // Contacto (clave para un negocio local)
  const wa = /wa\.me|api\.whatsapp\.com/i.test(html), tel = /href=["']tel:/i.test(html), mail = /href=["']mailto:/i.test(html);
  add('Conversión', 'WhatsApp / teléfono / correo', wa || tel ? 'ok' : 'warn', `WhatsApp ${wa ? 'sí' : 'no'} · tel ${tel ? 'sí' : 'no'} · correo ${mail ? 'sí' : 'no'}`, wa || tel ? '' : 'Agrega botón de WhatsApp y teléfono clicable.');
  const analytics = /gtag\(|googletagmanager|fbq\(|plausible|clarity/i.test(html);
  add('Conversión', 'Analítica', analytics ? 'ok' : 'warn', analytics ? 'detectada' : 'no detectada', analytics ? '' : 'Instala Google Analytics 4 / Tag Manager para medir visitas.');

  // Enlaces rotos (hasta 40 internos)
  const links = [...new Set(tags(html, 'a').map(a => attr(a, 'href')).filter(h => h && !/^(#|mailto:|tel:|javascript:)/i.test(h))
    .map(h => { try { return new URL(h, base).href.split('#')[0]; } catch { return null; } }).filter(Boolean))];
  const internal = links.filter(l => new URL(l).host === base.host).slice(0, 40);
  const results = await Promise.all(internal.map(async l => {
    let r = await get(l, { method: 'HEAD' });
    if (r.status === 405 || r.status === 0) r = await get(l);
    return { url: l, status: r.status };
  }));
  const broken = results.filter(r => r.status >= 400 || r.status === 0);
  add('Enlaces', 'Enlaces internos rotos', broken.length ? 'error' : 'ok', `${internal.length} revisados, ${broken.length} rotos${broken.length ? ': ' + broken.map(b => `${b.url} (${b.status || 'sin respuesta'})`).join(', ') : ''}`, broken.length ? 'Corrige o elimina esos enlaces.' : '');
  add('Enlaces', 'Enlaces externos', 'ok', `${links.length - links.filter(l => new URL(l).host === base.host).length} externos (no se revisan)`);

  const score = Math.round(100 * checks.filter(c => c.status === 'ok').length / checks.length);
  return { url: page.url, score, checks, xfo: page.headers['x-frame-options'] || '', csp: page.headers['content-security-policy'] || '' };
}

http.createServer(async (req, res) => {
  const u = new URL(req.url, `http://localhost:${PORT}`);
  if (u.pathname === '/api/scan') {
    let target = u.searchParams.get('url') || '';
    if (!/^https?:\/\//i.test(target)) target = 'http://' + target;
    const out = await scan(target).catch(e => ({ error: e.message }));
    res.writeHead(200, { 'content-type': 'application/json; charset=utf-8' });
    return res.end(JSON.stringify(out));
  }
  res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
  fs.createReadStream(path.join(__dirname, 'index.html')).pipe(res);
}).listen(PORT, () => console.log(`Revisor web listo → http://localhost:${PORT}`));
