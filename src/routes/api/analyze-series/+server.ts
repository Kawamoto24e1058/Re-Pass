import { GoogleGenerativeAI } from "@google/generative-ai";
import { GEMINI_API_KEY } from '$env/static/private';
import { json } from '@sveltejs/kit';

export const POST = async ({ request }) => {
    // APIキーを使って初期化
    const genAI = new GoogleGenerativeAI(GEMINI_API_KEY);
    try {
        const { subjectName, lectures } = await request.json();

        if (!lectures || lectures.length === 0) {
            return json({ error: "No lectures provided" }, { status: 400 });
        }

        // Prepare context from lectures
        // Limit context to avoid token limits (though Gemini 1.5 Pro is huge, let's be safe-ish or just dump it if it fits)
        // Let's assume we pass: Title, Date, Content (or Analysis if Content is too raw? Content is better for "Story")
        // We'll concatenate them.

        let context = `Subject: ${subjectName}\n\n`;
        lectures.forEach((lecture: any, index: number) => {
            context += `--- Lecture ${index + 1}: ${lecture.title} ---\n`;
            context += `Date: ${lecture.date}\n`;
            context += `Content: ${lecture.content.slice(0, 10000)} ...\n\n`; // Truncate individual lectures if needed, but 2M tokens is a lot.
        });

        const prompt = `
You are an expert academic tutor and curriculum analyst. 
Analyze the following series of lectures for the subject "${subjectName}" and generate a comprehensive "Series Summary Report".

Output MUST be valid JSON with the following structure:
{
    "story": "Markdown text describing the narrative arc of learning so far. What key concepts have been covered and how do they build on each other?",
    "unresolved": "Markdown text identifying open questions, logical connections between lectures, and topics that seem to be setting up future discussions.",
    "exam": "Markdown text providing 3-5 potential exam questions based on the covered material, with brief model answers."
}

Context:
${context}
`;

        const model = genAI.getGenerativeModel({
            model: "gemini-1.5-pro",
            generationConfig: { responseMimeType: "application/json" }
        });

        const result = await model.generateContent(prompt);
        const response = await result.response;
        const text = response.text();

        return json(JSON.parse(text));

    } catch (e) {
        console.error("Series Analysis Error:", e);
        return json({ error: "Failed to generate series summary" }, { status: 500 });
    }
};
