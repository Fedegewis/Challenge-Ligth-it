import { forwardRef, useId, type InputHTMLAttributes } from 'react';

type TextFieldProps = {
  label: string;
  error?: string;
  className?: string;
} & Omit<InputHTMLAttributes<HTMLInputElement>, 'className'>;

export function FieldError({ id, message }: { id: string; message?: string }) {
  if (!message) return null;
  return (
    <p id={id} className="field__error">
      {message}
    </p>
  );
}

export const TextField = forwardRef<HTMLInputElement, TextFieldProps>(
  function TextField({ label, error, className, ...inputProps }, ref) {
    const inputId = useId();
    const errorId = `${inputId}-error`;

    return (
      <div className={`field ${className ?? ''}`.trim()}>
        <label className="field__label" htmlFor={inputId}>
          {label}
        </label>
        <input
          ref={ref}
          id={inputId}
          className="field__input"
          aria-invalid={Boolean(error)}
          aria-describedby={error ? errorId : undefined}
          {...inputProps}
        />
        <FieldError id={errorId} message={error} />
      </div>
    );
  },
);
