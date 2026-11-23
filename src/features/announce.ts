/** Screen-reader announcements (WCAG 4.1.3): a polite live region rendered once by App (#sr-status). */
let timer = 0
export function announce(text: string) {
  const el = document.getElementById('sr-status')
  if (!el) return
  // clear first so the same message twice is announced twice
  el.textContent = ''
  window.clearTimeout(timer)
  timer = window.setTimeout(() => {
    el.textContent = text
  }, 40)
}
