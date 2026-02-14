import { getApps, getApp, initializeApp, cert } from 'firebase-admin/app';
import { getAuth } from 'firebase-admin/auth';
import { getFirestore } from 'firebase-admin/firestore';
import { env } from '$env/dynamic/private';
import fs from 'fs';
import path from 'path';

function initializeAdmin() {
    const apps = getApps();
    if (apps.length > 0) return getApp();

    // 1. Try local JSON file first (most reliable)
    try {
        const jsonPath = path.join(process.cwd(), 'src/lib/server/service-account.json');
        if (fs.existsSync(jsonPath)) {
            console.log("🏠 Firebase Admin: Using local service-account.json");
            const serviceAccount = JSON.parse(fs.readFileSync(jsonPath, 'utf8'));
            return initializeApp({
                credential: cert(serviceAccount),
            });
        }
    } catch (error) {
        console.warn("⚠️ Failed to load local JSON file, trying environment variables...");
    }

    // 2. Fall back to environment variables
    const pKey = env.FIREBASE_PRIVATE_KEY || env.FB_PRIVATE_KEY;
    const pId = env.FIREBASE_PROJECT_ID || env.FB_PROJECT_ID;
    const cEmail = env.FIREBASE_CLIENT_EMAIL || env.FB_CLIENT_EMAIL;

    if (pKey && pKey.includes('BEGIN PRIVATE KEY') && pId && cEmail) {
        try {
            console.log("🚀 Firebase Admin: Using Environment Variables");

            // Strip surrounding quotes and replace escaped newlines with actual newlines
            let cleanedKey = pKey.trim();

            // Remove quotes from both ends if present
            if ((cleanedKey.startsWith('"') && cleanedKey.endsWith('"')) ||
                (cleanedKey.startsWith("'") && cleanedKey.endsWith("'"))) {
                cleanedKey = cleanedKey.slice(1, -1);
            }
            // Replace literal \n with actual newline characters
            cleanedKey = cleanedKey.replace(/\\n/g, '\n');

            return initializeApp({
                credential: cert({
                    projectId: pId,
                    clientEmail: cEmail,
                    privateKey: cleanedKey,
                }),
            });
        } catch (error) {
            console.error("❌ Firebase Admin: Failed to initialize with environment variables:", error);
            throw error;
        }
    }

    console.error("❌ Firebase Admin credentials not found in JSON file or Environment Variables.");
    throw new Error("No Firebase credentials available");
}

const app = initializeAdmin();

// プロジェクト全体で使用されているサービスをエクスポート
export const adminAuth = app ? getAuth(app) : ({} as any);
export const adminDb = app ? getFirestore(app) : ({} as any);

export default app;
