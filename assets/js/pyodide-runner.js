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

    pyodide.setStdout({ batch: false, write: (text) => {
      outputEl.textContent += text;
    }});
    pyodide.setStderr({ batch: false, write: (text) => {
      outputEl.innerHTML += `<span class="py-error">${text}</span>`;
    }});

    await pyodide.runPythonAsync(source);

    if (!outputEl.textContent && !outputEl.innerHTML) {
      outputEl.innerHTML = '<span class="py-success">✓ 执行完成（无输出）</span>';
    }
  } catch (err) {
    const msg = err.message || String(err);
    if (msg.includes('PythonError')) {
      const traceback = msg.split('\n').filter(l => l.trim()).join('\n');
      outputEl.innerHTML = `<span class="py-error">${traceback}</span>`;
    } else {
      outputEl.innerHTML = `<span class="py-error">Error: ${msg}</span>`;
    }
  } finally {
    btn.textContent = 'Run';
    btn.disabled = false;
    btn.classList.remove('running');
  }
}

document.addEventListener('DOMContentLoaded', addRunButtons);
