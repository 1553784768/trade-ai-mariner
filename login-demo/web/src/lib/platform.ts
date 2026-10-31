export const isMac = () => typeof navigator !== "undefined" && /Mac/.test(navigator.platform);
export const modifierLabel = () => (isMac() ? "⌘" : "Ctrl");
