import type { CSSProperties, ReactNode } from "react";
import { sectionHeader } from "../../styles/shared.js";

export const formLabelStyle: CSSProperties = {
  ...sectionHeader,
  display: "block",
  marginBottom: "5px",
};

interface FormFieldProps {
  id: string;
  label: ReactNode;
  children: ReactNode;
}

/**
 * Label + input wrapper. Keeps field markup consistent across forms.
 * Children should be the actual input/select/textarea with matching id.
 */
export function FormField({ id, label, children }: FormFieldProps) {
  return (
    <div>
      <label htmlFor={id} style={formLabelStyle}>{label}</label>
      {children}
    </div>
  );
}
