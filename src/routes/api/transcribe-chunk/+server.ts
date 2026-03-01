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

        const contentType = request.headers.get('content-type') || '';
        let audioFile: File | null = null;
        let context = "";
        let isFinalCleanup = false;
        let textToClean = "";

        if (contentType.includes('application/json')) {
            const body = await request.json();
            isFinalCleanup = body.isFinalCleanup;
            textToClean = body.text || "";
        } else {
            const formData = await request.formData();
            audioFile = formData.get('audio') as File;
            context = formData.get('context') as string || "";
        }

        if (!isFinalCleanup && (!audioFile || audioFile.size === 0)) {
            console.log('[Transcription] Empty audio chunk received, skipping.');
            return json({ text: "" }, { status: 200 });
        }

        if (!GEMINI_API_KEY) {
            console.error('GEMINI_API_KEY is not defined in .env');
            return json({ error: 'Server configuration error: Missing API Key' }, { status: 500 });
        }

        const genAI = new GoogleGenerativeAI(GEMINI_API_KEY);
        // Using gemini-2.0-flash for high speed and reliability
        const model = genAI.getGenerativeModel({ model: "gemini-2.0-flash" });

        let result;
        if (isFinalCleanup) {
            console.log(`[Transcription] Final Cleanup requested. Text length: ${textToClean.length}`);
            const cleanupPrompt = `あなたは優秀なエディターです。以下の大学講義の書き起こし（低精度なWeb Speech APIによるもの）を読み、文脈から誤字脱字を修正し、読みやすい日本語に清書してください。
【指示】
1. 意味の通らない誤変換（例：「お腹」→「オーナー」）を文脈から推測して直してください。
2. 句読点を適切に補い、読みやすくしてください。
3. 内容の改変や要約は行わず、あくまで「清書」に留めてください。
4. HTML形式ではなく、純粋なテキストのみを返してください。

【対象テキスト】
${textToClean}`;

            result = await model.generateContent(cleanupPrompt);
        } else {
            console.log(`[Transcription] Processing chunk: ${audioFile!.size} bytes, MIME: ${audioFile!.type}`);
            const arrayBuffer = await audioFile!.arrayBuffer();
            let base64Audio = Buffer.from(arrayBuffer).toString('base64');

            // Phase 14: Strip Base64 prefix if it exists (Gemini expects raw Base64)
            base64Audio = base64Audio.replace(/^data:.*?;base64,/, '');

            // Phase 14: Guard for empty data after sanitization
            if (!base64Audio) {
                console.log('[Transcription] Empty Base64 after sanitization, skipping.');
                return json({ text: "" });
            }

            // Phase 14: Simplify MIME type (remove ;codecs=... component)
            const baseMimeType = audioFile!.type.split(';')[0] || "audio/webm";

            const prompt = `大学の講義の書き起こし担当です。一言一句正確に。要約不要。
【直前の文脈】
${context}`;

            result = await model.generateContent([
                {
                    inlineData: {
                        data: base64Audio,
                        mimeType: baseMimeType
                    }
                },
                { text: prompt }
            ]);
        }

        let text = "";
        try {
            text = result.response.text().trim();
        } catch (e) {
            console.warn('[Transcription] Gemini response text failed or blocked:', e);
        }

        console.log(`[Transcription] Successful: ${text.length} chars generated`);
        return json({ text });
    } catch (error: any) {
        console.error('[Server Error Details]:', error);
        return json({
            text: "",
            error: error.message || "Unknown error",
            stack: error.stack
        }, { status: 500 });
    }
};
