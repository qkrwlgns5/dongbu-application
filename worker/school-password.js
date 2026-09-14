/**
 * Converts the exact English-keyboard equivalents of the supported Korean
 * institution-code prefixes. All other input is returned unchanged.
 *
 * @param {unknown} value
 * @returns {string}
 */
export function normalizeSchoolPasswordInput(value) {
  const password = String(value ?? "").trim().normalize("NFC");
  const englishKeyboardCode = /^(ehdek|ehdej|ehdsk|ehdsj)(\d{2,4})$/iu.exec(password);
  if (!englishKeyboardCode) return password;
  const prefixes = { ehdek: "동다", ehdej: "동더", ehdsk: "동나", ehdsj: "동너" };
  const prefix = prefixes[englishKeyboardCode[1].toLowerCase()];
  return `${prefix}${englishKeyboardCode[2]}`;
}
