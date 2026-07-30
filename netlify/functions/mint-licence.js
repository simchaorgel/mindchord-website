// Mint an offline licence (.mind) for a client.
//
// A licence is both the client's entitlement to run the desktop app offline AND
// their prescription set — the app reads protocols out of the file instead of
// querying `assigned_sessions`. It is signed with Ed25519; the app carries the
// matching public key and refuses anything it can't verify.
//
// SECURITY: this is a public URL, and it signs things. Two separate concerns:
//
//   1. The caller. Same rules as add-client.js — verify the Supabase JWT,
//      confirm the caller is a clinician with an org, and confirm the TARGET
//      CLIENT is in that same org. Without the last check any authenticated
//      user could mint a licence for any client UUID they can guess.
//
//   2. The signing key. Read from MINDCHORD_LICENCE_KEY (Netlify → Site
//      settings → Environment variables) as a base64 32-byte Ed25519 seed.
//      Anyone holding it can mint a licence for any machine, so it must never
//      reach the browser bundle and must never be committed. If it leaks, the
//      only remedy is shipping a new desktop build with a new public key and
//      reissuing to every existing client.
//
// The signature covers the payload bytes EXACTLY as they are carried in
// `payload_b64` — see the serialise-once note on buildFile(). Do not
// restructure that without reading it.

const crypto = require('crypto');
const { createClient } = require('@supabase/supabase-js');

const SUPABASE_URL = process.env.SUPABASE_URL || 'https://obxibvkhozpulnwnjhoh.supabase.co';
const SECRET_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
const LICENCE_KEY = process.env.MINDCHORD_LICENCE_KEY;

// Licence file format understood by the current desktop build. Bump only for
// changes older builds cannot read — an older app rejects an unknown format
// outright rather than guessing.
const FORMAT = 2;

const ISSUED_BY = 'Mindchord';
const MAX_BAND_HZ = 45;
const DIRECTIONS = ['reward', 'punish'];

// The canonical default when a clinician leaves Z blank. Must agree with the
// protocol editor in console/src/client.njk and with the desktop app.
const DEFAULT_THRESHOLD_Z = 0;

function json(statusCode, body) {
    return { statusCode, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) };
}

// ── Machine codes ────────────────────────────────────────────────────────
// Crockford Base32 excludes I, L, O and U — the characters people mangle when
// reading a code aloud. 12 characters, the last one a position-weighted
// checksum over the first 11 (so transpositions are caught, not just typos).
//
// Duplicated in console/src/client.njk: that copy is UX (validate as you type),
// this one is the gate. A wrong code produces a licence that fails silently on
// the target machine, so it gets checked on both sides.
const CROCKFORD = '0123456789ABCDEFGHJKMNPQRSTVWXYZ';

function normaliseMachineCode(code) {
    return String(code || '').toUpperCase().replace(/[-\s]/g, '')
        .replace(/I/g, '1').replace(/L/g, '1').replace(/O/g, '0');
}

function machineCodeCheckChar(body) {
    let total = 0;
    for (let i = 0; i < body.length; i++) total += (i + 1) * CROCKFORD.indexOf(body[i]);
    return CROCKFORD[total % 32];
}

function isValidMachineCode(code) {
    const c = normaliseMachineCode(code);
    if (c.length !== 12) return false;
    if ([...c].some(ch => !CROCKFORD.includes(ch))) return false;
    return machineCodeCheckChar(c.slice(0, 11)) === c[11];
}

// ── Dates ────────────────────────────────────────────────────────────────
// Licences run for one calendar month from issue. Naive month arithmetic rolls
// 31 Jan into 3 Mar, which reads as a bug on a licence, so clamp to the last
// day of the intended month instead.
function addOneMonthUTC(d) {
    const day = d.getUTCDate();
    const t = new Date(Date.UTC(
        d.getUTCFullYear(), d.getUTCMonth() + 1, day,
        d.getUTCHours(), d.getUTCMinutes(), d.getUTCSeconds(),
    ));
    if (t.getUTCDate() !== day) t.setUTCDate(0);
    return t;
}

// The app parses these; match the documented shape exactly (no milliseconds) —
// an unparseable date is a hard `malformed` rejection at import.
function isoUtc(d) {
    return d.toISOString().replace(/\.\d{3}Z$/, 'Z');
}

// ── Protocol normalisation ───────────────────────────────────────────────
// Mirrors the `assigned_sessions` columns the desktop app reads online, so the
// app cannot tell an offline session from an online one. Anything invalid is a
// refusal rather than a coercion: a licence is signed and can't be recalled, so
// it's better to fail here than to ship a protocol the app interprets oddly.
function normaliseProtocol(row) {
    const bands = Array.isArray(row.bands) ? row.bands : null;
    if (!bands || bands.length < 1 || bands.length > 2) {
        return { error: `“${row.name}” must have one or two bands.` };
    }

    const outBands = [];
    for (const b of bands) {
        const lo = Number(b?.lo);
        const hi = Number(b?.hi);
        const z = b?.threshold_z == null ? DEFAULT_THRESHOLD_Z : Number(b.threshold_z);
        const direction = String(b?.direction || 'reward').toLowerCase();

        if (!Number.isFinite(lo) || !Number.isFinite(hi) || !Number.isFinite(z)) {
            return { error: `“${row.name}” has a band with a non-numeric value.` };
        }
        if (lo <= 0 || hi <= lo || hi > MAX_BAND_HZ) {
            return { error: `“${row.name}” has a band outside 0–${MAX_BAND_HZ} Hz.` };
        }
        if (!DIRECTIONS.includes(direction)) {
            return { error: `“${row.name}” has a band with an unknown direction.` };
        }
        outBands.push({ lo, hi, direction, threshold_z: z });
    }

    const duration = Number(row.duration_seconds);
    if (!Number.isFinite(duration) || duration <= 0) {
        return { error: `“${row.name}” has no valid duration.` };
    }

    return {
        protocol: {
            id: row.id,
            name: row.name,
            description: row.description ?? null,
            bands: outBands,
            // null is meaningful: it means all-channels mode in the app.
            channels: row.channels ?? null,
            duration_seconds: duration,
            calibration_seconds: row.calibration_seconds ?? null,
        },
    };
}

// ── Signing ──────────────────────────────────────────────────────────────
// Node can't import a bare 32-byte Ed25519 seed; it wants PKCS#8. The header
// is fixed for Ed25519, so prepending these 16 bytes is the whole conversion.
// (Skipping it fails with an opaque ASN.1 error, hence the explicit message.)
const ED25519_PKCS8_PREFIX = Buffer.from('302e020100300506032b657004220420', 'hex');

// The public key embedded in the desktop build. NOT secret — it's here purely so
// a misconfigured private key fails loudly on the first mint attempt.
//
// Without this check, the wrong key produces licences that look perfectly fine
// here and are rejected on the client's machine as `unsigned`, with nothing to
// indicate why. That's the one failure mode in this whole flow that can't be
// diagnosed remotely, so it's worth refusing to sign at all.
//
// If the desktop signing key is ever rotated, this constant must move with it.
const EXPECTED_PUBLIC_KEY = 'MeJR0kiOfr5HZ1LKRM6v0YGvD0qx4SpD+0hp7/XN/Js=';

function loadSigningKey(b64) {
    const seed = Buffer.from(String(b64), 'base64');
    if (seed.length !== 32) throw new Error('MINDCHORD_LICENCE_KEY must be a base64-encoded 32-byte Ed25519 seed.');

    const key = crypto.createPrivateKey({
        key: Buffer.concat([ED25519_PKCS8_PREFIX, seed]),
        format: 'der',
        type: 'pkcs8',
    });

    // Derive the public half and compare. In SPKI DER the raw 32-byte key is
    // the tail, after a fixed header.
    const derived = crypto.createPublicKey(key)
        .export({ format: 'der', type: 'spki' })
        .subarray(-32).toString('base64');
    if (derived !== EXPECTED_PUBLIC_KEY) {
        const err = new Error('Signing key does not match the desktop build.');
        err.keyMismatch = true;
        throw err;
    }
    return key;
}

// Serialise ONCE, sign those bytes, base64 those same bytes.
//
// The payload travels base64-encoded rather than as a nested object so the
// verifier never re-serialises it to check the signature. Python and JS don't
// serialise JSON identically — `threshold_z: 1.0` is `1.0` in Python and `1` in
// JS — so a re-serialising scheme would reject perfectly valid licences with a
// bare "invalid signature". Key order and non-ASCII escaping are the same trap.
// Because the bytes are carried, this function may serialise however it likes.
function buildFile(payload, key) {
    const payloadBytes = Buffer.from(JSON.stringify(payload), 'utf8');
    const signature = crypto.sign(null, payloadBytes, key);
    return {
        format: FORMAT,
        signature: signature.toString('base64'),
        payload_b64: payloadBytes.toString('base64'),
    };
}

function filenameFor(profile, expiresAt) {
    const name = [profile.display_name, profile.surname].filter(Boolean).join('-') || 'client';
    const slug = name.toLowerCase().normalize('NFKD')
        .replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'client';
    return `${slug}-${isoUtc(expiresAt).slice(0, 10)}.mind`;
}

exports.handler = async (event) => {
    if (event.httpMethod !== 'POST') return json(405, { error: 'Method not allowed' });
    if (!SECRET_KEY) return json(500, { error: 'Server is not configured.' });
    if (!LICENCE_KEY) return json(500, { error: 'Licence signing is not configured on the server.' });

    // Caller's bearer token.
    const authHeader = event.headers.authorization || event.headers.Authorization || '';
    const token = authHeader.startsWith('Bearer ') ? authHeader.slice(7) : null;
    if (!token) return json(401, { error: 'Not authenticated.' });

    let body;
    try { body = JSON.parse(event.body || '{}'); }
    catch { return json(400, { error: 'Invalid request body.' }); }
    const clientId = String(body.client_id || '').trim();
    if (!clientId) return json(400, { error: 'A client id is required.' });

    let signingKey;
    try { signingKey = loadSigningKey(LICENCE_KEY); }
    catch (err) {
        return json(500, {
            error: err.keyMismatch
                ? 'The licence signing key on the server does not match the Mindchord app. Licences signed with it would be rejected, so none was issued.'
                : 'Licence signing key is misconfigured on the server.',
        });
    }

    const admin = createClient(SUPABASE_URL, SECRET_KEY, { auth: { persistSession: false } });

    // 1. Verify the caller.
    const { data: userData, error: userErr } = await admin.auth.getUser(token);
    if (userErr || !userData?.user) return json(401, { error: 'Not authenticated.' });

    // 2. Confirm they're a clinician in an org.
    const { data: caller, error: callerErr } = await admin
        .from('profiles')
        .select('role, org_id')
        .eq('id', userData.user.id)
        .single();
    if (callerErr || !caller) return json(403, { error: 'Your profile could not be found.' });
    if (caller.role !== 'clinician' || !caller.org_id) {
        return json(403, { error: 'Only clinicians in an organization can issue licences.' });
    }

    // 3. Confirm the target is in the SAME org. That's the whole boundary — it's
    //    what stops a clinician minting for someone else's client.
    //
    //    Role is deliberately NOT checked: clinicians run the app themselves to
    //    try a protocol before assigning it, so any member of the org can be
    //    issued a licence. They reach it the same way, via the organization page.
    const { data: client, error: clientErr } = await admin
        .from('profiles')
        .select('id, org_id, role, display_name, surname, machine_code')
        .eq('id', clientId)
        .maybeSingle();
    if (clientErr) {
        console.error('mint-licence: client lookup failed', clientErr.message);
        return json(500, { error: 'Could not load the client.' });
    }
    if (!client || client.org_id !== caller.org_id) {
        // The response is deliberately identical either way — don't confirm that
        // an id exists in some other organization. The log line is where the
        // actual reason goes (Netlify → Functions → logs); it's server-side
        // only, so it can be specific.
        console.warn('mint-licence: refusing 404', JSON.stringify({
            reason: !client ? 'no profile row with that id' : 'target org does not match caller org',
            client_id: clientId,
            client_org_id: client ? client.org_id : null,
            client_role: client ? client.role : null,
            caller_id: userData.user.id,
            caller_org_id: caller.org_id,
        }));
        return json(404, { error: 'Client not found.' });
    }

    // 4. The machine code binds the licence to one computer. It's entered in
    //    Edit details, ahead of minting, so a missing one is a user-fixable
    //    state rather than an error.
    if (!client.machine_code) {
        return json(400, {
            error: 'No machine code on record for this client. Add it in Edit details first.',
            code: 'no_machine_code',
        });
    }
    if (!isValidMachineCode(client.machine_code)) {
        return json(400, {
            error: 'The stored machine code is not valid. Re-enter it in Edit details.',
            code: 'bad_machine_code',
        });
    }

    // 5. The client's email lives in auth.users, not profiles — the console
    //    can't read it from the browser at all, which is one reason minting has
    //    to happen here.
    const { data: authUser, error: authErr } = await admin.auth.admin.getUserById(clientId);
    if (authErr || !authUser?.user?.email) {
        return json(500, { error: 'Could not read the client’s account email.' });
    }

    const { data: org } = await admin
        .from('organizations').select('name').eq('id', caller.org_id).single();

    // 6. Active prescriptions only — archived rows are kept for history and
    //    must not ship in a new licence.
    const { data: rows, error: protoErr } = await admin
        .from('assigned_sessions')
        .select('id, name, description, bands, channels, duration_seconds, calibration_seconds')
        .eq('client_id', clientId)
        .is('archived_at', null)
        .order('created_at', { ascending: true });
    if (protoErr) return json(500, { error: 'Could not load the client’s protocols.' });
    if (!rows || rows.length === 0) {
        return json(400, {
            error: 'This client has no active protocols, so a licence would be unusable.',
            code: 'no_protocols',
        });
    }

    const protocols = [];
    for (const row of rows) {
        const { protocol, error } = normaliseProtocol(row);
        if (error) return json(400, { error, code: 'bad_protocol' });
        protocols.push(protocol);
    }

    // 7. Build, sign, wrap.
    //
    // `issued_at` is server time. Do NOT back-date it: the app rejects a
    // licence whose machine clock reads earlier than issued_at (`clock_invalid`),
    // because it won't rule on dates it can't trust.
    const issuedAt = new Date();
    const expiresAt = addOneMonthUTC(issuedAt);

    const payload = {
        licence: {
            machine_code: client.machine_code,
            issued_at: isoUtc(issuedAt),
            expires_at: isoUtc(expiresAt),
            issued_by: ISSUED_BY,
            clinic: org?.name ?? null,
        },
        user: {
            // The real auth.users UUID, so exported session logs stay
            // re-importable later without matching on names.
            id: clientId,
            email: authUser.user.email,
            first_name: client.display_name ?? null,
        },
        protocols,
    };

    let file;
    try { file = buildFile(payload, signingKey); }
    catch { return json(500, { error: 'Could not sign the licence.' }); }

    // 8. Record what we issued. This is not just display: the protocol editor
    //    reads licence_issued_at to decide whether editing a protocol must
    //    create a new version instead of rewriting one a client already holds.
    //    A failure here would silently break that, so it's fatal — the clinician
    //    retries rather than receiving a file we have no record of.
    const { error: stampErr } = await admin
        .from('profiles')
        .update({
            licence_issued_at: isoUtc(issuedAt),
            licence_expires_at: isoUtc(expiresAt),
        })
        .eq('id', clientId);
    if (stampErr) return json(500, { error: 'Licence was signed but could not be recorded. Please try again.' });

    return json(200, {
        filename: filenameFor(client, expiresAt),
        // Already-serialised file text. Pretty-printing the outer wrapper is
        // safe — the signature covers only the bytes inside payload_b64, which
        // are carried verbatim.
        contents: JSON.stringify(file, null, 2),
        issued_at: isoUtc(issuedAt),
        expires_at: isoUtc(expiresAt),
        protocol_count: protocols.length,
    });
};
