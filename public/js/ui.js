/**
 * ui.js – Piccoli helper condivisi dalle pagine (escape, sigle ruolo, etichette forma, icone)
 */

export const esc = str => String(str ?? "").replace(/[&<>"']/g, c => ({
  "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;",
}[c]));

export const ROLES = {
  portiere:       { code: "POR", label: "Portiere" },
  difensore:      { code: "DIF", label: "Difensore" },
  centrocampista: { code: "CEN", label: "Centrocampista" },
  attaccante:     { code: "ATT", label: "Attaccante" },
};
export const ROLE_ORDER = ["portiere", "difensore", "centrocampista", "attaccante"];

/** Sigla colorata del ruolo, es. <span class="role-chip role-chip--portiere">POR</span> */
export function roleChip(role, extra = "") {
  const r = ROLES[role];
  return `<span class="role-chip role-chip--${r ? role : "x"} ${extra}" title="${r ? r.label : "Ruolo"}">${r ? r.code : "?"}</span>`;
}

export const FORMA = {
  infortunato:  { label: "Infortunato",  short: "Infort.",  cls: "forma--red",    delta: -2.5 },
  scarsa_forma: { label: "Scarsa forma", short: "Scarsa",   cls: "forma--orange", delta: -1.0 },
  normale:      { label: "Normale",      short: "Normale",  cls: "forma--grey",   delta: 0 },
  in_forma:     { label: "In forma",     short: "In forma", cls: "forma--green",  delta: 1.0 },
  grande_forma: { label: "Grande forma", short: "Grande",   cls: "forma--gold",   delta: 2.0 },
};

/** Icone a tratto singolo (stroke 1.7), ereditano il colore dal testo */
const svg = (d, extra = "") =>
  `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" ${extra}>${d}</svg>`;

export const ICON = {
  search:   svg('<circle cx="11" cy="11" r="6.5"/><path d="M16 16l4.5 4.5"/>'),
  lock:     svg('<rect x="5" y="11" width="14" height="9" rx="2"/><path d="M8 11V8a4 4 0 018 0v3"/>'),
  unlock:   svg('<rect x="5" y="11" width="14" height="9" rx="2"/><path d="M8 11V8a4 4 0 017.5-1.9"/>'),
  download: svg('<path d="M12 4v11M7.5 10.5L12 15l4.5-4.5M5 19.5h14"/>'),
  share:    svg('<path d="M12 15V4M8 7.5L12 3.5l4 4"/><path d="M6 11H5.5A1.5 1.5 0 004 12.5v6A1.5 1.5 0 005.5 20h13a1.5 1.5 0 001.5-1.5v-6a1.5 1.5 0 00-1.5-1.5H18"/>'),
  arrow:    svg('<path d="M5 12h14M13 6l6 6-6 6"/>'),
};
