import { GoogleGenerativeAI } from "@google/generative-ai";
import { GEMINI_API_KEY } from '$env/static/private';
import { json } from '@sveltejs/kit';
import { adminAuth, adminDb } from '$lib/server/firebase-admin';

export const config = {
    maxDuration: 60
};

export const POST = async ({ request }) => {
    try {
        const genAI = new GoogleGenerativeAI(GEMINI_API_KEY);

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

        if (!uid) {
            return json({ error: "解析にはログインが必要です" }, { status: 401 });
        }

        const { sourceAnalysis, targetMode, targetLength } = await request.json();

        if (!sourceAnalysis || !targetMode) {
            return json({ error: "不足しているパラメータがあります" }, { status: 400 });
        }

        const tolerance = targetLength >= 1000 ? 0.05 : 0.1;
        const minLength = Math.floor(targetLength * (1 - tolerance));
        const maxLength = Math.floor(targetLength * (1 + tolerance));

        let systemPrompt = "";
        const jsonSchema = `
  出力は必ず以下のJSON形式で行ってください。
  重要：Markdownのコードブロック（\`\`\`jsonなど）は絶対に使用しないでください。純粋なJSON文字列のみを出力してください。
  **厳守**: JSON文字列内（summaryなど）で改行が必要な場合は、必ずエスケープシーケンス（\\n）を使用し、リテラルの改行コードを含めないでください。
  {
    "summary": "ここにMarkdown形式で構成された本文を記述",
    "glossary": [
      { "term": "用語1", "definition": "解説1" }
    ]
  }
  `;

        switch (targetMode) {
            case "thoughts":
                systemPrompt = `あなたは講義を受講した「熱心な学生」です。提示された要約を基に、丁寧語（です・ます調）でリアクションペーパー（感想文）を作成します。
      ${jsonSchema}
      **【出力フォーマット・ルール】**:
      1. **### 各見出しの直後に必ず1行の空行を入れること。**
      2. **要旨（冒頭）は3行以内**で簡潔に記述してください。
      3. **重要な結論**: \`> [!IMPORTANT]\` または引用ブロックで強調してください。

      summaryの中身は以下の構成にしてください:
      ### 【要旨】
      
      ### 【講義で得た気づき】
      
      ### 【考察と今後の課題】`;
                break;

            case "report":
                systemPrompt = `あなたは「論理적批評家」です。提示された要約を基に、常体（だ・である調）で学術レポートを作成します。
      ${jsonSchema}
      **【出力フォーマット・ルール】**:
      1. **### 各見出しの直後に必ず1行の空行を入れること。**
      2. **要旨（冒頭）は3行以内**で論旨を簡潔にまとめてください。
      3. **複雑な対比**: シンプルな Markdown テーブルを使用してください。

      summaryの中身は以下の構成にしてください:
      ### 【序論：テーマの提示】
      
      ### 【本論：論理的分析】
      
      ### 【結論】`;
                break;

            case "note":
            default:
                systemPrompt = `あなたは「優秀な書記」です。提示された要約を基に、事実関係の正確さを最優先し、講義内容を構造化した講義ノートを作成します。
      ${jsonSchema}
      **【出力フォーマット・ルール】**:
      1. **### 各見出しの直後に必ず1行の空行を入れること。**
      2. **要旨は3行以内**で全体の核心を記述してください。
      3. **重要ポイント**: \`> [!IMPORTANT]\` 等で視覚的に強調してください。

      summaryの中身は以下の構成にしてください:
      ### 【要旨】
      
      ### 【講義のポイント】`;
                break;
        }

        let formatRules = "";
        if (targetMode === "note") {
            formatRules = `
【重要ルール：フォーマットと文字数】
1. 文字数制限は設けません。講義内容を省略せず網羅的に記載してください。
2. Markdownを駆使して、見出しと箇条書きを使った最も見やすく理解しやすい構造で詳細なノートを作成してください。
3. 【超重要】プレーンテキストの塊にすることは絶対にやめてください。「## 見出し」「- 箇条書き」「太字」「適切な改行（空行）」を必ず使用して視覚的に整理してください。`;
        } else {
            formatRules = `
【重要ルール：フォーマットと文字数】
1. 出力する要約の文字数は、約 ${targetLength} 文字（許容範囲: ±15%）を目安にしてください。
2. 【超重要】文字数合わせのために改行を消したり、プレーンテキストの塊にすることは絶対にやめてください。
3. 必ずMarkdown形式を使用し、「## 見出し」「- 箇条書き」「太字」「適切な改行（空行）」を駆使して、人間が視覚的に読みやすく、コピー＆ペーストした際にも綺麗に構造化された文章を作成してください。`;
        }

        const prompt = `
  ${systemPrompt}

  以下の【元となる解析結果】を基に、指定された形式に書き換えてください。
${formatRules}

  【元となる解析結果】
  ${sourceAnalysis}
  `;

        try {
            const model = genAI.getGenerativeModel({ model: "gemini-2.0-flash" });
            const result = await model.generateContent(prompt);
            const response = await result.response;
            const text = response.text();

            let cleanedText = text.trim();
            const firstCurly = cleanedText.indexOf('{');
            const lastCurly = cleanedText.lastIndexOf('}');
            if (firstCurly !== -1 && lastCurly !== -1) {
                cleanedText = cleanedText.substring(firstCurly, lastCurly + 1);
            }

            return json({ result: JSON.parse(cleanedText) });
        } catch (error: any) {
            console.error("Gemini Generation Error:", error);
            return json({ error: "生成に失敗しました: " + error.message }, { status: 500 });
        }
    } catch (globalError: any) {
        console.error("Derivative Analysis Global Error:", globalError);
        return json({ error: "サーバー内でエラーが発生しました", details: globalError.message }, { status: 500 });
    }
};
