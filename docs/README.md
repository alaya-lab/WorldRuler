# WorldRuler project homepage

Website: https://alaya-lab.github.io/WorldRuler/

This directory contains the static project homepage, published by GitHub Pages from `main:/docs`. It needs no build step. Keep `.nojekyll` so assets are served directly.

The site includes the selected hero video, ten paired GTA V / Habitat demonstrations, four paper figures rendered from PDF, dataset tables, and a synchronized interactive point cloud in section 04. The video and geometry use relative URLs and work under `/WorldRuler/`.

## Media

The hero and section 04 share the author-selected combat-v2 video, 468 frames at 24 fps (19.5 seconds). The original source SHA-256 is `2f9f40fa5e75b3dd65b4638ec5a120c846d1d712c8bc37c2638d77d1b116e1f0`. The video uses reference-guided H3 generation with the Turbo adapter and CWM-style temporal constraints. Section 04 adds offline reconstruction from that exact video and authored rule annotations. These are illustrative demonstrations, not recordings of the full WorldRuler pipeline. Observations and unconfirmed states retain their labels.

The published video is a web-compressed H.264 derivative, 6,743,323 bytes, SHA-256 `27e98d4c1c91be86ce223c3be36e52f184c05c2369ac17271fee64df42c4e20b`. Compression retains resolution, frame rate, frame order and duration; it does not regenerate or trim the video. All 21 videos use H.264 with fast-start metadata. Original and web hashes, encoding settings and dimensions are recorded in `assets/video-encodings.json`.

The browser geometry manifest records the original source, displayed video and geometry hashes. Background points accumulate up to the current frame, with five chapters and orbit/pan/zoom controls. The paired showcase contains six GTA V and four Habitat examples selected by the authors.

PDF.js and its font/WASM dependencies retain their bundled license notices under `assets/vendor/pdfjs/`.

## Local preview

Serve this directory using a static HTTP server with byte-range support so video seeking works. Open the served root in a browser; no package installation or application backend is required.
