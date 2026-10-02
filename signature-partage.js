/* Vérification des messages du partage live — page de suivi (02/10/2026).

   Pendant de « SIGNATURE DU PARTAGE LIVE » dans `js/00-noyau-calculs.js` (Go_app) :
   l'app signe, cette page vérifie. Fichier SANS DOM exprès : `tests/partage.test.js`
   le charge sous Node pour vérifier qu'un message signé par l'app y est accepté, et
   qu'un message forgé y est refusé. Les deux moitiés vivent dans deux dépôts ; ce
   test est le seul endroit où elles se rencontrent avant le téléphone du suiveur.

   ⚠ Pas de module ES, pas de dépendance : une balise <script> classique, comme l'app. */

/* Base64 « URL » sans remplissage → octets, ou `null` si la chaîne n'en est pas. */
function decoderB64Url(txt) {
    if (typeof txt !== 'string' || !/^[A-Za-z0-9_-]*$/.test(txt)) return null;
    const b64 = txt.replace(/-/g, '+').replace(/_/g, '/') + '==='.slice((txt.length + 3) % 4);
    let bin;
    try { bin = atob(b64); } catch (e) { return null; }
    const octets = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) octets[i] = bin.charCodeAt(i);
    return octets;
}

/* Identifiant `s` et clé publique `k` du lien. Le FRAGMENT d'abord (`#s=…&k=…`, émis
   depuis le 02/10/2026), la requête ensuite (`?s=…`, APK antérieurs) : un lien déjà
   envoyé sur WhatsApp doit continuer de marcher après la mise à jour de cette page.
   `s` et `k` se lisent au MÊME endroit — jamais l'identifiant d'un côté et la clé de
   l'autre. */
function lireLienSuivi(hash, search) {
    const h = new URLSearchParams(String(hash || '').replace(/^#/, ''));
    const q = new URLSearchParams(String(search || '').replace(/^\?/, ''));
    const src = h.get('s') ? h : q;
    return { s: src.get('s') || null, k: src.get('k') || null };
}

/* Clé publique du lien → CryptoKey de vérification, ou `null` si elle est illisible.
   ⚠ `null` ICI N'AUTORISE PAS LES MESSAGES EN CLAIR : un lien qui porte une clé
   abîmée (tronqué par une messagerie, recopié à la main) doit afficher une erreur,
   jamais retomber sur le mode sans signature — ce serait offrir le repli à qui
   voudrait l'obtenir. C'est l'appelant qui tranche, sur la PRÉSENCE de `k`. */
async function importerClePartage(k) {
    const octets = decoderB64Url(k);
    if (!octets || octets.length !== 65) return null;   // point P-256 non compressé
    try {
        return await crypto.subtle.importKey('raw', octets, { name: 'ECDSA', namedCurve: 'P-256' },
                                             false, ['verify']);
    } catch (e) { return null; }
}

/* Lit un message reçu sur le canal. `ctx` : `{ sessionId, cle, dernierTs }` — `cle`
   à `null` pour un lien SANS clé (APK antérieur), où l'on accepte le message en clair
   comme avant. Rend `{ ok: true, donnees }` ou `{ ok: false, motif }`.

   ⚠ `dernierTs` REFUSE LE REJEU : un message authentique capté sur le canal reste
   authentique pour toujours. Le renvoyer plus tard ramènerait le point en arrière, et
   le `active: false` d'une session rejoué au début de la suivante n'est empêché que
   par l'identifiant signé. On exige donc un horodatage STRICTEMENT croissant.
   ⚠ L'appelant doit traiter les messages UN PAR UN (vérification asynchrone) : deux
   vérifications concurrentes liraient le même `dernierTs`. */
async function lireMessagePartage(payload, ctx) {
    const refus = (motif) => ({ ok: false, motif });
    if (!payload || typeof payload !== 'object') return refus('illisible');
    if (!ctx.cle) return { ok: true, donnees: payload };

    if (typeof payload.d !== 'string' || typeof payload.sig !== 'string') return refus('non-signe');
    const sig = decoderB64Url(payload.sig);
    if (!sig || sig.length !== 64) return refus('signature-illisible');
    let valide = false;
    try {
        valide = await crypto.subtle.verify({ name: 'ECDSA', hash: 'SHA-256' }, ctx.cle, sig,
                                            new TextEncoder().encode(payload.d));
    } catch (e) { valide = false; }
    if (!valide) return refus('signature-fausse');

    let d;
    try { d = JSON.parse(payload.d); } catch (e) { return refus('illisible'); }
    if (!d || typeof d !== 'object') return refus('illisible');
    if (d.s !== ctx.sessionId) return refus('autre-session');
    if (typeof d.ts !== 'number' || !isFinite(d.ts)) return refus('sans-date');
    if (ctx.dernierTs !== null && ctx.dernierTs !== undefined && d.ts <= ctx.dernierTs) return refus('rejoue');
    return { ok: true, donnees: d };
}
