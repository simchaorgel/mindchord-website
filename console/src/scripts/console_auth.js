// Shared Supabase client + auth helpers for the clinician console.
// Loaded after the supabase-js UMD bundle, which exposes `window.supabase`.

const SUPABASE_URL = "https://obxibvkhozpulnwnjhoh.supabase.co";
const SUPABASE_ANON_KEY = "sb_publishable_YPNhlhA1Wii-4U6oFyjeog_t2twadVz";

const sb = window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

async function getSession() {
    const { data } = await sb.auth.getSession();
    return data.session;
}

// Redirect to login if there is no session. Use on gated pages.
async function requireSession(loginUrl = "/console/login/") {
    const session = await getSession();
    if (!session) window.location.replace(loginUrl);
    return session;
}

// Redirect away if a session already exists. Use on the login page.
async function redirectIfSignedIn(targetUrl = "/console/dashboard/") {
    const session = await getSession();
    if (session) window.location.replace(targetUrl);
}

async function sendOtp(email) {
    return sb.auth.signInWithOtp({
        email,
        options: { shouldCreateUser: false },
    });
}

async function verifyOtp(email, token) {
    return sb.auth.verifyOtp({ email, token, type: "email" });
}

async function signOut() {
    await sb.auth.signOut();
    window.location.replace("/console/login/");
}

window.consoleAuth = { sb, getSession, requireSession, redirectIfSignedIn, sendOtp, verifyOtp, signOut };
