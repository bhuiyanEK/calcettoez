/**
 * api.js – Centralizza tutte le chiamate fetch
 */

async function request(method, endpoint, body = null) {
  const opts = { method, headers: { "Content-Type": "application/json" } };
  if (body !== null) opts.body = JSON.stringify(body);
  const res  = await fetch(endpoint, opts);
  const data = await res.json();
  if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`);
  return data;
}

export const PlayersAPI = {
  getAll:        ()         => request("GET",    "/players"),
  getById:       (id)       => request("GET",    `/players/${id}`),
  create:        (payload)  => request("POST",   "/players", payload),
  update:        (id, p)    => request("PUT",    `/players/${id}`, p),
  remove:        (id)       => request("DELETE", `/players/${id}`),
  updateForma:   (id, forma)=> request("PUT",    `/players/${id}`, { formaAttuale: forma }),
  importCSV:     (csvContent) => request("POST", "/players/import", { csvContent }),
  templateURL:   ()         => "/players/template",
};

export const MatchAPI = {
  generateTeams: (playerIds) => request("POST", "/match", { playerIds }),
};

export const ReportAPI = {
  save:          (payload)  => request("POST",   "/report",        payload),
  getHistory:    ()         => request("GET",    "/matches"),
  update:        (id, p)    => request("PUT",    `/matches/${id}`, p),
  remove:        (id)       => request("DELETE", `/matches/${id}`),
};

export const MetaAPI = {
  getRoleWeights: () => request("GET", "/role-weights"),
  getFormaOptions: () => request("GET", "/forma-options"),
};
