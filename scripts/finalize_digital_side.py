from pathlib import Path
import re
from urllib.request import urlopen

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
    s=s.replace('https://webdevn3v.github.io/law-firm-demo/','frederick-full-site.html')
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
    s=s.replace('--off:#EDE8DE;','--off:#F3EEE5;').replace('--gray:#777168;','--gray:#9B948A;')
    s=s.replace('radial-gradient(circle at 50% 0%,rgba(185,151,91,.06),transparent 28%),\n    #0b0a08;',
                'radial-gradient(circle at 50% 0%,rgba(185,151,91,.10),transparent 32%),\n    #15120e;')
    s=s.replace('border-color:rgba(255,255,255,.09);','border-color:rgba(217,189,133,.16);')
    s=s.replace('https://webdevn3v.github.io/law-firm-demo/','frederick-full-site.html')
    s=s.replace('<a class="path-card" href="#">','<a class="path-card" href="frederick-full-site.html">')
    s=s.replace("\ndocument.querySelectorAll('.path-card[href=\"#\"]').forEach(card => {\n  card.addEventListener('click', event => event.preventDefault());\n});",'')
    direct = re.compile(r'''\n\s*<div class="path-contact">\s*<div class="path-contact__label">Prefer to reach out directly\?</div>\s*<div class="path-utility">.*?</div>\s*</div>''', re.S)
    s = direct.sub('''\n    <div class="path-contact">\n      <div class="path-contact__label">Ready to contact the firm?</div>\n      <div class="path-utility"><a class="path-action" href="frederick-full-site.html#contact">Contact on Full Site ↗</a></div>\n    </div>''', s)
    return s


def atelier(s):
    s=ensure_ga(s)
    # Never render route-menu links or CTA targets as dead hashes in the demo.
    s=s.replace('d.menu.map(x=>`<a href="#">${x}', 'd.menu.map(x=>`<a href="atelier-house-full-site.html">${x}')
    s=s.replace("['Browse the full portfolio','#full-site']", "['Browse the full portfolio','atelier-house-full-site.html']")
    s=s.replace("['Bring my direction to a consultation','#consult']", "['Bring my direction to a consultation','atelier-house-full-site.html']")
    s=s.replace("['Start my project inquiry','#inquiry']", "['Start my project inquiry','atelier-house-full-site.html']")
    s=s.replace("['See services first','#full-site']", "['See services first','atelier-house-full-site.html']")
    s=s.replace("['Open client workspace','#client-portal']", "['See client process','atelier-house-full-site.html']")
    s=s.replace("['Contact the studio','mailto:hello@atelierhouse.example']", "['Contact the studio','atelier-house-full-site.html']")
    s=s.replace("['Find the right level of help','#consult']", "['Find the right level of help','atelier-house-full-site.html']")
    s=s.replace("['See design services','#full-site']", "['See design services','atelier-house-full-site.html']")
    return s


def northline_door(s):
    s=ensure_ga(s)
    s=s.replace('href="tel:+15555550198"','href="northline-mobile-site.html#storm"')
    s=s.replace('>24/7 ROOF LINE<','>STORM RESPONSE<')
    s=s.replace('>Call roof line<','>Storm response<')
    s=s.replace('href="mailto:crew@northlineroofing.example?subject=Current%20Northline%20project"','href="northline-mobile-site.html#customer"')
    s=s.replace('>Email the crew<','>Project support<')
    return s


def northline_mobile(s):
    s=ensure_ga(s)
    s=re.sub(r'href="tel:\+15555550198"', 'href="#storm"', s)
    s=re.sub(r'href="mailto:crew@northlineroofing\.example[^\"]*"', 'href="northline-full-site.html#estimate"', s)
    s=s.replace('>Call roof line<','>Storm response<').replace('>Call 24/7 roof line<','>Storm response<').replace('>Email crew<','>Project details<').replace('>Call<','>Storm response<').replace('>Call now<','>Storm response<')
    return s


def northline_full(s):
    s=ensure_ga(s)
    s=re.sub(r'href="tel:\+15555550198"', 'href="#estimate"', s)
    s=re.sub(r'href="mailto:crew@northlineroofing\.example[^\"]*"', 'href="#estimate"', s)
    s=s.replace('>24/7 ROOF LINE<','>START HERE<').replace('>Call roof line →<','>Start storm response →<').replace('>Call now<','>Start here<').replace('>Contact crew →<','>Project support →<')
    s=s.replace('action="mailto:crew@northlineroofing.example" method="post" enctype="text/plain"','action="northline-door.html" method="get"')
    s=s.replace('>Roof line<','>Digital Door<').replace('>Email<','>Customer path<')
    return s


def local_demo(s):
    return ensure_ga(s)


def build_frederick_full_site():
    url='https://raw.githubusercontent.com/Webdevn3v/law-firm-demo/main/index.html'
    s=urlopen(url,timeout=20).read().decode('utf-8')
    s=ensure_ga(s)
    warm='''\n  /* TDS warm Frederick alignment */\n  :root{--navy:#4a4037;--navy-deep:#2f2924;--gold:#9b7a49;--gold-lt:#b9975b;--cream:#f2ece3;--cream-dk:#e8dfd3;--charcoal:#403933;--slate:#756d65;--mist:#fbf8f3;--white:#fffdf9;--border:rgba(64,57,51,.12)}\n  body{background:var(--mist);color:var(--charcoal)}\n  .hero{background:var(--cream)}\n  .hero__bg{background:radial-gradient(ellipse 75% 65% at 110% 32%,rgba(155,122,73,.13),transparent 60%),radial-gradient(ellipse 55% 70% at -5% 60%,rgba(217,189,133,.12),transparent 68%),linear-gradient(155deg,#fbf8f3 0%,#f2ece3 56%,#e8dfd3 100%)}\n  .hero h1{color:var(--charcoal)}.hero h1 em{color:var(--gold)}.hero__sub{color:#70675f}.hero__phone{color:#82786f}.hero__phone span{color:var(--charcoal)}\n  .nav__logo-name{color:var(--charcoal)}.nav__logo-sub{color:var(--gold)}.nav__links a{color:rgba(64,57,51,.72)}.nav.scrolled{background:rgba(251,248,243,.96);border-bottom:1px solid rgba(64,57,51,.08)}\n  .trust{background:#e8dfd3;color:var(--charcoal)}.trust__label{color:#756d65}.section--dark{background:#e5dccf;color:var(--charcoal)}.section--dark h2,.section--dark h3,.section--dark h4{color:var(--charcoal)}.section--dark .lead{color:#756d65}\n  .btn--primary{background:var(--gold);color:#fffdf9}.btn--outline{border-color:rgba(64,57,51,.28);color:var(--charcoal)}.btn--outline:hover{background:#e8dfd3;color:var(--charcoal);border-color:var(--gold)}.btn--navy{background:#4a4037;color:#fffdf9}\n  .area-card{background:#fffdf9}.area-card:hover{background:#f2ece3}.area-card::before{background:linear-gradient(90deg,var(--gold),#c2a474)}\n'''
    s=s.replace('</style>',warm+'\n</style>',1)
    # Do not invite users to dial or email fictional placeholder contact details.
    s=re.sub(r'href="tel:[^"]+"','href="#contact"',s)
    s=re.sub(r'href="mailto:[^"]+"','href="#contact"',s)
    s=s.replace('action="mailto:hello@example.com"','action="#contact"')
    Path('frederick-full-site.html').write_text(s,encoding='utf-8')
    print('built frederick-full-site.html')

patch('index.html', index)
patch('door-frederick-legacy-law.html', frederick)
patch('atelier-door.html', atelier)
patch('northline-door.html', northline_door)
patch('northline-mobile-site.html', northline_mobile)
patch('northline-full-site.html', northline_full)
for path in ['lumina-door.html','lumina-mobile-site.html','atelier-house-mobile-site.html','atelier-house-full-site.html']:
    patch(path, local_demo)
build_frederick_full_site()
