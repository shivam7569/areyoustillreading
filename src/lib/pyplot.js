/*
 * Client-side Python plotting via Pyodide (CPython compiled to WebAssembly).
 *
 * WHAT / single responsibility
 *   Runs an author's matplotlib script *in the browser* and returns the
 *   figure(s) as inline SVG (or a base64 GIF for saved animations), so a Python
 *   code block in the editor can render its plot right below the code — a mini
 *   notebook cell. Exactly one public export: renderPythonPlot(code).
 *
 * WHERE it sits in the architecture
 *   This project is a static Astro site built and served on Cloudflare Pages,
 *   with a few Pages Functions for the API (e.g. functions/api/publish.js →
 *   commits Markdown to GitHub → Git-integration rebuild), Supabase for auth,
 *   and Dodo for payments. This module is PURELY CLIENT-SIDE and EDITOR-ONLY:
 *   it never runs at build time and never runs in a Pages Function. It executes
 *   only in the admin editor (src/pages/admin/editor.astro), i.e. on the
 *   author's own machine after sign-in. Published/reader pages ship a pre-baked
 *   static asset instead of any Python — Pyodide is far too heavy to load per
 *   visitor.
 *
 * KEY dependencies
 *   - Pyodide (PYODIDE_VERSION below), lazy-loaded as a remote ESM module from
 *     the jsDelivr CDN — NOT an npm dependency and NOT bundled by Vite (see the
 *     @vite-ignore on the dynamic import). matplotlib is loaded on top; numpy
 *     comes along as its transitive dependency.
 *   - No imports from elsewhere in this repo; this file stands alone.
 *
 * WHAT depends on this file (IMPORTANT / possibly-stale caveat)
 *   As of this writing NOTHING in the repo imports renderPythonPlot. The
 *   editor's live "python" plot cells were migrated to the sibling module
 *   src/lib/plotly.js (renderPlotlyFigure), which runs plotly.py under the same
 *   Pyodide runtime and renders an INTERACTIVE plotly.js figure (rotatable/
 *   zoomable 3D) instead of a flat matplotlib SVG. This file is the earlier
 *   matplotlib-to-static-SVG renderer, kept as a standalone module. If you are
 *   wiring Python plotting into the editor, check which of the two is imported
 *   in src/pages/admin/editor.astro before assuming this one is active.
 *
 * SECURITY / correctness caveats
 *   - It runs arbitrary author-supplied Python, but only ever the signed-in
 *     author's own code, and inside Pyodide's WASM sandbox (its own virtual
 *     filesystem, no direct host FS or network). exec runs in a fresh namespace
 *     per call, not the module globals.
 *   - matplotlib is forced to the non-interactive 'AGG' backend and
 *     svg.fonttype='none' so the SVG is safe to embed and survives the editor's
 *     SVG sanitizer (see the inline note in HARNESS).
 *   - Pyodide is a heavyweight singleton: the first render pays the full
 *     download + init cost; every later render reuses it (pyodidePromise).
 */
const PYODIDE_VERSION = '0.28.3';
const CDN = `https://cdn.jsdelivr.net/pyodide/v${PYODIDE_VERSION}/full/`;

// Python-side harness: exec the user's source in a fresh namespace with stdout
// captured, then serialize every open matplotlib figure to SVG. Returns a JSON
// string (svgs / stdout / error) that the JS side parses. Defined once at init.
const HARNESS = `
import sys, io, json, os, base64, traceback
import matplotlib
matplotlib.use('AGG')
# Emit text as real <text> elements, not <use> refs into <defs>: the editor's SVG
# sanitizer drops the glyph <use>/xlink:href refs, which would erase every title,
# axis label and legend. <text> survives and renders with the page's fonts.
matplotlib.rcParams['svg.fonttype'] = 'none'
import matplotlib.pyplot as plt

def __run_user_plot(src):
    plt.close('all')
    captured = io.StringIO()
    result = {'svgs': [], 'gif': None, 'stdout': '', 'error': None}
    real_stdout = sys.stdout
    sys.stdout = captured
    pre_files = set(os.listdir('.'))
    try:
        exec(src, {'__name__': '__main__'})
        # An animation the script saved (e.g. anim.save('x.gif', writer='pillow'))
        # is captured as a base64 GIF and shown as an <img> — this is how a
        # rotating 3D plot becomes a playable animation.
        for fn in sorted(set(os.listdir('.')) - pre_files):
            if fn.lower().endswith('.gif'):
                with open(fn, 'rb') as fh:
                    result['gif'] = base64.b64encode(fh.read()).decode('ascii')
                os.remove(fn)
                break
        # Otherwise, serialize every open figure to SVG.
        if result['gif'] is None:
            for num in plt.get_fignums():
                fig = plt.figure(num)
                sbuf = io.StringIO()
                fig.savefig(sbuf, format='svg', bbox_inches='tight')
                result['svgs'].append(sbuf.getvalue())
        plt.close('all')
    except Exception:
        result['error'] = traceback.format_exc()
    finally:
        sys.stdout = real_stdout
        result['stdout'] = captured.getvalue()
    return json.dumps(result)
`;

// Module-level singleton: caches the *promise*, not the resolved runtime, so
// concurrent first calls share one in-flight load rather than starting several.
let pyodidePromise = null;

function initPyodide() {
  if (!pyodidePromise) {
    pyodidePromise = (async () => {
      // @vite-ignore keeps Vite from trying to bundle the remote CDN module.
      const { loadPyodide } = await import(/* @vite-ignore */ CDN + 'pyodide.mjs');
      const pyodide = await loadPyodide({ indexURL: CDN });
      await pyodide.loadPackage(['matplotlib']); // pulls numpy in as a dependency
      await pyodide.runPythonAsync(HARNESS);
      return pyodide;
    })();
  }
  return pyodidePromise;
}

/**
 * Run `code` and resolve to { svg, stdout, error }.
 *  - svg:    concatenated SVG markup of every figure the script produced ('' if none)
 *  - stdout: anything the script printed
 *  - error:  a Python traceback string, or null on success
 */
export async function renderPythonPlot(code) {
  const pyodide = await initPyodide();
  // Auto-load extra packages the script imports (numpy, pandas, ...). A package
  // Pyodide doesn't know about simply surfaces as a Python ImportError below.
  try {
    await pyodide.loadPackagesFromImports(code);
  } catch {}
  // Hand the source across the JS↔Python boundary via a global rather than
  // string-interpolating it into the exec call, so quotes/newlines can't break
  // the harness. The harness swallows script errors into res.error (a traceback
  // string), so runPythonAsync itself resolves normally on user-code failures.
  pyodide.globals.set('__user_src', code);
  const raw = await pyodide.runPythonAsync('__run_user_plot(__user_src)');
  const res = JSON.parse(raw);
  return {
    svg: res.svgs.join('\n'),
    gif: res.gif || null,
    stdout: res.stdout || '',
    error: res.error,
  };
}
