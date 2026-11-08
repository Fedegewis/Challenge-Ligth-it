import { useEffect, useRef, useState, type FormEvent } from 'react';
import {
  createPatient,
  type FieldErrors,
  type FieldName,
  type TextFieldName,
} from '../api';
import {
  normalizeFullName,
  validateForm,
  type FormValues,
} from '../validation';
import { Modal } from './Modal';
import { PhotoField } from './PhotoField';
import { TextField } from './TextField';

type PatientFormModalProps = {
  onClose: () => void;
  onCreated: (fullName: string) => void;
  onFailed: () => void;
};

const EMPTY_VALUES: FormValues = {
  full_name: '',
  email: '',
  phone_prefix: '',
  phone_number: '',
};

export function PatientFormModal({
  onClose,
  onCreated,
  onFailed,
}: PatientFormModalProps) {
  const [values, setValues] = useState<FormValues>(EMPTY_VALUES);
  const [photo, setPhoto] = useState<File | null>(null);
  const [attempted, setAttempted] = useState(false);
  const [serverErrors, setServerErrors] = useState<FieldErrors>({});
  const [submitting, setSubmitting] = useState(false);
  const submittingRef = useRef(false);
  const focusFirstError = useRef(false);
  const formRef = useRef<HTMLFormElement>(null);
  const nameRef = useRef<HTMLInputElement>(null);

  const clientErrors = attempted ? validateForm(values, photo) : {};
  const errorFor = (field: FieldName) =>
    serverErrors[field] ?? clientErrors[field];

  useEffect(() => {
    if (!focusFirstError.current) return;
    focusFirstError.current = false;
    formRef.current
      ?.querySelector<HTMLElement>('[aria-invalid="true"]')
      ?.focus();
  });

  const clearServerError = (field: FieldName) =>
    setServerErrors((current) => {
      if (!(field in current)) return current;
      const next = { ...current };
      delete next[field];
      return next;
    });

  const updateValue = (field: TextFieldName, value: string) => {
    setValues((current) => ({ ...current, [field]: value }));
    clearServerError(field);
  };

  const updatePhoto = (file: File) => {
    setPhoto(file);
    clearServerError('photo');
  };

  const handleSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (submittingRef.current) return;

    setAttempted(true);
    setServerErrors({});
    const errors = validateForm(values, photo);
    if (Object.keys(errors).length > 0 || !photo) {
      focusFirstError.current = true;
      return;
    }

    submittingRef.current = true;
    setSubmitting(true);
    const result = await createPatient({ ...values, photo });
    submittingRef.current = false;
    setSubmitting(false);

    if (result.kind === 'created') {
      onCreated(normalizeFullName(values.full_name));
    } else if (result.kind === 'invalid') {
      setServerErrors(result.errors);
      focusFirstError.current = true;
    } else {
      onFailed();
    }
  };

  const textProps = (field: TextFieldName) => ({
    name: field,
    value: values[field],
    error: errorFor(field),
    onChange: (event: { target: { value: string } }) =>
      updateValue(field, event.target.value),
  });

  return (
    <Modal
      title="Add patient"
      onClose={onClose}
      canClose={!submitting}
      initialFocusRef={nameRef}
    >
      <form
        ref={formRef}
        className="patient-form"
        noValidate
        aria-busy={submitting}
        onSubmit={handleSubmit}
      >
        <TextField
          ref={nameRef}
          label="Full name"
          autoComplete="name"
          {...textProps('full_name')}
        />
        <TextField
          label="Email"
          type="email"
          autoComplete="email"
          placeholder="name@gmail.com"
          {...textProps('email')}
        />
        <div className="field-row">
          <TextField
            label="Phone prefix"
            className="field--prefix"
            inputMode="tel"
            autoComplete="tel-country-code"
            placeholder="+54"
            {...textProps('phone_prefix')}
          />
          <TextField
            label="Phone number"
            inputMode="numeric"
            autoComplete="tel-national"
            placeholder="1155667788"
            {...textProps('phone_number')}
          />
        </div>
        <PhotoField
          file={photo}
          error={errorFor('photo')}
          onChange={updatePhoto}
        />
        <div className="modal__actions">
          <button
            type="button"
            className="button"
            aria-disabled={submitting}
            onClick={() => {
              if (!submitting) onClose();
            }}
          >
            Cancel
          </button>
          <button
            type="submit"
            className="button button--primary"
            aria-disabled={submitting}
          >
            {submitting && (
              <span className="spinner spinner--small" aria-hidden="true" />
            )}
            {submitting ? 'Registering…' : 'Register patient'}
          </button>
        </div>
      </form>
    </Modal>
  );
}
