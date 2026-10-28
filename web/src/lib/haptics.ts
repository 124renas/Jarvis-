// Haptic feedback. Android/Chrome supports navigator.vibrate. iOS Safari does
// not, but since iOS 18 toggling an <input type="checkbox" switch> produces a
// system haptic tick — we use a hidden one. Must be called from a user gesture.

let enabled = true;
let label: HTMLLabelElement | null = null;

export function setHapticsEnabled(on: boolean) {
  enabled = on;
}

function iosSwitch(): HTMLLabelElement {
  if (label) return label;
  label = document.createElement("label");
  label.setAttribute("aria-hidden", "true");
  label.style.cssText = "position:fixed;left:-9999px;top:0;width:1px;height:1px;overflow:hidden;opacity:0;pointer-events:none";
  const input = document.createElement("input");
  input.type = "checkbox";
  input.setAttribute("switch", "");
  input.tabIndex = -1;
  label.appendChild(input);
  document.body.appendChild(label);
  return label;
}

export function haptic(kind: "light" | "success" | "warning" = "light") {
  if (!enabled) return;
  if ("vibrate" in navigator && typeof navigator.vibrate === "function") {
    navigator.vibrate(kind === "light" ? 8 : kind === "success" ? [10, 40, 10] : [20, 60, 20]);
    return;
  }
  try {
    iosSwitch().click();
  } catch {
    /* unsupported */
  }
}
