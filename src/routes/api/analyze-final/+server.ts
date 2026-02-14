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

        // --- Auth Check ---
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

        if (!analyses || analyses.length === 0) {
            return json({ error: "No analysis data provided" }, { status: 400 });
        }

        // --- Hybrid Summary Logic ---

        // 1. Estimate total length and chunk if necessary
        const totalLength = analyses.reduce((acc: number, cur: any) => acc + cur.analysis.length, 0);
        const CHUNK_THRESHOLD = 30000; // Approx 15k-20k tokens for Japanese

        let finalContext = "";

        if (totalLength > CHUNK_THRESHOLD) {
            console.log(`[Hybrid Summary] Large input detected (${totalLength} chars). Splitting into chunks...`);

            // Split analyses into chunks (2-4 groups)
            const numChunks = Math.min(4, Math.ceil(totalLength / CHUNK_THRESHOLD));
            const chunks: any[][] = Array.from({ length: numChunks }, () => []);
            let currentChunkIndex = 0;
            let currentChunkLength = 0;

            analyses.forEach((item: any) => {
                if (currentChunkLength > CHUNK_THRESHOLD && currentChunkIndex < numChunks - 1) {
                    currentChunkIndex++;
                    currentChunkLength = 0;
                }
                chunks[currentChunkIndex].push(item);
                currentChunkLength += item.analysis.length;
            });

            // Stage 1: Parallel Intermediate Summaries (Gemini 2.0 Flash)
            const flashModel = genAI.getGenerativeModel({ model: "gemini-2.0-flash" });

            const intermediateSummaries = await Promise.all(chunks.map(async (chunk, i) => {
                let chunkContext = `Chunk ${i + 1}:\n`;
                chunk.forEach((item, j) => {
                    chunkContext += `Lecture ${j + 1}: ${item.title}\n${item.analysis}\n\n`;
                });

                const intermediatePrompt = `
あなたは学術データの圧縮専門AIです。以下の講義データを、**重要キーワードと論理構造を維持したまま 1/10 の長さに要約**してください。

**【厳守ルール】**
- **固有名詞、専門用語、日付、試験に関する言及**は、絶対に削らずに全て抽出してください。
- 冗長な装飾を省き、事実に基づいた情報密度を最大化してください。
- 出力は構造化されたテキスト形式（箇条書き推奨）としてください。

データ:
${chunkContext}
`;
                const result = await flashModel.generateContent(intermediatePrompt);
                return result.response.text();
            }));

            finalContext = intermediateSummaries.join("\n\n--- Next Section ---\n\n");
        } else {
            // Standard small processing
            let context = `Subject: ${subjectName}\n\n`;
            analyses.forEach((item: any, index: number) => {
                context += `--- Lecture ${index + 1}: ${item.title} ---\n`;
                context += `Summary/Notes: ${item.analysis.slice(0, 5000)}\n\n`;
            });
            finalContext = context;
        }

        const systemPrompt = `
あなたは、大学生が単位を落とさないための「最短・最強の試験対策ノート」を作成する専門AIです。提供された講義データを分析し、以下の 4 つのセクションで構成される対策ノートを生成してください。

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
            model: "gemini-2.0-flash", // Replaced Pro with Flash to avoid 404 and standardize
        });

        const result = await finalModel.generateContent(systemPrompt);
        const responseText = result.response.text();

        return json({ result: responseText });

    } catch (e: any) {
        console.error("Final Analysis Error:", e);
        return json({ error: "Failed to generate final summary", details: e.message }, { status: 500 });
    }
};
