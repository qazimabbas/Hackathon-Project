import { useEffect, useRef, useState } from 'react';
import { FileText, LoaderCircle, Upload, X } from 'lucide-react';
import { readSourceDocument, SOURCE_FILE_ACCEPT } from './sourceDocument.js';

export default function SourceDocument({ value, onChange, maxLength, disabled, onBusyChange }) {
  const [filename, setFilename] = useState('');
  const [importing, setImporting] = useState(false);
  const [error, setError] = useState('');
  const inputRef = useRef(null);
  const importNumber = useRef(0);

  useEffect(
    () => () => {
      importNumber.current++;
    },
    [],
  );
  useEffect(() => {
    onBusyChange(importing);
    return () => onBusyChange(false);
  }, [importing, onBusyChange]);

  async function importFile(event) {
    const file = event.target.files?.[0];
    event.target.value = '';
    if (!file) return;
    const attempt = ++importNumber.current;
    setImporting(true);
    setError('');
    try {
      const text = await readSourceDocument(file, maxLength);
      if (attempt !== importNumber.current) return;
      onChange(text);
      setFilename(file.name);
    } catch (failure) {
      if (attempt === importNumber.current)
        setError(
          failure.message ||
            'This document could not be imported. Try another file or paste its text.',
        );
    } finally {
      if (attempt === importNumber.current) setImporting(false);
    }
  }

  return (
    <section className="source-document" aria-labelledby="source-heading" aria-busy={importing}>
      <div className="source-heading-row">
        <div>
          <FileText size={17} aria-hidden="true" />
          <label id="source-heading" htmlFor="source">
            Source document
          </label>
        </div>
        <span className="optional-tag">OPTIONAL</span>
      </div>
      <p id="source-hint" className="source-description">
        Add the reference the answer should agree with. Choose a file or paste its text below.
      </p>
      <div className="source-import-row">
        <input
          ref={inputRef}
          type="file"
          id="source-file"
          aria-label="Choose source document file"
          accept={SOURCE_FILE_ACCEPT}
          onChange={importFile}
          hidden
          disabled={disabled || importing}
        />
        <button
          className="source-upload-button"
          type="button"
          onClick={() => inputRef.current?.click()}
          disabled={disabled || importing}
        >
          {importing ? <LoaderCircle size={16} className="spin" /> : <Upload size={16} />}
          {importing ? 'Reading document...' : 'Choose document'}
        </button>
        <span className="source-file-types">PDF, DOCX, TXT or MD. Up to 10 MB.</span>
      </div>
      <div className="source-import-status" role="status" aria-live="polite">
        {importing
          ? 'Extracting the document text. You can review it before checking.'
          : filename && (
              <span>
                <FileText size={14} />
                {filename}
              </span>
            )}
      </div>
      <textarea
        id="source"
        value={value}
        onChange={(event) => onChange(event.target.value)}
        maxLength={maxLength}
        disabled={disabled || importing}
        placeholder="Paste source text here, or choose a document above"
        aria-describedby="source-hint source-format-note"
      />
      <div className="source-footer">
        <span>
          {value.length.toLocaleString()} / {maxLength.toLocaleString()} characters
        </span>
        {value && (
          <button
            type="button"
            disabled={disabled || importing}
            onClick={() => {
              onChange('');
              setFilename('');
              setError('');
            }}
          >
            <X size={13} />
            Clear source
          </button>
        )}
      </div>
      <p id="source-format-note" className="context-note">
        Files are read in your browser. Only the extracted text is used for the check. Scanned
        images need text recognition first.
      </p>
      {error && (
        <p className="source-import-error" role="alert">
          {error}
        </p>
      )}
    </section>
  );
}
