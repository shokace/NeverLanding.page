import {motionPreference, setMotionPreference} from './preferences.js';

export function initializeSettings({getUser, setUser, clearHistory, notify, openLogin, signOut}) {
  const modal = document.getElementById('settings-modal');
  const menu = document.getElementById('settings-menu');
  const closeButton = modal.querySelector('.modal-close');
  const status = document.getElementById('settings-status');
  const usernameForm = document.getElementById('settings-username-form');
  const deleteForm = document.getElementById('settings-delete-form');
  const deleteDetails = document.getElementById('settings-delete-details');
  const deleteSubmit = document.getElementById('settings-delete-submit');
  const passwordField = document.getElementById('settings-password-field');
  const deleteHelp = document.getElementById('settings-delete-help');
  const reauth = document.getElementById('settings-reauth');
  const motion = document.getElementById('settings-motion');
  const deletionKey = 'neverlanding-account-deleted';
  let previousFocus, loadController, busy = false, accountReady = false;

  function close() {
    loadController?.abort();
    modal.classList.add('is-hidden');
    deleteForm.reset();
    deleteDetails.open = false;
    reauth.hidden = true;
    const fallback = menu.closest('.menu').querySelector('.menu-button');
    (previousFocus?.getClientRects().length ? previousFocus : fallback).focus();
  }
  function lock(value) {
    busy = value;
    modal.querySelectorAll('form input, form button, #settings-revoke-sessions, #settings-reauth').forEach(el => {el.disabled = value;});
    deleteSubmit.disabled = value || !accountReady;
  }
  async function loadAccount() {
    loadController?.abort();
    const controller = new AbortController();
    loadController = controller;
    accountReady = false;
    deleteSubmit.disabled = true;
    const user = getUser();
    document.getElementById('settings-guest').hidden = Boolean(user);
    document.getElementById('settings-account').hidden = !user;
    document.getElementById('settings-danger').hidden = !user;
    if (!user) return;
    usernameForm.elements.username.value = user.username || '';
    deleteHelp.textContent = 'Loading account…';
    passwordField.hidden = true;
    deleteForm.elements.password.required = false;
    try {
      const response = await fetch('/api/account', {signal:controller.signal, cache:'no-store'});
      if (!response.ok) throw new Error();
      const data = await response.json();
      if (controller !== loadController || getUser()?.id !== user.id) return;
      passwordField.hidden = !data.hasPassword;
      deleteForm.elements.password.required = Boolean(data.hasPassword);
      deleteHelp.textContent = data.hasPassword ? '' : 'For your security, Google sign-in must be from the last 10 minutes.';
      accountReady = true;
      deleteSubmit.disabled = busy;
    } catch (error) {
      if (error.name !== 'AbortError' && controller === loadController) deleteHelp.textContent = 'Could not load your account. Close Settings and try again.';
    }
  }
  function open() {
    previousFocus = document.activeElement?.matches('button,input,select,a[href]') ? document.activeElement : null;
    modal.classList.remove('is-hidden');
    status.textContent = busy ? 'Saving…' : '';
    motion.value = motionPreference();
    closeButton.focus();
    loadAccount();
  }
  async function post(path, body) {
    const response = await fetch(path, {method:'POST', headers:{'content-type':'application/json'}, body:JSON.stringify(body)});
    const data = await response.json();
    if (!response.ok) {
      if (data.code === 'REAUTH_REQUIRED') reauth.hidden = false;
      throw new Error(data.error || 'That did not work. Please try again.');
    }
    return data;
  }
  async function act(operation) {
    if (busy) return;
    lock(true);
    status.textContent = 'Saving…';
    try {await operation();}
    catch (error) {
      status.textContent = error.message || 'Unable to connect. Please try again.';
      if (!modal.classList.contains('is-hidden')) status.scrollIntoView({block:'nearest'});
    }
    finally {lock(false);}
  }
  function forgetAccount(id) {
    if (getUser()?.id === id) {
      setUser(null);
      clearHistory();
      close();
      notify('Account deleted. Thanks for exploring with us.');
    }
    // auth-changed first finishes any open achievement viewing session.
    try {localStorage.removeItem(`neverlanding-achievements-seen:${id}`);} catch {}
  }
  menu.addEventListener('click', open);
  closeButton.addEventListener('click', close);
  modal.addEventListener('click', event => {if (event.target === modal) close();});
  document.addEventListener('keydown', event => {
    if (modal.classList.contains('is-hidden')) return;
    if (event.key === 'Escape') {event.preventDefault(); close();}
    if (event.key === 'Tab') {
      const items = [...modal.querySelectorAll('button:not(:disabled), input:not(:disabled), select, summary')].filter(el => el.getClientRects().length && (!el.closest('details:not([open])') || el.matches('summary')));
      const first = items[0], last = items.at(-1);
      if (event.shiftKey && document.activeElement === first) {event.preventDefault();last.focus();}
      else if (!event.shiftKey && document.activeElement === last) {event.preventDefault();first.focus();}
    }
  });
  motion.addEventListener('change', () => {
    setMotionPreference(motion.value);
    status.textContent = 'Animation preference saved on this browser.';
  });
  document.addEventListener('motion-changed', () => {motion.value = motionPreference();});
  document.getElementById('settings-clear-history').addEventListener('click', () => {
    clearHistory();
    status.textContent = 'This tab’s history is cleared. Onward!';
  });
  document.getElementById('settings-login').addEventListener('click', () => {close();openLogin();});
  usernameForm.addEventListener('submit', event => {
    event.preventDefault();
    const user = getUser();
    if (!user) return;
    const username = usernameForm.elements.username.value;
    act(async () => {
      const data = await post('/api/account/profile', {username});
      if (getUser()?.id !== user.id) return;
      setUser({...getUser(), username:data.username, needsUsername:false});
      status.textContent = 'New name, same explorer. Username saved!';
      notify('Username saved.');
    });
  });
  document.getElementById('settings-revoke-sessions').addEventListener('click', () => act(async () => {
    await post('/api/account/sessions/revoke', {});
    status.textContent = 'Other devices signed out. You’re still here!';
  }));
  deleteForm.addEventListener('submit', event => {
    event.preventDefault();
    const user = getUser();
    if (!user || !accountReady) return;
    const body = {confirmation:deleteForm.elements.confirmation.value, password:deleteForm.elements.password.value};
    act(async () => {
      await post('/api/account/delete', body);
      forgetAccount(user.id);
      try {localStorage.setItem(deletionKey, JSON.stringify({id:user.id, at:Date.now()}));} catch {}
    });
  });
  reauth.addEventListener('click', () => act(async () => {
    await signOut();
    close();
    openLogin();
  }));
  document.addEventListener('auth-changed', () => {
    deleteForm.reset();
    deleteDetails.open = false;
    reauth.hidden = true;
    if (!modal.classList.contains('is-hidden')) loadAccount();
  });
  window.addEventListener('storage', event => {
    if (event.key !== deletionKey || !event.newValue) return;
    try {forgetAccount(JSON.parse(event.newValue).id);} catch {}
  });
}
