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

    const formData = await request.formData();
    const mode = formData.get('mode') as string || "note";
    const targetLengthRaw = formData.get('targetLength');
    let targetLength = parseInt(targetLengthRaw as string || "1000");
    let audioText = formData.get('audioText') as string || "";
    let documentText = formData.get('documentText') as string || "";
    const targetUrl = formData.get('url') as string;
    const evaluationCriteria = formData.get('evaluationCriteria') as string || "";
    const taskText = formData.get('taskText') as string || "";
    const isTaskAssist = (formData.get('isTaskAssist') === 'true') || (taskText.length > 0);

    // --- Safe Usage Check & Gating ---
    if (uid) {
      try {
        const today = new Date().toISOString().split('T')[0];
        const usageRef = adminDb.collection('users').doc(uid).collection('usage').doc('daily');
        const usageDoc = await usageRef.get();
        const usageData = usageDoc.data() || { count: 0, mediaCount: 0, lastResetDate: today };

        let currentCount = usageData.count || 0;
        let currentMediaCount = usageData.mediaCount || 0;
        let lastResetDate = usageData.lastResetDate;

        if (lastResetDate !== today) {
          currentCount = 0;
          currentMediaCount = 0;
          lastResetDate = today;
        }

        const hasMedia = formData.has('videoUrl') || formData.has('audioUrl') || formData.has('audio') || formData.has('video');

        if (!isPremium) {
          if (currentCount >= 1) {
            return json({
              error: "本日の上限に達しました",
              details: "無料プランの1日あたりの解析上限（1回）に達しました。明日また試すか、プレミアムプランへアップグレードしてください。"
            }, { status: 429 });
          }
        } else if (isPremium && !isUltimate && hasMedia) {
          if (currentMediaCount >= 3) {
            return json({
              error: "メディア解析の上限に達しました",
              details: "プレミアムプランの1日あたりのメディア解析上限（3回）に達しました。明日また試すか、アルティメットプランへアップグレードしてください。"
            }, { status: 429 });
          }
        }
      } catch (usageError: any) {
        console.error("🚨 Usage Check Failed:", usageError);
      }
    } else {
      return json({ error: "解析にはログインが必要です" }, { status: 401 });
    }

    // --- Hard Logic Gating ---
    if (!isPremium && targetLength > 500) {
      console.warn('⚠️ Character Limit Gating: Free user attempted > 500 chars');
      targetLength = 500; // Force down in backend
    }

    if (!isPremium && (mode === 'thoughts' || mode === 'report' || isTaskAssist)) {
      console.warn('⚠️ Feature Gating: Free user attempted premium mode');
      return json({ error: "この機能はプレミアム限定です" }, { status: 403 });
    }

    // --- Validation & Logging ---
    console.log('--- 🤖 Analysis Request Received ---');
    console.log('Mode:', mode);
    console.log('TargetLength:', targetLength);
    console.log('URL:', targetUrl || 'None');
    console.log('AudioText Length:', audioText.length);
    console.log('DocumentText Length:', documentText.length);
    console.log('Files:', {
      pdf: formData.has('pdf') || formData.has('pdfUrl'),
      txt: formData.has('documentText') || formData.has('txt'),
      audio: formData.has('audio') || formData.has('audioUrl'),
      image: formData.has('image') || formData.has('imageUrl'),
      video: formData.has('video') || formData.has('videoUrl')
    });

    if (isNaN(targetLength) || targetLength <= 0) {
      console.error('❌ Validation Failed: Invalid targetLength');
      return json({ error: "無効な文字数指定です" }, { status: 400 });
    }

    const hasInput =
      audioText ||
      documentText ||
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
      documentText += `\n\n【追加テキストファイル内容】\n${textContent}`;
    }

    if (taskText) {
      documentText += `\n\n【課題・問題の内容】\n${taskText}`;
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

    // Image (Multiple)
    const imageUrls = formData.getAll('imageUrl') as string[];
    const imageFileInput = formData.get('image') as File;

    if (imageUrls && imageUrls.length > 0) {
      for (let i = 0; i < imageUrls.length; i++) {
        await processFileUrl(imageUrls[i], 'image/jpeg', `Image_${i + 1}`);
      }
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
            audioText += `\n\n【YouTube動画内容（字幕）】\n${fullTranscript}`;
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
              documentText += `\n\n【YouTube動画情報（字幕なし・メタデータのみ）】\nタイトル: ${title}\n概要: ${description || '概要なし'}\n\n⚠️ 注意: この動画には字幕が設定されていないため、詳細な内容分析はできません。`;
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
            documentText += `\n\n【ウェブサイト内容】\n${mainContent}\n(URL: ${targetUrl})`;
          } catch (scrapeErr) {
            console.error('Generic scraping failed:', scrapeErr);
          }
        }
      } catch (e: any) {
        console.error('URL Scraping master failed:', e);
        documentText += `\n\n【参照URL（取得失敗）】\n${targetUrl}\n(URLの内容を取得できませんでした)`;
      }
    }

    // --- Final Input Validation & Pre-API Logging ---
    const totalInputLength = (audioText?.length || 0) + (documentText?.length || 0);
    const MAX_FREE_CHARS = 1000;
    const MAX_PREMIUM_CHARS = 50000;

    console.log('\n=== 🚀 Initiating Gemini API Call ===');
    console.log(`Plan Status : ${isUltimate ? 'Ultimate' : isPremium ? 'Premium' : 'Free'}`);
    console.log(`Total Text  : ${totalInputLength} chars`);
    console.log(`Model Mode  : ${mode}`);
    console.log('=====================================\n');

    if (!isPremium && totalInputLength > MAX_FREE_CHARS) {
      console.warn(`⚠️ Blocked: Free user attempted ${totalInputLength} chars (Limit: ${MAX_FREE_CHARS})`);
      return json({ error: `無料プランの処理文字数上限（${MAX_FREE_CHARS}文字）を超過しました。プレミアムにアップグレードしてください。` }, { status: 403 });
    } else if (isPremium && totalInputLength > MAX_PREMIUM_CHARS) {
      console.warn(`⚠️ Blocked: Premium user attempted ${totalInputLength} chars (Limit: ${MAX_PREMIUM_CHARS})`);
      return json({ error: `一度に処理できる最大文字数（${MAX_PREMIUM_CHARS}文字）を超過しました。内容を分割してください。` }, { status: 400 });
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

    const multiModalInstruction = `あなたは超優秀な学術アシスタントです。提供された『スライド画像内のテキスト等の資料』と『講義の文字起こしや音声データ』の両方を深く分析してください。
【重要ルール：複数データの高度な統合】
資料テキストと音声テキストの両方が提供されている場合、絶対に片方だけを要約してはいけません。
必ず両方の内容を突き合わせ、以下の点に強く注目して補足情報を生成してください：
1. スライドに記載されていないが、講師が口頭で強調していた具体例や補足説明。
2. 講師が「ここがテストに出る」「重要だ」「覚えておいて」と言及した箇所。
3. スライドの箇条書きの背景にある、講師の意図や論理構成。

生成する文章には、「講師の補足によると…」や「口頭での説明では…」といった形で、文字起こし由来の情報であることを明示してください。
また、特に重要な口頭補足やテスト対策に関する内容は、以下のような書式（太字や引用ブロックなど）を用いて視覚的に目立たせてください。
例：
> **【口頭補足】**: 講師の補足によると、この理論は実際の現場では〇〇のように応用されるとのことです。
> **【テスト対策】**: 講師が「ここは次回のテストで必ず問う」と明言していました。`;

    let systemPrompt = "";
    if (isTaskAssist) {
      systemPrompt = "あなたは優秀なTA（ティーチングアシスタント）です。提供された資料や問題をもとに、学生が課題を解くサポートをします。\n" +
        "【重要ルール】\n" +
        "直接的な答え（最終的な解答そのもの）は絶対に出さないでください。\n" +
        "代わりに以下の3点を含めて解説してください：\n" +
        "① この課題が意図していること・問われている核心\n" +
        "② 参考にするべき資料の該当箇所や関連する公式・概念\n" +
        "③ 自力で解くための具体的なステップ（最初の一歩はどうするか等）\n\n" +
        jsonSchema;
    } else {
      switch (mode) {
        case "thoughts":
          systemPrompt = `あなたは講義を受講した「熱心な学生」です。丁寧語（です・ます調）でリアクションペーパー（感想文）を作成します。
【提供データの利用ルール】
1. 構成の主軸は必ず「資料テキスト（スライド等）」に基づき作成し、講義の構造を維持してください。
2. 音声データ（文字起こし）は、スライドにない詳細な説明、講師の独自見解、具体例を補完するため「のみ」に使用してください。
3. 講義の本筋と無関係な雑談（部活、事務連絡など）はノイズとなるため厳格に除外してください。

【文体と情報の統合指示】
1. 口語をそのまま引用するのではなく、「先生が〜だとおっしゃっていたのが印象的でした」など、丁寧語の感想文として自然な文章にリライトして組み込んでください。
2. 「重要」といった発言も括弧で括るのではなく、文章に自然に溶け込ませてください。
3. 文字起こし由来の補足が含まれる情報には、必ず「🔊 講義内の補足」というラベルやアイコンを挿入し、情報の出所を区別できるようにしてください。
4. 提供された資料のみに基づき解析すること。一般論での補完は厳禁です。要旨は3行以内としてください。\n${jsonSchema}`;
          break;
        case "report":
          systemPrompt = `あなたは「論理的批評家」です。常体（だ・である調）で学術レポートを作成します。
【提供データの利用ルール】
1. 構成の主軸は必ず「資料テキスト（スライド等）」に基づき作成し、論理的な構造を維持してください。
2. 音声データ（文字起こし）は、スライドにない詳細な説明、講師の独自見解、具体例を補完するため「のみ」に使用してください。
3. 講義の本筋と無関係な雑談（部活、事務連絡など）はノイズとなるため厳格に除外してください。

【文体と情報の統合指示】
1. 口語をそのまま引用するのではなく、「講師によって〜という補足がなされた」「〜との見解が示された」など、格調高い学術的表現の文章にリライトして組み込んでください。
2. 「重要」といった発言も括弧で括るのではなく、レポートの論旨に自然に溶け込ませてください。
3. 文字起こし由来の補足が含まれる情報には、必ず「🔊 講義内の補足」というラベルやアイコンを挿入し、情報の出所を区別できるようにしてください。
4. 提供された資料のみに基づき解析すること。一般論での補完は厳禁です。要旨は3行以内としてください。\n${jsonSchema}`;
          break;
        case "note":
        default:
          systemPrompt = multiModalInstruction + `あなたは「優秀な書記」です。事実関係の正確さを最優先し、講義内容を詳細に構造化します。\n${jsonSchema}\n
**【最重要原則】**:
1. **提供された資料（スライドと音声）のみ**に基づき解析すること。一般論での補完は厳禁。
2. **階層的な箇条書き**を多用し、読者がこのノートだけで講義を完全に復習できるようにすること。
3. **【重要】** スライドにある見出しに対し、必ず音声データから得られた「口頭での補足説明」や「具体例」を肉付けして記述すること。
4. **数式**が登場した場合は、LaTeX形式で記述し、変数の意味と式の意図を詳細に解説すること。
5. **専門用語**は用語辞典だけでなく、本文中でも文脈に沿って解説を加えること。
6. 各見出しの直後に必ず空行を入れること。
7. 【口頭補足】や【テスト対策】、【意図・背景】などの特殊タグを積極的に用い、スライド外の情報を目立たせること。`;
          break;
      }
    }
    let formatRules = "";
    if (mode === "note") {
      formatRules = `
【重要ルール：フォーマットと文字数】
1. 文字数制限は設けません。講義内容を省略せず網羅的に記載してください。
2. Markdownを駆使して、見出しと箇条書きを使った最も見やすく理解しやすい構造で詳細なノートを作成してください。
3. 【超重要】プレーンテキストの塊にすることは絶対にやめてください。「## 見出し」「- 箇条書き」「太字」「適切な改行（空行）」を必ず使用して視覚的に整理してください。`;
    } else {
      formatRules = `
【重要ルール：フォーマットと文字数】
1. 出力する文章の文字数は、約 ${targetLength} 文字（許容範囲: ±15%）を目安にしてください。
2. 文字数合わせのために改行を消したり、プレーンテキストの塊にすることは絶対にやめてください。Markdown形式で段落を分けて読みやすくしてください。`;
    }

    const prompt = `
${systemPrompt}
        以下の資料をもとに解析を行ってください。
${formatRules}

【提供された資料テキスト（スライドや文書の抽出内容など）】
${documentText ? documentText : '（データなし：スライド等の視覚資料は提供されていません）'}

【提供された音声テキスト（講義の録音文字起こしや動画字幕など）】
${audioText ? audioText : '（データなし：文字起こし等の音声資料は提供されていません。資料テキストのみで補完してください）'}
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
        if (uid) {
          try {
            const today = new Date().toISOString().split('T')[0];
            const usageRef = adminDb.collection('users').doc(uid).collection('usage').doc('daily');
            const usageDoc = await usageRef.get();
            const usageData = usageDoc.data() || { count: 0, mediaCount: 0, lastResetDate: today };

            let newCount = (usageData.lastResetDate !== today) ? 1 : (usageData.count || 0) + 1;

            const hasMedia = formData.has('videoUrl') || formData.has('audioUrl') || formData.has('audio') || formData.has('video');
            let newMediaCount = (usageData.lastResetDate !== today) ? (hasMedia ? 1 : 0) : ((usageData.mediaCount || 0) + (hasMedia ? 1 : 0));

            await usageRef.set({
              count: newCount,
              mediaCount: newMediaCount,
              lastResetDate: today,
              updatedAt: new Date().toISOString()
            }, { merge: true });

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
        } // Close catch (parseError)
      } catch (error: any) {
        console.error(`❌ Attempt ${retryCount + 1} failed: `, error.message);
        if (error.stack) console.error(error.stack);

        // --- Safety Block Handling ---
        const errorMsg = String(error.message).toLowerCase();
        if (errorMsg.includes("safety") || errorMsg.includes("blocked") || errorMsg.includes("candidate was blocked")) {
          console.warn("⚠️ Request blocked by Gemini Safety Settings.");
          return json({ error: "不適切なコンテンツまたは安全基準に抵触する内容が含まれているため、AIが解析をブロックしました。" }, { status: 400 });
        }

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
