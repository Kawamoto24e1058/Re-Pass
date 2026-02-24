<script lang="ts">
    import { createEventDispatcher, onDestroy } from "svelte";
    import { marked } from "marked";
    import { analysisMode } from "$lib/stores/recordingStore";
    import { lectures } from "$lib/stores";

    const dispatch = createEventDispatcher();

    export let lectureAnalyses: Record<string, any> = {};
    export let result: any = "";
    export let derivativeAnalyzing: boolean = false;
    export let isResultCopied: boolean = false;
    export let previewVideoUrl: string | null = null;
    export let currentLectureId: string | null = null;
    export let analyzedTitle: string = "";
    export let strategyContent: string | null = null;
    export let displaySummary: string = "";
    export let isPremium: boolean = false;
    export let isUltimate: boolean = false;
    export let selectedDerivativeMode: string | null = null;
    export let derivativeTargetLength: number = 400;

    let resultContainer: HTMLElement;
    let resultTextContainer: HTMLElement;
    let videoPlayer: HTMLVideoElement;

    $: currentAnalysis =
        lectureAnalyses[selectedDerivativeMode || $analysisMode || "note"] ||
        result;

    $: manuscriptPages = Math.ceil(derivativeTargetLength / 400);

    function copyResultToClipboard() {
        dispatch("copy");
    }

    function handleTimestampClick(e: MouseEvent) {
        const target = e.target as HTMLElement;
        if (target.classList.contains("timestamp-link")) {
            const timestamp = target.getAttribute("data-timestamp");
            if (timestamp && videoPlayer) {
                const parts = timestamp.split(":").map(Number);
                let seconds = 0;
                if (parts.length === 3) {
                    seconds = parts[0] * 3600 + parts[1] * 60 + parts[2];
                } else if (parts.length === 2) {
                    seconds = parts[0] * 60 + parts[1];
                }
                videoPlayer.currentTime = seconds;
                videoPlayer.play();
                videoPlayer.scrollIntoView({
                    behavior: "smooth",
                    block: "center",
                });
            }
        }
    }

    $: isVideoSource =
        $lectures.find((l) => l.id === currentLectureId)?.sourceType ===
            "video" ||
        $lectures.find((l) => l.id === currentLectureId)?.sourceType ===
            "audio";

    // --- Dynamic UI State ---
    let oralSupplements: string[] = [];
    let cleanedSummaryForMain: string = "";

    $: {
        oralSupplements = [];
        cleanedSummaryForMain = displaySummary || "";
        if (cleanedSummaryForMain) {
            const tokenRegex = /(?:^|\n)(>.*?【口頭補足】.*?(?:\n>.*)*)/g;
            let match;
            let tempSummary = cleanedSummaryForMain;
            while ((match = tokenRegex.exec(tempSummary)) !== null) {
                // Remove the "> " markdown prefix for cleaner rendering in our custom card
                oralSupplements.push(match[1].trim());
            }
            cleanedSummaryForMain = tempSummary.replace(tokenRegex, "").trim();
        }
    }

    // --- Loading State Animation ---
    const loadingMessages = [
        "AIが講義内容を分析中...",
        "先生の補足発言を抽出中...",
        "重要なポイントを整理中...",
        "フォーマットを構築中...",
    ];
    let currentMessageIndex = 0;
    let messageInterval: ReturnType<typeof setInterval> | null = null;

    $: if (derivativeAnalyzing || !currentAnalysis) {
        if (!messageInterval && typeof window !== "undefined") {
            messageInterval = setInterval(() => {
                currentMessageIndex =
                    (currentMessageIndex + 1) % loadingMessages.length;
            }, 3000);
        }
    } else {
        if (messageInterval) {
            clearInterval(messageInterval);
            messageInterval = null;
        }
    }

    onDestroy(() => {
        if (messageInterval) clearInterval(messageInterval);
    });
</script>

{#if currentAnalysis}
    <div
        bind:this={resultContainer}
        class="relative bg-white rounded-3xl shadow-sm border border-slate-100 p-8 md:p-12 animate-in fade-in slide-in-from-bottom-8 duration-700 overflow-hidden {$analysisMode ===
        'note'
            ? 'bg-article-paper'
            : ''}"
    >
        <div class="absolute top-6 right-6 flex items-center gap-4 z-20">
            {#if !derivativeAnalyzing}
                <button
                    on:click={copyResultToClipboard}
                    class="flex items-center gap-2 px-3 py-1.5 rounded-xl bg-white/80 backdrop-blur-sm border border-slate-200 text-slate-500 hover:bg-white hover:border-indigo-300 hover:text-indigo-600 transition-all shadow-sm active:scale-95 group"
                >
                    {#if isResultCopied}
                        <span
                            class="text-[10px] font-bold text-emerald-600 animate-in fade-in"
                            >✅ コピー完了</span
                        >
                    {:else}
                        <span
                            class="text-xs group-hover:scale-110 transition-transform"
                            >📋</span
                        >
                        <span
                            class="text-[10px] font-bold uppercase tracking-wider"
                            >コピー</span
                        >
                    {/if}
                </button>
            {/if}
        </div>

        {#if derivativeAnalyzing}
            <div class="py-12 animate-in fade-in max-w-3xl mx-auto">
                <div class="flex items-center gap-4 mb-8">
                    <div
                        class="w-8 h-8 rounded-full border-4 border-indigo-100 border-t-indigo-600 animate-spin"
                    ></div>
                    <p
                        class="text-lg font-bold text-indigo-900 transition-all duration-500"
                    >
                        {loadingMessages[currentMessageIndex]}
                    </p>
                </div>

                <div class="space-y-8 opacity-60">
                    <div
                        class="w-3/4 h-8 bg-slate-200 rounded-lg animate-pulse"
                    ></div>
                    <div class="space-y-4">
                        <div
                            class="w-full h-4 bg-slate-100 rounded animate-pulse"
                        ></div>
                        <div
                            class="w-full h-4 bg-slate-100 rounded animate-pulse"
                        ></div>
                        <div
                            class="w-5/6 h-4 bg-slate-100 rounded animate-pulse"
                        ></div>
                    </div>

                    <div
                        class="w-1/2 h-6 bg-slate-100 rounded-lg animate-pulse mt-8"
                    ></div>
                    <div class="space-y-4">
                        <div
                            class="w-full h-4 bg-slate-100 rounded animate-pulse"
                        ></div>
                        <div
                            class="w-4/5 h-4 bg-slate-100 rounded animate-pulse"
                        ></div>
                    </div>
                </div>
            </div>
        {:else if !displaySummary}
            <!-- Empty Output Fallback -->
            <div class="py-16 text-center animate-in fade-in">
                <div
                    class="w-16 h-16 bg-red-50 text-red-500 rounded-full flex items-center justify-center mx-auto mb-4"
                >
                    <svg
                        class="w-8 h-8"
                        fill="none"
                        viewBox="0 0 24 24"
                        stroke="currentColor"
                    >
                        <path
                            stroke-linecap="round"
                            stroke-linejoin="round"
                            stroke-width="2"
                            d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z"
                        />
                    </svg>
                </div>
                <h3 class="text-xl font-bold text-slate-800 mb-2">
                    解析結果の取得に失敗しました
                </h3>
                <p class="text-slate-500">
                    もう一度お試しいただくか、別の講義データを選択してください。
                </p>
            </div>
        {:else}
            <!-- Video Player (Sticky Optional, now regular to not conflict with new sticky toolbar) -->
            {#if previewVideoUrl && $analysisMode === "note"}
                <div
                    class="mb-8 bg-white/50 backdrop-blur-md p-2 rounded-2xl border border-indigo-50 transition-all max-w-2xl mx-auto"
                >
                    <video
                        bind:this={videoPlayer}
                        src={previewVideoUrl}
                        controls
                        class="w-full h-auto max-h-[300px] rounded-xl bg-black shadow-inner"
                    >
                        <track kind="captions" />
                    </video>
                    <p
                        class="text-[10px] text-center text-slate-400 mt-1 font-bold"
                    >
                        ノート内の <span
                            class="text-indigo-600 bg-indigo-50 px-1 rounded"
                            >[00:00]</span
                        > をクリックしてシーク再生
                    </p>
                </div>
            {/if}

            <!-- Sticky Toolbar: Format Options & Slim QA -->
            <div
                class="sticky top-0 z-30 mb-8 bg-white/95 backdrop-blur-md border-b border-slate-200/60 pb-4 pt-2 -mx-4 px-4 shadow-[0_10px_30px_-15px_rgba(0,0,0,0.05)] rounded-b-2xl transition-all"
            >
                <div class="flex flex-col gap-4 max-w-4xl mx-auto">
                    <!-- Top Row: Formats and Edit/Copy -->
                    <div
                        class="flex flex-wrap items-center justify-between gap-4"
                    >
                        <div class="flex items-center gap-2">
                            <span
                                class="text-xs font-bold text-slate-400 uppercase tracking-widest mr-2 hidden sm:inline-block"
                                >変換</span
                            >
                            <div class="flex bg-slate-100/50 p-1 rounded-xl">
                                <button
                                    on:click={() =>
                                        dispatch("select_derivative", "note")}
                                    class="px-3 py-1.5 rounded-lg text-sm font-bold transition-all flex items-center gap-1.5
                                    {selectedDerivativeMode === 'note'
                                        ? 'bg-white text-indigo-600 shadow-sm ring-1 ring-slate-200'
                                        : lectureAnalyses['note']
                                          ? 'text-indigo-600 hover:bg-white/50'
                                          : 'text-slate-500 hover:text-slate-700 hover:bg-white/50'}"
                                >
                                    {lectureAnalyses["note"] ? "✅ " : ""}ノート
                                </button>
                                <button
                                    on:click={() =>
                                        dispatch(
                                            "select_derivative",
                                            "thoughts",
                                        )}
                                    class="px-3 py-1.5 rounded-lg text-sm font-bold transition-all flex items-center gap-1.5
                                    {selectedDerivativeMode === 'thoughts'
                                        ? 'bg-amber-500 text-white shadow-sm hover:bg-amber-600'
                                        : lectureAnalyses['thoughts']
                                          ? 'text-amber-600 hover:bg-white/50'
                                          : 'text-slate-500 hover:text-amber-600 hover:bg-white/50'}"
                                >
                                    {lectureAnalyses["thoughts"]
                                        ? "✅ "
                                        : ""}感想文
                                </button>
                                <button
                                    on:click={() =>
                                        dispatch("select_derivative", "report")}
                                    class="px-3 py-1.5 rounded-lg text-sm font-bold transition-all flex items-center gap-1.5
                                    {selectedDerivativeMode === 'report'
                                        ? 'bg-slate-800 text-white shadow-sm hover:bg-slate-900'
                                        : lectureAnalyses['report']
                                          ? 'text-slate-800 hover:bg-white/50'
                                          : 'text-slate-500 hover:text-slate-800 hover:bg-white/50'}"
                                >
                                    {lectureAnalyses["report"]
                                        ? "✅ "
                                        : ""}レポート
                                </button>
                            </div>
                        </div>

                        <div class="flex items-center gap-2">
                            <button
                                on:click={() => dispatch("edit")}
                                class="text-xs font-bold text-slate-400 hover:text-indigo-600 bg-slate-50 hover:bg-indigo-50 px-3 py-1.5 rounded-lg border border-slate-100 transition-colors flex items-center gap-1 shadow-sm h-8"
                            >
                                <svg
                                    class="w-3.5 h-3.5"
                                    fill="none"
                                    viewBox="0 0 24 24"
                                    stroke="currentColor"
                                    ><path
                                        stroke-linecap="round"
                                        stroke-linejoin="round"
                                        stroke-width="2"
                                        d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z"
                                    /></svg
                                >
                                編集
                            </button>
                        </div>
                    </div>

                    <!-- Middle Row (Conditional): Derivative controls -->
                    {#if selectedDerivativeMode === "thoughts" || selectedDerivativeMode === "report"}
                        <div
                            class="bg-slate-50/80 rounded-xl p-4 border border-slate-200/60 flex flex-col sm:flex-row gap-4 sm:items-center animate-in slide-in-from-top-2"
                        >
                            <div class="flex-grow">
                                <div
                                    class="flex justify-between items-end mb-1 pl-1"
                                >
                                    <span
                                        class="text-[10px] font-bold text-slate-400 uppercase tracking-widest"
                                        >目標文字数</span
                                    >
                                    <span
                                        class="text-xs font-bold text-slate-500"
                                        >{manuscriptPages}枚分 ({derivativeTargetLength}文字)</span
                                    >
                                </div>
                                <input
                                    type="range"
                                    min="100"
                                    max="4000"
                                    step="50"
                                    bind:value={derivativeTargetLength}
                                    on:input={(e) =>
                                        dispatch(
                                            "length_change",
                                            e.currentTarget.value,
                                        )}
                                    class="w-full h-1.5 bg-slate-200 rounded-lg appearance-none cursor-pointer accent-indigo-600 hover:accent-indigo-500 transition-all focus:outline-none focus:ring-2 focus:ring-indigo-500/30"
                                />
                            </div>
                            <button
                                on:click={() =>
                                    dispatch(
                                        "generate",
                                        selectedDerivativeMode,
                                    )}
                                disabled={derivativeAnalyzing}
                                class="shrink-0 bg-indigo-600 hover:bg-indigo-700 text-white px-4 py-2 rounded-lg text-sm font-bold shadow-sm transition-all disabled:opacity-50 flex items-center justify-center gap-2"
                            >
                                {#if derivativeAnalyzing}
                                    <div
                                        class="w-3 h-3 border-2 border-white border-t-transparent rounded-full animate-spin"
                                    ></div>
                                    生成中
                                {:else}
                                    <span>作成する</span>
                                {/if}
                            </button>
                        </div>
                    {/if}
                </div>
            </div>

            <!-- Rich Structured Display -->
            {#if typeof currentAnalysis === "object"}
                <header class="mb-8 border-b border-indigo-50 pb-6">
                    <div
                        class="flex flex-wrap gap-2 mb-3 justify-between items-start"
                    >
                        <div class="flex gap-2">
                            {#if currentAnalysis.category}
                                <span
                                    class="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-bold bg-indigo-50 text-indigo-700 border border-indigo-100"
                                >
                                    {currentAnalysis.category}
                                </span>
                            {/if}
                            <span
                                class="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-bold bg-slate-50 text-slate-500 border border-slate-100 uppercase tracking-wider"
                            >
                                {$analysisMode === "note"
                                    ? "Lecture Note"
                                    : $analysisMode === "thoughts"
                                      ? "Reflections"
                                      : "Academic Report"}
                            </span>
                        </div>

                        <!-- Edit button moved to sticky toolbar. -->
                    </div>

                    <h1
                        class="text-2xl md:text-3xl font-extrabold text-slate-900 tracking-tight leading-tight"
                    >
                        {currentAnalysis.title ||
                            analyzedTitle ||
                            "Analysis Result"}
                    </h1>
                </header>

                <!-- Dynamic Oral Supplements Area -->
                {#if oralSupplements.length > 0}
                    <div
                        class="mb-8 bg-blue-50 border-l-4 border-blue-500 rounded-r-2xl p-6 shadow-sm border-r border-t border-b border-blue-100/50"
                    >
                        <h3
                            class="flex items-center gap-2 text-blue-900 font-bold text-lg mb-4"
                        >
                            <span>🔊</span>
                            講師による重要補足（スライド外の情報）
                        </h3>
                        <div class="space-y-4">
                            {#each oralSupplements as supplement}
                                <div
                                    class="prose prose-sm max-w-none prose-p:text-blue-800 prose-p:leading-relaxed prose-strong:text-blue-900"
                                >
                                    {@html marked.parse(
                                        supplement.replace(/^>[ \t]*/gm, ""),
                                    )}
                                </div>
                            {/each}
                        </div>
                    </div>
                {/if}

                <!-- Main Content (Summary) -->
                <!-- svelte-ignore a11y_click_events_have_key_events -->
                <!-- svelte-ignore a11y_no_noninteractive_element_interactions -->
                <article
                    bind:this={resultTextContainer}
                    on:click={handleTimestampClick}
                    class="prose prose-slate max-w-none
            prose-p:text-slate-700 prose-p:leading-8 prose-p:text-[17px]
            prose-headings:font-bold prose-headings:text-slate-900 prose-headings:tracking-tight
            prose-h2:text-xl prose-h2:mt-10 prose-h2:mb-4 prose-h2:border-l-4 prose-h2:border-indigo-500 prose-h2:pl-3
            prose-h3:text-lg prose-h3:text-indigo-900
            prose-ul:my-6 prose-li:my-1 prose-li:text-slate-700
            prose-strong:text-indigo-900 prose-strong:font-bold
            prose-a:text-indigo-600 prose-a:no-underline hover:prose-a:underline
            prose-blockquote:border-l-indigo-300 prose-blockquote:bg-indigo-50/30 prose-blockquote:py-1 prose-blockquote:px-4 prose-blockquote:rounded-r-lg
            [&>blockquote:has(strong:contains('口頭補足'))]:bg-yellow-50 [&>blockquote:has(strong:contains('口頭補足'))]:border-yellow-400 [&>blockquote:has(strong:contains('口頭補足'))]:text-yellow-900
            [&>blockquote:has(strong:contains('テスト対策'))]:bg-rose-50 [&>blockquote:has(strong:contains('テスト対策'))]:border-rose-400 [&>blockquote:has(strong:contains('テスト対策'))]:text-rose-900
            [&>blockquote:has(strong:contains('意図・背景'))]:bg-emerald-50 [&>blockquote:has(strong:contains('意図・背景'))]:border-emerald-400 [&>blockquote:has(strong:contains('意図・背景'))]:text-emerald-900"
                >
                    {@html (
                        marked.parse(
                            isVideoSource
                                ? cleanedSummaryForMain
                                : cleanedSummaryForMain.replace(
                                      /\[(\d{1,2}:\d{2}(?::\d{2})?)\]/g,
                                      "",
                                  ),
                        ) as string
                    ).replace(
                        /\[(\d{1,2}:\d{2}(?::\d{2})?)\]/g,
                        '<button class="timestamp-link inline-flex items-center gap-1 bg-indigo-50 text-indigo-700 px-1.5 py-0.5 rounded-md text-xs font-bold hover:bg-indigo-100 hover:text-indigo-800 transition-colors cursor-pointer select-none border border-indigo-100/50" data-timestamp="$1">▶ $1</button>',
                    )}
                </article>

                <!-- Strategy Guide -->
                {#if strategyContent}
                    <div
                        class="mt-8 relative group overflow-hidden rounded-2xl border-2 transition-all duration-500 {isPremium
                            ? 'border-amber-400 bg-amber-50'
                            : 'border-slate-200 bg-slate-50'}"
                    >
                        <!-- Header -->
                        <div
                            class="bg-gradient-to-r {isPremium
                                ? 'from-amber-400 to-amber-500 text-white'
                                : 'from-slate-200 to-slate-300 text-slate-500'} px-6 py-3 font-bold flex items-center gap-2"
                        >
                            <span class="text-xl"
                                >{isPremium ? "🏆" : "🔒"}</span
                            >
                            <span>A評価攻略ガイド</span>
                            {#if isPremium}
                                <span
                                    class="ml-auto text-xs bg-white/20 px-2 py-0.5 rounded text-amber-50 font-normal"
                                    >{isUltimate ? "Ultimate" : "Premium"}</span
                                >
                            {/if}
                        </div>

                        <!-- Content -->
                        <div class="p-6 relative">
                            <div
                                class="prose prose-sm max-w-none prose-p:text-slate-700 prose-headings:text-amber-900 {isPremium
                                    ? ''
                                    : 'blur-sm select-none opacity-50 pointer-events-none'}"
                            >
                                {@html marked.parse(strategyContent)}
                            </div>

                            <!-- Lock Overlay for Free Users -->
                            {#if !isPremium}
                                <div
                                    class="absolute inset-0 z-10 flex flex-col items-center justify-center p-6 text-center"
                                >
                                    <div
                                        class="bg-white/90 backdrop-blur-sm p-6 rounded-2xl shadow-xl border border-white/50 max-w-sm"
                                    >
                                        <div
                                            class="w-12 h-12 bg-slate-100 rounded-full flex items-center justify-center mx-auto mb-4 text-2xl"
                                        >
                                            🔒
                                        </div>
                                        <h2
                                            class="font-bold text-slate-900 mb-2"
                                        >
                                            A評価攻略ガイドをアンロック
                                        </h2>
                                        <p
                                            class="text-xs text-slate-500 mb-4 leading-relaxed"
                                        >
                                            この講義の「評価基準」に基づいた、具体的な高評価獲得戦略（レポートのキーワードやテスト対策など）を表示します。
                                        </p>
                                        <button
                                            on:click={() =>
                                                dispatch("upgrade_request")}
                                            class="w-full bg-slate-900 text-white py-3 rounded-xl text-sm font-bold shadow-lg shadow-slate-900/10 hover:shadow-xl hover:-translate-y-0.5 transition-all"
                                        >
                                            プレミアムプランにアップグレード
                                        </button>
                                    </div>
                                </div>
                            {/if}
                        </div>
                    </div>
                {/if}

                <!-- Glossary Section (Conditional) -->
                {#if currentAnalysis.glossary && currentAnalysis.glossary.length > 0}
                    <section class="mt-16 pt-10 border-t border-slate-200/60">
                        <h3
                            class="flex items-center gap-2 text-lg font-bold text-slate-900 mb-6"
                        >
                            <span class="text-xl">📚</span> 用語辞典
                        </h3>
                        <div class="grid grid-cols-1 md:grid-cols-2 gap-4">
                            {#each currentAnalysis.glossary as item}
                                <div
                                    class="bg-slate-50/80 rounded-xl p-4 border border-slate-100 hover:border-indigo-100 hover:shadow-sm transition-all group"
                                >
                                    <dt
                                        class="font-bold text-indigo-900 text-[15px] mb-1 group-hover:text-indigo-700 flex items-baseline justify-between"
                                    >
                                        {item.term}
                                    </dt>
                                    <dd
                                        class="text-sm text-slate-600 leading-relaxed text-[13px]"
                                    >
                                        {item.definition}
                                    </dd>
                                </div>
                            {/each}
                        </div>
                    </section>
                {/if}
            {:else}
                <!-- Legacy String Rendering -->
                <!-- svelte-ignore a11y_click_events_have_key_events -->
                <!-- svelte-ignore a11y_no_noninteractive_element_interactions -->
                <article
                    bind:this={resultTextContainer}
                    on:click={handleTimestampClick}
                    class="prose prose-slate max-w-none prose-headings:font-bold prose-headings:text-slate-800 prose-p:text-slate-600 prose-li:text-slate-600 prose-a:text-indigo-600 prose-strong:text-indigo-700 prose-strong:font-bold prose-code:text-pink-600 prose-code:bg-pink-50 prose-code:px-1 prose-code:rounded prose-pre:bg-slate-900 prose-pre:rounded-2xl prose-img:rounded-2xl prose-hr:border-slate-100 marker:text-indigo-400"
                >
                    {@html (
                        marked.parse(currentAnalysis as string) as string
                    ).replace(
                        /\[(\d{1,2}:\d{2}(?::\d{2})?)\]/g,
                        '<button class="timestamp-link inline-flex items-center gap-1 bg-indigo-50 text-indigo-700 px-1.5 py-0.5 rounded-md text-xs font-bold hover:bg-indigo-100 hover:text-indigo-800 transition-colors cursor-pointer select-none" data-timestamp="$1">▶ $1</button>',
                    )}
                </article>
            {/if}

            <!-- Old bottom format controls removed as they are now in the sticky toolbar -->
        {/if}
    </div>
{/if}
