import { CircleAlert } from 'lucide-react'

export function ErrorMessage({ message }: { message: string }) {
  if (!message) return null
  return <p className="form-error" role="alert"><CircleAlert size={15} aria-hidden="true" /> {message}</p>
}
