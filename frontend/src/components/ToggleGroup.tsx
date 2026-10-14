export interface ToggleOption<T extends string> {
  value: T
  label: string
  disabled?: boolean
}

/** Single-select group of toggle buttons that exposes its state through aria-pressed. */
export function ToggleGroup<T extends string>({ label, options, value, onChange, disabled = false }: {
  label: string
  options: ToggleOption<T>[]
  value: T | undefined
  onChange: (value: T) => void
  disabled?: boolean
}) {
  return <div className="toggle-group" role="group" aria-label={label}>
    {options.map(option => <button type="button" key={option.value}
      aria-pressed={option.value === value}
      disabled={disabled || option.disabled}
      onClick={() => { if (option.value !== value) onChange(option.value) }}>
      {option.label}
    </button>)}
  </div>
}
