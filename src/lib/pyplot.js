/*
 * Client-side Python plotting via Pyodide (CPython compiled to WebAssembly).
 *
 * Runs a reader/author's matplotlib script *in the browser* and returns the
 * figure(s) as inline SVG, so a Python code block in the editor can render its
 * plot right below the code — a mini notebook cell. Pyodide and its scientific
 * packages are large, so the whole runtime is lazy-loaded from the jsDelivr CDN
 * on first use and reused for every later render. This only ever runs on the
 * admin editor page; published pages get a pre-baked static image instead.
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
