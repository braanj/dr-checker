// The target may mount a few frames after the navigation that creates it, so
// poll per frame and give up quietly rather than steal focus much later.
export function focusWhenPresent(id: string, timeoutMs = 2000): void {
  const deadline = Date.now() + timeoutMs;
  const tick = () => {
    const el = document.getElementById(id);
    if (el) el.focus();
    else if (Date.now() < deadline) requestAnimationFrame(tick);
  };
  tick();
}
