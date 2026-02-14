import { getApps, getApp, initializeApp, cert } from 'firebase-admin/app';
import { getAuth } from 'firebase-admin/auth';
import { getFirestore } from 'firebase-admin/firestore';
import { FB_PROJECT_ID, FB_CLIENT_EMAIL, FB_PRIVATE_KEY } from '$env/static/private';

function initializeAdmin() {
    const apps = getApps();
    if (apps.length > 0) {
        return getApp();
    }

    console.log("🔥 Initializing Firebase Admin with Environment Variables...");

    // Remove quotes if present and replace literal \n with actual newlines
    const privateKey = FB_PRIVATE_KEY?.replace(/^"|"$/g, '').replace(/\\n/g, '\n');

    return initializeApp({
        credential: cert({
            projectId: FB_PROJECT_ID,
            clientEmail: FB_CLIENT_EMAIL,
            privateKey: privateKey,
        }),
    });
}

const app = initializeAdmin();

// プロジェクト全体で使用されているサービスをエクスポート
export const adminAuth = getAuth(app);
export const adminDb = getFirestore(app);

export default app;
