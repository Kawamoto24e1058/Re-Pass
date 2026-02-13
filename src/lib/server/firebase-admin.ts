import { getApps, getApp, initializeApp, cert } from 'firebase-admin/app';
import { getAuth } from 'firebase-admin/auth';
import { getFirestore } from 'firebase-admin/firestore';
// JSONファイルを直接インポート（ViteでJSONを読み込むための記述）
import serviceAccount from './service-account.json';

function initializeAdmin() {
    const apps = getApps();
    if (apps.length > 0) {
        return getApp();
    }

    console.log("🔥 Initializing Firebase Admin with JSON file...");

    return initializeApp({
        credential: cert(serviceAccount as any),
    });
}

const app = initializeAdmin();

// プロジェクト全体で使用されているサービスをエクスポート
export const adminAuth = getAuth(app);
export const adminDb = getFirestore(app);

export default app;
