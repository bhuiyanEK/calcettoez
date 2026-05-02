"use strict";

require("dotenv").config({ path: require("path").join(__dirname, "../.env") });

const express = require("express");
const path    = require("path");
const { v4: uuidv4 } = require("uuid");

const db = require("./db");
const { simulatedAnnealing, teamStrength, getChem: getSAchem, chemKey, CHEMISTRY_BONUS }
  = require("./sa-matchmaker");
const { generateSuggestions } = require("./chemistry-engine");
const { authMiddleware, loginHandler } = require("./auth");

const app  = express();
const PORT = process.env.PORT || 3000;

app.use(express.json({ limit: "2mb" }));
app.use(express.static(path.join(__dirname, "../public")));
app.post("/__login", loginHandler);
//app.use(authMiddleware);

// ─────────────────────────────────────────────
// Constants
// ─────────────────────────────────────────────
const ROLE_WEIGHTS = {
  portiere:       { velocita:.10, tiro:.05, passaggio:.15, difesa:.45, fisico:.20, dribbling:.05 },
  difensore:      { velocita:.15, tiro:.05, passaggio:.15, difesa:.35, fisico:.20, dribbling:.10 },
  centrocampista: { velocita:.15, tiro:.15, passaggio:.25, difesa:.15, fisico:.15, dribbling:.15 },
  attaccante:     { velocita:.20, tiro:.30, passaggio:.10, difesa:.05, fisico:.15, dribbling:.20 },
};
const ROLE_STAT_BIAS = {
  portiere:       { velocita:-.5, tiro:-1.5, passaggio:0,   difesa:+2,  fisico:+.5, dribbling:-1.5 },
  difensore:      { velocita:0,   tiro:-.5,  passaggio:0,   difesa:+1.5,fisico:+.5, dribbling:-.5  },
  centrocampista: { velocita:0,   tiro:0,    passaggio:+1,  difesa:0,   fisico:0,   dribbling:+.5  },
  attaccante:     { velocita:+1,  tiro:+1.5, passaggio:-.5, difesa:-1.5,fisico:0,   dribbling:+1   },
};
const LIVELLO_BASE = { scarso:3.5, discreto:5.0, buono:6.5, ottimo:8.0, fenomeno:9.5 };
const FORMA_DELTA  = { infortunato:-2.5, scarsa_forma:-1.0, normale:0.0, in_forma:+1.0, grande_forma:+2.0 };
const VALID_ROLES  = Object.keys(ROLE_WEIGHTS);
const VALID_FORMA  = Object.keys(FORMA_DELTA);
const STAT_KEYS    = ["velocita","tiro","passaggio","difesa","fisico","dribbling"];
const FORMATION    = ["portiere","difensore","centrocampista","centrocampista","attaccante"];

// ─────────────────────────────────────────────
// Pure helpers
// ─────────────────────────────────────────────
const clamp           = v => Math.min(10, Math.max(0, Math.round(v * 10) / 10));
const calcRoleOVR     = (stats, r) => Math.round(STAT_KEYS.reduce((s,k)=>s+ROLE_WEIGHTS[r][k]*(stats[k]??0),0)*10)/10;
const calcAllOVR      = stats => Object.fromEntries(VALID_ROLES.map(r=>[r,calcRoleOVR(stats,r)]));
const statsFromLv     = (lv,r) => { const base=LIVELLO_BASE[lv]??5,bias=ROLE_STAT_BIAS[r]??{}; return Object.fromEntries(STAT_KEYS.map(k=>[k,clamp(base+(bias[k]??0))])); };
const avgOVR          = p => VALID_ROLES.reduce((s,r)=>s+(p.ovr[r]??0),0)/VALID_ROLES.length;
const effectiveAvgOVR = p => Math.min(10,Math.max(0,avgOVR(p)+(FORMA_DELTA[p.forma_attuale]??0)));

// DB row → frontend-friendly object (snake_case → camelCase)
function toPlayer(row) {
  return {
    id:                row.id,
    name:              row.name,
    nickname:          row.nickname,
    ruoloPreferito:    row.ruolo_preferito,
    isUnknown:         row.is_unknown,
    livello:           row.livello,
    formaAttuale:      row.forma_attuale,
    presente:          row.presente,
    ovr:               row.ovr,
    stats:             row.stats,
    spiritoSacrificio: row.spirito_sacrificio,
    storico:           row.storico,
  };
}

// Frontend object → DB row
function toRow(p) {
  return {
    ruolo_preferito:    p.ruoloPreferito,
    is_unknown:         p.isUnknown,
    forma_attuale:      p.formaAttuale,
    spirito_sacrificio: p.spiritoSacrificio,
  };
}

// DB helper: throw on Supabase error
function check(result) {
  if (result.error) throw new Error(result.error.message);
  return result.data;
}

// Chemistry map from DB
async function getChemMap() {
  const rows = check(await db.from("chemistry").select("key,level"));
  return Object.fromEntries(rows.map(r=>[r.key,r.level]));
}

function computeAutoForma(playerId, matches) {
  const recent = matches
    .filter(m=>[...(m.team_a||[]),...(m.team_b||[])].includes(playerId))
    .slice(-2);
  if (!recent.length) return "normale";
  const votes = recent.map(m=>Number(m.ratings?.[playerId])).filter(Boolean);
  if (!votes.length) return "normale";
  const avg = votes.reduce((s,v)=>s+v,0)/votes.length;
  return avg>=7.5?"in_forma":avg<5.0?"scarsa_forma":"normale";
}

// ─────────────────────────────────────────────
// Role assignment (5v5)
// ─────────────────────────────────────────────
function permutations(arr) {
  if (arr.length<=1) return [arr];
  return arr.flatMap((v,i)=>permutations([...arr.slice(0,i),...arr.slice(i+1)]).map(p=>[v,...p]));
}
function assignOptimalRoles(team) {
  const idx=team.map((_,i)=>i); let best=-1,bestPerm=null;
  for (const perm of permutations(idx)) {
    let score=0;
    for(let s=0;s<FORMATION.length;s++) score+=team[perm[s]].ovr[FORMATION[s]];
    if(score>best){best=score;bestPerm=perm;}
  }
  const roleMap=new Array(5);
  for(let s=0;s<FORMATION.length;s++) roleMap[bestPerm[s]]=FORMATION[s];
  return team.map((p,i)=>({...p,assignedRole:roleMap[i],assignedRoleOVR:p.ovr[roleMap[i]]}));
}

// ─────────────────────────────────────────────
// CSV parser
// ─────────────────────────────────────────────
function parseCSV(text) {
  const lines=text.replace(/\r\n/g,"\n").replace(/\r/g,"\n").split("\n").filter(l=>l.trim());
  if(lines.length<2)return{rows:[]};
  function parseLine(line){const f=[];let cur="",inQ=false;for(let i=0;i<line.length;i++){const c=line[i];if(c==='"'){if(inQ&&line[i+1]==='"'){cur+='"';i++;}else inQ=!inQ;}else if(c===','&&!inQ){f.push(cur.trim());cur="";}else cur+=c;}f.push(cur.trim());return f;}
  const headers=parseLine(lines[0]).map(h=>h.toLowerCase().replace(/\s+/g,"_").trim());
  return{rows:lines.slice(1).map((line,i)=>{const vals=parseLine(line);const obj=Object.fromEntries(headers.map((h,j)=>[h,vals[j]??""]));obj._line=i+2;return obj;})};
}

function buildPlayerData(fields) {
  const { name, nickname, ruoloPreferito, stats, spiritoSacrificio, isUnknown, livello } = fields;
  let finalStats;
  if (isUnknown) finalStats=statsFromLv(livello,ruoloPreferito);
  else finalStats=Object.fromEntries(STAT_KEYS.map(k=>[k,Number(stats[k])]));
  return {
    id: uuidv4(), name: name.trim(), nickname: nickname.trim(),
    ruolo_preferito: ruoloPreferito, is_unknown: !!isUnknown,
    livello: isUnknown?livello:null, forma_attuale:"normale", presente:false,
    ovr: calcAllOVR(finalStats), stats: finalStats,
    spirito_sacrificio: Math.round(clamp(Number(spiritoSacrificio))),
    storico: { partite:0, goal:0, assist:0, mediaVoto:0 },
  };
}

function playerFromRow(row) {
  const errors=[];
  const name=(row.name||"").trim(), nickname=(row.nickname||"").trim();
  const ruolo=(row.ruolo_preferito||row.ruolo||"").trim().toLowerCase();
  if(!name)errors.push("'name' mancante");
  if(!nickname)errors.push("'nickname' mancante");
  if(!VALID_ROLES.includes(ruolo))errors.push(`ruolo '${ruolo}' non valido`);
  const spirit=Number(row.spirito_sacrificio);
  if(isNaN(spirit)||spirit<1||spirit>10)errors.push("spirito_sacrificio 1–10");
  const isUnknown=["true","1","si","sì","yes"].includes((row.sconosciuto||"").toLowerCase());
  let stats,livello=null;
  if(isUnknown){livello=(row.livello||"discreto").toLowerCase();if(!LIVELLO_BASE[livello])errors.push(`livello '${livello}' non valido`);else stats={};}
  else{const p={};for(const k of STAT_KEYS){const v=Number(row[k]);if(isNaN(v)||v<0||v>10)errors.push(`stat '${k}' non valida`);else p[k]=v;}if(!errors.length)stats=p;}
  if(errors.length)return{ok:false,errors};
  return{ok:true,player:buildPlayerData({name,nickname,ruoloPreferito:ruolo,stats,spiritoSacrificio:spirit,isUnknown,livello})};
}

// ─────────────────────────────────────────────
// PLAYERS – CRUD
// ─────────────────────────────────────────────
app.get("/players", async (_,res) => {
  try {
    const rows = check(await db.from("players").select("*").order("created_at"));
    res.json(rows.map(toPlayer));
  } catch(err){res.status(500).json({error:err.message});}
});

app.get("/players/:id", async (req,res) => {
  try {
    const rows = check(await db.from("players").select("*").eq("id",req.params.id));
    if(!rows.length)return res.status(404).json({error:"Non trovato."});
    res.json(toPlayer(rows[0]));
  } catch(err){res.status(500).json({error:err.message});}
});

app.post("/players", async (req,res) => {
  try {
    const {name,nickname,ruoloPreferito,stats,spiritoSacrificio,isUnknown,livello}=req.body;
    if(!name||!nickname)return res.status(400).json({error:"name e nickname obbligatori."});
    if(!VALID_ROLES.includes(ruoloPreferito))return res.status(400).json({error:"Ruolo non valido."});
    if(spiritoSacrificio===undefined)return res.status(400).json({error:"spiritoSacrificio obbligatorio."});
    if(isUnknown){if(!LIVELLO_BASE[livello])return res.status(400).json({error:"Livello non valido."});}
    else{for(const k of STAT_KEYS){const v=Number(stats?.[k]);if(isNaN(v)||v<0||v>10)return res.status(400).json({error:`Stat '${k}' non valida.`});}}
    const data=buildPlayerData({name,nickname,ruoloPreferito,stats,spiritoSacrificio,isUnknown,livello});
    const rows=check(await db.from("players").insert(data).select());
    res.status(201).json(toPlayer(rows[0]));
  } catch(err){res.status(500).json({error:err.message});}
});

app.put("/players/:id", async (req,res) => {
  try {
    const existing=check(await db.from("players").select("*").eq("id",req.params.id));
    if(!existing.length)return res.status(404).json({error:"Non trovato."});
    const ex=existing[0];
    const {name,nickname,ruoloPreferito,stats,spiritoSacrificio,isUnknown,livello,formaAttuale,presente}=req.body;
    if(ruoloPreferito&&!VALID_ROLES.includes(ruoloPreferito))return res.status(400).json({error:"Ruolo non valido."});
    if(formaAttuale&&!VALID_FORMA.includes(formaAttuale))return res.status(400).json({error:"Forma non valida."});
    const nowUnknown=isUnknown!==undefined?!!isUnknown:ex.is_unknown;
    let finalStats={...ex.stats};
    if(nowUnknown&&livello&&LIVELLO_BASE[livello])finalStats=statsFromLv(livello,ruoloPreferito||ex.ruolo_preferito);
    else if(!nowUnknown&&stats){for(const k of STAT_KEYS)if(stats[k]!==undefined)finalStats[k]=clamp(Number(stats[k]));}
    const patch={
      ...(name      &&{name:name.trim()}),
      ...(nickname  &&{nickname:nickname.trim()}),
      ...(ruoloPreferito&&{ruolo_preferito:ruoloPreferito}),
      is_unknown:nowUnknown, livello:nowUnknown?(livello||ex.livello):null,
      ...(VALID_FORMA.includes(formaAttuale)&&{forma_attuale:formaAttuale}),
      ...(presente!==undefined&&{presente:!!presente}),
      stats:finalStats, ovr:calcAllOVR(finalStats),
      ...(spiritoSacrificio!==undefined&&{spirito_sacrificio:Math.round(clamp(Number(spiritoSacrificio)))}),
    };
    const rows=check(await db.from("players").update(patch).eq("id",req.params.id).select());
    res.json(toPlayer(rows[0]));
  } catch(err){res.status(500).json({error:err.message});}
});

app.delete("/players/:id", async (req,res) => {
  try {
    const rows=check(await db.from("players").select("nickname").eq("id",req.params.id));
    if(!rows.length)return res.status(404).json({error:"Non trovato."});
    await Promise.all([
      db.from("players").delete().eq("id",req.params.id),
      db.from("chemistry").delete().like("key",`%${req.params.id}%`),
      db.from("suggestions").delete().or(`id_a.eq.${req.params.id},id_b.eq.${req.params.id}`),
    ]);
    res.json({message:`"${rows[0].nickname}" eliminato.`});
  } catch(err){res.status(500).json({error:err.message});}
});

app.post("/players/presence", async (req,res) => {
  try {
    const {presentIds}=req.body;
    if(!Array.isArray(presentIds))return res.status(400).json({error:"presentIds array obbligatorio."});
    await db.from("players").update({presente:false}).neq("id","");
    if(presentIds.length)await db.from("players").update({presente:true}).in("id",presentIds);
    res.json({updated:true});
  } catch(err){res.status(500).json({error:err.message});}
});

// ─────────────────────────────────────────────
// CSV
// ─────────────────────────────────────────────
app.post("/players/import", async (req,res) => {
  try {
    const {csvContent}=req.body;
    if(!csvContent)return res.status(400).json({error:"csvContent mancante."});
    const {rows}=parseCSV(csvContent);
    if(!rows.length)return res.status(400).json({error:"CSV vuoto."});
    const result={imported:[],errors:[]};
    for(const row of rows){
      const r=playerFromRow(row);
      if(!r.ok){result.errors.push({line:row._line,messages:r.errors});continue;}
      check(await db.from("players").insert(r.player));
      result.imported.push({id:r.player.id,name:r.player.name,nickname:r.player.nickname});
    }
    res.json(result);
  } catch(err){res.status(500).json({error:err.message});}
});

app.get("/players/template",(_,res)=>{
  const rows=["name,nickname,ruolo_preferito,spirito_sacrificio,sconosciuto,livello,velocita,tiro,passaggio,difesa,fisico,dribbling","Marco Rossi,Rozzo,attaccante,7,false,,8,8.5,7,5.5,7.5,8.5","Nuovo Tizio,Tigre,centrocampista,6,true,buono,,,,,,"];
  res.setHeader("Content-Type","text/csv;charset=utf-8");res.setHeader("Content-Disposition",'attachment;filename="giocatori_template.csv"');res.send(rows.join("\n"));
});

// ─────────────────────────────────────────────
// CHEMISTRY
// ─────────────────────────────────────────────
app.get("/chemistry",async(_,res)=>{try{res.json(await getChemMap());}catch(err){res.status(500).json({error:err.message});}});

app.get("/chemistry/matrix",async(_,res)=>{
  try{
    const [playerRows,chemMap]=await Promise.all([db.from("players").select("id,nickname"),getChemMap()]);
    res.json({players:check(playerRows).map(p=>({id:p.id,nickname:p.nickname})),chemistry:chemMap});
  }catch(err){res.status(500).json({error:err.message});}
});

app.put("/chemistry/:idA/:idB",async(req,res)=>{
  try{
    const{idA,idB}=req.params;const level=Number(req.body.level);
    if(![0,1,2,3,4].includes(level))return res.status(400).json({error:"Level 0–4."});
    if(idA===idB)return res.status(400).json({error:"Stesso giocatore."});
    const key=chemKey(idA,idB);
    if(level===0)await db.from("chemistry").delete().eq("key",key);
    else check(await db.from("chemistry").upsert({key,level},{onConflict:"key"}));
    res.json({key,level});
  }catch(err){res.status(500).json({error:err.message});}
});

// ─────────────────────────────────────────────
// SUGGESTIONS
// ─────────────────────────────────────────────
app.get("/suggestions",async(_,res)=>{try{res.json(check(await db.from("suggestions").select("*").eq("status","pending")));}catch(err){res.status(500).json({error:err.message});}});

app.post("/suggestions/:id/accept",async(req,res)=>{
  try{
    const rows=check(await db.from("suggestions").select("*").eq("id",req.params.id));
    if(!rows.length)return res.status(404).json({error:"Non trovato."});
    const sug=rows[0];
    await db.from("suggestions").update({status:"accepted"}).eq("id",sug.id);
    const key=chemKey(sug.id_a,sug.id_b);
    if(sug.suggested_level===0)await db.from("chemistry").delete().eq("key",key);
    else check(await db.from("chemistry").upsert({key,level:sug.suggested_level},{onConflict:"key"}));
    res.json({message:`Intesa aggiornata a ${sug.suggested_level}.`});
  }catch(err){res.status(500).json({error:err.message});}
});

app.post("/suggestions/:id/dismiss",async(req,res)=>{
  try{await db.from("suggestions").update({status:"dismissed"}).eq("id",req.params.id);res.json({message:"Ignorato."});}
  catch(err){res.status(500).json({error:err.message});}
});

// ─────────────────────────────────────────────
// MATCHMAKING
// ─────────────────────────────────────────────
app.get("/match/autoselect",async(_,res)=>{
  try{
    const rows=check(await db.from("players").select("*").eq("presente",true));
    if(rows.length<10)return res.status(400).json({error:`Solo ${rows.length} presenti. Minimo 10.`});
    const k=rows.length%2===0?rows.length:rows.length-1;
    const sorted=[...rows].sort((a,b)=>b.storico.partite-a.storico.partite);
    res.json({selected:sorted.slice(0,k).map(p=>p.id),count:k,dropped:sorted.slice(k).map(p=>({id:p.id,nickname:p.nickname}))});
  }catch(err){res.status(500).json({error:err.message});}
});

app.post("/match",async(req,res)=>{
  try{
    const{playerIds}=req.body;
    if(!Array.isArray(playerIds)||playerIds.length<10||playerIds.length%2!==0)
      return res.status(400).json({error:"Numero pari ≥ 10."});
    const[playerRows,chemMap]=await Promise.all([
      db.from("players").select("*").in("id",playerIds),
      getChemMap(),
    ]);
    const players=check(playerRows).map(toPlayer);
    if(players.length!==playerIds.length)return res.status(400).json({error:"Giocatori non trovati."});

    const{teamA,teamB,energy:finalEnergy}=simulatedAnnealing(players,effectiveAvgOVR,chemMap);
    let assignedA,assignedB;
    if(teamA.length===5){assignedA=assignOptimalRoles(teamA);assignedB=assignOptimalRoles(teamB);}
    else{assignedA=teamA.map(p=>({...p,assignedRole:p.ruoloPreferito,assignedRoleOVR:effectiveAvgOVR(p)}));assignedB=teamB.map(p=>({...p,assignedRole:p.ruoloPreferito,assignedRoleOVR:effectiveAvgOVR(p)}));}

    const strA=teamStrength(teamA,effectiveAvgOVR,chemMap);
    const strB=teamStrength(teamB,effectiveAvgOVR,chemMap);
    const chemBreakdown=team=>{const pairs=[];for(let i=0;i<team.length;i++)for(let j=i+1;j<team.length;j++){const c=getSAchem(chemMap,team[i].id,team[j].id);if(c>0)pairs.push({a:team[i].nickname,b:team[j].nickname,level:c,bonus:CHEMISTRY_BONUS[c]});}return pairs;};

    res.json({teamA:assignedA,teamB:assignedB,strengthA:Math.round(strA*10)/10,strengthB:Math.round(strB*10)/10,chemistryA:chemBreakdown(teamA),chemistryB:chemBreakdown(teamB),saEnergy:Math.round(finalEnergy*100)/100});
  }catch(err){res.status(500).json({error:err.message});}
});

// ─────────────────────────────────────────────
// REPORT
// ─────────────────────────────────────────────
app.post("/report",async(req,res)=>{
  try{
    const{scoreA,scoreB,teamA,teamB,ratings,goals,assists}=req.body;
    if(scoreA===undefined||scoreB===undefined||!Array.isArray(teamA)||!Array.isArray(teamB)||typeof ratings!=="object")
      return res.status(400).json({error:"Dati incompleti."});

    const allIds=[...teamA,...teamB];
    const playerRows=check(await db.from("players").select("*").in("id",allIds));

    const updates=[];
    for(const row of playerRows){
      const p=toPlayer(row);
      const rating=Number(ratings[p.id]);
      if(!rating||rating<1||rating>10)return res.status(400).json({error:`Voto non valido per "${p.nickname}".`});

      const{partite:pp,mediaVoto:pm}=p.storico;const np=pp+1;
      const newStorico={
        partite:np,
        goal:p.storico.goal+(Number(goals?.[p.id])||0),
        assist:p.storico.assist+(Number(assists?.[p.id])||0),
        mediaVoto:Math.round(((pm*pp+rating)/np)*10)/10,
      };
      let newStats={...p.stats};
      let delta=0;if(rating>7.5)delta=0.2;else if(rating<5)delta=-0.2;
      if(delta!==0){for(const k of STAT_KEYS)newStats[k]=clamp(newStats[k]+delta);}
      const newIsUnknown=p.isUnknown&&np>=3?false:p.isUnknown;
      updates.push({id:p.id,stats:newStats,ovr:calcAllOVR(newStats),storico:newStorico,is_unknown:newIsUnknown});
    }

    // Save match
    const matchRecord={
      id:uuidv4(),date:new Date().toISOString(),
      score_a:scoreA,score_b:scoreB,
      team_a:teamA,team_b:teamB,
      ratings,goals:goals||{},assists:assists||{},
    };

    // Compute auto-forma from last 2 matches per player
    const recentMatches=check(await db.from("matches").select("team_a,team_b,ratings").order("date",{ascending:false}).limit(10));
    const allMatchesForForma=[matchRecord,...recentMatches.map(m=>({team_a:m.team_a,team_b:m.team_b,ratings:m.ratings}))];
    for(const upd of updates){
      upd.forma_attuale=computeAutoForma(upd.id,allMatchesForForma.map(m=>({team_a:m.team_a,team_b:m.team_b,ratings:m.ratings})));
    }

    await Promise.all([
      ...updates.map(u=>db.from("players").update({stats:u.stats,ovr:u.ovr,storico:u.storico,is_unknown:u.is_unknown,forma_attuale:u.forma_attuale}).eq("id",u.id)),
      db.from("matches").insert(matchRecord),
    ]);

    // Chemistry suggestions
    const[allPlayers,chemMap,existingSuggs,allMatches]=await Promise.all([
      db.from("players").select("*"),
      getChemMap(),
      db.from("suggestions").select("*"),
      db.from("matches").select("team_a,team_b,ratings").order("date",{ascending:false}).limit(20),
    ]);
    const playersPlain=check(allPlayers).map(r=>({...toPlayer(r)}));
    const matchesPlain=check(allMatches).map(m=>({teamA:m.team_a,teamB:m.team_b,ratings:m.ratings}));
    const existingPlain=check(existingSuggs).map(s=>({idA:s.id_a,idB:s.id_b,suggestedLevel:s.suggested_level,status:s.status}));

    const newSuggs=generateSuggestions(matchesPlain,chemMap,existingPlain,playersPlain);
    if(newSuggs.length){
      await db.from("suggestions").insert(newSuggs.map(s=>({
        id:s.id,id_a:s.idA,id_b:s.idB,nickname_a:s.nicknameA,nickname_b:s.nicknameB,
        current_level:s.currentLevel,suggested_level:s.suggestedLevel,reason:s.reason,
        games_together:s.gamesTogther,games_against:s.gamesAgainst,
        created_at:s.createdAt,status:"pending",
      })));
    }

    res.json({message:"Report salvato.",newSuggestions:newSuggs.length});
  }catch(err){res.status(500).json({error:err.message});}
});

app.get("/matches",async(_,res)=>{try{res.json(check(await db.from("matches").select("*").order("date",{ascending:false})));}catch(err){res.status(500).json({error:err.message});}});
app.get("/role-weights",(_,res)=>res.json(ROLE_WEIGHTS));
app.get("/forma-options",(_,res)=>res.json(FORMA_DELTA));

// ─────────────────────────────────────────────
// Start
// ─────────────────────────────────────────────
app.listen(PORT,()=>console.log(`\n🟢  FantaCalcetto Manager → http://localhost:${PORT}\n`));
