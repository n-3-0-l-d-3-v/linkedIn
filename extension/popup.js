const statusEl = document.getElementById('status');
const apiEl = document.getElementById('api');

async function check() {
  statusEl.className = 'status';
  statusEl.textContent = 'Checking API…';
  chrome.runtime.sendMessage({ type: 'ping' }, (res) => {
    if (res?.ok) {
      statusEl.className = 'status up';
      statusEl.textContent = `Engine reachable · ${res.data.status}`;
    } else {
      statusEl.className = 'status down';
      statusEl.textContent = `Unreachable. Run "npm run dev" in the project root.`;
    }
  });
}

chrome.storage.local.get('apiBase').then(({ apiBase }) => {
  apiEl.value = apiBase || 'http://localhost:4180';
  check();
});

document.getElementById('save').addEventListener('click', async () => {
  await chrome.storage.local.set({ apiBase: apiEl.value.trim().replace(/\/$/, '') });
  check();
});
