import { useId, type InputHTMLAttributes, type ReactNode, type SelectHTMLAttributes } from 'react'

const baseField =
  'w-full rounded-lg bg-noat-surface-inset px-3 py-2 text-sm text-noat-text-primary placeholder:text-noat-text-muted transition-colors focus:bg-noat-surface focus:outline-2 focus:outline-noat-primary'

interface FieldWrapperProps {
  label: string
  hint?: ReactNode
  error?: string
  required?: boolean
  children: ReactNode
  id?: string
}

export function FieldWrapper({ label, hint, error, required, children, id }: FieldWrapperProps) {
  return (
    <div className="flex flex-col gap-1.5">
      <label htmlFor={id} className="text-sm font-medium text-noat-text-primary">
        {label}
        {required && <span className="ml-0.5 text-noat-danger" aria-hidden="true">*</span>}
      </label>
      {children}
      {error ? (
        <p className="text-xs text-noat-danger" role="alert">{error}</p>
      ) : hint ? (
        <p className="text-xs text-noat-text-muted">{hint}</p>
      ) : null}
    </div>
  )
}

interface TextFieldProps extends InputHTMLAttributes<HTMLInputElement> {
  label: string
  hint?: ReactNode
  error?: string
  inputClassName?: string
}

export function TextField({ label, hint, error, id, inputClassName = '', ...rest }: TextFieldProps) {
  const autoId = useId()
  const fieldId = id ?? autoId
  return (
    <FieldWrapper label={label} hint={hint} error={error} id={fieldId}>
      <input id={fieldId} className={`${baseField} ${inputClassName}`} {...rest} />
    </FieldWrapper>
  )
}

interface SelectFieldProps extends SelectHTMLAttributes<HTMLSelectElement> {
  label: string
  hint?: ReactNode
  error?: string
  children: ReactNode
}

export function SelectField({ label, hint, error, id, children, ...rest }: SelectFieldProps) {
  const autoId = useId()
  const fieldId = id ?? autoId
  return (
    <FieldWrapper label={label} hint={hint} error={error} id={fieldId}>
      <select id={fieldId} className={baseField} {...rest}>
        {children}
      </select>
    </FieldWrapper>
  )
}

interface CheckboxFieldProps {
  label: string
  hint?: ReactNode
  checked: boolean
  disabled?: boolean
  onChange: (checked: boolean) => void
}

export function CheckboxField({ label, hint, checked, disabled = false, onChange }: CheckboxFieldProps) {
  return (
    <label className={`flex cursor-pointer items-start gap-2.5 ${disabled ? 'cursor-not-allowed opacity-60' : ''}`}>
      <input
        type="checkbox"
        checked={checked}
        disabled={disabled}
        onChange={(e) => onChange(e.target.checked)}
        className="mt-0.5 size-4 cursor-pointer rounded border-noat-border-strong accent-noat-primary"
      />
      <span className="flex flex-col">
        <span className="text-sm font-medium text-noat-text-primary">{label}</span>
        {hint && <span className="text-xs text-noat-text-muted">{hint}</span>}
      </span>
    </label>
  )
}
