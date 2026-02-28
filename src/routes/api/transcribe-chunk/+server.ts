import { GoogleGenerativeAI } from "@google/generative-ai";
import { GEMINI_API_KEY } from '$env/static/private';
import { json, type RequestHandler } from '@sveltejs/kit';
import { adminAuth } from '$lib/server/firebase-admin';

export const config = {
    maxDuration: 60
};

export const POST: RequestHandler = async ({ request }) => {
    try {
        const authHeader = request.headers.get('Authorization');
        if (!authHeader || !authHeader.startsWith('Bearer ')) {
            return json({ error: 'Unauthorized' }, { status: 401 });
        }

        const idToken = authHeader.split('Bearer ')[1];
        const decodedToken = await adminAuth.verifyIdToken(idToken);
        const uid = decodedToken.uid;

        const formData = await request.formData();
        const audioFile = formData.get('audio') as File;
        const context = formData.get('context') as string || "";

        if (!audioFile) {
            return json({ error: 'No audio file' }, { status: 400 });
        }

        const genAI = new GoogleGenerativeAI(GEMINI_API_KEY);
        const model = genAI.getGenerativeModel({ model: "gemini-1.5-flash" }); // Use 1.5 flash for speed/cost or 2.0 if available

        const arrayBuffer = await audioFile.arrayBuffer();
        const base64Audio = Buffer.from(arrayBuffer).toString('base64');

        const prompt = `あなたは非常に精密な文字起こしアシスタントです。
提供された5秒間の音声データを、文字に起こしてください。

【重要な指示】
1. この音声は広い講義室で遠くから録音されたものです。反響や環境ノイズが含まれますが、文脈から判断して、大学の講義内容として自然な日本語に補完して書き起こしてください。
2. 直前の文脈（context）が提供されている場合、その文脈に続くように自然に文字起こしをしてください。
3. 音声が途切れている場合や不明瞭な場合でも、文脈から推測して最も自然な日本語を生成してください。
4. 余計な解説や、文末の句読点以外の記号は含めないでください。
5. 文字起こしされたテキストのみを返却してください。

【直前の文脈】
${context}
`;

        const result = await model.generateContent([
            {
                inlineData: {
                    data: base64Audio,
                    mimeType: audioFile.type || "audio/webm"
                }
            },
            { text: prompt }
        ]);

        const text = result.response.text().trim();

        return json({ text });
    } catch (error: any) {
        console.error('Transcription error:', error);
        return json({ error: error.message }, { status: 500 });
    }
};
