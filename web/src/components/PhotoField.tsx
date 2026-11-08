import { useEffect, useId, useState, type DragEvent } from 'react';
import { FieldError } from './TextField';

type PhotoFieldProps = {
  file: File | null;
  error?: string;
  onChange: (file: File) => void;
};

function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

export function PhotoField({ file, error, onChange }: PhotoFieldProps) {
  const inputId = useId();
  const labelId = `${inputId}-label`;
  const statusId = `${inputId}-status`;
  const errorId = `${inputId}-error`;
  const [dragging, setDragging] = useState(false);

  useEffect(() => {
    const preventNavigation = (event: globalThis.DragEvent) =>
      event.preventDefault();
    window.addEventListener('dragover', preventNavigation);
    window.addEventListener('drop', preventNavigation);
    return () => {
      window.removeEventListener('dragover', preventNavigation);
      window.removeEventListener('drop', preventNavigation);
    };
  }, []);

  const pick = (files: FileList | null | undefined) => {
    const selected = files?.[0];
    if (selected) onChange(selected);
  };

  const handleDrop = (event: DragEvent<HTMLDivElement>) => {
    event.preventDefault();
    setDragging(false);
    pick(event.dataTransfer?.files);
  };

  const handleDragLeave = (event: DragEvent<HTMLDivElement>) => {
    if (!event.currentTarget.contains(event.relatedTarget as Node | null)) {
      setDragging(false);
    }
  };

  const zoneClass = [
    'photo-drop',
    dragging && 'photo-drop--dragging',
    error && 'photo-drop--invalid',
  ]
    .filter(Boolean)
    .join(' ');

  return (
    <div className="field">
      <span id={labelId} className="field__label">
        Photo
      </span>
      <div
        className={zoneClass}
        data-testid="photo-drop"
        onDragEnter={(event) => {
          event.preventDefault();
          setDragging(true);
        }}
        onDragOver={(event) => event.preventDefault()}
        onDragLeave={handleDragLeave}
        onDrop={handleDrop}
      >
        <input
          id={inputId}
          type="file"
          accept=".jpg"
          className="visually-hidden"
          aria-labelledby={labelId}
          aria-describedby={error ? `${statusId} ${errorId}` : statusId}
          aria-invalid={Boolean(error)}
          onChange={(event) => {
            pick(event.target.files);
            event.target.value = '';
          }}
        />
        <label htmlFor={inputId} className="photo-drop__label">
          <span id={statusId}>
            {file ? (
              <>
                <span className="photo-drop__title">{file.name}</span>
                <span className="photo-drop__meta">
                  {formatSize(file.size)} · Choose or drop another file to
                  replace it
                </span>
              </>
            ) : (
              <>
                <span className="photo-drop__title">Drag a .jpg here</span>
                <span className="photo-drop__meta">
                  or <span className="photo-drop__link">choose a file</span>{' '}
                  (max 5 MB)
                </span>
              </>
            )}
          </span>
        </label>
      </div>
      <FieldError id={errorId} message={error} />
    </div>
  );
}
