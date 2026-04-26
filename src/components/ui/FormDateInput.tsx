import type { CSSProperties, InputHTMLAttributes } from "react";
import { inputStyle as sharedInputStyle } from "../../styles/shared.js";

interface FormDateInputProps extends Omit<InputHTMLAttributes<HTMLInputElement>, "type"> {
  id: string;
  style?: CSSProperties;
}

/**
 * Themed date input that uses the shared inputStyle by default.
 */
export function FormDateInput({ id, style, ...rest }: FormDateInputProps) {
  return (
    <input
      id={id}
      type="date"
      style={style ?? sharedInputStyle}
      {...rest}
    />
  );
}
