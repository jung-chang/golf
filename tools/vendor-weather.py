"""Reproduce the unchanged Flat SVG subset from @meteocons/svg-static 0.1.0."""
import base64
import hashlib
import io
from pathlib import Path
import tarfile
import urllib.request

URL = 'https://registry.npmjs.org/@meteocons/svg-static/-/svg-static-0.1.0.tgz'
INTEGRITY = 'dnuXOkt1W5q+XZbyj54dzjuBcKmsC0eLv51IVaW9kzzvzwnhwv9KgNXHKgpvmdN6cX2stMo+k95iMFbcyM4x5Q=='
ICONS = ['clear-day', 'partly-cloudy-day', 'overcast', 'fog', 'drizzle', 'rain', 'sleet', 'snow',
         'partly-cloudy-day-rain', 'partly-cloudy-day-snow', 'thunderstorms', 'thunderstorms-hail', 'not-available']

data = urllib.request.urlopen(URL, timeout=30).read()
assert base64.b64encode(hashlib.sha512(data).digest()).decode() == INTEGRITY, 'Package integrity mismatch'
destination = Path(__file__).resolve().parent.parent / 'public' / 'weather'
destination.mkdir(exist_ok=True)
with tarfile.open(fileobj=io.BytesIO(data), mode='r:gz') as archive:
    for icon in ICONS:
        svg = archive.extractfile(f'package/flat/{icon}.svg').read()
        assert b'<animate' not in svg and b'<set ' not in svg and b'<script' not in svg
        (destination / f'{icon}.svg').write_bytes(svg)
    (destination / 'LICENSE').write_bytes(archive.extractfile('package/LICENSE').read())
print(f'Verified SHA-512; copied {len(ICONS)} unchanged Flat static SVGs and MIT license.')
