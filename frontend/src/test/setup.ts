import '@testing-library/jest-dom/vitest'
import { cleanup } from '@testing-library/react'
import { afterEach } from 'vitest'

// jsdom does not implement modal dialogs yet.
if (!HTMLDialogElement.prototype.showModal) {
  HTMLDialogElement.prototype.showModal = function showModal(this: HTMLDialogElement) { this.open = true }
  HTMLDialogElement.prototype.close = function close(this: HTMLDialogElement) { this.open = false }
}

window.scrollTo = () => {}

afterEach(() => {
  cleanup()
  window.history.replaceState(null, '', '/')
})
