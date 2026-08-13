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
  "w-full rounded-xl border border-white/50 bg-white/40 px-3.5 py-2.5 text-base text-slate-900 outline-none focus:border-accent focus:bg-white focus:ring-2 focus:ring-accent/20";

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
