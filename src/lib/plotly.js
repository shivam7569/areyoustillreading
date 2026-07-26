/*
 * Client-side Plotly plotting: the author writes plotly.py, it runs in the browser
 * via Pyodide (CPython in WASM), and we return the figure as a plain JS object.
 * That object is rendered *interactively* with plotly.js (loaded separately from
 * plotly's CDN) — so 3D plots are natively rotatable/zoomable. Pyodide runs only
 * in the editor; published pages ship the figure JSON + plotly.js, no Python.
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
