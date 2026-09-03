from pathlib import Path
import re

GA = '''<script async src="https://www.googletagmanager.com/gtag/js?id=G-GGMNTLZZ06"></script>\n<script>window.dataLayer=window.dataLayer||[];function gtag(){dataLayer.push(arguments)}gtag('js',new Date());gtag('config','G-GGMNTLZZ06');</script>'''


def patch(path, fn):
    p = Path(path)
    s = p.read_text(encoding='utf-8')
    n = fn(s)
    if n != s:
        p.write_text(n, encoding='utf-8')
        print('updated', path)
    else:
        print('no change', path)


def ensure_ga(s):
    if 'G-GGMNTLZZ06' in s:
        return s
    return s.replace('</head>', GA + '\n</head>', 1)


def index(s):
    s = ensure_ga(s)
    reps = {
        '.section{padding:112px 0}':'.section{padding:84px 0}',
        '.work{background:var(--dark);padding:112px 0}':'.work{background:var(--dark);padding:84px 0}',
        '.services{background:var(--black);padding:112px 0}':'.services{background:var(--black);padding:84px 0}',
        '.pricing{background:var(--dark);padding:112px 0}':'.pricing{background:var(--dark);padding:84px 0}',
        '.process{background:var(--black);padding:112px 0}':'.process{background:var(--black);padding:84px 0}',
        '.about{background:var(--dark);padding:112px 0}':'.about{background:var(--dark);padding:84px 0}',
        '.contact{background:var(--dark);padding:112px 0}':'.contact{background:var(--dark);padding:84px 0}',
        'margin-bottom:68px;':'margin-bottom:48px;',
        'margin-top:68px;':'margin-top:44px;',
        'margin-top:80px;':'margin-top:52px;',
    }
    for a,b in reps.items(): s=s.replace(a,b)

    for c in ('#a0a8b4','#7ecfcf','#d4a0b0','#c98a52','#b8a98a','#9a9a8a'):
        s=s.replace(c,'#a9b1a2')

    # Keep the flagship showcase to the four current Door systems.
    pat=r'\n\s*<!-- Funeral Home -->.*?\n\s*<!-- Also built for -->'
    atelier='''

      <!-- Interior Design -->
      <div class="proj-card reveal d2" style="--card-color:#a9b1a2;--icon-color:#a9b1a2;--icon-bg:rgba(169,177,162,.08);--icon-border:rgba(169,177,162,.2);--icon-bg-hover:rgba(169,177,162,.15);--card-accent:linear-gradient(90deg,#a9b1a2,transparent)">
        <div class="proj-card__num">04</div>
        <div class="proj-card__icon-wrap">
          <svg viewBox="0 0 24 24"><path d="M4 20V8l8-5 8 5v12"/><path d="M8 20v-7h8v7"/><path d="M3 20h18"/></svg>
        </div>
        <div class="proj-card__industry">Interior Design · Residential</div>
        <h3>Atelier House</h3>
        <p>An editorial Door that stays intentionally quiet at the threshold, then opens into richer style, portfolio, project, and current-client paths.</p>
        <div class="proj-card__footer">
          <div class="proj-card__tech"><span>HTML</span><span>CSS</span><span>JS</span></div>
          <div class="proj-card__actions"><a href="atelier-door.html" class="proj-card__link">View Door →</a><a href="atelier-house-mobile-site.html" class="proj-card__link proj-card__link--ghost">Mobile Site ↗</a><a href="atelier-house-full-site.html" class="proj-card__link proj-card__link--ghost">Full Site ↗</a></div>
        </div>
      </div>

    </div>

    <!-- Also built for -->'''
    s=re.sub(pat,atelier,s,flags=re.S)

    s=s.replace('<a href="https://webdevn3v.github.io/dental-office-demo/" target="_blank" rel="noopener" class="proj-card__link proj-card__link--ghost">Full Site ↗</a>',
                '<a href="lumina-mobile-site.html" class="proj-card__link proj-card__link--ghost">Mobile Site ↗</a><a href="https://webdevn3v.github.io/dental-office-demo/" target="_blank" rel="noopener" class="proj-card__link proj-card__link--ghost">Full Site ↗</a>')
    if 'northline-mobile-site.html" class="proj-card__link proj-card__link--ghost">Mobile Site' not in s:
        s=s.replace('<a href="northline-full-site.html" class="proj-card__link proj-card__link--ghost">Full Site ↗</a>',
                    '<a href="northline-mobile-site.html" class="proj-card__link proj-card__link--ghost">Mobile Site ↗</a><a href="northline-full-site.html" class="proj-card__link proj-card__link--ghost">Full Site ↗</a>')
    return s


def frederick(s):
    s = ensure_ga(s)
    s=s.replace('/* Customer-facing Digital Key */','/* Customer-facing Door entrance */')
    s=s.replace('<div class="access-eyebrow">Private Access // Frederick Legacy Law</div>','<div class="access-eyebrow">Frederick Legacy Law</div>')
    s=s.replace('<div class="key-label">Digital Key</div>','<div class="key-label">Client Entrance</div>')
    s=s.replace('<div class="key-instruction">Tap Key to Enter</div>','<div class="key-instruction">Tap to Enter</div>')
    s=s.replace('<div class="key-sub">Private access</div>','<div class="key-sub">Choose what brings you here</div>')
    s=s.replace('aria-label="Unlock Frederick Legacy Law Digital Door"','aria-label="Enter Frederick Legacy Law"')
    s=s.replace('<div class="door__reveal-num">Private Access Granted</div>','<div class="door__reveal-num">Frederick Legacy Law</div>')
    s=s.replace('--off:#EDE8DE;','--off:#F3EEE5;')
    s=s.replace('--gray:#777168;','--gray:#9B948A;')
    s=s.replace('radial-gradient(circle at 50% 0%,rgba(185,151,91,.06),transparent 28%),\n    #0b0a08;',
                'radial-gradient(circle at 50% 0%,rgba(185,151,91,.10),transparent 32%),\n    #15120e;')
    s=s.replace('border-color:rgba(255,255,255,.09);','border-color:rgba(217,189,133,.16);')

    dest='https://webdevn3v.github.io/law-firm-demo/'
    s=s.replace('<a class="path-card" href="#">','<a class="path-card" href="'+dest+'" target="_blank" rel="noopener">')
    s=s.replace("\ndocument.querySelectorAll('.path-card[href=\"#\"]').forEach(card => {\n  card.addEventListener('click', event => event.preventDefault());\n});",'')

    # Never show fake phone/email details in the public-facing demo.
    direct = re.compile(r'''\n\s*<div class="path-contact">\s*<div class="path-contact__label">Prefer to reach out directly\?</div>\s*<div class="path-utility">.*?</div>\s*</div>''', re.S)
    s = direct.sub('''\n    <div class="path-contact">\n      <div class="path-contact__label">Ready to contact the firm?</div>\n      <div class="path-utility">\n        <a class="path-action" href="https://webdevn3v.github.io/law-firm-demo/" target="_blank" rel="noopener">Contact on Full Site ↗</a>\n      </div>\n    </div>''', s)
    return s


def local_demo(s):
    return ensure_ga(s)

patch('index.html', index)
patch('door-frederick-legacy-law.html', frederick)
for path in [
    'lumina-door.html','lumina-mobile-site.html','northline-door.html',
    'northline-mobile-site.html','northline-full-site.html','atelier-door.html',
    'atelier-house-mobile-site.html','atelier-house-full-site.html'
]:
    patch(path, local_demo)
