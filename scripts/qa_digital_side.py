from pathlib import Path
import re
import sys

FILES = [
    'index.html','door.html','client-intake.html','door-frederick-legacy-law.html',
    'frederick-full-site.html','lumina-door.html','lumina-mobile-site.html',
    'northline-door.html','northline-mobile-site.html','northline-full-site.html',
    'atelier-door.html','atelier-house-mobile-site.html','atelier-house-full-site.html'
]
errors=[]

def fail(msg): errors.append(msg)

for name in FILES:
    p=Path(name)
    if not p.exists():
        fail(f'missing file: {name}')
        continue
    s=p.read_text(encoding='utf-8')
    if 'G-GGMNTLZZ06' not in s:
        fail(f'GA4 missing: {name}')
    for href in re.findall(r'href=["\']([^"\']+)',s):
        if href.startswith(('#','http://','https://','mailto:','tel:','sms:','javascript:')):
            continue
        target=href.split('#',1)[0].split('?',1)[0]
        if target and not Path(target).exists():
            fail(f'broken local href in {name}: {href}')

# Production form endpoints.
door=Path('door.html').read_text(encoding='utf-8')
intake=Path('client-intake.html').read_text(encoding='utf-8')
if 'https://formspree.io/f/mjyvrdnj' not in door: fail('quick intake Formspree endpoint missing')
if 'https://formspree.io/f/xaeyjzrk' not in intake: fail('full intake Formspree endpoint missing')

# Exactly four explainer stages.
if door.count('<article class="flow-card">') != 4: fail('Door explainer must contain exactly four flow cards')
for label in ('Digital Key','Digital Door','Customer Path','Destination'):
    if f'<b>{label}</b>' not in door: fail(f'Door explainer missing stage: {label}')

# Frederick visitor entrance should not call itself a customer Digital Key.
fred=Path('door-frederick-legacy-law.html').read_text(encoding='utf-8')
for bad in ('Tap Key to Enter','Private Access Granted','<div class="key-label">Digital Key</div>','tel:+10000000000','hello@example.com'):
    if bad in fred: fail(f'Frederick stale/placeholder content remains: {bad}')
if 'frederick-full-site.html' not in fred: fail('Frederick Door is not routed to warm local full site')

# Lumina: no emoji UI and no dead hrefs.
for name in ('lumina-door.html','lumina-mobile-site.html'):
    s=Path(name).read_text(encoding='utf-8')
    if re.search(r'[\U0001F300-\U0001FAFF]',s): fail(f'emoji remains in {name}')
    if 'href="#"' in s: fail(f'dead hash link remains in {name}')

# Northline fictional contact details should not trigger fake calls/emails.
for name in ('northline-door.html','northline-mobile-site.html','northline-full-site.html'):
    s=Path(name).read_text(encoding='utf-8')
    for bad in ('+15555550198','northlineroofing.example'):
        if bad in s: fail(f'placeholder contact remains in {name}: {bad}')

# Atelier Door paths must resolve somewhere useful.
atelier=Path('atelier-door.html').read_text(encoding='utf-8')
for bad in ('href="#"',"'#full-site'","'#consult'","'#inquiry'","'#client-portal'",'atelierhouse.example'):
    if bad in atelier: fail(f'Atelier dead/placeholder route remains: {bad}')

if errors:
    print('\n'.join('ERROR: '+e for e in errors))
    sys.exit(1)
print('Digital Side QA passed:', len(FILES), 'HTML files checked')
