import { getDocument, GlobalWorkerOptions } from './assets/vendor/pdfjs/pdf.min.mjs';

GlobalWorkerOptions.workerSrc = new URL('./assets/vendor/pdfjs/pdf.worker.min.mjs', import.meta.url).href;
const standardFontDataUrl = new URL('./assets/vendor/pdfjs/standard_fonts/', import.meta.url).href;
const wasmUrl = new URL('./assets/vendor/pdfjs/wasm/', import.meta.url).href;

document.querySelectorAll('[data-pdf]').forEach((figure) => {
  let pagePromise;
  let active = false;
  let revision = 0;
  let renderedWidth = 0;
  let renderedDensity = 0;
  let resizeTimer;
  let renderTask;

  async function renderFigure() {
    const width = Math.round(figure.clientWidth);
    const density = Math.max(2, window.devicePixelRatio || 1);
    if (!active || width === 0 || (width === renderedWidth && density === renderedDensity)) return;
    const currentRevision = ++revision;
    figure.dataset.state = 'loading';
    try {
      pagePromise ??= getDocument({
        url: new URL(figure.dataset.pdf, document.baseURI).href,
        standardFontDataUrl,
        wasmUrl,
      }).promise.then((document) => document.getPage(1));
      const page = await pagePromise;
      if (currentRevision !== revision) return;
      renderTask?.cancel();
      const bounds = page.getViewport({ scale: 1 });
      const viewport = page.getViewport({ scale: width * density / bounds.width });
      const canvas = document.createElement('canvas');
      canvas.width = Math.ceil(viewport.width);
      canvas.height = Math.ceil(viewport.height);
      canvas.setAttribute('aria-hidden', 'true');
      renderTask = page.render({ canvas, viewport, background: '#ffffff' });
      await renderTask.promise;
      if (currentRevision !== revision) return;
      figure.style.setProperty('--pdf-ratio', `${bounds.width}/${bounds.height}`);
      figure.replaceChildren(canvas);
      renderedWidth = width;
      renderedDensity = density;
      figure.dataset.state = 'ready';
    } catch (error) {
      if (currentRevision !== revision || error.name === 'RenderingCancelledException') return;
      figure.dataset.state = 'error';
      figure.textContent = 'This figure could not load. Please refresh the page.';
      console.error('Could not render figure:', figure.dataset.pdf, error);
    }
  }

  const observer = new IntersectionObserver((entries) => {
    if (!entries.some((entry) => entry.isIntersecting)) return;
    active = true;
    observer.disconnect();
    renderFigure();
  }, { rootMargin: '1000px' });
  observer.observe(figure);
  new ResizeObserver(() => {
    clearTimeout(resizeTimer);
    resizeTimer = setTimeout(renderFigure, 120);
  }).observe(figure);
});
