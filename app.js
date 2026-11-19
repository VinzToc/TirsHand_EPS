/* TirsHand — carte de tirs et projet tactique (EPS · Handball)
   100 % local : aucune donnée envoyée sur Internet. Utilise eps-core.js puis eleve-core.js (non modifiés). */
(function () {
'use strict';

const APP = 'tirshand';
const ZONES = ['Aile G', 'Arrière G', 'Centre', 'Arrière D', 'Aile D', '6 m'];
const TYPES = ['En appui', 'En suspension', 'Après course'];
const RES = ['But', 'Arrêt', 'Hors cadre'];
const EQUIPES = [1, 2, 3, 4, 5, 6, 7, 8];
const ROLES = [
  ['Marqueur', 'tient la tablette et note chaque tir'],
  ['Vidéo', 'filme et montre le ralenti au tireur'],
  ['Capitaine', 'rappelle le projet tactique pendant le match'],
  ['Observateur binôme', "élève de l'autre équipe qui co-évalue le projet"]
];
const INTENTIONS = [
  'Chercher plus de tirs à 6 m (jeu avec le pivot)',
  'Écarter le jeu pour utiliser les ailes',
  'Tirer de loin seulement quand on est démarqué',
  'Prendre le temps : moins de tirs précipités',
  'Varier la façon de tirer face au gardien',
  'Jouer plus vite (contre-attaque, tirs après course)'
];
const CONSEILS = ['Continuer ainsi', 'Tirer plus souvent dans la zone choisie', 'Mieux se démarquer avant de tirer', 'Viser les coins du but'];

/* ───────── Outils ───────── */
const $ = (s, r = document) => r.querySelector(s);
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const aujourdhui = () => { const d = new Date(); d.setMinutes(d.getMinutes() - d.getTimezoneOffset()); return d.toISOString().slice(0, 10); };
const dateFr = iso => { const [a, m, j] = String(iso).split('-'); return j ? `${j}/${m}/${a}` : iso; };
const pct = (a, b) => b ? Math.round(100 * a / b) : 0;
const lsGet = k => { try { return localStorage.getItem(k); } catch (e) { return null; } };
const lsSet = (k, v) => { try { localStorage.setItem(k, v); } catch (e) { /* stockage indisponible */ } };

function toast(html, actions) {
  const t = $('#toast');
  t.innerHTML = `<span>${html}</span>`;
  (actions || []).forEach(([lib, fn]) => {
    const b = document.createElement('button'); b.className = 'btn'; b.textContent = lib;
    b.onclick = () => { t.hidden = true; fn(); }; t.appendChild(b);
  });
  t.hidden = false;
  clearTimeout(toast.h); toast.h = setTimeout(() => { t.hidden = true; }, actions ? 6000 : 2600);
}

function confirmer(texte) {
  return new Promise(res => {
    const d = $('#confirmer'); $('#confirmer-texte').textContent = texte;
    const fin = v => { d.close(); res(v); };
    $('#confirmer-oui').onclick = () => fin(true);
    $('#confirmer-non').onclick = () => fin(false);
    d.oncancel = e => { e.preventDefault(); fin(false); };
    d.showModal();
  });
}

/* ───────── Données ─────────
   - Tirs : enregistrés ligne par ligne via ELEVE.enregistrer('tirshand', …) (exportables) + copie locale.
   - Infos de match (rôles, ressenti, repères, projet, co-évaluation) : stockage local de l'appli, par élève.
   - Élève non identifié : tout reste en mémoire et disparaît à la fermeture. */
let eleve = null;
let meta = { matchs: {}, courant: null };
let memAnon = { matchs: {}, courant: null };
let lignes = [];
let matchVu = null; // match affiché dans l'écran Bilan

const cleMeta = () => eleve ? 'tirshand_meta_' + eleve.id : null;
function chargerMeta() {
  if (!eleve) { meta = memAnon; return; }
  try { meta = JSON.parse(lsGet(cleMeta())) || { matchs: {}, courant: null }; } catch (e) { meta = { matchs: {}, courant: null }; }
  meta.matchs = meta.matchs || {};
}
function sauverMeta() { if (eleve) lsSet(cleMeta(), JSON.stringify(meta)); }

let fileCharge = Promise.resolve();
function charger() { fileCharge = fileCharge.then(chargerVraiment, chargerVraiment); return fileCharge; }
async function chargerVraiment() {
  eleve = await ELEVE.courant();
  chargerMeta();
  // L'élève s'identifie en cours de séance : on transfère ce qui a été noté sans identification
  if (eleve && Object.keys(memAnon.matchs).length) {
    const copie = memAnon; memAnon = { matchs: {}, courant: null };
    Object.assign(meta.matchs, copie.matchs);
    if (copie.courant) meta.courant = copie.courant;
    sauverMeta();
    for (const x of Object.values(copie.matchs)) for (const t of x.tirs)
      await ELEVE.enregistrer(APP, { Date: x.date, Match: x.label, 'N° tir': t.n, Zone: t.zone, 'Type de tir': t.type, 'Résultat': t.res });
  }
  lignes = eleve ? ((await ELEVE.donnees())[APP] || []) : [];
  // Matchs présents dans les saisies mais pas dans les infos locales (ex. sauvegarde restaurée sur une autre tablette)
  for (const l of lignes) {
    if (!l.Match || !l.Date) continue;
    const id = l.Date + '|' + l.Match;
    let m = meta.matchs[id];
    if (!m) {
      const mm = /Éq\.(\d+) vs Éq\.(\d+)/.exec(l.Match) || [];
      m = meta.matchs[id] = { id, date: l.Date, label: l.Match, equipe: mm[1] || '?', adv: mm[2] || '?', scoreAdv: 0, tirs: [], fini: true, roles: {}, restaure: true };
    }
    if (m.restaure) {
      if (l['N° tir'] === 'Bilan') {
        const s = String(l.Score || '').split('-');
        m.scoreAdv = +s[1] || 0;
        m.projet = m.projet || { choix: [], texte: '', phrase: l['Projet tactique'] || '' };
      } else if (ZONES.includes(l.Zone) && !m.tirs.some(t => t.n === +l['N° tir'])) {
        m.tirs.push({ n: +l['N° tir'], zone: l.Zone, type: l['Type de tir'], res: l['Résultat'] });
      }
    }
  }
  Object.values(meta.matchs).forEach(m => m.tirs.sort((a, b) => a.n - b.n));
}

const listeMatchs = () => Object.values(meta.matchs).sort((a, b) => a.date.localeCompare(b.date) || (a.cree || 0) - (b.cree || 0) || a.label.localeCompare(b.label, 'fr', { numeric: true }));
const matchCourant = () => meta.courant ? meta.matchs[meta.courant] : null;
function matchPrecedent(m) { const L = listeMatchs().filter(x => x.fini || x.id === m.id); const i = L.findIndex(x => x.id === m.id); return i > 0 ? L[i - 1] : null; }

async function remplacerLignes(fn) {
  const e = await ELEVE.courant(); if (!e) return;
  const rec = (await EPS.all()).find(x => x.id === e.id); if (!rec) return;
  const cur = ((rec.ext || {})[APP] || {}).lignes || [];
  await EPS.setExt(APP, e.id, { lignes: fn(cur) });
}

/* ───────── Statistiques ───────── */
function stats(tirs) {
  const z = {}, ty = {};
  ZONES.forEach(k => z[k] = { n: 0, buts: 0, arrets: 0, hc: 0 });
  TYPES.forEach(k => ty[k] = { n: 0, buts: 0 });
  let buts = 0, arrets = 0, hc = 0;
  for (const t of tirs) {
    const s = z[t.zone]; if (!s) continue;
    s.n++; if (ty[t.type]) ty[t.type].n++;
    if (t.res === 'But') { s.buts++; buts++; if (ty[t.type]) ty[t.type].buts++; }
    else if (t.res === 'Arrêt') { s.arrets++; arrets++; } else { s.hc++; hc++; }
  }
  return { z, ty, n: tirs.length, buts, arrets, hc };
}
function meilleureZone(st, pire) {
  let best = null;
  for (const k of ZONES) {
    const s = st.z[k]; if (s.n < 2) continue;
    const e = s.buts / s.n;
    if (!best || (pire ? e < best.e || (e === best.e && s.n > best.n) : e > best.e || (e === best.e && s.n > best.n))) best = { zone: k, e, n: s.n, buts: s.buts };
  }
  return best;
}

/* ───────── Terrain (SVG) ───────── */
const POLY = {
  'Aile G': '0,0 50,0 57,41 70,65 85,85 43,127 0,170',
  '6 m': '85,85 110,104 170,120 230,120 290,104 315,85 357,127 320,156 230,180 170,180 80,156 43,127',
  'Arrière G': '0,170 43,127 80,156 140,177 140,300 0,300',
  'Centre': '140,177 170,180 230,180 260,177 260,300 140,300',
  'Arrière D': '400,170 357,127 320,156 260,177 260,300 400,300',
  'Aile D': '400,0 350,0 343,41 330,65 315,85 357,127 400,170'
};
const LABEL = { 'Aile G': [28, 52], 'Aile D': [372, 52], '6 m': [200, 150], 'Arrière G': [70, 232], 'Centre': [200, 232], 'Arrière D': [330, 232] };
function couleur(s) {
  if (!s || !s.n) return 'rgba(255,255,255,.10)';
  const e = s.buts / s.n;
  return e >= .67 ? '#22c55e' : e >= .5 ? '#a3e635' : e >= .34 ? '#f59e0b' : '#ef4444';
}
/* mode : 'saisie' (zones cliquables, compteur) ou 'carte' (couleurs d'efficacité) */
function terrain(st, mode, sel) {
  let h = `<svg class="terrain" viewBox="0 0 400 300" role="img" aria-label="Demi-terrain de handball découpé en zones de tir">
  <rect x="0" y="0" width="400" height="300" rx="10" fill="#26324a"/>`;
  for (const k of ZONES) {
    const s = st && st.z[k];
    const fill = mode === 'carte' ? couleur(s) : (k === sel ? 'rgba(255,94,0,.55)' : 'rgba(10,79,208,.35)');
    h += `<polygon class="zone${k === sel ? ' sel' : ''}" data-zone="${k}" points="${POLY[k]}" fill="${fill}" role="button" aria-label="${k}"/>`;
  }
  h += `<path d="M50,0 A120,120 0 0 0 170,120 L230,120 A120,120 0 0 0 350,0 Z" fill="#c8a24a" fill-opacity=".55" stroke="#fff" stroke-width="3"/>
  <path d="M0,59 A180,180 0 0 0 170,180 L230,180 A180,180 0 0 0 400,59" fill="none" stroke="#fff" stroke-width="2" stroke-dasharray="8 7"/>
  <rect x="170" y="0" width="60" height="9" fill="#fff"/><text x="200" y="50" text-anchor="middle" fill="#3b2a00" font-size="13">Gardien</text>`;
  for (const k of ZONES) {
    const [x, y] = LABEL[k], s = st && st.z[k];
    const fonce = mode === 'carte' && s && s.n && s.buts / s.n >= .34;
    const col = fonce ? '#0a1428' : '#fff';
    const nom = k.replace('Arrière', 'Arr.');
    let val = '';
    if (s && s.n) val = mode === 'carte' ? `${s.buts}/${s.n} · ${pct(s.buts, s.n)} %` : `${s.buts} but${s.buts > 1 ? 's' : ''} sur ${s.n}`;
    else if (mode === 'carte') val = k.startsWith('Aile') ? 'aucun / tir' : 'aucun tir';
    h += `<text class="nom" x="${x}" y="${y}" text-anchor="middle" fill="${col}">${nom}</text>`;
    const lignesVal = k.startsWith('Aile') ? val.split(/ · | \/ | (?=sur )/) : [val]; // ailes étroites : chiffres sur deux lignes
    lignesVal.forEach((v, i) => { if (v) h += `<text class="val" x="${x}" y="${y + 18 + i * 17}" text-anchor="middle" fill="${col}">${v}</text>`; });
  }
  return h + '</svg>';
}
const legende = `<p class="aide">Couleurs : <b style="color:#22c55e">■</b> 67 % et plus · <b style="color:#a3e635">■</b> 50 à 66 % · <b style="color:#f59e0b">■</b> 34 à 49 % · <b style="color:#ef4444">■</b> moins de 34 % de réussite</p>`;

/* ───────── Écran MATCH ───────── */
let saisie = { zone: null, type: null };
let prepa = { equipe: null, adv: null, roles: {} };

function rendreMatch() {
  const el = $('#ecran-match'), m = matchCourant();
  if (!m) return rendrePrepa(el);
  const st = stats(m.tirs);
  const prec = matchPrecedent(m);
  el.innerHTML = `
  <div class="carte">
    <div class="score"><span>Éq. ${esc(m.equipe)} (nous)</span><span class="chiffre">${st.buts}</span><span>–</span><span class="chiffre">${m.scoreAdv}</span><span>Éq. ${esc(m.adv)}</span></div>
    <div class="ligne-boutons"><button class="btn" data-adv="-1">➖ But adverse</button><button class="btn btn-accent" data-adv="1">➕ But adverse</button></div>
    ${prec && prec.projet && prec.projet.phrase ? `<div class="rappel">🎯 Notre projet : ${esc(prec.projet.phrase)}</div>` : ''}
    ${!eleve ? `<p class="verdict ko">⚠️ Sans identification : les tirs ne sont pas enregistrés et disparaîtront à la fermeture.</p>` : ''}
  </div>
  <div class="carte">
    <span class="etape">1</span> <b>Touche la zone du tir</b>
    ${terrain(st, 'saisie', saisie.zone)}
    <span class="etape">2</span> <b>Type de tir</b>
    <div class="grille g3">${TYPES.map(t => `<button class="btn choix${saisie.type === t ? ' sel' : ''}" data-type="${t}">${t}</button>`).join('')}</div>
    <span class="etape">3</span> <b>Résultat</b> <span class="aide">(enregistre le tir)</span>
    <div class="grille g3">
      <button class="btn res-but" data-res="But">⚽ But</button>
      <button class="btn res-arret" data-res="Arrêt">🧤 Arrêt</button>
      <button class="btn res-hc" data-res="Hors cadre">↗️ Hors cadre</button>
    </div>
    <p class="compteur">${st.n} tir${st.n > 1 ? 's' : ''} · ${st.buts} but${st.buts > 1 ? 's' : ''} · ${st.arrets} arrêt${st.arrets > 1 ? 's' : ''} · ${st.hc} hors cadre</p>
    <div class="ligne-boutons">${m.tirs.length ? `<button class="btn" id="annuler-tir">↩️ Annuler le dernier tir</button>` : ''}</div>
  </div>
  <div class="carte">
    <button class="btn btn-accent btn-large" id="fin-match">🏁 Fin du match : voir la carte de tirs</button>
    <div class="ligne-boutons"><button class="btn btn-danger" id="abandon">🗑️ Supprimer ce match</button></div>
  </div>`;

  el.querySelectorAll('.zone').forEach(p => p.addEventListener('click', () => { saisie.zone = p.dataset.zone; rendreMatch(); }));
  el.querySelectorAll('[data-type]').forEach(b => b.onclick = () => { saisie.type = b.dataset.type; rendreMatch(); });
  el.querySelectorAll('[data-res]').forEach(b => b.onclick = () => ajouterTir(b.dataset.res));
  el.querySelectorAll('[data-adv]').forEach(b => b.onclick = () => { m.scoreAdv = Math.max(0, m.scoreAdv + +b.dataset.adv); sauverMeta(); rendreMatch(); });
  const an = $('#annuler-tir', el); if (an) an.onclick = annulerTir;
  $('#fin-match', el).onclick = () => { m.fini = true; meta.courant = null; sauverMeta(); matchVu = m.id; saisie = { zone: null, type: null }; montrer('bilan'); };
  $('#abandon', el).onclick = async () => {
    if (!await confirmer(`Supprimer ce match et ses ${m.tirs.length} tir(s) ? Cette action est définitive.`)) return;
    await remplacerLignes(L => L.filter(l => !(l.Date === m.date && l.Match === m.label)));
    delete meta.matchs[m.id]; meta.courant = null; sauverMeta(); await charger(); rendreMatch();
  };
}

async function ajouterTir(res) {
  const m = matchCourant(); if (!m) return;
  if (!saisie.zone) return toast('👆 Touche d\'abord la zone du tir sur le terrain.');
  if (!saisie.type) return toast('👆 Choisis d\'abord le type de tir.');
  const tir = { n: (m.tirs.length ? m.tirs[m.tirs.length - 1].n : 0) + 1, zone: saisie.zone, type: saisie.type, res };
  m.tirs.push(tir); sauverMeta();
  if (eleve) await ELEVE.enregistrer(APP, { Date: m.date, Match: m.label, 'N° tir': tir.n, Zone: tir.zone, 'Type de tir': tir.type, 'Résultat': tir.res });
  saisie = { zone: null, type: null };
  rendreMatch();
  toast(`Tir n°${tir.n} noté : ${esc(tir.zone)} · ${esc(tir.type)} · <b>${esc(res)}</b>`);
}

async function annulerTir() {
  const m = matchCourant(); if (!m || !m.tirs.length) return;
  const t = m.tirs[m.tirs.length - 1];
  if (!await confirmer(`Supprimer le tir n°${t.n} (${t.zone} · ${t.type} · ${t.res}) ?`)) return;
  m.tirs.pop(); sauverMeta();
  await remplacerLignes(L => L.filter(l => !(l.Date === m.date && l.Match === m.label && +l['N° tir'] === t.n)));
  rendreMatch(); toast('Tir supprimé.');
}

function rendrePrepa(el) {
  const L = listeMatchs().filter(x => x.fini);
  const dernier = L[L.length - 1];
  el.innerHTML = `
  <div class="carte">
    <h2>🏁 Nouveau match</h2>
    <p class="aide">Une tablette par équipe. Le <b>marqueur</b> note chaque tir de son équipe : zone, type de tir, résultat.</p>
    ${dernier && dernier.projet && dernier.projet.phrase ? `<div class="rappel">🎯 Votre projet du dernier match : ${esc(dernier.projet.phrase)}</div>` : ''}
    <div class="choix-titre">Notre équipe</div>
    <div class="grille g4">${EQUIPES.map(n => `<button class="btn choix${prepa.equipe === n ? ' sel' : ''}" data-eq="${n}">Éq. ${n}</button>`).join('')}</div>
    <div class="choix-titre">Adversaire</div>
    <div class="grille g4">${EQUIPES.map(n => `<button class="btn choix${prepa.adv === n ? ' sel' : ''}" data-adv="${n}" ${prepa.equipe === n ? 'disabled' : ''}>Éq. ${n}</button>`).join('')}</div>
  </div>
  <div class="carte">
    <h2>👥 Répartition des rôles</h2>
    <p class="aide">Qui fait quoi pendant ce match ? Le prénom est facultatif. Changez les rôles à chaque match.</p>
    ${ROLES.map(([r, d]) => `<label class="choix-titre" style="display:block">${r} <span class="aide">— ${d}</span>
      <input type="text" data-role="${r}" maxlength="30" placeholder="Prénom (facultatif)" value="${esc(prepa.roles[r] || '')}"></label>`).join('')}
  </div>
  <button class="btn btn-accent btn-large" id="commencer" ${prepa.equipe && prepa.adv ? '' : 'disabled'}>▶️ Commencer le match</button>`;
  el.querySelectorAll('[data-eq]').forEach(b => b.onclick = () => { prepa.equipe = +b.dataset.eq; if (prepa.adv === prepa.equipe) prepa.adv = null; rendreMatch(); });
  el.querySelectorAll('[data-adv]').forEach(b => b.onclick = () => { prepa.adv = +b.dataset.adv; rendreMatch(); });
  el.querySelectorAll('[data-role]').forEach(i => i.oninput = () => { prepa.roles[i.dataset.role] = i.value.trim(); });
  $('#commencer', el).onclick = commencer;
}

async function commencer() {
  const el = await ELEVE.demander();
  await charger();
  if (!el) toast('Sans identification : rien ne sera enregistré.');
  const date = aujourdhui();
  const base = `Éq.${prepa.equipe} vs Éq.${prepa.adv}`;
  let k = 1; while (meta.matchs[date + '|' + base + ' #' + k]) k++;
  const label = base + ' #' + k, id = date + '|' + label;
  meta.matchs[id] = { id, cree: Date.now(), date, label, equipe: prepa.equipe, adv: prepa.adv, scoreAdv: 0, tirs: [], fini: false, roles: { ...prepa.roles } };
  meta.courant = id; sauverMeta();
  saisie = { zone: null, type: null };
  prepa.roles = {};
  rendreMatch();
}

/* ───────── Écran BILAN ───────── */
function suggestions(st) {
  const s = [];
  if (!st.n) return s;
  const loin = st.z['Arrière G'].n + st.z['Centre'].n + st.z['Arrière D'].n;
  const ailes = st.z['Aile G'].n + st.z['Aile D'].n;
  const t = st.z['6 m'];
  s.push(['Beaucoup de tirs de loin (arrières, centre)', loin / st.n >= .5]);
  s.push(['Les tirs à 6 m réussissent bien', t.n >= 2 && t.buts / t.n >= .6]);
  s.push(['Les ailes ont été peu utilisées', ailes / st.n < .2]);
  s.push(['Beaucoup de tirs hors cadre : tirs précipités ?', st.hc / st.n >= .25]);
  s.push(['Le gardien adverse a arrêté beaucoup de tirs', st.arrets / st.n >= .35]);
  let bt = null; TYPES.forEach(k => { const x = st.ty[k]; if (x.n >= 2 && (!bt || x.buts / x.n > bt.e)) bt = { k, e: x.buts / x.n }; });
  if (bt) s.push([`Les tirs « ${bt.k.toLowerCase()} » sont les plus efficaces`, true]);
  s.push(['On a tiré sans être démarqué', false]);
  s.push(['On a peu fait circuler le ballon avant de tirer', false]);
  return s;
}

function phraseProjet(p) {
  if (!p) return '';
  const morceaux = [];
  if (p.zonePlus) morceaux.push(`tirer davantage depuis « ${p.zonePlus} »`);
  if (p.zoneMoins) morceaux.push(`éviter les tirs depuis « ${p.zoneMoins} »`);
  (p.choix || []).forEach(c => morceaux.push(c.charAt(0).toLowerCase() + c.slice(1)));
  let ph = morceaux.length ? 'Au prochain match, nous allons ' + morceaux.join(', ') + '.' : '';
  if (p.texte) ph += (ph ? ' ' : '') + p.texte;
  return ph;
}

function rendreBilan() {
  const el = $('#ecran-bilan');
  const L = listeMatchs().filter(x => x.fini);
  if (!matchVu || !meta.matchs[matchVu] || !meta.matchs[matchVu].fini) matchVu = L.length ? L[L.length - 1].id : null;
  const m = matchVu && meta.matchs[matchVu];
  if (!m) { el.innerHTML = `<div class="carte"><h2>🗺️ Bilan</h2><p>Aucun match terminé pour l'instant. Commence par noter les tirs dans l'écran <b>Match</b>.</p></div>`; return; }
  const st = stats(m.tirs);
  m.ressenti = m.ressenti || {};
  m.reperes = m.reperes || [];
  m.projet = m.projet || { choix: [], texte: '' };
  const r = m.ressenti;
  const revele = r.vu || (r.meilleure && r.pire);
  const best = meilleureZone(st), worst = meilleureZone(st, true);
  const prec = matchPrecedent(m);
  const sugg = suggestions(st);

  let h = `<div class="carte">
    <h2>🗺️ Bilan du match</h2>
    ${L.length > 1 ? `<select id="choix-match" aria-label="Choisir le match">${L.map(x => `<option value="${esc(x.id)}" ${x.id === m.id ? 'selected' : ''}>${dateFr(x.date)} · ${esc(x.label)}</option>`).join('')}</select>` : ''}
    <div class="score"><span>Éq. ${esc(m.equipe)}</span><span class="chiffre">${st.buts}</span><span>–</span><span class="chiffre">${m.scoreAdv}</span><span>Éq. ${esc(m.adv)}</span></div>
    <p class="compteur">${dateFr(m.date)} · ${st.n} tirs · réussite ${pct(st.buts, st.n)} %</p>
  </div>`;

  // Étape 1 : ressenti avant de voir la carte
  h += `<div class="carte"><span class="etape">1</span> <b>Votre ressenti, avant de voir la carte</b>
    <div class="choix-titre">D'après vous, notre zone la plus efficace :</div>
    <div class="grille g3">${ZONES.map(z => `<button class="btn choix${r.meilleure === z ? ' sel' : ''}" data-rm="${z}">${z}</button>`).join('')}</div>
    <div class="choix-titre">Et notre zone la moins efficace :</div>
    <div class="grille g3">${ZONES.map(z => `<button class="btn choix${r.pire === z ? ' sel' : ''}" data-rp="${z}">${z}</button>`).join('')}</div>
    ${revele ? '' : `<div class="ligne-boutons"><button class="btn" id="passer">Passer et voir la carte</button></div>`}
  </div>`;

  if (revele) {
    // Étape 2 : carte de tirs + ressenti / résultat
    h += `<div class="carte accent"><span class="etape">2</span> <b>Notre carte de tirs</b>
      ${terrain(st, 'carte')}${legende}
      <table><tr><th>Type de tir</th><th>Tirs</th><th>Buts</th><th>Réussite</th></tr>
      ${TYPES.map(k => `<tr><td>${k}</td><td>${st.ty[k].n}</td><td>${st.ty[k].buts}</td><td>${st.ty[k].n ? pct(st.ty[k].buts, st.ty[k].n) + ' %' : '–'}</td></tr>`).join('')}
      <tr><td><b>Total</b></td><td><b>${st.n}</b></td><td><b>${st.buts}</b></td><td><b>${pct(st.buts, st.n)} %</b></td></tr></table>
      <h3>Ressenti / résultat</h3>
      ${best ? verdict('la plus efficace', r.meilleure, best) : `<p class="aide">Pas assez de tirs par zone (au moins 2) pour désigner une meilleure zone.</p>`}
      ${worst && best && worst.zone !== best.zone ? verdict('la moins efficace', r.pire, worst) : ''}
    </div>`;

    // Étape 3 : repères d'observation
    h += `<div class="carte"><span class="etape">3</span> <b>Ce que l'on observe</b>
      <p class="aide">Cochez ce qui est vrai pour votre équipe. « 💡 » = indiqué par les chiffres.</p>
      ${sugg.map(([t, s]) => `<label class="coche"><input type="checkbox" data-rep="${esc(t)}" ${m.reperes.includes(t) ? 'checked' : ''}><span>${esc(t)}</span>${s ? '<span class="sugg">💡 chiffres</span>' : ''}</label>`).join('')}
    </div>`;

    // Étape 4 : projet tactique
    const p = m.projet;
    h += `<div class="carte accent"><span class="etape">4</span> <b>Notre projet tactique pour le prochain match</b>
      <div class="choix-titre">Zone à privilégier</div>
      <div class="grille g3">${ZONES.map(z => `<button class="btn choix${p.zonePlus === z ? ' sel' : ''}" data-zp="${z}">${z}</button>`).join('')}</div>
      <div class="choix-titre">Zone à éviter (facultatif)</div>
      <div class="grille g3">${ZONES.map(z => `<button class="btn choix${p.zoneMoins === z ? ' sel' : ''}" data-zm="${z}" ${p.zonePlus === z ? 'disabled' : ''}>${z}</button>`).join('')}</div>
      <div class="choix-titre">Comment ? (1 ou 2 choix)</div>
      <div class="grille g2">${INTENTIONS.map(c => `<button class="btn choix${p.choix.includes(c) ? ' sel' : ''}" data-int="${esc(c)}">${esc(c)}</button>`).join('')}</div>
      <div class="choix-titre">Un détail à ajouter ? (facultatif)</div>
      <textarea id="projet-texte" rows="2" maxlength="200" placeholder="Ex. : on passe par l'ailier gauche dès qu'il est libre">${esc(p.texte)}</textarea>
      <p class="choix-titre">Notre projet :</p>
      <div class="phrase" id="phrase">${esc(phraseProjet(p)) || '<span class="aide">Choisissez au moins une zone ou une intention.</span>'}</div>
    </div>`;

    // Étape 5 : co-évaluation en binôme
    if (prec && prec.projet && prec.projet.phrase) {
      const c = m.coeval = m.coeval || {};
      const sp = stats(prec.tirs), zp = prec.projet.zonePlus;
      h += `<div class="carte"><span class="etape">5</span> <b>Co-évaluation par le binôme observateur</b>
        <p class="rappel">🎯 Projet prévu pour ce match : ${esc(prec.projet.phrase)}</p>
        ${zp ? `<p>📊 Tirs depuis « ${esc(zp)} » : <b>${pct(sp.z[zp].n, sp.n)} %</b> des tirs au match précédent → <b>${pct(st.z[zp].n, st.n)} %</b> aujourd'hui (réussite ${pct(sp.z[zp].buts, sp.z[zp].n)} % → ${pct(st.z[zp].buts, st.z[zp].n)} %).</p>` : ''}
        <div class="choix-titre">Le binôme : le projet a-t-il été appliqué ?</div>
        <div class="grille g3">${['Oui', 'En partie', 'Non'].map(v => `<button class="btn choix${c.applique === v ? ' sel' : ''}" data-ap="${v}">${v}</button>`).join('')}</div>
        <div class="choix-titre">Le conseil du binôme</div>
        <div class="grille g2">${CONSEILS.map(v => `<button class="btn choix${c.conseil === v ? ' sel' : ''}" data-co="${esc(v)}">${esc(v)}</button>`).join('')}</div>
      </div>`;
    }
    h += `<button class="btn btn-accent btn-large" id="sauver-bilan">💾 Enregistrer le bilan et le projet</button>`;
  }
  el.innerHTML = h;

  const sel = $('#choix-match', el); if (sel) sel.onchange = () => { matchVu = sel.value; rendreBilan(); };
  el.querySelectorAll('[data-rm]').forEach(b => b.onclick = () => { r.meilleure = b.dataset.rm; sauverMeta(); rendreBilan(); });
  el.querySelectorAll('[data-rp]').forEach(b => b.onclick = () => { r.pire = b.dataset.rp; sauverMeta(); rendreBilan(); });
  const ps = $('#passer', el); if (ps) ps.onclick = () => { r.vu = true; sauverMeta(); rendreBilan(); };
  if (!revele) return;
  el.querySelectorAll('[data-rep]').forEach(i => i.onchange = () => {
    const t = i.dataset.rep; m.reperes = m.reperes.filter(x => x !== t); if (i.checked) m.reperes.push(t); sauverMeta();
  });
  const p = m.projet;
  el.querySelectorAll('[data-zp]').forEach(b => b.onclick = () => { p.zonePlus = p.zonePlus === b.dataset.zp ? null : b.dataset.zp; if (p.zoneMoins === p.zonePlus) p.zoneMoins = null; garder(rendreBilan); });
  el.querySelectorAll('[data-zm]').forEach(b => b.onclick = () => { p.zoneMoins = p.zoneMoins === b.dataset.zm ? null : b.dataset.zm; garder(rendreBilan); });
  el.querySelectorAll('[data-int]').forEach(b => b.onclick = () => {
    const c = b.dataset.int;
    if (p.choix.includes(c)) p.choix = p.choix.filter(x => x !== c);
    else { if (p.choix.length >= 2) return toast('2 choix maximum : retire d\'abord un choix.'); p.choix.push(c); }
    garder(rendreBilan);
  });
  const ta = $('#projet-texte', el);
  ta.oninput = () => { p.texte = ta.value.trim(); $('#phrase', el).textContent = phraseProjet(p); sauverMeta(); };
  el.querySelectorAll('[data-ap]').forEach(b => b.onclick = () => { m.coeval.applique = b.dataset.ap; garder(rendreBilan); });
  el.querySelectorAll('[data-co]').forEach(b => b.onclick = () => { m.coeval.conseil = b.dataset.co; garder(rendreBilan); });
  $('#sauver-bilan', el).onclick = () => sauverBilan(m);

  function garder(fn) { const y = window.scrollY; sauverMeta(); fn(); window.scrollTo(0, y); }
}

function verdict(lib, ressenti, vrai) {
  const ok = ressenti === vrai.zone;
  return `<div class="verdict ${ok ? 'ok' : 'ko'}">${ok ? '✅' : '🤔'} Zone ${lib} : vous pensiez <b>${esc(ressenti || '—')}</b>, les chiffres disent <b>${esc(vrai.zone)}</b> (${vrai.buts}/${vrai.n}, ${Math.round(vrai.e * 100)} %).${ok ? ' Bien vu !' : ' Pourquoi cet écart ?'}</div>`;
}

async function sauverBilan(m) {
  const p = m.projet;
  p.phrase = phraseProjet(p);
  if (!p.phrase) return toast('✍️ Choisissez au moins une zone ou une intention pour votre projet.');
  sauverMeta();
  if (!eleve) {
    const el = await ELEVE.demander();
    if (!el) { toast('Projet affiché, mais rien n\'est enregistré (sans identification).'); rendreCarnet(); return; }
    await charger(); // transfère le match noté sans identification
    m = meta.matchs[m.id]; if (!m) return;
  }
  const st = stats(m.tirs);
  const ligne = { Date: m.date, Match: m.label, 'N° tir': 'Bilan', Score: `${st.buts}-${m.scoreAdv}`, 'Projet tactique': p.phrase };
  if (m.coeval && m.coeval.applique) ligne['Co-évaluation'] = m.coeval.applique + (m.coeval.conseil ? ' · ' + m.coeval.conseil : '');
  await remplacerLignes(L => L.filter(l => !(l.Date === m.date && l.Match === m.label && l['N° tir'] === 'Bilan')).concat([ligne]));
  m.restaure = false; sauverMeta();
  toast('✅ Bilan enregistré. Le projet s\'affichera au début du prochain match.');
  rendreCarnet();
}

/* ───────── Écran CARNET ───────── */
let comp = { a: null, b: null };
function rendreCarnet() {
  const el = $('#ecran-carnet');
  const L = listeMatchs().filter(x => x.fini);
  let h = `<div class="carte"><h2>📒 Carnet de bord</h2>`;
  if (!L.length) h += `<p>Aucun match terminé pour l'instant.</p>`;
  h += [...L].reverse().map(m => {
    const st = stats(m.tirs);
    return `<div class="carte match-item"><div class="infos">
      <b>${dateFr(m.date)}</b> · ${esc(m.label)}<br>
      Score ${st.buts}–${m.scoreAdv} · <span class="pastille">${pct(st.buts, st.n)} % de réussite</span> · ${st.n} tirs
      ${m.projet && m.projet.phrase ? `<br>🎯 ${esc(m.projet.phrase)}` : '<br><span class="aide">Projet pas encore écrit</span>'}
      ${m.coeval && m.coeval.applique ? `<br>🤝 Binôme : projet appliqué ? <b>${esc(m.coeval.applique)}</b>` : ''}
      </div><button class="btn" data-voir="${esc(m.id)}">🗺️ Voir</button></div>`;
  }).join('');
  h += `</div>`;

  if (L.length >= 2) {
    h += `<div class="carte"><h2>📈 Progression</h2>${graphique(L)}</div>`;
    if (!comp.a || !meta.matchs[comp.a]) comp.a = L[L.length - 2].id;
    if (!comp.b || !meta.matchs[comp.b]) comp.b = L[L.length - 1].id;
    const A = meta.matchs[comp.a], B = meta.matchs[comp.b], sa = stats(A.tirs), sb = stats(B.tirs);
    const opt = v => L.map(x => `<option value="${esc(x.id)}" ${x.id === v ? 'selected' : ''}>${dateFr(x.date)} · ${esc(x.label)}</option>`).join('');
    const fl = (a, b) => b > a ? '<span class="haut">⬆️</span>' : b < a ? '<span class="bas">⬇️</span>' : '＝';
    h += `<div class="carte"><h2>⚖️ Comparer deux matchs</h2>
      <div class="grille g2"><select id="comp-a" aria-label="Premier match">${opt(comp.a)}</select><select id="comp-b" aria-label="Second match">${opt(comp.b)}</select></div>
      <div class="cartes-cote"><div><h3>${dateFr(A.date)}</h3>${terrain(sa, 'carte')}</div><div><h3>${dateFr(B.date)}</h3>${terrain(sb, 'carte')}</div></div>
      <table><tr><th>Zone</th><th>${dateFr(A.date)}</th><th>${dateFr(B.date)}</th><th></th></tr>
      ${ZONES.map(z => { const x = sa.z[z], y = sb.z[z]; return `<tr><td>${z}</td><td>${x.buts}/${x.n}${x.n ? ' · ' + pct(x.buts, x.n) + ' %' : ''}</td><td>${y.buts}/${y.n}${y.n ? ' · ' + pct(y.buts, y.n) + ' %' : ''}</td><td>${x.n && y.n ? fl(x.buts / x.n, y.buts / y.n) : ''}</td></tr>`; }).join('')}
      <tr><td><b>Total</b></td><td><b>${pct(sa.buts, sa.n)} %</b></td><td><b>${pct(sb.buts, sb.n)} %</b></td><td>${fl(sa.n ? sa.buts / sa.n : 0, sb.n ? sb.buts / sb.n : 0)}</td></tr></table>
    </div>`;
  }

  h += `<div class="carte"><h2>📤 Pour le professeur</h2>
    <p class="aide">Le fichier contient tes tirs et tes bilans. Remets-le au professeur.</p>
    <button class="btn btn-accent btn-large" id="exporter">📤 Exporter mes résultats (.xlsx)</button>
    <div class="ligne-boutons"><button class="btn btn-danger" id="effacer-app">🗑️ Effacer les données de l'appli</button></div>
  </div>`;
  el.innerHTML = h;

  el.querySelectorAll('[data-voir]').forEach(b => b.onclick = () => { matchVu = b.dataset.voir; montrer('bilan'); });
  const ca = $('#comp-a', el), cb = $('#comp-b', el);
  if (ca) { ca.onchange = () => { comp.a = ca.value; rendreCarnet(); }; cb.onchange = () => { comp.b = cb.value; rendreCarnet(); }; }
  $('#exporter', el).onclick = async () => {
    try {
      const e = await ELEVE.demander();
      if (!e) return toast('Identifie-toi pour exporter tes résultats.');
      await ELEVE.exporter([APP]);
    } catch (x) { toast('⚠️ ' + esc(x.message || 'Export impossible : aucune donnée enregistrée.')); }
  };
  $('#effacer-app', el).onclick = effacerTout;
}

function graphique(L) {
  const W = 600, H = 240, g = 40, n = L.length;
  const pts = L.map((m, i) => { const st = stats(m.tirs); return { x: g + (n === 1 ? 0 : i * (W - 2 * g) / (n - 1)), y: H - g - (st.n ? st.buts / st.n : 0) * (H - 2 * g), v: pct(st.buts, st.n), d: dateFr(m.date).slice(0, 5), p: !!(m.projet && m.projet.phrase) }; });
  let s = `<svg class="graph" viewBox="0 0 ${W} ${H}" role="img" aria-label="Réussite au tir à chaque match">`;
  [0, 25, 50, 75, 100].forEach(v => { const y = H - g - v / 100 * (H - 2 * g); s += `<line x1="${g}" x2="${W - g}" y1="${y}" y2="${y}" stroke="rgba(255,255,255,.15)"/><text x="${g - 6}" y="${y + 4}" text-anchor="end" fill="#c9d6ee" font-size="12">${v} %</text>`; });
  s += `<polyline fill="none" stroke="url(#dg)" stroke-width="4" points="${pts.map(p => p.x + ',' + p.y).join(' ')}"/>
  <defs><linearGradient id="dg"><stop offset="0" stop-color="#ff5e00"/><stop offset="1" stop-color="#4f8bff"/></linearGradient></defs>`;
  pts.forEach(p => { s += `<circle cx="${p.x}" cy="${p.y}" r="7" fill="${p.p ? '#ff5e00' : '#fff'}"/><text x="${p.x}" y="${p.y - 12}" text-anchor="middle" fill="#fff" font-size="14" font-weight="900">${p.v} %</text><text x="${p.x}" y="${H - 14}" text-anchor="middle" fill="#c9d6ee" font-size="12">${p.d}</text>`; });
  return s + `</svg><p class="aide">Réussite au tir (buts ÷ tirs) à chaque match. Point orange = un projet tactique a été écrit après ce match.</p>`;
}

async function effacerTout() {
  if (!await confirmer('Effacer toutes les données de TirsHand sur cette tablette (tirs, bilans, projets) ? Cette action est définitive.')) return;
  try { await ELEVE.effacerApp(APP); } catch (e) { /* rien à effacer */ }
  try { Object.keys(localStorage).filter(k => k.startsWith('tirshand_')).forEach(k => localStorage.removeItem(k)); } catch (e) { /* stockage indisponible */ }
  memAnon = { matchs: {}, courant: null };
  videoEffacer();
  $('#confid').open && $('#confid').close();
  await charger(); toutRendre();
  toast('🗑️ Données de TirsHand effacées.');
}

/* ───────── Écran VIDÉO (différé, en mémoire vive uniquement) ───────── */
const V = { stream: null, video: null, frames: [], capt: null, raf: 0, delai: 5, mode: 'diff', vitesse: .5, rep: null, occupe: false, dernier: null, off: null };
const FPS = 12, GARDE = 22000, DUREE_RALENTI = 8000;

async function videoDemarrer() {
  if (V.stream) return;
  if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) return toast('⚠️ Caméra indisponible sur cet appareil.');
  try {
    V.stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: { ideal: 'environment' }, width: { ideal: 1280 } }, audio: false });
  } catch (e) { return toast('⚠️ Accès à la caméra refusé. Autorise la caméra dans le navigateur.'); }
  V.video = document.createElement('video'); V.video.muted = true; V.video.playsInline = true; V.video.srcObject = V.stream;
  await V.video.play().catch(() => {});
  V.off = document.createElement('canvas');
  V.frames = []; V.mode = 'diff';
  V.capt = setInterval(() => {
    const v = V.video; if (!v || !v.videoWidth) return;
    // On garde les proportions réelles de la caméra (paysage ou portrait) : aucune déformation
    const w = 640, h = Math.round(w * v.videoHeight / v.videoWidth);
    if (V.off.width !== w || V.off.height !== h) { V.off.width = w; V.off.height = h; }
    V.off.getContext('2d').drawImage(v, 0, 0, w, h);
    const t = performance.now();
    V.off.toBlob(b => { if (b && V.stream) V.frames.push({ t, b }); }, 'image/jpeg', .7);
    const lim = performance.now() - GARDE; while (V.frames.length && V.frames[0].t < lim) V.frames.shift();
  }, 1000 / FPS);
  boucle(); majVideo();
}

function boucle() {
  V.raf = requestAnimationFrame(boucle);
  if (V.occupe || !V.frames.length) return;
  const now = performance.now(); let f = null;
  if (V.mode === 'diff') {
    const cible = now - V.delai * 1000;
    for (let i = V.frames.length - 1; i >= 0; i--) if (V.frames[i].t <= cible) { f = V.frames[i]; break; }
    const etat = $('#v-etat');
    if (!f) { etat.textContent = `⏳ Différé dans ${Math.ceil((V.frames[0].t - cible) / 1000)} s…`; return; }
    etat.textContent = `🔴 Différé ${V.delai} s · rien n'est enregistré`;
  } else if (V.rep && V.rep.frames.length) {
    const R = V.rep, pos = R.debut + ((now - R.t0) * V.vitesse) % (R.fin - R.debut);
    f = R.frames[0]; for (const x of R.frames) { if (x.t <= pos) f = x; else break; }
    $('#v-etat').textContent = `🐢 Ralenti ×${String(V.vitesse).replace('.', ',')} (en boucle)`;
  }
  if (!f || f === V.dernier) return;
  V.occupe = true; V.dernier = f;
  createImageBitmap(f.b).then(bm => { const c = $('#v-canvas'); if (c.width !== bm.width || c.height !== bm.height) { c.width = bm.width; c.height = bm.height; } c.getContext('2d').drawImage(bm, 0, 0); bm.close(); })
    .catch(() => {}).finally(() => { V.occupe = false; });
}

function videoRalenti() {
  if (!V.stream) return;
  const fin = V.mode === 'diff' ? performance.now() - V.delai * 1000 : performance.now();
  const frames = V.frames.filter(f => f.t <= fin && f.t >= fin - DUREE_RALENTI);
  if (frames.length < 2) return toast('Pas encore assez d\'images : attends quelques secondes.');
  V.rep = { frames, debut: frames[0].t, fin: frames[frames.length - 1].t + 1, t0: performance.now() };
  V.mode = 'rep'; majVideo();
}

function videoEffacer() {
  clearInterval(V.capt); cancelAnimationFrame(V.raf);
  if (V.stream) V.stream.getTracks().forEach(t => t.stop());
  if (V.video) V.video.srcObject = null;
  V.stream = null; V.video = null; V.frames = []; V.rep = null; V.dernier = null; V.mode = 'diff';
  const c = $('#v-canvas'); if (c) c.getContext('2d').clearRect(0, 0, c.width, c.height);
  const e = $('#v-etat'); if (e) e.textContent = 'Caméra arrêtée · images effacées';
  majVideo();
}

function majVideo() {
  const on = !!V.stream;
  $('#v-ralenti').disabled = !on;
  $('#v-vitesse').disabled = !on;
  $('#v-retour').disabled = !on || V.mode === 'diff';
  $('#v-vitesse').textContent = 'Vitesse ×' + String(V.vitesse).replace('.', ',');
  $('#v-demarrer').disabled = on;
}

function initVideo() {
  $('#v-demarrer').onclick = videoDemarrer;
  $('#v-effacer').onclick = () => { videoEffacer(); toast('🗑️ Images effacées, caméra arrêtée.'); };
  $('#v-ralenti').onclick = videoRalenti;
  $('#v-vitesse').onclick = () => { V.vitesse = V.vitesse === .5 ? .25 : .5; if (V.rep) V.rep.t0 = performance.now(); majVideo(); };
  $('#v-retour').onclick = () => { V.mode = 'diff'; V.rep = null; majVideo(); };
  document.querySelectorAll('#v-delais [data-d]').forEach(b => b.onclick = () => {
    V.delai = +b.dataset.d; document.querySelectorAll('#v-delais [data-d]').forEach(x => x.classList.toggle('sel', x === b));
  });
  document.addEventListener('visibilitychange', () => { if (document.hidden) videoEffacer(); });
  window.addEventListener('pagehide', videoEffacer);
}

/* ───────── Navigation ───────── */
let ecran = 'match';
function montrer(nom) {
  if (ecran === 'video' && nom !== 'video') videoEffacer();
  ecran = nom;
  document.querySelectorAll('.onglet').forEach(b => b.classList.toggle('actif', b.dataset.ecran === nom));
  document.querySelectorAll('.ecran').forEach(s => s.classList.toggle('actif', s.id === 'ecran-' + nom));
  if (nom === 'match') rendreMatch();
  if (nom === 'bilan') rendreBilan();
  if (nom === 'carnet') rendreCarnet();
  window.scrollTo(0, 0);
}
function toutRendre() { rendreMatch(); rendreBilan(); rendreCarnet(); }

async function init() {
  document.querySelectorAll('.onglet').forEach(b => b.onclick = () => montrer(b.dataset.ecran));
  $('#lien-confid').onclick = () => $('#confid').showModal();
  $('#confid [data-fermer]').onclick = () => $('#confid').close();
  $('#btn-effacer-tout').onclick = effacerTout;
  initVideo();
  ELEVE.bandeau($('#bandeau'));
  document.addEventListener('eleve-change', async () => { await charger(); toutRendre(); });
  await charger();
  toutRendre();
}
init().catch(e => { console.error(e); toast('⚠️ Problème au démarrage : recharge la page.'); });
})();
