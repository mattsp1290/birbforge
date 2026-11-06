# Birbforge design documentation

Open `index.html` in a browser. The generated site works offline and includes
the agreed architecture, research, contracts and repository handoffs.

Markdown files are the editable source. HTML files and assets are checked-in
reading artifacts. Update the source and rebuild instead of editing generated
HTML. The Birbcrew and Birbverify milestone pages are generated from their
authoritative sibling checkouts. Keep those checkouts beside Birbforge when
rebuilding. The built site needs neither checkout nor a running service.

## Rebuild

From this directory, run `npm ci` and `npm run build`. Then run `npm run check`.
Only the documentation build uses the pinned Markdown parser. Reading the
site has no package or network dependency.

For a local preview, run `python3 -m http.server 8765 --bind 127.0.0.1` from this
directory and open `http://127.0.0.1:8765`. Stop the server when finished.

The check command verifies local links, fragment targets and standalone assets.
Browser inspection is also required after layout or interaction changes.
Documentation checks are not factory runtime acceptance.
