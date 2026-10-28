export function showStatus(element: HTMLElement, message: string, error = false) {
  element.textContent = message;
  element.classList.toggle('error', error);
}
