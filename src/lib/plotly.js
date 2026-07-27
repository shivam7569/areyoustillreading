/*
 * src/lib/plotly.js — client-side Plotly plotting for the admin editor.
 * ===========================================================================
 * WHAT / SINGLE RESPONSIBILITY
 *   A browser-only helper module that turns author-written plotly.py source into
 *   an interactive plot, plus a rotating-GIF exporter for 3D figures. The author
 *   writes Python, it runs in the browser via Pyodide (CPython compiled to WASM),
 *   and we hand back the figure as a plain JS object ({data, layout}). That object
 *   is rendered *interactively* with plotly.js (a separate CDN library) — so 3D
 *   plots are natively rotatable/zoomable, not static images. This file owns three
 *   things and nothing else: running the Python (renderPlotlyFigure), loading
 *   plotly.js (loadPlotlyJs), and encoding a 360-degree camera sweep to GIF
 *   (makeRotatingGif).
 *
 * WHERE IT SITS IN THE ARCHITECTURE
 *   Project = a static Astro site built on Cloudflare Pages, with Pages Functions
 *   (functions/api/*) for the dynamic bits, Supabase for auth/data, and Dodo for
 *   payments. THIS module is none of that: it is a pure client-side src/lib helper
 *   bundled into ONE page — the admin Milkdown/Crepe editor. Everything here runs
 *   in the author's browser at edit time; there is no server round-trip, no Pages
 *   Function, and no build-time step involved. Pyodide, plotly.js, and gifenc all
 *   load from public CDNs on first use (see the pinned version constants below).
 *
 * WHO DEPENDS ON THIS (and who does NOT)
 *   The ONLY importer is src/pages/admin/editor.astro, which imports all three
 *   exports. In the editor, each ```python fenced code block gets a live plot
 *   rendered right below it (notebook-style cell); renderPlotlyFigure runs the
 *   cell, loadPlotlyJs draws it, and 3D cells expose a "Download GIF" control that
 *   calls makeRotatingGif. NOTE: this is an EDIT-TIME PREVIEW only. The publish
 *   pipeline (functions/api/publish.js) commits the raw Markdown to GitHub, so a
 *   published post keeps the python source as an ordinary code fence — there is
 *   currently NO code anywhere that re-runs Pyodide or embeds figure JSON on public
 *   pages. If you came here expecting published-page rendering, it does not exist
 *   yet; wiring it up would mean serializing res.figure at publish time and adding
 *   a client that calls plotly.js on the reader's page.
 *
 * KEY DEPENDENCIES (all remote, all lazy)
 *   - Pyodide v0.28.3 (CDN, dynamic import of pyodide.mjs) — the WASM Python.
 *   - plotly (Python pkg) installed at init via micropip; numpy + pandas are
 *     preloaded because plotly.express needs pandas even for bundled datasets.
 *   - plotly.js 2.35.2 (CDN <script> tag) — the interactive renderer, window.Plotly.
 *   - gifenc 1.0.3 (CDN ESM) — client-side GIF encoder for makeRotatingGif.
 *
 * IMPORTANT DESIGN DECISIONS / NON-OBVIOUS GOTCHAS
 *   - Everything is lazy + memoized behind module-level promise singletons
 *     (pyodidePromise, plotlyJsPromise, gifencPromise): nothing downloads until the
 *     author first runs a cell, and each heavy asset loads exactly once per session.
 *   - Pyodide is a SINGLE shared interpreter. Concurrent cell runs would clobber the
 *     __user_src global and race, so renderPlotlyFigure funnels every call through a
 *     serial promise queue (renderQueue) — strictly one run at a time. See the note
 *     there about keeping the chain alive past a rejected run.
 *   - The Python HARNESS deliberately recovers a figure even when exec() raised
 *     AFTER building it — a trailing fig.show() throws under Pyodide (no renderer),
 *     but the figure is already valid, so we return it and clear the error. It
 *     prefers a Figure named `fig`, else falls back to the last go.Figure in scope.
 *   - The /* @vite-ignore *(slash) hints on the dynamic CDN imports stop Vite/Astro
 *     from trying to bundle those remote URLs at build time. (Written literally in
 *     the code below; do not remove them.)
 *   - Hard CDN dependency: with no network, an offline build, or a Content-Security
 *     -Policy that blocks cdn.jsdelivr.net / cdn.plot.ly, every export here fails.
 *   - makeRotatingGif mutates then RESTORES the live plot's camera; if it throws
 *     mid-sweep the restore in the finally-less path may be skipped, leaving the
 *     plot rotated (caller currently swallows errors in the editor UI).
 *
 * SECURITY / CORRECTNESS CAVEATS
 *   - renderPlotlyFigure exec()s arbitrary Python. The blast radius is bounded by
 *     the Pyodide WASM sandbox (no host filesystem/network beyond what Pyodide
 *     grants), and the only person who can type that code is the signed-in admin
 *     author — the editor page is admin-gated. Do NOT wire this to untrusted input
 *     without reconsidering that trust boundary.
 *   - Loading executable code from third-party CDNs (Pyodide, plotly.js, gifenc) is
 *     a supply-chain trust assumption; versions are pinned to reduce drift, but a
 *     compromised CDN would run in the author's browser.
 */
const PYODIDE_VERSION = '0.28.3';
const CDN = `https://cdn.jsdelivr.net/pyodide/v${PYODIDE_VERSION}/full/`;
const PLOTLY_JS = 'https://cdn.plot.ly/plotly-2.35.2.min.js';

// Python harness: exec the user's plotly.py, locate a Figure (prefers one named
// `fig`, else the last go.Figure created), and return it as JSON. stdout + any
// traceback are captured for display. Defined once at init.
const HARNESS = `
import sys, io, json, traceback
import plotly.graph_objects as go
import plotly.io as pio

def __run_user_plotly(src):
    captured = io.StringIO()
    result = {'figure': None, 'stdout': '', 'error': None}
    real_stdout = sys.stdout
    sys.stdout = captured
    ns = {'__name__': '__main__'}
    try:
        exec(src, ns)
    except Exception:
        result['error'] = traceback.format_exc()
    finally:
        sys.stdout = real_stdout
        result['stdout'] = captured.getvalue()
    # Recover a figure even if exec raised after building it (e.g. a trailing
    # fig.show(), which has no renderer under Pyodide).
    fig = ns.get('fig')
    if not isinstance(fig, go.Figure):
        fig = None
        for v in ns.values():
            if isinstance(v, go.Figure):
                fig = v
    if fig is not None:
        result['figure'] = pio.to_json(fig)
        result['error'] = None  # got a figure -> ignore a render/show error
    return json.dumps(result)
`;

let pyodidePromise = null;
function initPyodide() {
  if (!pyodidePromise) {
    pyodidePromise = (async () => {
      // @vite-ignore keeps Vite from bundling the remote CDN module.
      const { loadPyodide } = await import(/* @vite-ignore */ CDN + 'pyodide.mjs');
      const pyodide = await loadPyodide({ indexURL: CDN });
      // numpy + pandas cover the common cases: plotly.express needs pandas (even for
      // its bundled datasets like px.data.iris()). Anything else the script imports
      // is auto-loaded per-run via loadPackagesFromImports below.
      await pyodide.loadPackage(['micropip', 'numpy', 'pandas']);
      const micropip = pyodide.pyimport('micropip');
      await micropip.install('plotly');
      await pyodide.runPythonAsync(HARNESS);
      return pyodide;
    })();
  }
  return pyodidePromise;
}

/**
 * Run `code` and resolve to { figure, stdout, error }.
 *  - figure: the parsed Plotly figure ({data, layout}) or null if none produced
 *  - stdout: anything the script printed
 *  - error:  a Python traceback string, or null on success
 */
// Pyodide is one shared interpreter, so runs must never overlap — concurrent
// cells would race on the __user_src global and render each other's code. Chain
// every call through a promise queue so they execute strictly one at a time.
let renderQueue = Promise.resolve();
export function renderPlotlyFigure(code) {
  const run = async () => {
    const pyodide = await initPyodide();
    try {
      await pyodide.loadPackagesFromImports(code);
    } catch {}
    pyodide.globals.set('__user_src', code);
    const raw = await pyodide.runPythonAsync('__run_user_plotly(__user_src)');
    const res = JSON.parse(raw);
    return {
      figure: res.figure ? JSON.parse(res.figure) : null,
      stdout: res.stdout || '',
      error: res.error,
    };
  };
  const result = renderQueue.then(run, run);
  renderQueue = result.then(() => {}, () => {}); // keep the chain alive past errors
  return result;
}

let plotlyJsPromise = null;
/** Lazy-load plotly.js from its CDN; resolves to window.Plotly. */
export function loadPlotlyJs() {
  if (!plotlyJsPromise) {
    plotlyJsPromise = new Promise((resolve, reject) => {
      if (window.Plotly) return resolve(window.Plotly);
      const s = document.createElement('script');
      s.src = PLOTLY_JS;
      s.onload = () => resolve(window.Plotly);
      s.onerror = () => reject(new Error('plotly.js failed to load'));
      document.head.appendChild(s);
    });
  }
  return plotlyJsPromise;
}

// --- Rotating-GIF export -----------------------------------------------------
// plotly.js can't export a GIF, so we sweep the 3D camera 360° around the scene,
// snapshot each frame with Plotly.toImage, and encode them client-side (gifenc).
let gifencPromise = null;
function loadGifenc() {
  if (!gifencPromise) gifencPromise = import(/* @vite-ignore */ 'https://cdn.jsdelivr.net/npm/gifenc@1.0.3/dist/gifenc.esm.js');
  return gifencPromise;
}
function loadImage(url) {
  return new Promise((res, rej) => {
    const im = new Image();
    im.onload = () => res(im);
    im.onerror = rej;
    im.src = url;
  });
}

/**
 * Render a 3D plotly figure (`gd` = the plot div) as a rotating GIF Blob.
 * opts: { frames, fps, onProgress(fraction) }. Restores the original camera after.
 */
export async function makeRotatingGif(gd, { frames = 36, fps = 15, onProgress } = {}) {
  const Plotly = await loadPlotlyJs();
  const { GIFEncoder, quantize, applyPalette } = await loadGifenc();
  const cam = (gd._fullLayout && gd._fullLayout.scene && gd._fullLayout.scene.camera
    && gd._fullLayout.scene.camera.eye) || { x: 1.25, y: 1.25, z: 1.25 };
  const eye = { x: cam.x, y: cam.y, z: cam.z };
  const r = Math.hypot(eye.x, eye.y) || 1.77; // sweep radius in the x-y plane
  const phi0 = Math.atan2(eye.y, eye.x);
  const width = Math.round(gd.clientWidth || 700);
  const height = Math.round(gd.clientHeight || 450);
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext('2d');
  const encoder = GIFEncoder();
  const delay = Math.round(1000 / fps);
  for (let i = 0; i < frames; i++) {
    const a = phi0 + (i / frames) * 2 * Math.PI;
    await Plotly.relayout(gd, { 'scene.camera.eye': { x: r * Math.cos(a), y: r * Math.sin(a), z: eye.z } });
    await new Promise((res) => requestAnimationFrame(res)); // let the GL frame paint
    const img = await loadImage(await Plotly.toImage(gd, { format: 'png', width, height }));
    ctx.clearRect(0, 0, width, height);
    ctx.drawImage(img, 0, 0, width, height);
    const rgba = ctx.getImageData(0, 0, width, height).data;
    const palette = quantize(rgba, 256);
    encoder.writeFrame(applyPalette(rgba, palette), width, height, { palette, delay });
    if (onProgress) onProgress((i + 1) / frames);
  }
  encoder.finish();
  await Plotly.relayout(gd, { 'scene.camera.eye': eye }); // restore the view
  return new Blob([encoder.bytes()], { type: 'image/gif' });
}
