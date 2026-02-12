import { GoogleGenerativeAI } from "@google/generative-ai";
import { GEMINI_API_KEY } from '$env/static/private';
import { json } from '@sveltejs/kit';

// genAI will be initialized inside the POST handler to avoid build-time issues with $env/static/private
export const POST = async ({ request }) => {
  // APIキーを使って初期化
  const genAI = new GoogleGenerativeAI(GEMINI_API_KEY);

  const formData = await request.formData();
  const mode = formData.get('mode') as string || "note";
  const plan = formData.get('plan') as string || "free";
  const targetLength = parseInt(formData.get('targetLength') as string || "1000");
  let transcript = formData.get('transcript') as string || "";

  // Backend Plan Check
  if (plan === 'free') {
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
      - 入力された資料（PDF/画像）のヘッダーや本文から『科目名（例：心理学、マクロ経済学）』を特定し、categoryにセットしてください。資料がない場合は内容から推測してください。
      - 講義の内容を端的に表すタイトルを生成し、titleにセットしてください。
      
      summaryの中身は以下の構成にしてください:
      1. **講義で得た気づき**: 印象に残った内容と理由。
      2. **考察**: 社会事象や経験との結合による仮説。
      3. **今後の課題・疑問**: 新たに生まれた疑問。
      glossaryには、講義内で特に重要だったキーワードと、あなたの解釈を加えて定義してください。`;
      break;

    case "report":
      console.log(`Generating prompt for REPORT mode`);
      systemPrompt = `あなたは「論理的批評家」です。常体（だ・である調）で学術レポートを作成します。
      ${jsonSchema}
      **自動分類の指示**:
      - 入力された資料（PDF/画像）のヘッダーや本文から『科目名（例：心理学、マクロ経済学）』を特定し、categoryにセットしてください。資料がない場合は内容から推測してください。
      - 講義の内容を端的に表すタイトルを生成し、titleにセットしてください。

      summaryの中身は以下の構成にしてください:
      1. **序論**: テーマと問いの提示。
      2. **本論**: 主張の整理、分析、対立軸の提示。
      3. **結論**: 最終的な結論。
      glossaryには、講義内で使用された専門用語を定義してください。`;
      break;

    case "note":
    default:
      console.log(`Generating prompt for NOTE mode`);
      systemPrompt = `あなたは「優秀な書記」です。事実関係の正確さを最優先し、講義内容を構造化します。
      ${jsonSchema}
      **自動分類の指示**:
      - 入力された資料（PDF/画像）のヘッダーや本文から『科目名（例：心理学、マクロ経済学）』を特定し、categoryにセットしてください。資料がない場合は内容から推測してください。
      - 講義の内容を端的に表すタイトルを生成し、titleにセットしてください。

      summaryの中身は以下の【厳格な構成】に従ってください:

      ### 【要旨】
      講義の核心を3行以内で簡潔にまとめる。

      ### 【講義のポイント】
      重要な論理構成を、見出しと箇条書きで整理する。
      **重要**: 対比構造（AとBの違い、メリット・デメリットなど）がある場合は、必ずMarkdownの表（Table）形式を使って整理すること。
      
      （注：【用語辞典】セクションは summary に含めず、JSONの glossary 配列に出力してください）`;
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

      // Let's try parsing directly first, if fails, try a manual sanitize
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
