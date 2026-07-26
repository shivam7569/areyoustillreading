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
    try:
        ns = {'__name__': '__main__'}
        exec(src, ns)
        fig = ns.get('fig')
        if not isinstance(fig, go.Figure):
            fig = None
            for v in ns.values():
                if isinstance(v, go.Figure):
                    fig = v
        if fig is not None:
            result['figure'] = pio.to_json(fig)
    except Exception:
        result['error'] = traceback.format_exc()
    finally:
        sys.stdout = real_stdout
        result['stdout'] = captured.getvalue()
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
export async function renderPlotlyFigure(code) {
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
