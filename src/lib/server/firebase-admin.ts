import { getApps, getApp, initializeApp, cert } from 'firebase-admin/app';
import { getAuth } from 'firebase-admin/auth';
import { getFirestore } from 'firebase-admin/firestore';
import { env } from '$env/dynamic/private';
import fs from 'fs';
import path from 'path';

function initializeAdmin() {
    const apps = getApps();
    if (apps.length > 0) {
        return getApp();
    }

    // Try Environment Variables First (Dynamic to avoid build-time issues)
    const projectId = env.FB_PROJECT_ID || env.FIREBASE_PROJECT_ID;
    const clientEmail = env.FB_CLIENT_EMAIL || env.FIREBASE_CLIENT_EMAIL;
    const privateKey = (env.FB_PRIVATE_KEY || env.FIREBASE_PRIVATE_KEY)?.replace(/\\n/g, '\n').replace(/^"|"$/g, '');

    if (projectId && clientEmail && privateKey) {
        console.log("🔥 Initializing Firebase Admin with Environment Variables...");
        return initializeApp({
            credential: cert({
                projectId,
                clientEmail,
                privateKey
            }),
        });
    }

    // Fallback: Dynamic File Loading (Avoids build-time resolution by static analyzers)
    // We use path.resolve with process.cwd() or similar relative to the runtime env
    const jsonPath = path.join(process.cwd(), 'src/lib/server/service-account.json');
    if (fs.existsSync(jsonPath)) {
        console.log("🔥 Initializing Firebase Admin with Local JSON file (dynamic)...");
        try {
            const serviceAccount = JSON.parse(fs.readFileSync(jsonPath, 'utf8'));
            return initializeApp({
                credential: cert(serviceAccount),
            });
        } catch (e) {
            console.error("❌ Failed to parse service-account.json dynamically:", e);
        }
    }

    console.error("❌ Firebase Admin credentials NOT found in environment or local file.");
    throw new Error("Unable to initialize Firebase Admin SDK. Please check your environment variables or local service-account.json file.");
}

const app = initializeAdmin();

// プロジェクト全体で使用されているサービスをエクスポート
export const adminAuth = getAuth(app);
export const adminDb = getFirestore(app);

export default app;
