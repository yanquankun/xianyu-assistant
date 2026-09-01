import { useEffect, useId, useRef, useState } from 'react';

export interface SelectOption {
  value: string;
  label: string;
}

interface CustomSelectProps {
  label: string;
  value: string;
  options: readonly SelectOption[];
  onChange: (value: string) => void;
}

export function CustomSelect({ label, value, options, onChange }: CustomSelectProps) {
  const labelId = useId();
  const listboxId = useId();
  const rootRef = useRef<HTMLDivElement>(null);
  const [isOpen, setIsOpen] = useState(false);
  const selectedIndex = Math.max(
    0,
    options.findIndex((option) => option.value === value)
  );
  const [activeIndex, setActiveIndex] = useState(selectedIndex);
  const selectedOption = options[selectedIndex];

  useEffect(() => {
    if (!isOpen) {
      return;
    }
    const closeOnOutsidePointer = (event: PointerEvent) => {
      if (!rootRef.current?.contains(event.target as Node)) {
        setIsOpen(false);
      }
    };
    window.addEventListener('pointerdown', closeOnOutsidePointer);
    return () => window.removeEventListener('pointerdown', closeOnOutsidePointer);
  }, [isOpen]);

  const open = () => {
    setActiveIndex(selectedIndex);
    setIsOpen(true);
  };

  const choose = (index: number) => {
    const option = options[index];
    if (option !== undefined) {
      onChange(option.value);
    }
    setIsOpen(false);
  };

  const moveActive = (offset: number) => {
    if (options.length === 0) {
      return;
    }
    setActiveIndex((current) => (current + offset + options.length) % options.length);
  };

  return (
    <div ref={rootRef} className="field custom-select">
      <span id={labelId} className="custom-select__label">
        {label}
      </span>
      <button
        type="button"
        className="custom-select__trigger"
        role="combobox"
        aria-labelledby={labelId}
        aria-haspopup="listbox"
        aria-expanded={isOpen}
        aria-controls={listboxId}
        aria-activedescendant={isOpen ? `${listboxId}-option-${String(activeIndex)}` : undefined}
        onClick={() => (isOpen ? setIsOpen(false) : open())}
        onKeyDown={(event) => {
          switch (event.key) {
            case 'ArrowDown':
              event.preventDefault();
              if (isOpen) {
                moveActive(1);
              } else {
                open();
              }
              break;
            case 'ArrowUp':
              event.preventDefault();
              if (isOpen) {
                moveActive(-1);
              } else {
                open();
              }
              break;
            case 'Home':
              if (isOpen) {
                event.preventDefault();
                setActiveIndex(0);
              }
              break;
            case 'End':
              if (isOpen) {
                event.preventDefault();
                setActiveIndex(Math.max(0, options.length - 1));
              }
              break;
            case 'Enter':
            case ' ':
              event.preventDefault();
              if (isOpen) {
                choose(activeIndex);
              } else {
                open();
              }
              break;
            case 'Escape':
              if (isOpen) {
                event.preventDefault();
                setIsOpen(false);
              }
              break;
            case 'Tab':
              setIsOpen(false);
              break;
          }
        }}
      >
        <span>{selectedOption?.label ?? value}</span>
        <svg className="custom-select__chevron" viewBox="0 0 20 20" aria-hidden="true">
          <path d="m5.5 7.5 4.5 4.5 4.5-4.5" />
        </svg>
      </button>
      {isOpen ? (
        <div id={listboxId} className="custom-select__listbox" role="listbox" aria-labelledby={labelId}>
          {options.map((option, index) => (
            <button
              id={`${listboxId}-option-${String(index)}`}
              key={option.value}
              type="button"
              className={`custom-select__option${index === activeIndex ? ' custom-select__option--active' : ''}`}
              role="option"
              aria-selected={option.value === value}
              tabIndex={-1}
              onPointerMove={() => setActiveIndex(index)}
              onClick={() => choose(index)}
            >
              <span className="custom-select__check" aria-hidden="true">
                {option.value === value ? (
                  <svg viewBox="0 0 20 20" focusable="false">
                    <path d="m4.75 10.25 3.2 3.2 7.3-7.3" />
                  </svg>
                ) : null}
              </span>
              <span>{option.label}</span>
            </button>
          ))}
        </div>
      ) : null}
    </div>
  );
}
