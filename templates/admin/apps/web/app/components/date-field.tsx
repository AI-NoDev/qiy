import { DatePicker, TimePicker } from "antd";
import { fieldPickerFormat, toFormValue, toPayloadValue, type DateFieldType } from "../date-fields";

/**
 * Ant Design picker for a Date, Time or DateTime form field.
 *
 * `Form.Item` injects `value` (the stored server string) and `onChange`; this
 * component converts between that contract and the dayjs value the picker needs,
 * then forwards the change back as a contract string. Keeping the conversion
 * inside `value`/`onChange` means the form store always holds what the API
 * accepts, so required rules and edit-form initial values keep working.
 */
export function DateFieldInput({
  type,
  value,
  onChange,
  placeholder,
  disabled,
}: {
  type: DateFieldType;
  /** Stored value injected by Form.Item (`YYYY-MM-DD`, `HH:mm:ss` or an ISO date-time). */
  value?: string | null;
  /** Form.Item setter; receives the contract string or null when cleared. */
  onChange?: (next: string | null) => void;
  placeholder?: string;
  disabled?: boolean;
}) {
  const pickerValue = toFormValue(type, value);
  const handleChange = (next: unknown) => onChange?.(toPayloadValue(type, next as never));
  if (type === "Time") {
    return <TimePicker style={{ width: "100%" }} format={fieldPickerFormat.Time} value={pickerValue} onChange={handleChange} placeholder={placeholder ?? fieldPickerFormat.Time} disabled={disabled} />;
  }
  return (
    <DatePicker
      style={{ width: "100%" }}
      showTime={type === "DateTime" ? { format: "HH:mm:ss" } : false}
      format={fieldPickerFormat[type]}
      value={pickerValue}
      onChange={handleChange}
      placeholder={placeholder ?? fieldPickerFormat[type]}
      disabled={disabled}
    />
  );
}
