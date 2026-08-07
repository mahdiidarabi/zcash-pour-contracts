// Tiny DOM helpers. Screens build their markup as template strings and wire
// events by id afterwards -- with four screens that is less machinery than a
// component layer, and it stays readable to someone skimming the repo.

export function $<T extends HTMLElement>(id: string): T {
  const el = document.getElementById(id);
  if (el === null) throw new Error(`no element #${id}`);
  return el as T;
}

export function on(id: string, event: string, handler: (e: Event) => unknown): void {
  $(id).addEventListener(event, handler);
}

export function show(id: string, visible: boolean): void {
  $(id).style.display = visible ? "" : "none";
}

// Field elements are ~77 digits. Full value in the title so it can still be
// copied, abbreviated on screen so a row stays one line.
export function abbreviate(value: string, keep = 10): string {
  return value.length <= keep * 2 + 1 ? value : `${value.slice(0, keep)}…${value.slice(-keep)}`;
}

export function escapeHtml(value: string): string {
  return value.replace(/[&<>"']/g, (c) => {
    return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]!;
  });
}

export async function copy(text: string, button: HTMLElement): Promise<void> {
  await navigator.clipboard.writeText(text);
  const previous = button.textContent;
  button.textContent = "copied";
  setTimeout(() => (button.textContent = previous), 1200);
}

export function download(filename: string, contents: string): void {
  const url = URL.createObjectURL(new Blob([contents], { type: "application/json" }));
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

export function status(id: string, kind: "idle" | "working" | "ok" | "error", message: string): void {
  const el = $(id);
  el.className = `status ${kind}`;
  el.innerHTML = message;
}

// Wei <-> ETH without pulling ethers into every screen.
export function parseEth(input: string): bigint {
  const trimmed = input.trim();
  if (!/^\d*\.?\d*$/.test(trimmed) || trimmed === "" || trimmed === ".") {
    throw new Error("not a number");
  }

  const [whole, fraction = ""] = trimmed.split(".");
  if (fraction.length > 18) throw new Error("more than 18 decimals");

  return BigInt(whole || "0") * 10n ** 18n + BigInt(fraction.padEnd(18, "0") || "0");
}

export function formatEth(wei: bigint): string {
  const whole = wei / 10n ** 18n;
  const fraction = (wei % 10n ** 18n).toString().padStart(18, "0").replace(/0+$/, "");
  return fraction === "" ? `${whole}` : `${whole}.${fraction}`;
}
