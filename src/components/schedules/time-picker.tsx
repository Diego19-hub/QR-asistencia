"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import type { KeyboardEvent as ReactKeyboardEvent } from "react";
import { createPortal } from "react-dom";
import { ChevronDown } from "lucide-react";

import { filterTimeOptions, formatTime12Hour, isValidTime, nearestTimeOption, TIME_OPTIONS } from "@/lib/schedules/time-options";

type PopoverPosition = { top: number; left: number; width: number; maxHeight: number };

export function TimePicker({
  id,
  label,
  value,
  onChange,
  required = false,
  className,
}: {
  id: string;
  label: string;
  value: string;
  onChange: (value: string) => void;
  required?: boolean;
  className: string;
}) {
  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState(value);
  const [filterActive, setFilterActive] = useState(false);
  const [touched, setTouched] = useState(false);
  const [activeIndex, setActiveIndex] = useState(0);
  const [position, setPosition] = useState<PopoverPosition | null>(null);
  const rootRef = useRef<HTMLDivElement>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const optionRefs = useRef(new Map<string, HTMLDivElement>());
  const listId = `${id}-options`;
  const inputClassName = className.replace(/\bmt-1\.5\b/, "").trim();
  const options = useMemo(() => filterTimeOptions(TIME_OPTIONS, filterActive ? draft : ""), [draft, filterActive]);
  const activeOption = options[Math.min(activeIndex, Math.max(options.length - 1, 0))];
  const error = (touched || draft.length > 5) && !isValidTime(draft)
    ? "Escribe una hora válida en formato de 24 horas (HH:mm)."
    : null;

  useEffect(() => {
    if (!open) return;

    function updatePosition() {
      const anchor = rootRef.current?.getBoundingClientRect();
      if (!anchor) return;
      const spaceBelow = window.innerHeight - anchor.bottom - 8;
      const spaceAbove = anchor.top - 8;
      const openAbove = spaceBelow < 190 && spaceAbove > spaceBelow;
      const maxHeight = Math.max(96, Math.min(240, openAbove ? spaceAbove : spaceBelow));
      setPosition({
        left: Math.max(8, Math.min(anchor.left, window.innerWidth - anchor.width - 8)),
        top: openAbove ? Math.max(8, anchor.top - maxHeight - 4) : anchor.bottom + 4,
        width: anchor.width,
        maxHeight,
      });
    }

    function closeOnOutsidePointer(event: PointerEvent) {
      const target = event.target;
      if (target instanceof Node && !rootRef.current?.contains(target) && !listRef.current?.contains(target)) {
        setOpen(false);
      }
    }

    updatePosition();
    document.addEventListener("pointerdown", closeOnOutsidePointer);
    window.addEventListener("resize", updatePosition);
    window.addEventListener("scroll", updatePosition, true);
    return () => {
      document.removeEventListener("pointerdown", closeOnOutsidePointer);
      window.removeEventListener("resize", updatePosition);
      window.removeEventListener("scroll", updatePosition, true);
    };
  }, [open]);

  useEffect(() => {
    if (!open || !activeOption) return;
    optionRefs.current.get(activeOption)?.scrollIntoView({ block: "nearest" });
  }, [activeOption, open]);

  function showOptions() {
    const nearest = nearestTimeOption(draft);
    const initialIndex = TIME_OPTIONS.indexOf(nearest);
    setFilterActive(false);
    setActiveIndex(initialIndex);
    setOpen(true);
  }

  function selectOption(time: string) {
    setDraft(time);
    onChange(time);
    setTouched(false);
    setFilterActive(false);
    setOpen(false);
  }

  function handleInputChange(nextValue: string) {
    setDraft(nextValue);
    setTouched(false);
    setFilterActive(true);
    onChange(nextValue);
    const filtered = filterTimeOptions(TIME_OPTIONS, nextValue);
    setActiveIndex(Math.max(0, filtered.indexOf(nearestTimeOption(nextValue))));
    setOpen(true);
  }

  function handleKeyDown(event: ReactKeyboardEvent<HTMLInputElement>) {
    if (event.key === "Escape") {
      setOpen(false);
      return;
    }
    if (event.key === "ArrowDown" || event.key === "ArrowUp") {
      event.preventDefault();
      if (!open) {
        showOptions();
        return;
      }
      if (options.length) {
        setActiveIndex((index) => event.key === "ArrowDown"
          ? (index + 1) % options.length
          : (index - 1 + options.length) % options.length);
      }
      return;
    }
    if (event.key === "Enter" && open && activeOption) {
      event.preventDefault();
      selectOption(activeOption);
    }
  }

  return (
    <div ref={rootRef} className="relative mt-1.5">
      <div className="relative">
        <input
          type="text"
          inputMode="text"
          autoComplete="off"
          role="combobox"
          aria-label={label}
          aria-autocomplete="list"
          aria-controls={listId}
          aria-expanded={open}
          aria-owns={open ? listId : undefined}
          aria-activedescendant={open && activeOption ? `${listId}-${activeOption.replace(":", "-")}` : undefined}
          aria-invalid={Boolean(error)}
          aria-describedby={error ? `${listId}-error` : undefined}
          pattern="([01][0-9]|2[0-3]):[0-5][0-9]"
          title="Escribe una hora válida en formato de 24 horas (HH:mm)."
          placeholder="HH:mm"
          maxLength={5}
          required={required}
          value={draft}
          onFocus={showOptions}
          onClick={showOptions}
          onBlur={() => setTouched(true)}
          onChange={(event) => handleInputChange(event.target.value)}
          onKeyDown={handleKeyDown}
          className={`${inputClassName} pr-10 ${error ? "border-rose-400 focus:border-rose-500 focus:ring-rose-100" : ""}`}
        />
        <button
          type="button"
          aria-label={`Mostrar opciones de ${label}`}
          aria-haspopup="listbox"
          aria-expanded={open}
          aria-controls={listId}
          onMouseDown={(event) => event.preventDefault()}
          onClick={() => open ? setOpen(false) : showOptions()}
          className="absolute inset-y-1.5 right-1.5 grid w-8 place-items-center rounded-lg text-slate-500 hover:bg-slate-100"
        >
          <ChevronDown size={15} />
        </button>
      </div>
      {error ? <p id={`${listId}-error`} role="alert" className="mt-1 text-[10px] font-medium text-rose-700">{error}</p> : null}
      {open && position && typeof document !== "undefined" ? createPortal(
        <div
          ref={listRef}
          id={listId}
          role="listbox"
          aria-label={`Opciones de ${label}`}
          className="fixed z-[100] overflow-y-auto overscroll-contain rounded-xl border border-slate-200 bg-white p-1 shadow-xl"
          style={{ top: position.top, left: position.left, width: position.width, maxHeight: position.maxHeight }}
        >
          {options.length ? options.map((time) => (
            <div
              id={`${listId}-${time.replace(":", "-")}`}
              ref={(element) => { if (element) optionRefs.current.set(time, element); else optionRefs.current.delete(time); }}
              role="option"
              aria-selected={time === value}
              key={time}
              onPointerDown={(event) => event.preventDefault()}
              onClick={() => selectOption(time)}
              className={`cursor-pointer rounded-lg px-3 py-2 text-left text-sm hover:bg-blue-50 ${time === value ? "bg-blue-50 font-semibold text-blue-800" : "text-slate-700"}`}
            >
              {formatTime12Hour(time)}
            </div>
          )) : <p className="px-3 py-2 text-xs text-slate-500">Sin coincidencias. Puedes escribir una hora exacta en formato HH:mm.</p>}
        </div>,
        document.body,
      ) : null}
    </div>
  );
}
