import { GoogleGenerativeAI } from "@google/generative-ai";
import { GEMINI_API_KEY } from '$env/static/private';
import { json } from '@sveltejs/kit';
import { adminAuth, adminDb } from '$lib/server/firebase-admin';

// genAI will be initialized inside the POST handler to avoid build-time issues with $env/static/private
export const POST = async ({ request }) => {
  // APIキーを使って初期化
  const genAI = new GoogleGenerativeAI(GEMINI_API_KEY);

  // --- Auth & Usage Check ---
  let uid: string | null = null;
  let isPremium = false;
  let userData: any = null;

  const authHeader = request.headers.get('Authorization');
  if (authHeader && authHeader.startsWith('Bearer ')) {
    try {
      const idToken = authHeader.split('Bearer ')[1];
      const decodedToken = await adminAuth.verifyIdToken(idToken);
      uid = decodedToken.uid;

      const userDoc = await adminDb.collection('users').doc(uid).get();
      userData = userDoc.data();
      isPremium = userData?.plan === 'premium' || userData?.plan === 'season' || userData?.isPro === true;
    } catch (e) {
      console.warn('Auth token verification failed:', e);
    }
  }

  // Daily Usage Check for Free Plan
  if (!isPremium && uid) {
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
  } else if (!isPremium && !uid) {
    // If not logged in and not premium, we still want to limit or require login
    // For now, let's assume we need a user to track usage
    return json({ error: "解析にはログインが必要です" }, { status: 401 });
  }

  const formData = await request.formData();
  const mode = formData.get('mode') as string || "note";
  const targetLength = parseInt(formData.get('targetLength') as string || "1000");
  let transcript = formData.get('transcript') as string || "";

  // Backend Plan Check (Redundant but kept for safety)
  if (!isPremium) {
    if (mode === 'thoughts' || mode === 'report') {
      return json({ error: "この機能はプレミアム限定です" }, { status: 403 });
    }
  }

  // Handle Text File
  const txtFile = formData.get('txt') as File;
  if (txtFile) {
    const textContent = await txtFile.text();
    transcript += `\n\n【テキストファイル内容】\n${textContent}`;
  }

  // Handle Binary Files
  const promptParts: any[] = [];

  // Audio
  const audioFile = formData.get('audio') as File;
  if (audioFile) {
    const arrayBuffer = await audioFile.arrayBuffer();
    promptParts.push({
      inlineData: {
        data: Buffer.from(arrayBuffer).toString('base64'),
        mimeType: audioFile.type
      }
    });
  }

  // Video (New)
  const videoFile = formData.get('video') as File;
  if (videoFile) {
    const arrayBuffer = await videoFile.arrayBuffer();
    promptParts.push({
      inlineData: {
        data: Buffer.from(arrayBuffer).toString('base64'),
        mimeType: videoFile.type
      }
    });
  }

  // PDF
  const pdfFile = formData.get('pdf') as File;
  if (pdfFile) {
    const arrayBuffer = await pdfFile.arrayBuffer();
    promptParts.push({
      inlineData: {
        data: Buffer.from(arrayBuffer).toString('base64'),
        mimeType: pdfFile.type
      }
    });
  }

  // Image (New)
  const imageFile = formData.get('image') as File;
  if (imageFile) {
    const arrayBuffer = await imageFile.arrayBuffer();
    promptParts.push({
      inlineData: {
        data: Buffer.from(arrayBuffer).toString('base64'),
        mimeType: imageFile.type
      }
    });
  }

  // URL (New)
  const targetUrl = formData.get('url') as string;
  if (targetUrl) {
    transcript += `\n\n【参照URL】\n${targetUrl}\n(このURLの内容を分析してください)`;
  }

  // Calculate character limits
  const tolerance = targetLength >= 1000 ? 0.05 : 0.1;
  const minLength = Math.floor(targetLength * (1 - tolerance));
  const maxLength = Math.floor(targetLength * (1 + tolerance));

  let systemPrompt = "";
  // JSON Schema Definition for structured output
  const jsonSchema = `
  出力は必ず以下のJSON形式で行ってください。
  重要：Markdownのコードブロック（\`\`\`jsonなど）は絶対に使用しないでください。純粋なJSON文字列のみを出力してください。
  **厳守**: JSON文字列内（summaryなど）で改行が必要な場合は、必ずエスケープシーケンス（\\n）を使用し、リテラルの改行コードを含めないでください。
  {
    "title": "講義タイトル",
    "category": "科目名（例：心理学、マクロ経済学）",
    "summary": "ここにMarkdown形式で構成されたノート本文を記述",
    "glossary": [
      { "term": "用語1", "definition": "解説1" },
      { "term": "用語2", "definition": "解説2" }
    ]
  }
  `;

  switch (mode) {
    case "thoughts":
      console.log(`Generating prompt for THOUGHTS mode`);
      systemPrompt = `あなたは講義を受講した「熱心な学生」です。丁寧語（です・ます調）でリアクションペーパーを作成します。
      ${jsonSchema}
      **自動分類の指示**:
      - 入力された資料から『科目名』を特定し category にセット。
      - 講義タイトルを生成し title にセット。
      
      **【出力フォーマット・ルール】**:
      1. **### 各見出しの直後に必ず1行の空行を入れること。**
      2. **要旨（冒頭）は3行以内**で「何を学んだか」を端的に記述してください。
      3. **用語解説**: \`**用語名**: 説明\` の形式で記述し、HTMLタグは一切使用しないでください。
      4. **重要な結論**: \`> [!IMPORTANT]\` または引用ブロックで強調してください。

      summaryの中身は以下の構成にしてください:
      ### 【要旨】
      
      ### 【講義で得た気づき】
      
      ### 【考察と今後の課題】`;
      break;

    case "report":
      console.log(`Generating prompt for REPORT mode`);
      systemPrompt = `あなたは「論理的批評家」です。常体（だ・である調）で学術レポートを作成します。
      ${jsonSchema}
      **自動分類の指示**:
      - 入力された資料から『科目名』を特定し category にセット。
      - 講義タイトルを生成し title にセット。

      **【出力フォーマット・ルール】**:
      1. **### 各見出しの直後に必ず1行の空行を入れること。**
      2. **要旨（冒頭）は3行以内**で論旨を簡潔にまとめてください。
      3. **用語解説**: \`**用語名**: 説明\` の形式で記述し、HTMLタグは一切使用しないでください。
      4. **複雑な対比**: シンプルな Markdown テーブルを使用してください。

      summaryの中身は以下の構成にしてください:
      ### 【序論：テーマの提示】
      
      ### 【本論：論理的分析】
      
      ### 【結論】`;
      break;

    case "note":
    default:
      console.log(`Generating prompt for NOTE mode`);
      systemPrompt = `あなたは「優秀な書記」です。事実関係の正確さを最優先し、講義内容を構造化します。
      ${jsonSchema}
      **自動分類の指示**:
      - 入力された資料から『科目名』を特定し category にセット。
      - 講義タイトルを生成し title にセット。

      **【出力フォーマット・ルール】**:
      1. **### 各見出しの直後に必ず1行の空行を入れること。**
      2. **要旨は3行以内**で全体の核心を記述してください。
      3. **用語解説**: \`**用語名**: 説明\` または \`> **用語名**: 説明\` の形式で記述し、HTMLタグは一切使用しないでください。
      4. **比較**: 必ず Markdown テーブル（2-3列程度）で整理してください。
      5. **重要ポイント**: \`> [!IMPORTANT]\` 等で視覚的に強調してください。

      summaryの中身は以下の【厳格な構成】に従ってください:
      ### 【要旨】
      
      ### 【講義のポイント】`;
      break;
  }

  const prompt = `
${systemPrompt}

以下のリソース（文字起こし/ファイル/URL）をもとに、指定された形式で出力を行ってください。
文字数は概ね ${minLength}〜${maxLength}文字 を目指してください。

【文字起こし・テキスト情報】
${transcript}
`;

  // Retry Logic
  const maxRetries = 3;
  let retryCount = 0;
  let currentModelName = "gemini-2.0-flash"; // Use generic latest

  while (retryCount < maxRetries) {
    try {
      const model = genAI.getGenerativeModel(
        { model: currentModelName },
        { apiVersion: 'v1' }
      );

      // Pass input parts + text prompt
      const result = await model.generateContent({
        contents: [{ role: "user", parts: [...promptParts, { text: prompt }] }]
      });

      const response = await result.response;
      const text = response.text();

      // Better JSON extraction: Find first '{' and last '}'
      let cleanedText = text.trim();
      const firstCurly = cleanedText.indexOf('{');
      const lastCurly = cleanedText.lastIndexOf('}');

      if (firstCurly === -1 || lastCurly === -1) {
        throw new Error("JSON object not found in response");
      }

      cleanedText = cleanedText.substring(firstCurly, lastCurly + 1);

      // Robust parsing for AI-generated results: 
      // Replace literal newlines and tabs within the JSON string that might be inside quotes.
      // This is common when Gemini outputs Markdown tables or formatted summaries.
      // Note: This regex is a safety measure to prevent "Bad control character" errors.
      const sanitizedText = cleanedText.replace(/\n/g, "\\n").replace(/\r/g, "\\r").replace(/\t/g, "\\t");
      // Wait, the above is TOO aggressive as it breaks the JSON structure itself (keys/braces).
      // Let's use a more targeted approach: replace only literal control characters UNLESS they are between tokens.
      // Actually, standard JSON.parse is fine with newlines BETWEEN tokens.
      // The issue is ONLY inside strings.

      // After successful analysis, increment usage count for free users
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
          dailyUsage: dailyUsage,
          usageCount: (userData?.usageCount || 0) + 1 // Keep old total counter too
        }, { merge: true });
      }

      try {
        return json({ result: JSON.parse(cleanedText) });
      } catch (e) {
        console.warn("Standard JSON parse failed, attempting sanitization...", e);
        // Targeted sanitization: replace literal newlines that are NOT followed by a JSON structural char
        // This is a heuristic: literal newlines inside strings are the main culprits.
        const fixControlChars = (str: string) => {
          return str.replace(/[\x00-\x1f]/g, (match) => {
            if (match === '\n') return '\\n';
            if (match === '\r') return '\\r';
            if (match === '\t') return '\\t';
            return '\\u' + match.charCodeAt(0).toString(16).padStart(4, '0');
          });
        };
        try {
          return json({ result: JSON.parse(fixControlChars(cleanedText)) });
        } catch (innerError) {
          console.error("Sanitized JSON parse also failed:", innerError);
          console.error("Raw Text:", text);
          throw new Error("JSON Parse Failed");
        }
      }

    } catch (error: any) {
      // ... (Error handling same as before)
      console.error(`Attempt ${retryCount + 1} failed:`, error.message);
      if (error.status === 429 || error.status === 503 || error.message?.includes("429")) {
        retryCount++;
        await new Promise(r => setTimeout(r, 5000));
        continue;
      }
      return json({ error: "Server Error: " + error.message }, { status: 500 });
    }
  }
  return json({ error: "Failed after retries" }, { status: 500 });

};
