/** Escapes typed text for nvim_input (only `<` is special). */
export function textToNvimKeys(text: string): string {
  return text.replace(/</g, '<lt>').replace(/\r?\n/g, '<CR>');
}
