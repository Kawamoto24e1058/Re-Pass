import { GoogleGenerativeAI } from "@google/generative-ai";
import { GEMINI_API_KEY } from '$env/static/private';
import { json } from '@sveltejs/kit';
import { adminAuth, adminDb } from '$lib/server/firebase-admin';

export const POST = async ({ request }) => {
    const genAI = new GoogleGenerativeAI(GEMINI_API_KEY);
    try {
        const { uid: bodyUid, subjectId, subjectName, lectures, customInstructions } = await request.json();

        // --- Auth & Usage Check ---
        let uid = bodyUid;
        let isPremium = false;
        let userData: any = null;

        const authHeader = request.headers.get('Authorization');
        if (authHeader && authHeader.startsWith('Bearer ')) {
            try {
                const idToken = authHeader.split('Bearer ')[1];
                const decodedToken = await adminAuth.verifyIdToken(idToken);
                uid = decodedToken.uid; // Prioritize token UID
            } catch (e) {
                console.warn('Auth token verification failed:', e);
            }
        }

        if (!uid || !subjectId) {
            return json({ error: "UID and SubjectID are required" }, { status: 400 });
        }

        // Fetch User Data from Firestore
        const userDoc = await adminDb.collection('users').doc(uid).get();
        userData = userDoc.data();
        isPremium = userData?.plan === 'premium' || userData?.plan === 'season' || userData?.isPro === true;

        // Daily Usage Check for Free Plan
        if (!isPremium) {
            const today = new Date().toISOString().split('T')[0];
            const dailyUsage = userData?.dailyUsage || { count: 0, lastResetDate: today };

            // Reset if it's a new day
            if (dailyUsage.lastResetDate !== today) {
                dailyUsage.count = 0;
                dailyUsage.lastResetDate = today;
            }

            if (dailyUsage.count >= 3) {
                return json({
                    error: "本日の上限に達しました",
                    details: "無料プランの1日あたりの解析上限（3回）に達しました。明日また試すか、Proプランへアップグレードしてください。"
                }, { status: 403 });
            }
        }

        if (!lectures || lectures.length === 0) {
            return json({ error: "No lectures provided" }, { status: 400 });
        }

        // --- Cache Detection & Logic ---
        const analysisRef = adminDb.doc(`users/${uid}/subjects/${subjectId}/seriesAnalysis/latest`);
        const cachedSnap = await analysisRef.get();
        const cachedData = cachedSnap.exists ? cachedSnap.data() : null;

        const currentCount = lectures.length;
        const lastLecture = lectures[currentCount - 1];
        const lastId = lastLecture.id;

        // 1. Semantic Cache Hit (Only if instructions match or are both empty)
        if (cachedData &&
            cachedData.last_lecture_count === currentCount &&
            cachedData.last_lecture_id === lastId &&
            cachedData.customInstructions === (customInstructions || "")) {
            console.log(`[Cache Hit] Subject: ${subjectId}`);
            return json(cachedData.result);
        }

        let prompt = "";
        let isDiff = false;

        // 2. Differential Update (One new lecture added)
        if (cachedData &&
            cachedData.last_lecture_count === currentCount - 1 &&
            lectures[currentCount - 2].id === cachedData.last_lecture_id &&
            cachedData.customInstructions === (customInstructions || "")) {

            console.log(`[Diff Update] Subject: ${subjectId}`);
            isDiff = true;

            const prevSummary = JSON.stringify(cachedData.result);
            prompt = `
You are updating a Series Summary for the subject "${subjectName}".

Previous Summary (Base):
${prevSummary}

New Lecture Added:
Title: ${lastLecture.title}
Date: ${lastLecture.date}
Content: ${lastLecture.content.slice(0, 15000)}

Instructions:
1. Use the "Previous Summary" as your cumulative knowledge base.
2. Integrate the information from the "New Lecture" into the existing "story", "unresolved issues", and "exam predictions".
3. Do NOT delete or contradict previous information unless the new lecture explicitly corrects a prior hypothesis.
4. Maintain a consistent, scholarly, and supportive tone.
5. ${customInstructions ? `Additional User Requirements: ${customInstructions}` : ""}
6. Output MUST be valid JSON with the following structure:
{
    "story": "Markdown text describing the updated narrative arc.",
    "unresolved": "Markdown text identifying new or remaining open questions.",
    "exam": "Markdown text with 3-5 potential exam questions (cumulative)."
}
`;
        } else {
            // 3. Full Reset / Initial Analysis
            console.log(`[Full Analysis] Subject: ${subjectId}`);
            let context = `Subject: ${subjectName}\n\n`;
            lectures.forEach((lecture: any, index: number) => {
                context += `--- Lecture ${index + 1}: ${lecture.title} ---\n`;
                context += `Date: ${lecture.date}\n`;
                context += `Content: ${lecture.content.slice(0, 5000)} ...\n\n`;
            });

            prompt = `
You are an expert academic tutor. Analyze the lectures for "${subjectName}" and generate a "Series Summary Report".
${customInstructions ? `Specific Requirements: ${customInstructions}` : "Focus on creating a structured, insightful summary."}

Output MUST be valid JSON:
{
    "story": "Markdown description of the narrative arc of learning so far.",
    "unresolved": "Markdown identifying open questions and logical gaps.",
    "exam": "Markdown with 3-5 potential exam questions and model answers."
}

Context:
${context}
`;
        }

        const model = genAI.getGenerativeModel({
            model: "gemini-2.0-flash",
            generationConfig: { responseMimeType: "application/json" }
        });

        const result = await model.generateContent(prompt);
        const responseText = result.response.text();
        const parsedResult = JSON.parse(responseText);

        // --- Save to Cache ---
        await analysisRef.set({
            result: parsedResult,
            last_lecture_count: currentCount,
            last_lecture_id: lastId,
            customInstructions: customInstructions || "",
            updatedAt: new Date().toISOString()
        });

        // Match usage increment logic from main analyze API
        if (!isPremium && uid) {
            const today = new Date().toISOString().split('T')[0];
            const dailyUsage = userData?.dailyUsage || { count: 0, lastResetDate: today };

            if (dailyUsage.lastResetDate !== today) {
                dailyUsage.count = 1;
                dailyUsage.lastResetDate = today;
            } else {
                dailyUsage.count += 1;
            }

            await adminDb.collection('users').doc(uid).set({
                dailyUsage: dailyUsage
            }, { merge: true });
        }

        return json(parsedResult);

    } catch (e: any) {
        console.error("Series Analysis Error:", e);
        return json({ error: "Failed to generate series summary", details: e.message }, { status: 500 });
    }
};
