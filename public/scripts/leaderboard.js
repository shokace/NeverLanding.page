const modal = document.getElementById('leaderboard-modal');
const status = document.getElementById('leaderboard-status');
const rows = document.getElementById('leaderboard-rows');
const table = modal.querySelector('table');
const refresh = document.getElementById('leaderboard-refresh');
const closeButton = modal.querySelector('.modal-close');
let previousFocus;
let controller;

async function loadLeaderboard() {
  controller?.abort();
  const pending = new AbortController();
  controller = pending;
  refresh.disabled = true;
  rows.replaceChildren();
  table.hidden = true;
  status.textContent = 'Loading leaderboard…';
  try {
    const response = await fetch('/api/leaderboard', {signal:pending.signal, credentials:'omit'});
    if (!response.ok) throw new Error('Leaderboard unavailable');
    const data = await response.json();
    if (controller !== pending) return;
    if (!Array.isArray(data.items)) throw new Error('Invalid leaderboard');
    const fragment = document.createDocumentFragment();
    for (const item of data.items.slice(0,100)) {
      if (!/^[A-Za-z0-9_-]{1,32}$/.test(item.username) || !Number.isSafeInteger(item.visits) || item.visits < 1 || !Number.isInteger(item.rank) || item.rank < 1) continue;
      const row = document.createElement('tr');
      for (const value of [item.rank, item.username, item.visits.toLocaleString()]) {
        const cell = document.createElement('td');
        cell.textContent = String(value);
        row.appendChild(cell);
      }
      fragment.appendChild(row);
    }
    rows.replaceChildren(fragment);
    table.hidden = !rows.children.length;
    status.textContent = rows.children.length ? '' : 'No landings yet. Your next discovery could start the leaderboard!';
  } catch (error) {
    if (error.name !== 'AbortError' && controller === pending) status.textContent = 'The leaderboard could not load. Please try Refresh.';
  } finally {
    if (controller === pending) refresh.disabled = false;
  }
}
export function openLeaderboard() {
  previousFocus = document.activeElement;
  modal.classList.remove('is-hidden');
  closeButton.focus();
  loadLeaderboard();
}
function closeLeaderboard() {
  controller?.abort();
  modal.classList.add('is-hidden');
  const fallback = document.querySelector('#leaderboard-menu')?.closest('.menu')?.querySelector('.menu-button');
  const canRestore = previousFocus?.matches('button,a[href],input,select,textarea,[tabindex]') && previousFocus.getClientRects().length;
  const target = canRestore ? previousFocus : fallback;
  target?.focus();
}
closeButton.addEventListener('click',closeLeaderboard);
refresh.addEventListener('click',loadLeaderboard);
modal.addEventListener('click',event=>{if(event.target===modal)closeLeaderboard();});
document.addEventListener('keydown',event=>{
  if (modal.classList.contains('is-hidden')) return;
  if (event.key === 'Escape') {event.stopPropagation(); closeLeaderboard();}
  if (event.key === 'Tab') {
    const focusable = [...modal.querySelectorAll('button:not(:disabled), [tabindex="0"]')].filter(el=>el.getClientRects().length);
    const first = focusable[0], last = focusable.at(-1);
    if (event.shiftKey && document.activeElement === first) {event.preventDefault();last.focus();}
    else if (!event.shiftKey && document.activeElement === last) {event.preventDefault();first.focus();}
  }
});
