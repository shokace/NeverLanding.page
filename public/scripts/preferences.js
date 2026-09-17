const key = 'neverlanding-motion';
export function motionPreference() {
  try {return localStorage.getItem(key) === 'reduce' ? 'reduce' : 'system';}
  catch {return 'system';}
}
export function reducedMotion() {
  return motionPreference() === 'reduce' || matchMedia('(prefers-reduced-motion: reduce)').matches;
}
function apply() {
  document.documentElement.dataset.reducedMotion = String(reducedMotion());
  document.dispatchEvent(new Event('motion-changed'));
}
export function setMotionPreference(value) {
  try {localStorage.setItem(key, value === 'reduce' ? 'reduce' : 'system');} catch {}
  apply();
}
window.addEventListener('storage', event => {if (event.key === key) apply();});
matchMedia('(prefers-reduced-motion: reduce)').addEventListener('change', apply);
apply();
