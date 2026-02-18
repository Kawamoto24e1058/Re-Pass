import { GoogleGenerativeAI } from "@google/generative-ai";
import { GEMINI_API_KEY } from '$env/static/private';
import { json } from '@sveltejs/kit';
import { adminAuth, adminDb } from '$lib/server/firebase-admin';

export const config = {
    maxDuration: 60
};

export const POST = async ({ request }) => {
    const genAI = new GoogleGenerativeAI(GEMINI_API_KEY);
    try {
        const { subjectName, analyses, customInstructions } = await request.json();

        // --- Auth & Data Check ---
        let uid: string | null = null;
        let userData: any = null;
        let isPremium = false;
        let isUltimate = false;

        console.log(`🚀 [Analyze-Final] Start processing for subject: ${subjectName}`);

        const authHeader = request.headers.get('Authorization');
        if (authHeader && authHeader.startsWith('Bearer ')) {
            try {
                const idToken = authHeader.split('Bearer ')[1];
                const decodedToken = await adminAuth.verifyIdToken(idToken);
                uid = decodedToken.uid;
                console.log(`✅ [Analyze-Final] Auth Verified for UID: ${uid}`);

                // Fetch latest user data for plan verification
                try {
                    const userDoc = await adminDb.collection('users').doc(uid).get();
                    if (userDoc.exists) {
                        userData = userDoc.data();
                        const plan = String(userData?.plan || '').trim().toLowerCase();
                        isPremium = ['premium', 'ultimate', 'season', 'pro'].includes(plan);
                        isUltimate = plan === 'ultimate';
                        console.log(`💎 [Analyze-Final] Plan: ${plan} (Premium: ${isPremium}, Ultimate: ${isUltimate})`);
                    }
                } catch (dbError) {
                    console.warn("⚠️ [Analyze-Final] Failed to fetch user data:", dbError);
                }
            } catch (e) {
                console.warn('⚠️ [Analyze-Final] Auth token verification failed:', e);
            }
        }

        if (!analyses || analyses.length === 0) {
            console.error("❌ [Analyze-Final] No analysis data provided");
            return json({ error: "No analysis data provided" }, { status: 400 });
        }

        // --- Data Sanitization ---
        const sanitizedAnalyses = analyses.map((item: any, index: number) => {
            let safeAnalysis = "";
            try {
                if (typeof item.analysis === 'string') {
                    safeAnalysis = item.analysis;
                } else if (typeof item.analysis === 'object' && item.analysis !== null) {
                    // Try to extract content if it looks like a structure we know, or just stringify
                    safeAnalysis = (item.analysis as any).content || (item.analysis as any).summary || JSON.stringify(item.analysis);
                } else {
                    safeAnalysis = String(item.analysis || "");
                }
            } catch (e) {
                console.warn(`⚠️ [Analyze-Final] Failed to sanitize item ${index}:`, e);
                safeAnalysis = "";
            }
            return { ...item, analysis: safeAnalysis };
        });

        // --- Hybrid Summary Logic ---

        // 1. Estimate total length and chunk if necessary
        const totalLength = sanitizedAnalyses.reduce((acc: number, cur: any) => acc + (cur.analysis?.length || 0), 0);
        const CHUNK_THRESHOLD = 30000; // Approx 15k-20k tokens for Japanese

        let finalContext = "";

        if (totalLength > CHUNK_THRESHOLD) {
            console.log(`[Hybrid Summary] Large input detected (${totalLength} chars). Splitting into chunks...`);

            // Split analyses into chunks (2-4 groups)
            const numChunks = Math.min(4, Math.ceil(totalLength / CHUNK_THRESHOLD));
            const chunks: any[][] = Array.from({ length: numChunks }, () => []);
            let currentChunkIndex = 0;
            let currentChunkLength = 0;

            sanitizedAnalyses.forEach((item: any) => {
                const len = item.analysis?.length || 0;
                if (currentChunkLength + len > CHUNK_THRESHOLD && currentChunkIndex < numChunks - 1) {
                    currentChunkIndex++;
                    currentChunkLength = 0;
                }
                chunks[currentChunkIndex].push(item);
                currentChunkLength += len;
            });

            // Stage 1: Parallel Intermediate Summaries (Gemini 2.0 Flash)
            const flashModel = genAI.getGenerativeModel({ model: "gemini-2.0-flash" });

            const intermediateSummaries = await Promise.all(chunks.map(async (chunk, i) => {
                let chunkContext = `Chunk ${i + 1}:\n`;
                chunk.forEach((item, j) => {
                    chunkContext += `【ソース${j + 1}: ${item.title}】\n${item.analysis}\n\n`;
                });

                const intermediatePrompt = `
あなたは優秀な学習アシスタントです。以下の複数の講義データ（スライド、文字起こし等）を統合し、**矛盾なく、かつ補完し合った包括的な要約**を作成してください。

**【統合ルール】**
1. **スライド/板書**と思われる内容から「構造・専門用語・定義」を骨子として抽出してください。
2. **文字起こし**と思われる内容から「具体的な説明・事例・ニュアンス」を肉付けしてください。
3. すべての情報を 1/10 の長さに圧縮しつつ、試験に出る重要なキーワードは漏らさないでください。

データ:
${chunkContext}
`;
                try {
                    const result = await flashModel.generateContent(intermediatePrompt);
                    return result.response.text();
                } catch (chunkError) {
                    console.error(`⚠️ [Analyze-Final] Chunk ${i} generation failed:`, chunkError);
                    return ""; // Skip this chunk if it fails
                }
            }));

            finalContext = intermediateSummaries.join("\n\n--- Next Section ---\n\n");
        } else {
            // Standard small processing
            let context = `Subject: ${subjectName}\n\n`;
            sanitizedAnalyses.forEach((item: any, index: number) => {
                context += `【ソース${index + 1}: ${item.title}】\n`;
                // Safe slice
                const content = item.analysis || "";
                context += `(内容):\n${content.slice(0, 5000)}\n\n`;
            });
            finalContext = context;
        }

        const systemPrompt = `
あなたは優秀な学習アシスタントです。以下の【スライド構成】と【講義の文字起こし】という2つの異なるソースから、矛盾なく、かつ補完し合った包括的な要約を作成してください。

**【統合方針】**
- **スライドにある専門用語や構造**を「骨子」として採用してください。
- **文字起こしの詳細な説明**でその骨子を「肉付け」してください。

**【重要：回答のスタイルとルール】**
1. **### 各見出しの直後に必ず1行の空行を入れること。**
2. **要旨（冒頭）は3行以内**で全体のポイントを記述してください。
3. **視覚的メリハリ**: 重要な結論やアドバイスには \`> [!IMPORTANT]\` または引用ブロックを使用してください。
4. **比較・分類**: 対比構造がある場合は、必ず Markdown テーブル（モバイル配慮でシンプルに）で整理してください。
5. **HTMLタグ禁止**: 全て純粋な Markdown 形式で記述してください。

### 【要旨】

### 【1. 絶対暗記：試験出現ポイント】
講義内で「ここが出る」「重要」と明示された箇所、または複数回言及された概念を最優先でリストアップしてください。

### 【2. 用語攻略：重要単語辞典】
試験で問われやすい専門用語を抽出し、\`**用語名**: 定義\` の形式で簡潔に記載してください。

### 【3. 論述対策：因果関係のまとめ】
論述問題でそのまま使える形式で、論理の骨組みを整理してください。

### 【4. AI予想問題（解答・解説付き）】
試験で想定される問題を 3〜5 問作成してください。
- 全ての問題に「正解」と「解説」を必ず付けること。
- 出力フォーマット：
  問題: [問い]
  正解: [答え]
  解説: [根拠]

${customInstructions ? `\nユーザーからの追加指示:\n${customInstructions}\n` : ""}

Context (Processed Summaries):
${finalContext}
`;

        // Automatic model selection if needed
        let modelName = "gemini-2.0-flash";
        /* 
        // If using v1beta and dynamic selection is desired:
        try {
            const models = await genAI.listModels();
            const latest = models.find(m => m.name.includes("flash"))?.name;
            if (latest) modelName = latest.split("/").pop() || modelName;
        } catch (e) {
            console.warn("Failed to list models, using fallback:", modelName);
        }
        */

        // Stage 2: Final Integration (Gemini 2.0 Flash)
        const finalModel = genAI.getGenerativeModel({
            model: "gemini-2.0-flash",
            generationConfig: {
                maxOutputTokens: 8192,
            }
        });

        const result = await finalModel.generateContent(systemPrompt);
        const responseText = result.response.text();

        return json({ result: responseText });

    } catch (e: any) {
        console.error("🚨 [Analyze-Final] Critical Error:", e);
        console.error("Stack:", e.stack);
        return json({
            error: "Failed to generate final summary",
            details: e.message,
            debug: process.env.NODE_ENV === 'development' ? e.stack : undefined
        }, { status: 500 });
    }
};
