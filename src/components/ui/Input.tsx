import type { InputHTMLAttributes, TextareaHTMLAttributes } from "react";

interface FieldWrapperProps {
  label?: string;
  children: React.ReactNode;
}

function FieldWrapper({ label, children }: FieldWrapperProps) {
  return (
    <label className="block">
      {label && <span className="mb-1.5 block text-sm font-medium text-slate-600">{label}</span>}
      {children}
    </label>
  );
}

const fieldClasses =
  "spatial-field w-full min-h-11 rounded-[2px] border border-white/55 bg-white/32 px-3.5 py-2.5 text-base text-slate-900 shadow-[inset_0_1px_0_rgba(255,255,255,.55)] outline-none placeholder:text-slate-400 focus:border-accent/60 focus:bg-white/55 focus:ring-2 focus:ring-accent/15";

interface InputProps extends InputHTMLAttributes<HTMLInputElement> {
  label?: string;
}

export function Input({ label, className = "", ...props }: InputProps) {
  return (
    <FieldWrapper label={label}>
      <input className={`${fieldClasses} ${className}`} {...props} />
    </FieldWrapper>
  );
}

interface TextareaProps extends TextareaHTMLAttributes<HTMLTextAreaElement> {
  label?: string;
}

export function Textarea({ label, className = "", ...props }: TextareaProps) {
  return (
    <FieldWrapper label={label}>
      <textarea className={`${fieldClasses} resize-none ${className}`} {...props} />
    </FieldWrapper>
  );
}
