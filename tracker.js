/* Suivi en direct — page réceptrice de js/07-gps-position.js (Go_app).
   Même projet Supabase que le classement de l'app (js/21-classement.js) : la clé
   ci-dessous est la clé publishable, publique par construction.

   ⚠ AUCUNE TABLE, AUCUNE RLS À CONFIGURER. Cette page s'abonne à un canal Realtime
   Broadcast nommé par l'identifiant de session (`liveshare:<id>`) — du pub/sub
   éphémère, rien n'est lu ni écrit en base. L'identifiant protège la LECTURE : le
   connaître suffit à s'abonner. Ne jamais republier ce lien publiquement.
   ⚠⚠ L'ÉCRITURE, ELLE, EST PROTÉGÉE PAR LA SIGNATURE (02/10/2026) : le canal accepte
   les messages de quiconque connaît l'identifiant. Dès que le lien porte une clé
   (`k`), on refuse tout message qu'elle ne vérifie pas — voir signature-partage.js.

   Sorti de tracker.html le 02/10/2026 : la CSP de la page n'autorise que des scripts
   servis par fichier, aucun script inline. */
const SUPABASE_URL = 'https://husqmdqwqunufgjbcmsk.supabase.co';
const SUPABASE_KEY = 'sb_publishable_2IOxe6QVMsUflUfFuoUN_A_loUc8zbL';

const lien = lireLienSuivi(location.hash, location.search);
const sessionId = lien.s;

const statusEl   = document.getElementById('status');
const statusTxt  = document.getElementById('status-txt');
const erreurEl   = document.getElementById('erreur');
const erreurTxt  = document.getElementById('erreur-txt');

function afficherErreur(msg) {
    erreurTxt.textContent = msg;
    erreurEl.classList.add('visible');
}

/* ⚠ Un lien qui porte une clé illisible s'ARRÊTE ici : retomber sur les messages en
   clair rendrait la signature facultative pour qui sait abîmer un lien. */
async function demarrer() {
    if (!sessionId) {
        afficherErreur("Lien de suivi invalide — il manque l'identifiant de session dans l'adresse.");
        return;
    }
    if (typeof supabase === 'undefined' || !supabase.createClient) {
        afficherErreur("Le service de suivi n'a pas pu se charger (connexion bloquée ou hors ligne). Réessaie de recharger la page.");
        return;
    }
    let cle = null;
    if (lien.k) {
        cle = await importerClePartage(lien.k);
        if (!cle) {
            afficherErreur("Lien de suivi abîmé — il a sans doute été coupé en le copiant. Demande à la personne de te le renvoyer.");
            return;
        }
    }
    demarrerSuivi(cle);
}
demarrer();

/* ── Heure d'arrivée (28/09/2026) ──────────────────────────────────────────────
   Demande de la première personne à avoir suivi un trajet : « 18h30 », avec le
   temps restant. L'app envoie `arriveeTs`, un HORODATAGE : l'heure s'affiche dans le
   fuseau de qui regarde, et le temps restant se recalcule ici toutes les 15 s — il
   continue donc de décompter même si deux positions tardent.
   ⚠ REPLI SUR `eta` : un APK antérieur n'envoie que le texte « 24m 58s ». On
   l'affiche alors tel quel, comme avant, plutôt qu'une case vide. */
let arriveeTs = null;

function heureFr(ms) {
    const d = new Date(ms);
    return d.getHours() + 'h' + String(d.getMinutes()).padStart(2, '0');
}
function resteFr(ms) {
    const min = Math.round((ms - Date.now()) / 60000);
    if (min <= 0) return 'arrivée imminente';
    if (min < 60) return 'dans ' + min + ' min';
    const h = Math.floor(min / 60), m = min % 60;
    return 'dans ' + h + ' h' + (m ? ' ' + String(m).padStart(2, '0') : '');
}
function majArrivee() {
    if (arriveeTs === null) return;
    document.getElementById('val-eta').textContent = heureFr(arriveeTs);
    document.getElementById('val-reste').textContent = resteFr(arriveeTs);
}
const minuterieArrivee = setInterval(majArrivee, 15000);

function demarrerSuivi(cle) {
    /* ═══ FOND OPENFREEMAP, AFFICHÉ PAR MAPLIBRE (28/09/2026) ═══════════════════
       Remplace les tuiles de tile.openstreetmap.org, affichées par Leaflet : la
       politique d'usage de ces serveurs communautaires déconseille les applications,
       et leur rendu est chargé.
       ⚠ PAS CARTO, BIEN QU'IL AIT ÉTÉ LE PREMIER CHOIX : essayé le 28/09/2026, il
       sert désormais à TOUT LE MONDE une tuile-filigrane « API KEY REQUIRED » — même
       tuile, même empreinte, quelle que soit l'origine de la demande (vérifié depuis
       127.0.0.1 et avec l'origine saliferic.github.io). Le conseil « gratuit, sans clé »
       qu'on lit partout est périmé.
       OpenFreeMap : gratuit, sans clé ni inscription, cartes VECTORIELLES — d'où
       MapLibre à la place de Leaflet, qui ne sait afficher que des images.
       Paramètre d'adresse `fond=sombre|clair` pour comparer sans republier : le lien
       envoyé par l'app ne le porte pas, c'est donc FOND_DEFAUT que voit qui suit.
       « couleur » par défaut depuis le 28/09/2026 (choix utilisateur, sur captures des
       trois fonds) : le plus lisible pour quelqu'un qui ne connaît pas le quartier.
       ⚠ L'attribution (fournie par le style lui-même) est une CONDITION d'utilisation :
       ne pas passer `attributionControl: false` sans la reposer ailleurs. */
    const FONDS = { sombre: 'dark', clair: 'positron', couleur: 'liberty' };
    const FOND_DEFAUT = 'couleur';
    const fondDemande = new URLSearchParams(location.search).get('fond');
    const fond = Object.prototype.hasOwnProperty.call(FONDS, fondDemande) ? fondDemande : FOND_DEFAUT;
    const map = new maplibregl.Map({
        container: 'map',
        style: 'https://tiles.openfreemap.org/styles/' + FONDS[fond],
        center: [2.3522, 48.8566], zoom: 13,
        attributionControl: false,
    });
    map.addControl(new maplibregl.AttributionControl({ compact: true }), 'top-left');
    /* MapLibre ouvre l'attribution compacte au chargement : une bande blanche sur
       toute la largeur, sous le bandeau d'état. On la replie sur son bouton « i »,
       d'où elle reste lisible d'un appui — elle n'est pas retirée. */
    map.once('load', () => {
        const attrib = document.querySelector('.maplibregl-ctrl-attrib');
        if (attrib) attrib.classList.remove('maplibregl-compact-show');
    });

    /* Le point du véhicule : un élément DOM, pas une couche — il reste net à tout zoom.
       ROUGE depuis le 28/09/2026 (demande utilisateur), turquoise avant. Le contour
       BLANC n'est pas décoratif : sans lui, le rouge se fond dans les routes orangées
       du fond « couleur » et s'éteint sur le fond sombre. Le halo pâle dit « c'est ici »
       sans masquer la rue sous le point. `box-sizing` : les 3 px de contour sont
       comptés DANS les 18 px, sinon le point grossit et se décentre de son ancre. */
    const pointEl = document.createElement('div');
    pointEl.style.cssText = 'box-sizing:border-box;width:18px;height:18px;border-radius:50%;' +
        'background:#E53935;border:3px solid #fff;' +
        'box-shadow:0 0 0 6px rgba(229,57,53,0.22),0 1px 4px rgba(0,0,0,0.45);' +
        'transition:opacity .4s';
    let marker = null;
    let premierPoint = true;

    function afficherPosition(payload) {
        if (payload.active === false) {
            statusEl.className = 'ended';
            statusTxt.textContent = 'Partage terminé';
            pointEl.style.opacity = '0.4';
            // Plus rien ne viendra : le décompte s'arrête sur la dernière heure connue.
            clearInterval(minuterieArrivee);
            document.getElementById('val-reste').textContent = '';
            return;
        }

        statusEl.className = 'live';
        statusTxt.textContent = 'En direct';

        const { lat, lng, speed, eta, dest, ts } = payload;   // arriveeTs : voir plus bas
        if (typeof lat === 'number' && typeof lng === 'number') {
            if (!marker) {
                marker = new maplibregl.Marker({ element: pointEl }).setLngLat([lng, lat]).addTo(map);
            } else {
                marker.setLngLat([lng, lat]);
            }
            /* Premier point : on saute dessus au zoom 15. Ensuite on glisse sans
               toucher au zoom — celui qu'a choisi la personne qui regarde. */
            if (premierPoint) map.jumpTo({ center: [lng, lat], zoom: 15 });
            else map.easeTo({ center: [lng, lat], duration: 800 });
            premierPoint = false;
        }

        document.getElementById('val-vitesse').textContent =
            (typeof speed === 'number') ? speed + ' km/h' : '—';
        if (typeof payload.arriveeTs === 'number' && isFinite(payload.arriveeTs)) {
            arriveeTs = payload.arriveeTs;
            majArrivee();
        } else {
            // Ancien APK, ou pas d'arrivée connue (trajet libre) : affichage d'avant.
            arriveeTs = null;
            document.getElementById('val-eta').textContent = eta || '—';
            document.getElementById('val-reste').textContent = '';
        }
        document.getElementById('dest-val').textContent = dest || '—';
        document.getElementById('val-maj').textContent =
            ts ? new Date(ts).toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit', second: '2-digit' }) : '—';
    }

    /* Les messages se vérifient UN PAR UN, dans l'ordre d'arrivée : la vérification
       est asynchrone, et deux vérifications concurrentes liraient le même `dernierTs`
       — le rejeu passerait entre les deux. */
    let dernierTs = null;
    let refusTant = 0;
    let file = Promise.resolve();
    function recevoir(payload) {
        file = file.then(async () => {
            const r = await lireMessagePartage(payload, { sessionId, cle, dernierTs });
            if (!r.ok) {
                refusTant++;
                console.warn('[suivi] message refusé :', r.motif);
                /* Tant qu'aucun message authentique n'est arrivé, on le DIT : sans ça,
                   des refus en série se liraient « en attente », indéfiniment. */
                if (dernierTs === null) statusTxt.textContent = 'Message non authentifié ignoré (' + refusTant + ')';
                return;
            }
            if (typeof r.donnees.ts === 'number') dernierTs = r.donnees.ts;
            afficherPosition(r.donnees);
        }).catch((e) => console.warn('[suivi] exception :', e));
    }

    const client = supabase.createClient(SUPABASE_URL, SUPABASE_KEY);
    const canal = client.channel('liveshare:' + sessionId);

    canal
        .on('broadcast', { event: 'position' }, ({ payload }) => recevoir(payload))
        .subscribe((statut) => {
            // Une confirmation d'abonnement tardive n'efface pas un « En direct » déjà affiché.
            if (statut === 'SUBSCRIBED' && statusEl.className !== 'live') {
                statusTxt.textContent = 'En attente de la première position…';
            } else if (statut === 'CHANNEL_ERROR' || statut === 'TIMED_OUT') {
                afficherErreur("La connexion au suivi a échoué. Vérifie ta connexion et recharge la page.");
            }
        });
}
