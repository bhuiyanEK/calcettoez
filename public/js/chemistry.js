/**
 * chemistry.js – Gestione matrice intesa tra giocatori
 * Usato dentro matchmaker.html via import
 */

const CHEM_LABELS = {
  0: { text:"–",            cls:"chem-0" },
  1: { text:"Di vista",     cls:"chem-1" },
  2: { text:"Avversari",    cls:"chem-2" },
  3: { text:"Compagni",     cls:"chem-3" },
  4: { text:"Perfetti",     cls:"chem-4" },
};

export async function loadChemistryMatrix(container) {
  const { players, chemistry } = await fetch("/chemistry/matrix").then(r => r.json());

  if (players.length < 2) {
    container.innerHTML = `<p class="empty-state">Aggiungi almeno 2 giocatori per impostare l'intesa.</p>`;
    return;
  }

  // Build table
  let html = `<div class="chem-scroll"><table class="chem-table">
    <thead><tr><th></th>`;
  for (const p of players) html += `<th class="chem-th" title="${p.nickname}">${p.nickname}</th>`;
  html += `</tr></thead><tbody>`;

  for (const pA of players) {
    html += `<tr><td class="chem-row-label">${pA.nickname}</td>`;
    for (const pB of players) {
      if (pA.id === pB.id) {
        html += `<td class="chem-cell chem-self">·</td>`;
      } else {
        const key   = [pA.id, pB.id].sort().join(":");
        const level = chemistry[key] ?? 0;
        const lbl   = CHEM_LABELS[level];
        html += `
          <td class="chem-cell">
            <select class="chem-select ${lbl.cls}"
              data-a="${pA.id}" data-b="${pB.id}"
              title="${pA.nickname} ↔ ${pB.nickname}">
              ${[0,1,2,3,4].map(v =>
                `<option value="${v}" ${v===level?"selected":""}>${v} – ${CHEM_LABELS[v].text}</option>`
              ).join("")}
            </select>
          </td>`;
      }
    }
    html += `</tr>`;
  }
  html += `</tbody></table></div>`;
  container.innerHTML = html;

  // Events — debounced save
  let saveTimer = null;
  container.querySelectorAll(".chem-select").forEach(sel => {
    sel.addEventListener("change", () => {
      // Update select style immediately
      sel.className = `chem-select ${CHEM_LABELS[Number(sel.value)].cls}`;
      clearTimeout(saveTimer);
      saveTimer = setTimeout(async () => {
        await fetch(`/chemistry/${sel.dataset.a}/${sel.dataset.b}`, {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ level: Number(sel.value) }),
        });
        // Mirror the symmetric cell
        const mirror = container.querySelector(`[data-a="${sel.dataset.b}"][data-b="${sel.dataset.a}"]`);
        if (mirror) {
          mirror.value = sel.value;
          mirror.className = `chem-select ${CHEM_LABELS[Number(sel.value)].cls}`;
        }
      }, 300);
    });
  });
}
