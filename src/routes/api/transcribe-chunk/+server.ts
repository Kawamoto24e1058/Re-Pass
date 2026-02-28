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

        if (!audioFile || audioFile.size === 0) {
            console.log('[Transcription] Empty audio chunk received, skipping.');
            return json({ text: "" }, { status: 200 });
        }

        console.log(`[Transcription] Processing chunk: ${audioFile.size} bytes, MIME: ${audioFile.type}`);

        if (!GEMINI_API_KEY) {
            console.error('GEMINI_API_KEY is not defined in .env');
            return json({ error: 'Server configuration error: Missing API Key' }, { status: 500 });
        }

        const genAI = new GoogleGenerativeAI(GEMINI_API_KEY);
        // Using gemini-2.0-flash-lite for minimum cost
        const model = genAI.getGenerativeModel({ model: "gemini-2.0-flash-lite" });

        const arrayBuffer = await audioFile.arrayBuffer();
        const base64Audio = Buffer.from(arrayBuffer).toString('base64');

        const prompt = `大学の講義の書き起こし担当です。一言一句正確に。要約不要。
【直前の文脈】
${context}`;

        let result;
        try {
            result = await model.generateContent([
                {
                    inlineData: {
                        data: base64Audio,
                        mimeType: "audio/webm" // Explicitly specified as audio/webm for Gemini
                    }
                },
                { text: prompt }
            ]);
        } catch (geminiError: any) {
            console.error('[Transcription] Gemini API Call Failed:', geminiError.message);
            // Return 200 with empty text to trigger frontend's buffer-retaining "retry"
            return json({ text: "" });
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
        console.error('--- Transcription API Error ---');
        console.error('Message:', error.message);
        console.error('Stack:', error.stack);
        if (error.response) {
            console.error('Response Data:', JSON.stringify(error.response, null, 2));
        }
        return json({
            error: 'Transcription failed',
            details: error.message
        }, { status: 500 });
    }
};
