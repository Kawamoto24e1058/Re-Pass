import { GoogleGenerativeAI } from "@google/generative-ai";
import { GoogleAIFileManager } from "@google/generative-ai/server";
import { GEMINI_API_KEY } from '$env/static/private';
import { json } from '@sveltejs/kit';
import { adminAuth, adminDb } from '$lib/server/firebase-admin';
import * as fs from 'fs/promises';
import * as os from 'os';
import * as path from 'path';

export const config = {
  maxDuration: 60
};

export const POST = async ({ request }) => {
  try {
    const genAI = new GoogleGenerativeAI(GEMINI_API_KEY);
    const fileManager = new GoogleAIFileManager(GEMINI_API_KEY);

    // --- Auth & Usage Check ---
    let uid: string | null = null;
    let isPremium = false;
    let isUltimate = false; // New flag
    let userData: any = null;

    const authHeader = request.headers.get('Authorization');
    console.log(`🔑 Auth Header Present: ${!!authHeader}`); // Debug Log

    if (authHeader && authHeader.startsWith('Bearer ')) {
      try {
        const idToken = authHeader.split('Bearer ')[1];
        const decodedToken = await adminAuth.verifyIdToken(idToken);
        uid = decodedToken.uid;
        console.log(`✅ Auth Verified for UID: ${uid}`); // Debug Log

        const userDoc = await adminDb.collection('users').doc(uid).get();
        if (userDoc.exists) {
          userData = userDoc.data();
          console.log(`👤 User Data Found: Plan=${userData?.plan}`); // Debug Log
        } else {
          console.warn(`⚠️ User Document not found for UID: ${uid}`);
        }

        const plan = String(userData?.plan || '').trim().toLowerCase();
        isPremium = ['premium', 'ultimate', 'season', 'pro'].includes(plan);
        isUltimate = plan === 'ultimate';
        console.log(`💎 Plan Logic Resolved: isPremium=${isPremium}, isUltimate=${isUltimate}`); // Debug Log

      } catch (e: any) {
        console.warn('⚠️ Auth token verification logic failed:', e);
        // Ensure uid is null if verification failed to prevent undefined behavior downstream
        if (!uid) {
          console.warn('⚠️ UID not set after auth failure, treating as guest');
        }
      }
    }

    // --- Safe Usage Check with Try-Catch ---
    if (!isPremium && uid) {
      try {
        const today = new Date().toISOString().split('T')[0];
        const usageRef = adminDb.collection('users').doc(uid).collection('usage').doc('daily');
        const usageDoc = await usageRef.get();
        const usageData = usageDoc.data() || { count: 0, lastResetDate: today };

        let currentCount = usageData.count;
        let lastResetDate = usageData.lastResetDate;

        if (lastResetDate !== today) {
          currentCount = 0;
          lastResetDate = today;
        }

        console.log(`📊 Usage Check: ${currentCount}/3 (Premium: ${isPremium})`);

        if (currentCount >= 3) {
          return json({
            error: "本日の上限に達しました",
            details: "無料プランの1日あたりの解析上限（3回）に達しました。明日また試すか、アルティメットプランへアップグレードしてください。"
          }, { status: 403 });
        }
      } catch (usageError: any) {
        console.error("🚨 Usage Check Failed:", usageError);
        // OPTIONAL: Fail open or closed?
        // For now, let's NOT crash the request, but log it.
        // If we return, we stop. If we continue, we allow analysis.
        // Let's allow analysis if DB check fails to avoid blocking users due to system error.
        console.warn("⚠️ Allowing analysis despite usage check failure due to DB error.");
      }
    } else if (!isPremium && !uid) {
      return json({ error: "解析にはログインが必要です" }, { status: 401 });
    }

    const formData = await request.formData();
    const mode = formData.get('mode') as string || "note";
    const targetLengthRaw = formData.get('targetLength');
    let targetLength = parseInt(targetLengthRaw as string || "1000");
    let transcript = formData.get('transcript') as string || "";
    const targetUrl = formData.get('url') as string;
    const evaluationCriteria = formData.get('evaluationCriteria') as string || "";

    // --- Hard Logic Gating ---
    if (!isPremium && targetLength > 500) {
      console.warn('⚠️ Character Limit Gating: Free user attempted > 500 chars');
      targetLength = 500; // Force down in backend
    }

    if (!isUltimate && (formData.has('videoUrl') || formData.has('audioUrl') || targetUrl)) {
      console.warn('⚠️ Plan Gating: Non-Ultimate user attempted Video/URL analysis');
      return json({ error: "動画・URL解析はアルティメットプラン限定です" }, { status: 403 });
    }

    if (!isPremium && (mode === 'thoughts' || mode === 'report')) {
      console.warn('⚠️ Feature Gating: Free user attempted premium mode');
      return json({ error: "この機能はプレミアム限定です" }, { status: 403 });
    }

    // --- Validation & Logging ---
    console.log('--- 🤖 Analysis Request Received ---');
    console.log('Mode:', mode);
    console.log('TargetLength:', targetLength);
    console.log('URL:', targetUrl || 'None');
    console.log('Transcript Length:', transcript.length);
    console.log('Files:', {
      pdf: formData.has('pdf') || formData.has('pdfUrl'),
      txt: formData.has('txt'),
      audio: formData.has('audio') || formData.has('audioUrl'),
      image: formData.has('image') || formData.has('imageUrl'),
      video: formData.has('video') || formData.has('videoUrl')
    });

    if (isNaN(targetLength) || targetLength <= 0) {
      console.error('❌ Validation Failed: Invalid targetLength');
      return json({ error: "無効な文字数指定です" }, { status: 400 });
    }

    const hasInput =
      transcript ||
      targetUrl ||
      formData.has('pdf') || formData.has('txt') || formData.has('audio') || formData.has('image') || formData.has('video') ||
      formData.get('audioUrl') || formData.get('videoUrl') || formData.get('pdfUrl') || formData.get('imageUrl');
    if (!hasInput) {
      console.error('❌ Validation Failed: No input data provided');
      return json({ error: "解析対象となるデータが必要です" }, { status: 400 });
    }

    // --- Input Processing ---
    const promptParts: any[] = [];

    // Handle Text File
    const txtFileInput = formData.get('txt') as File;
    if (txtFileInput) {
      const textContent = await txtFileInput.text();
      transcript += `\n\n【テキストファイル内容】\n${textContent}`;
    }


    // Helper to fetch file from URL, save to temp, upload to Gemini, and get URI
    const processFileUrl = async (url: string, mimeType: string, label: string) => {
      if (!url) return;
      let tempFilePath = '';
      try {
        console.log(`📡 Fetching ${label} from Storage: ${url}`);
        const response = await fetch(url);
        if (!response.ok) throw new Error(`Failed to fetch ${label}`);
        const arrayBuffer = await response.arrayBuffer();

        // Create temp file
        const tempDir = os.tmpdir();
        const fileName = `temp_${Date.now()}_${Math.random().toString(36).substring(7)}`;
        tempFilePath = path.join(tempDir, fileName);

        await fs.writeFile(tempFilePath, Buffer.from(arrayBuffer));
        console.log(`✅ ${label} downloaded to temp: ${tempFilePath} (${arrayBuffer.byteLength} bytes)`);

        // Upload to Gemini
        console.log(`☁️ Uploading ${label} to Gemini File Manager...`);
        const uploadResponse = await fileManager.uploadFile(tempFilePath, {
          mimeType: mimeType,
          displayName: label
        });

        console.log(`✅ ${label} uploaded to Gemini: ${uploadResponse.file.uri}`);

        promptParts.push({
          fileData: {
            mimeType: uploadResponse.file.mimeType,
            fileUri: uploadResponse.file.uri
          }
        });
      } catch (err) {
        console.error(`❌ Error processing ${label} URL:`, err);
      } finally {
        // Cleanup temp file
        if (tempFilePath) {
          try {
            await fs.unlink(tempFilePath);
          } catch (e) {
            console.warn(`Failed to cleanup temp file: ${tempFilePath}`, e);
          }
        }
      }
    };

    // Audio
    const audioUrl = formData.get('audioUrl') as string;
    const audioFileInput = formData.get('audio') as File;
    if (audioUrl) {
      const mimeType = audioUrl.toLowerCase().includes('.wav') ? 'audio/wav' : 'audio/mpeg';
      await processFileUrl(audioUrl, mimeType, 'Audio');
    } else if (audioFileInput) {
      console.log(`🎙️ Processing Audio (Direct): ${audioFileInput.name || 'blob'}, type=${audioFileInput.type}, size=${audioFileInput.size} bytes`);
      const arrayBuffer = await audioFileInput.arrayBuffer();
      promptParts.push({
        inlineData: {
          data: Buffer.from(arrayBuffer).toString('base64'),
          mimeType: audioFileInput.type || 'audio/mpeg'
        }
      });
    }

    // Video
    const videoUrl = formData.get('videoUrl') as string;
    const videoFileInput = formData.get('video') as File;
    if (videoUrl) {
      // For video, we still just pass the audio part if it was extracted, 
      // but if it's a direct video URL, we pass it as video/mp4
      await processFileUrl(videoUrl, 'video/mp4', 'Video');
    } else if (videoFileInput) {
      console.log(`🎥 Processing Video (Direct): ${videoFileInput.name || 'blob'}, type=${videoFileInput.type}, size=${videoFileInput.size} bytes`);
      const arrayBuffer = await videoFileInput.arrayBuffer();
      promptParts.push({
        inlineData: {
          data: Buffer.from(arrayBuffer).toString('base64'),
          mimeType: videoFileInput.type || 'video/mp4'
        }
      });
    }

    // PDF 
    const pdfUrl = formData.get('pdfUrl') as string;
    const pdfFileInput = formData.get('pdf') as File;
    if (pdfUrl) {
      await processFileUrl(pdfUrl, 'application/pdf', 'PDF');
    } else if (pdfFileInput) {
      console.log(`📄 Processing PDF (Direct): ${pdfFileInput.name || 'blob'}, type=${pdfFileInput.type}, size=${pdfFileInput.size} bytes`);
      const arrayBuffer = await pdfFileInput.arrayBuffer();
      promptParts.push({
        inlineData: {
          data: Buffer.from(arrayBuffer).toString('base64'),
          mimeType: 'application/pdf'
        }
      });
    }

    // Image
    const imageUrl = formData.get('imageUrl') as string;
    const imageFileInput = formData.get('image') as File;
    if (imageUrl) {
      await processFileUrl(imageUrl, 'image/jpeg', 'Image');
    } else if (imageFileInput) {
      console.log(`🖼️ Processing Image (Direct): ${imageFileInput.name || 'blob'}, type=${imageFileInput.type}, size=${imageFileInput.size} bytes`);
      const arrayBuffer = await imageFileInput.arrayBuffer();
      promptParts.push({
        inlineData: {
          data: Buffer.from(arrayBuffer).toString('base64'),
          mimeType: imageFileInput.type || 'image/jpeg'
        }
      });
    }

    // Scraping URL
    if (targetUrl) {
      try {
        console.log(`🔗 Scraping URL: ${targetUrl}`);
        if (targetUrl.includes('youtube.com') || targetUrl.includes('youtu.be')) {
          try {
            const { YoutubeTranscript } = await import('youtube-transcript');
            const transcripts = await YoutubeTranscript.fetchTranscript(targetUrl);
            if (!transcripts || transcripts.length === 0) throw new Error('Transcript is empty');

            let fullTranscript = transcripts.map(t => t.text).join(' ');
            if (fullTranscript.length > 10000) {
              const head = fullTranscript.substring(0, 5000);
              const tail = fullTranscript.substring(fullTranscript.length - 5000);
              fullTranscript = `${head}\n\n... (略: 内容が長いため中間部分をカットしました) ...\n\n${tail}`;
            }
            transcript += `\n\n【YouTube動画内容（字幕）】\n${fullTranscript}`;
            console.log('✅ YouTube transcript extracted successfully');
          } catch (transcriptError) {
            console.warn('YouTube transcript fetch failed, trying metadata fallback...', transcriptError);
            try {
              const response = await fetch(targetUrl);
              const html = await response.text();
              const cheerio = await import('cheerio');
              const $ = cheerio.load(html);
              let title = $('meta[property="og:title"]').attr('content') || $('title').text() || 'タイトル取得失敗';
              let description = $('meta[property="og:description"]').attr('content') || '';
              if (description.length > 500) description = description.substring(0, 500) + '...';
              transcript += `\n\n【YouTube動画情報（字幕なし・メタデータのみ）】\nタイトル: ${title}\n概要: ${description || '概要なし'}\n\n⚠️ 注意: この動画には字幕が設定されていないため、詳細な内容分析はできません。`;
              console.log('⚠️ YouTube metadata extracted as fallback');
            } catch (fallbackError) {
              console.error('YouTube metadata fallback failed:', fallbackError);
            }
          }
        } else {
          try {
            const response = await fetch(targetUrl);
            const html = await response.text();
            const cheerio = await import('cheerio');
            const $ = cheerio.load(html);
            $('script, style, nav, footer, aside, .ads, #ads').remove();
            let mainContent = $('article').text() || $('main').text() || $('body').text();
            mainContent = mainContent.replace(/\s+/g, ' ').trim();
            if (mainContent.length > 10000) {
              const head = mainContent.substring(0, 5000);
              const tail = mainContent.substring(mainContent.length - 5000);
              mainContent = `${head}\n\n... (略: 内容が長いため中間部分をカットしました) ...\n\n${tail}`;
            }
            transcript += `\n\n【ウェブサイト内容】\n${mainContent}\n(URL: ${targetUrl})`;
          } catch (scrapeErr) {
            console.error('Generic scraping failed:', scrapeErr);
          }
        }
      } catch (e: any) {
        console.error('URL Scraping master failed:', e);
        transcript += `\n\n【参照URL（取得失敗）】\n${targetUrl}\n(URLの内容を取得できませんでした)`;
      }
    }

    // --- Generation Logic ---
    const tolerance = targetLength >= 1000 ? 0.05 : 0.1;
    const minLength = Math.floor(targetLength * (1 - tolerance));
    const maxLength = Math.floor(targetLength * (1 + tolerance));

    const jsonSchema = `
  出力は必ず以下のJSON形式で行ってください。
  重要：Markdownのコードブロック（\`\`\`jsonなど）は絶対に使用しないでください。純粋なJSON文字列のみを出力してください。
  **厳守**: JSON文字列内（summaryなど）で改行が必要な場合は、必ずエスケープシーケンス（\\n）を使用し、リテラルの改行コードを含めないでください。
  絶対禁止: JSON以外の解説文、前置き、Markdownの装飾（\`\`\`jsonなど）は一切含めないでください。
  {
    "title": "講義タイトル",
    "subtitle": "15文字程度の短いサブタイトル（講義の主題を端的に表す）",
    "category": "科目名（例：心理学、マクロ経済学）",
    "summary": "ここにMarkdown形式で構成されたノート本文を記述。構成は必ず【導入】【本編（トピックごとにセクション化）】【まとめ】の順序で記述すること。",
    "glossary": [
      { "term": "用語1", "definition": "解説1" },
      { "term": "用語2", "definition": "解説2" }
    ]
  }
  `;

    let systemPrompt = "";
    switch (mode) {
      case "thoughts":
        systemPrompt = `あなたは講義を受講した「熱心な学生」です。丁寧語（です・ます調）でリアクションペーパーを作成します。\n${jsonSchema}\n**【最重要原則】**: 提供された資料のみに基づき解析すること。一般論での補完は厳禁。各見出しの直後に必ず空行を入れること。要旨は3行以内。`;
        break;
      case "report":
        systemPrompt = `あなたは「論理的批評家」です。常体（だ・である調）で学術レポートを作成します。\n${jsonSchema}\n**【最重要原則】**: 提供された資料のみに基づき解析すること。一般論での補完は厳禁。各見出しの直後に必ず空行を入れること。要旨は3行以内。`;
        break;
      case "note":
      default:
        systemPrompt = `あなたは「優秀な書記」です。事実関係の正確さを最優先し、講義内容を詳細に構造化します。\n${jsonSchema}\n
**【最重要原則】**:
1. **提供された資料のみ**に基づき解析すること。一般論での補完は厳禁。
2. **階層的な箇条書き**を多用し、読者がこのノートだけで講義を完全に復習できるようにすること。
3. **具体的**な事例、ケーススタディ、エピソードは必ず省略せずに記述すること。
4. **数式**（例えば $PaQa + PbQb = Bg$）が登場した場合は、LaTeX形式で記述し、変数の意味と式の意図を詳細に解説すること。
5. **専門用語**は用語辞典だけでなく、本文中でも文脈に沿って解説を加えること。
6. 各見出しの直後に必ず空行を入れること。
7. **タイムスタンプ**: 重要なトピックの切り替わりや議論の転換点には、必ず **[MM:SS]** 形式（例: [05:30]）でタイムスタンプを付記すること。`;
        break;
    }

    const prompt = `
${systemPrompt}
        以下の資料をもとに解析を行ってください。目標文字数: ${minLength}〜${maxLength} 文字程度。
【テキスト情報】
${transcript}
${evaluationCriteria ? `
【追加指示：A評価攻略ガイド】
この講義の評価基準は「${evaluationCriteria}」です。
生成されたノート（summaryフィールド）の最後に、この評価基準に基づいた「A評価を勝ち取るための戦略的アドバイス」を追加してください。
具体的かつ『楽をしたい学生』向けに、レポートで強調すべきキーワードや、テストで重視すべきポイントを300文字程度で記述してください。

**重要：出力形式の制御**
このアドバイス部分は、必ず **[A_STRATEGY_START]** と **[A_STRATEGY_END]** というタグで囲んでください。
このタグは summary フィールドの文字列の中に含めてください。
例: "...まとめの文章。\n\n[A_STRATEGY_START]\n### 🏆 A評価攻略ガイド\n評価基準の「期末レポート50%」を攻略するには...\n[A_STRATEGY_END]"` : ""
      }
`;

    const maxRetries = 3;
    let retryCount = 0;
    let currentModelName = "gemini-2.0-flash";
    let hasTriedFallback = false;

    const tokensPerChar = 6; // Increased from 3 to 6 for deeper analysis
    const jsonOverhead = 1000; // Increased buffer
    const maxOutputTokens = Math.min(Math.ceil(targetLength * tokensPerChar) + jsonOverhead, 8192);

    while (retryCount < maxRetries) {
      try {
        console.log(`🤖 Model: ${currentModelName} (Attempt ${retryCount + 1}/${maxRetries})`);
        // Model Configuration
        const model = genAI.getGenerativeModel({
          model: currentModelName,
          generationConfig: {
            maxOutputTokens: maxOutputTokens,
            temperature: 0.7,
          }
        });

        console.log(`🚀 Sending request to Gemini(Model: gemini - 2.0 - flash)...`);
        const result = await model.generateContent({
          contents: [{ role: "user", parts: [...promptParts, { text: prompt }] }]
        });

        const response = await result.response;
        const rawText = response.text();
        console.log(`📥 Raw AI Response(Length: ${rawText.length})`);

        // --- Aggressive JSON Extraction ---
        let cleanedText = rawText.trim();
        // Remove Markdown code blocks if present
        cleanedText = cleanedText.replace(/^```json\n ?| ```$/g, '').trim();

        const firstCurly = cleanedText.indexOf('{');
        const lastCurly = cleanedText.lastIndexOf('}');

        if (firstCurly !== -1 && lastCurly !== -1) {
          cleanedText = cleanedText.substring(firstCurly, lastCurly + 1);
        }

        // Update usage count
        if (!isPremium && uid) {
          try {
            const today = new Date().toISOString().split('T')[0];
            const usageRef = adminDb.collection('users').doc(uid).collection('usage').doc('daily');
            const usageDoc = await usageRef.get();
            const usageData = usageDoc.data() || { count: 0, lastResetDate: today };
            let newCount = (usageData.lastResetDate !== today) ? 1 : usageData.count + 1;
            await usageRef.set({ count: newCount, lastResetDate: today, updatedAt: new Date().toISOString() }, { merge: true });

            // Safe update for global usage count
            const currentGlobalCount = userData?.usageCount || 0;
            await adminDb.collection('users').doc(uid).set({ usageCount: currentGlobalCount + 1 }, { merge: true });
          } catch (usageError) {
            console.error("⚠️ Failed to update usage stats (non-fatal):", usageError);
          }
        }

        try {
          return json({ result: JSON.parse(cleanedText) });
        } catch (parseError) {
          console.warn("⚠️ JSON.parse failed, attempting sanitization...", parseError);
          const sanitize = (str: string) => str.replace(/[\x00-\x1f]/g, (m) => ({ '\n': '\\n', '\r': '\\r', '\t': '\\t' }[m] || '\\u' + m.charCodeAt(0).toString(16).padStart(4, '0')));

          try {
            return json({ result: JSON.parse(sanitize(cleanedText)) });
          } catch (finalError) {
            console.error("🚨 Final JSON parse failed. Using fail-safe fallback.");
            // FAIL-SAFE FALLBACK: Wrap raw text in valid JSON structure
            return json({
              result: {
                title: "解析結果 (構造化失敗)",
                category: "未分類",
                summary: rawText,
                glossary: []
              },
              fallback: true,
              parseError: (finalError as Error).message
            });
          }
        }
      } catch (error: any) {
        console.error(`❌ Attempt ${retryCount + 1} failed: `, error.message);
        if (error.stack) console.error(error.stack);

        if (error.status === 429 || error.status === 503) {
          retryCount++;
          await new Promise(r => setTimeout(r, 5000));
          continue;
        }

        if (!hasTriedFallback && (error.message?.includes("2.0") || error.status === 404)) {
          console.warn(`⚠️ Falling back to gemini - 1.5 - flash`);
          currentModelName = "gemini-1.5-flash";
          hasTriedFallback = true;
          retryCount++;
          continue;
        }

        return json({ error: "解析エラー: " + error.message, stack: error.stack }, { status: 500 });
      }
    }
    return json({ error: "リトライ上限に達しました" }, { status: 500 });
  } catch (globalError: any) {
    console.error("🚨 Global Server Error in /api/analyze:");
    console.error("Message:", globalError.message);
    console.error("Stack:", globalError.stack);

    return json({
      error: "サーバー処理中に予期せぬエラーが発生しました。",
      details: globalError.message,
      debug_stack: process.env.NODE_ENV === 'development' ? globalError.stack : undefined
    }, { status: 500 });
  }
};
