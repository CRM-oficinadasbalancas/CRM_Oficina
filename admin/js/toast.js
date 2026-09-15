function showToast(message, type) {
  var container = document.getElementById('toast-container');
  if (!container) return;

  var el = document.createElement('div');
  el.className = 'toast' + (type ? ' toast-' + type : '');
  el.textContent = message;
  container.appendChild(el);

  setTimeout(function () {
    el.remove();
  }, 4000);
}
