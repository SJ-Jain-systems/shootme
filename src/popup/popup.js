chrome.runtime.sendMessage({ type: 'get-sender' }, (response) => {
  const dot = document.getElementById('dot');
  const text = document.getElementById('stateText');
  if (chrome.runtime.lastError || !response || !response.ok) {
    dot.classList.add('bad');
    text.textContent = 'Reload the extension and try again.';
    return;
  }
  if (!response.hasKey) {
    dot.classList.add('bad');
    text.textContent = 'No Claude key yet. Add one in settings.';
    return;
  }
  text.textContent = `Ready${response.senderName ? ` as ${response.senderName}` : ''}.`;
});

document.getElementById('settings').addEventListener('click', () => {
  chrome.runtime.openOptionsPage();
  window.close();
});

document.getElementById('help').addEventListener('click', () => {
  const steps = document.getElementById('steps');
  steps.hidden = !steps.hidden;
});
