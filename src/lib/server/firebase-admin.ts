
import admin from 'firebase-admin';
import { FB_PROJECT_ID, FB_CLIENT_EMAIL, FB_PRIVATE_KEY } from '$env/static/private';

/**
 * Initializes and returns the Firebase Admin SDK.
 * This should only be used in server-side code.
 */
function initializeAdmin() {
    if (!admin.apps.length) {
        console.log('Firebase Admin初期化中...');

        try {
            // Validate required variables
            if (!FB_PROJECT_ID || !FB_CLIENT_EMAIL || !FB_PRIVATE_KEY) {
                const missing = [];
                if (!FB_PROJECT_ID) missing.push('FB_PROJECT_ID');
                if (!FB_CLIENT_EMAIL) missing.push('FB_CLIENT_EMAIL');
                if (!FB_PRIVATE_KEY) missing.push('FB_PRIVATE_KEY');

                throw new Error(`環境変数が不足しています: ${missing.join(', ')}`);
            }

            // 1. Initial cleanup: Trim and remove surrounding quotes
            let cleanedKey = FB_PRIVATE_KEY.trim();
            while ((cleanedKey.startsWith('"') && cleanedKey.endsWith('"')) ||
                (cleanedKey.startsWith("'") && cleanedKey.endsWith("'"))) {
                cleanedKey = cleanedKey.slice(1, -1).trim();
            }

            // 2. Normalize newlines: Convert literal \\n to actual \n and remove Windows \r
            cleanedKey = cleanedKey.replace(/\\n/g, '\n').replace(/\r/g, '');

            // 3. Robust PEM reconstruction
            const HEADER = '-----BEGIN PRIVATE KEY-----';
            const FOOTER = '-----END PRIVATE KEY-----';

            if (!cleanedKey.includes(HEADER) || !cleanedKey.includes(FOOTER)) {
                throw new Error('FB_PRIVATE_KEY が正しい PEM 形式（BEGIN/END PRIVATE KEY 包含）ではありません。');
            }

            // Extract the base64 body and remove any whitespace within it
            let body = cleanedKey
                .replace(HEADER, '')
                .replace(FOOTER, '')
                .replace(/\s+/g, ''); // Remove ALL spaces, tabs, and newlines from body

            if (!body) {
                throw new Error('FB_PRIVATE_KEY の「中身（Base64部分）」が空です。ヘッダーとフッターの間のキー情報を正しく貼り付けてください。');
            }

            // Reconstruct with standard newlines
            const formattedKey = `${HEADER}\n${body}\n${FOOTER}`;

            // Debug Logging (Safe & Detailed)
            console.log('--- Firebase Admin Diagnostic ---');
            console.log(`  Project ID: ${FB_PROJECT_ID}`);
            console.log(`  Client Email: ${FB_CLIENT_EMAIL}`);
            console.log(`  Private Key Length: ${formattedKey.length}`);
            console.log(`  Private Key Prefix: ${formattedKey.substring(0, 30)}...`);
            console.log(`  Private Key Suffix: ...${formattedKey.substring(formattedKey.length - 30)}`);
            console.log('---------------------------------');

            if (formattedKey.length < 1500) {
                console.warn('⚠️ 警告: 秘密鍵が短すぎます。正しい値をコピーしているか確認してください。');
            }

            admin.initializeApp({
                credential: admin.credential.cert({
                    projectId: FB_PROJECT_ID,
                    clientEmail: FB_CLIENT_EMAIL,
                    privateKey: formattedKey,
                })
            });
            console.log('✅ Firebase Admin SDK initialized successfully.');

            // Test call to verify authentication immediately
            const db = admin.firestore();
            db.collection('_health_check').doc('test').get()
                .then(() => console.log('✅ Firestore connection test: SUCCESS'))
                .catch((err) => {
                    console.error('❌ Firestore connection test: FAILED');
                    console.error(`   Error details: ${err.message}`);
                });

        } catch (error: any) {
            console.error('❌ Firebase Admin SDK Initialization Error:', error.message);
            throw new Error(`Firebase Adminの初期化に失敗しました。: ${error.message}`);
        }
    }
    return admin;
}

const firebaseAdmin = initializeAdmin();
export const adminDb = firebaseAdmin.firestore();
export const adminAuth = firebaseAdmin.auth();
export default firebaseAdmin;
