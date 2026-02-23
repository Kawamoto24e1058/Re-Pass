import { GoogleGenerativeAI } from "@google/generative-ai";
import { GEMINI_API_KEY } from '$env/static/private';
import { json } from '@sveltejs/kit';
import { adminAuth, adminDb } from '$lib/server/firebase-admin';

export const config = {
    maxDuration: 60
};

export const POST = async ({ request }) => {
    try {
        // --- Auth & Plan Check ---
        let uid: string | null = null;
        const authHeader = request.headers.get('Authorization');
        if (authHeader && authHeader.startsWith('Bearer ')) {
            try {
                const idToken = authHeader.split('Bearer ')[1];
                const decodedToken = await adminAuth.verifyIdToken(idToken);
                uid = decodedToken.uid;
            } catch (e) {
                console.warn('Auth token verification failed:', e);
            }
        }

        if (!uid) {
            return json({ error: "ログインが必要です" }, { status: 401 });
        }

        // Fetch User Profile to strictly check plan
        const userDoc = await adminDb.collection('users').doc(uid).get();
        if (!userDoc.exists) {
            return json({ error: "ユーザー情報が見つかりません" }, { status: 404 });
        }
        const userData = userDoc.data();
        if (userData?.plan === 'free' || !userData?.plan) {
            return json({ error: "この機能は有料プラン限定です" }, { status: 403 });
        }

        const formData = await request.formData();
        const imageFile = formData.get('image') as File;

        if (!imageFile) {
            return json({ error: "画像ファイルが提供されていません" }, { status: 400 });
        }

        // Parse Image for Gemini
        const buffer = await imageFile.arrayBuffer();
        const base64Image = Buffer.from(buffer).toString("base64");
        const mimeType = imageFile.type || "image/jpeg";

        const genAI = new GoogleGenerativeAI(GEMINI_API_KEY);
        const model = genAI.getGenerativeModel({ model: "gemini-2.0-flash" });

        const prompt = `ユーザーがアップロードした時間割やシラバスの画像から、講義名と担当教員名を抽出してください。
出力は必ず以下のJSON形式の配列のみとし、マークダウンやその他のテキストは一切含めないでください。
[
  {"courseName": "経済学入門", "instructor": "山田太郎"},
  {"courseName": "プログラミングI", "instructor": "鈴木一郎"}
]`;

        const result = await model.generateContent([
            prompt,
            {
                inlineData: {
                    data: base64Image,
                    mimeType: mimeType
                }
            }
        ]);

        const response = await result.response;
        const text = response.text();

        let cleanedText = text.trim();
        const firstBracket = cleanedText.indexOf('[');
        const lastBracket = cleanedText.lastIndexOf(']');
        if (firstBracket !== -1 && lastBracket !== -1) {
            cleanedText = cleanedText.substring(firstBracket, lastBracket + 1);
        }

        return json({ result: JSON.parse(cleanedText) });

    } catch (globalError: any) {
        console.error("Course Extraction Error:", globalError);
        return json({ error: "サーバー内でエラーが発生しました", details: globalError.message }, { status: 500 });
    }
};
