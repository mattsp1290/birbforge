from html.parser import HTMLParser
from pathlib import Path
from urllib.parse import urlsplit, unquote
import xml.etree.ElementTree as ET
import re

root = Path(__file__).resolve().parent
errors = []

class Document(HTMLParser):
    def __init__(self, path):
        super().__init__()
        self.path = path
        self.ids = set()
        self.links = []
        self.assets = []
        self.h1 = 0
        self.feed(path.read_text())

    def handle_starttag(self, tag, attrs):
        attrs = dict(attrs)
        if 'id' in attrs:
            if attrs['id'] in self.ids:
                errors.append(f'{self.path.name}: duplicate ID {attrs["id"]}')
            self.ids.add(attrs['id'])
        if tag == 'h1':
            self.h1 += 1
        if tag == 'a' and 'href' in attrs:
            self.links.append(attrs['href'])
        if tag in ('img', 'script') and 'src' in attrs:
            self.assets.append(attrs['src'])
        if tag == 'link' and 'href' in attrs:
            self.assets.append(attrs['href'])
        if tag == 'img' and not attrs.get('alt'):
            errors.append(f'{self.path.name}: image missing alt text')

docs = {p.resolve(): Document(p) for p in root.glob('*.html')}
for path, doc in docs.items():
    if doc.h1 != 1:
        errors.append(f'{path.name}: expected one h1, got {doc.h1}')
    for url in doc.links + doc.assets:
        parts = urlsplit(url)
        if parts.scheme or parts.netloc:
            if url in doc.assets:
                errors.append(f'{path.name}: network dependency {url}')
            continue
        target = (path.parent / unquote(parts.path)).resolve() if parts.path else path
        if not target.is_file():
            errors.append(f'{path.name}: missing local target {url}')
        elif parts.fragment and target in docs and unquote(parts.fragment) not in docs[target].ids:
            errors.append(f'{path.name}: missing fragment {url}')
for path, doc in docs.items():
    source = root / (path.stem + '.md')
    if path.stem in ('birbcrew-first-milestone', 'birbverify-first-milestone'):
        repo = path.stem.split('-')[0]
        source = root.parent.parent / repo / 'docs' / 'first-milestone.md'
    if source.is_file():
        external = re.findall(r'\]\((https?://[^)]+)\)', source.read_text())
        for url in external:
            if url not in doc.links:
                errors.append(f'{path.name}: external source link changed or missing: {url}')
for path in root.glob('assets/*.svg'):
    ET.parse(path)
if errors:
    raise SystemExit('\n'.join(errors))
print(f'PASS: {len(docs)} pages; local links, fragment targets, unique IDs, headings, image labels and offline assets.')
