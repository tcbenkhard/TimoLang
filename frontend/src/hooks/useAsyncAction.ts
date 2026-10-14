import { useCallback, useState } from 'react'
import { errorMessage } from '../api'

/** Tracks one pending user action at a time and exposes its readable failure message. */
export function useAsyncAction() {
  const [pending, setPending] = useState(false)
  const [error, setError] = useState('')

  const run = useCallback(async (action: () => Promise<unknown>, fallback = 'The action failed. Try again.') => {
    setPending(true)
    setError('')
    try {
      await action()
      return true
    } catch (problem) {
      setError(errorMessage(problem, fallback))
      return false
    } finally {
      setPending(false)
    }
  }, [])

  const clearError = useCallback(() => setError(''), [])

  return { pending, error, run, clearError }
}
