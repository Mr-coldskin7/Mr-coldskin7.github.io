let pyodideReady = null;

async function loadPyodideOnce() {
  if (!pyodideReady) {
    pyodideReady = loadPyodide({
      indexURL: 'https://cdn.jsdelivr.net/pyodide/v0.25.1/full/'
    });
  }
  return pyodideReady;
}

function escapeHtml(str) {
  return str.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

function ensureOutputEl(block) {
  let el = block.nextElementSibling;
  if (el && el.classList.contains('py-output')) {
    el.querySelector('.py-output-body').textContent = '';
    el.querySelector('.py-status').className = 'py-status';
    el.querySelector('.py-status').textContent = '';
    return el;
  }

  el = document.createElement('div');
  el.className = 'py-output';
  el.innerHTML =
    '<div class="py-output-header"><span class="py-status"></span><span>Output</span></div>' +
    '<div class="py-output-body"></div>';
  block.parentNode.insertBefore(el, block.nextSibling);
  return el;
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
  const outputEl = ensureOutputEl(block);
  const body = outputEl.querySelector('.py-output-body');
  const status = outputEl.querySelector('.py-status');

  btn.textContent = '';
  btn.disabled = true;
  btn.classList.add('running');

  try {
    const pyodide = await loadPyodideOnce();

    await pyodide.runPythonAsync(`
import sys as _sys, io as _io
__orig_stdout, _sys.stdout = _sys.stdout, _io.StringIO()
__orig_stderr, _sys.stderr = _sys.stderr, _io.StringIO()
`);
    await pyodide.runPythonAsync(source);
    await pyodide.runPythonAsync(`
__captured_out = _sys.stdout.getvalue()
__captured_err = _sys.stderr.getvalue()
_sys.stdout = __orig_stdout
_sys.stderr = __orig_stderr
`);

    const stdout = pyodide.globals.get('__captured_out') || '';
    const stderr = pyodide.globals.get('__captured_err') || '';

    if (stderr) {
      body.innerHTML = '<span class="py-error">' + escapeHtml(stderr) + '</span>';
      status.className = 'py-status err';
      status.textContent = 'Error';
    } else if (stdout) {
      body.textContent = stdout;
      status.className = 'py-status ok';
      status.textContent = 'Success';
    } else {
      body.innerHTML = '<span class="py-success">&#10003; 执行完成（无输出）</span>';
      status.className = 'py-status ok';
      status.textContent = 'Done';
    }
  } catch (err) {
    body.innerHTML = '<span class="py-error">' + escapeHtml(err.message || String(err)) + '</span>';
    status.className = 'py-status err';
    status.textContent = 'Error';
  } finally {
    btn.textContent = 'Run';
    btn.disabled = false;
    btn.classList.remove('running');
  }
}

document.addEventListener('DOMContentLoaded', addRunButtons);
