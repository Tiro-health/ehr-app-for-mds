export const FIELD_INVALID_CLASSES =
  'aria-invalid:border-destructive aria-invalid:ring-1 aria-invalid:ring-destructive/20'

/** For a control that draws its own border (`Input`, `SelectTrigger`, `ComboboxInput`, …). */
export const FIELD_STATE_CLASSES = `focus-visible:ring-1 focus-visible:ring-ring focus-visible:outline-none disabled:cursor-not-allowed disabled:opacity-50 readonly:bg-muted readonly:shadow-none readonly:focus:ring-1 readonly:focus:ring-ring ${FIELD_INVALID_CLASSES}`

/** For a bordered wrapper around a borderless control (`MultiSelect` chips, `ColorPicker`). */
export const FIELD_GROUP_STATE_CLASSES =
  'has-focus-visible:ring-1 has-focus-visible:ring-ring has-disabled:cursor-not-allowed has-disabled:opacity-50 has-readonly:bg-muted has-readonly:shadow-none has-readonly:has-focus:ring-1 has-readonly:has-focus:ring-ring has-aria-invalid:border-destructive has-aria-invalid:ring-1 has-aria-invalid:ring-destructive/20'

/** Invalid state for an `InputGroup` frame, keyed to its `input-group-control` child. */
export const INPUT_GROUP_INVALID_CLASSES =
  'has-[[data-slot=input-group-control][aria-invalid=true]]:border-destructive has-[[data-slot=input-group-control][aria-invalid=true]]:ring-1 has-[[data-slot=input-group-control][aria-invalid=true]]:ring-destructive/20'

/** For a chip frame a `Combobox` shows through `renderSelected`, which replaces its input. */
export const FIELD_CHIP_STATE_CLASSES = 'in-data-readonly:bg-muted in-data-readonly:shadow-none'
