let pyodideReady = null;

async function loadPyodideOnce() {
  if (!pyodideReady) {
    pyodideReady = loadPyodide({
      indexURL: 'https://cdn.jsdelivr.net/pyodide/v0.25.1/full/'
    });
  }
  return pyodideReady;
}

function addRunButtons() {
  document.querySelectorAll('div.language-python.highlighter-rouge').forEach(block => {
    if (block.querySelector('.py-run-btn')) return;

    const code = block.querySelector('.highlight code, code');
    if (!code) return;

    const header = block.querySelector('.code-header');

    const btn = document.createElement('button');
    btn.className = 'py-run-btn';
    btn.textContent = 'Run';
    btn.addEventListener('click', () => runCode(code.textContent, block, btn));

    if (header) {
      header.appendChild(btn);
    } else {
      block.style.position = 'relative';
      block.appendChild(btn);
    }
  });
}

async function runCode(source, block, btn) {
  let outputEl = block.nextElementSibling;
  if (!outputEl || !outputEl.classList.contains('py-output')) {
    outputEl = document.createElement('div');
    outputEl.className = 'py-output';
    block.parentNode.insertBefore(outputEl, block.nextSibling);
  }
  outputEl.textContent = '';
  outputEl.innerHTML = '';

  btn.textContent = 'Loading...';
  btn.disabled = true;
  btn.classList.add('running');

  try {
    const pyodide = await loadPyodideOnce();

    const setupCode = `
import sys as _sys, io as _io
__orig_stdout, _sys.stdout = _sys.stdout, _io.StringIO()
__orig_stderr, _sys.stderr = _sys.stderr, _io.StringIO()
`;

    const teardownCode = `
__captured_out = _sys.stdout.getvalue()
__captured_err = _sys.stderr.getvalue()
_sys.stdout = __orig_stdout
_sys.stderr = __orig_stderr
`;

    await pyodide.runPythonAsync(setupCode);
    await pyodide.runPythonAsync(source);
    await pyodide.runPythonAsync(teardownCode);

    const stdout = pyodide.globals.get('__captured_out') || '';
    const stderr = pyodide.globals.get('__captured_err') || '';

    if (stderr) {
      outputEl.innerHTML += `<span class="py-error">${stderr}</span>`;
    }
    if (stdout) {
      outputEl.textContent = stdout;
    }
    if (!stdout && !stderr) {
      outputEl.innerHTML = '<span class="py-success">✓ 执行完成（无输出）</span>';
    }
  } catch (err) {
    const msg = err.message || String(err);
    outputEl.innerHTML = `<span class="py-error">${msg}</span>`;
  } finally {
    btn.textContent = 'Run';
    btn.disabled = false;
    btn.classList.remove('running');
  }
}

document.addEventListener('DOMContentLoaded', addRunButtons);
