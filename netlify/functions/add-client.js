// Add-client endpoint. Creates a Supabase auth user (an allowlisted client)
// scoped to the calling clinician's organization.
//
// SECURITY: this is a public URL, so it must authenticate its caller — the
// secret key alone is not enough. Every call:
//   1. verifies the caller's Supabase JWT,
//   2. confirms the caller is a clinician with an org,
//   3. forces the new client into THAT org (never trusting client-supplied org).
//
// The secret key is read from the SUPABASE_SECRET_KEY env var (set in
// Netlify → Site settings → Environment variables). It must never reach the
// browser bundle.

const { createClient } = require('@supabase/supabase-js');

const SUPABASE_URL = process.env.SUPABASE_URL || 'https://obxibvkhozpulnwnjhoh.supabase.co';
const SECRET_KEY = process.env.SUPABASE_SECRET_KEY;

const EMAIL_RE = /^[^@\s]+@[^@\s]+\.[^@\s]+$/;

function json(statusCode, body) {
    return { statusCode, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) };
}

exports.handler = async (event) => {
    if (event.httpMethod !== 'POST') return json(405, { error: 'Method not allowed' });
    if (!SECRET_KEY) return json(500, { error: 'Server is not configured.' });

    // Caller's bearer token.
    const authHeader = event.headers.authorization || event.headers.Authorization || '';
    const token = authHeader.startsWith('Bearer ') ? authHeader.slice(7) : null;
    if (!token) return json(401, { error: 'Not authenticated.' });

    // Body.
    let payload;
    try { payload = JSON.parse(event.body || '{}'); }
    catch { return json(400, { error: 'Invalid request body.' }); }
    const email = String(payload.email || '').trim().toLowerCase();
    const displayName = String(payload.display_name || '').trim();
    if (!EMAIL_RE.test(email)) return json(400, { error: 'A valid email address is required.' });

    const admin = createClient(SUPABASE_URL, SECRET_KEY, { auth: { persistSession: false } });

    // 1. Verify the caller.
    const { data: userData, error: userErr } = await admin.auth.getUser(token);
    if (userErr || !userData?.user) return json(401, { error: 'Not authenticated.' });

    // 2. Confirm they're a clinician in an org.
    const { data: caller, error: profErr } = await admin
        .from('profiles')
        .select('role, org_id')
        .eq('id', userData.user.id)
        .single();
    if (profErr || !caller) return json(403, { error: 'Your profile could not be found.' });
    if (caller.role !== 'clinician' || !caller.org_id) {
        return json(403, { error: 'Only clinicians in an organization can add clients.' });
    }
    const orgId = caller.org_id;

    // 3. Friendly pre-check of the client limit (the DB trigger is the real guard).
    const { data: org } = await admin
        .from('organizations').select('client_limit').eq('id', orgId).single();
    if (org && org.client_limit != null) {
        const { count } = await admin
            .from('profiles')
            .select('*', { count: 'exact', head: true })
            .eq('org_id', orgId)
            .eq('role', 'client');
        if ((count ?? 0) >= org.client_limit) {
            return json(409, { error: `Client limit reached (max ${org.client_limit}).` });
        }
    }

    // 4. Create the user. handle_new_user reads this metadata and populates the
    //    profile atomically; the limit trigger rolls the whole insert back if
    //    the cap is hit (e.g. a race after the pre-check) — no orphan user.
    const { data: created, error: createErr } = await admin.auth.admin.createUser({
        email,
        email_confirm: true,
        app_metadata: { org_id: orgId, role: 'client' },
        user_metadata: displayName ? { display_name: displayName } : {},
    });

    if (createErr) {
        const msg = (createErr.message || '').toLowerCase();
        if (msg.includes('already') || msg.includes('registered') || msg.includes('exist')) {
            return json(409, { error: 'A user with that email already exists.' });
        }
        if (msg.includes('limit')) {
            return json(409, { error: 'Client limit reached.' });
        }
        return json(500, { error: 'Could not create the client. Please try again.' });
    }

    return json(200, { id: created.user.id, email });
};
