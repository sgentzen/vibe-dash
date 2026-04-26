import type { CSSProperties, ReactNode, SelectHTMLAttributes } from "react";
import { inputStyle as sharedInputStyle } from "../../styles/shared.js";

interface FormSelectProps extends SelectHTMLAttributes<HTMLSelectElement> {
  id: string;
  children: ReactNode;
  style?: CSSProperties;
}

/**
 * Themed <select> that uses the shared inputStyle by default.
 */
export function FormSelect({ id, children, style, ...rest }: FormSelectProps) {
  return (
    <select id={id} style={style ?? sharedInputStyle} {...rest}>
      {children}
    </select>
  );
}
