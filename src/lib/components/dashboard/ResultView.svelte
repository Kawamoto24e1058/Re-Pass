<script lang="ts">
    import { createEventDispatcher } from "svelte";
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

    $: currentAnalysis = lectureAnalyses[$analysisMode || "note"] || result;

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
            <div class="py-20 text-center animate-in fade-in">
                <div
                    class="inline-block w-8 h-8 border-4 border-indigo-600 border-t-transparent rounded-full animate-spin mb-4"
                ></div>
                <p class="text-slate-400">生成中...</p>
            </div>
        {:else}
            <!-- Video Player (Sticky) -->
            {#if previewVideoUrl && $analysisMode === "note"}
                <div
                    class="mb-8 sticky top-4 z-30 bg-white/95 backdrop-blur-md p-2 rounded-2xl shadow-lg border border-indigo-50 transition-all max-w-2xl mx-auto ring-1 ring-slate-900/50"
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

                        <button
                            on:click={() => dispatch("edit")}
                            class="text-xs font-bold text-slate-400 hover:text-indigo-600 bg-slate-50 hover:bg-indigo-50 px-3 py-1.5 rounded-lg transition-colors flex items-center gap-1"
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
                            編集に戻る
                        </button>
                    </div>

                    <h1
                        class="text-2xl md:text-3xl font-extrabold text-slate-900 tracking-tight leading-tight"
                    >
                        {currentAnalysis.title ||
                            analyzedTitle ||
                            "Analysis Result"}
                    </h1>
                </header>

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
            prose-blockquote:border-l-indigo-300 prose-blockquote:bg-indigo-50/30 prose-blockquote:py-1 prose-blockquote:px-4 prose-blockquote:rounded-r-lg"
                >
                    {@html (
                        marked.parse(
                            isVideoSource
                                ? displaySummary
                                : displaySummary.replace(
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

            <div class="mt-12 pt-8 border-t border-slate-100">
                <p
                    class="text-xs font-bold text-slate-400 uppercase tracking-widest mb-6 text-center"
                >
                    他の形式も作成する
                </p>
                <div class="flex flex-wrap justify-center gap-4">
                    <button
                        on:click={() => dispatch("select_derivative", "note")}
                        class="px-6 py-3 rounded-2xl font-bold transition-all flex items-center gap-2
            {selectedDerivativeMode === 'note'
                            ? 'bg-indigo-600 text-white shadow-lg shadow-indigo-100'
                            : lectureAnalyses['note']
                              ? 'bg-white border border-indigo-200 text-indigo-600'
                              : 'bg-white border border-slate-200 text-slate-500 hover:border-indigo-300 hover:text-indigo-600'}"
                    >
                        {lectureAnalyses["note"] ? "✅ " : ""}ノート形式
                    </button>
                    <button
                        on:click={() =>
                            dispatch("select_derivative", "thoughts")}
                        class="px-6 py-3 rounded-2xl font-bold transition-all flex items-center gap-2
            {selectedDerivativeMode === 'thoughts'
                            ? 'bg-amber-500 text-white shadow-lg shadow-amber-100'
                            : lectureAnalyses['thoughts']
                              ? 'bg-white border border-amber-200 text-amber-600'
                              : 'bg-white border border-slate-200 text-slate-500 hover:border-amber-300 hover:text-amber-600'}"
                    >
                        {lectureAnalyses["thoughts"] ? "✅ " : ""}感想文形式
                    </button>
                    <button
                        on:click={() => dispatch("select_derivative", "report")}
                        class="px-6 py-3 rounded-2xl font-bold transition-all flex items-center gap-2
            {selectedDerivativeMode === 'report'
                            ? 'bg-slate-800 text-white shadow-lg shadow-slate-200'
                            : lectureAnalyses['report']
                              ? 'bg-white border border-slate-400 text-slate-800'
                              : 'bg-white border border-slate-200 text-slate-500 hover:border-slate-800 hover:text-slate-800'}"
                    >
                        {lectureAnalyses["report"] ? "✅ " : ""}レポート形式
                    </button>
                </div>

                <!-- Derivative Length Slider -->
                {#if selectedDerivativeMode === "thoughts" || selectedDerivativeMode === "report"}
                    <div
                        class="mt-8 max-w-lg mx-auto bg-slate-50 p-6 rounded-2xl border border-slate-200 transition-all"
                    >
                        <div class="flex justify-between items-end mb-4">
                            <span
                                class="block text-xs font-bold text-slate-400 uppercase tracking-widest"
                                >目標文字数</span
                            >
                            <span
                                class="text-xs font-bold text-slate-400 bg-white px-2 py-1 rounded-lg shadow-sm border border-slate-100"
                            >
                                {manuscriptPages}枚分
                            </span>
                        </div>

                        <div class="relative w-full pt-6 pb-2">
                            <span
                                class="absolute -top-3 px-3 py-1 bg-indigo-600 text-white text-xs font-bold rounded-lg transform -translate-x-1/2 transition-all"
                                style="left: {((derivativeTargetLength - 100) /
                                    3900) *
                                    100}%"
                            >
                                {derivativeTargetLength}文字
                            </span>
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
                                class="w-full h-2 bg-slate-200 rounded-lg appearance-none cursor-pointer accent-indigo-600 hover:accent-indigo-500 relative z-10 transition-all focus:outline-none focus:ring-2 focus:ring-indigo-500/30"
                            />

                            <div
                                class="relative w-full mt-2 text-xs text-slate-400 font-bold"
                            >
                                <span
                                    class="absolute"
                                    style="left: 0%; transform: translateX(0);"
                                    >100</span
                                >
                                <span
                                    class="absolute"
                                    style="left: 10.25%; transform: translateX(-50%);"
                                    >500</span
                                >
                                <span
                                    class="absolute"
                                    style="left: 48.71%; transform: translateX(-50%);"
                                    >2000</span
                                >
                                <span
                                    class="absolute"
                                    style="right: 0%; transform: translateX(0);"
                                    >4000</span
                                >
                            </div>
                        </div>
                    </div>
                {/if}

                {#if selectedDerivativeMode}
                    <div class="mt-8 flex justify-center">
                        <button
                            on:click={() =>
                                dispatch("generate", selectedDerivativeMode)}
                            disabled={derivativeAnalyzing}
                            class="bg-indigo-600 hover:bg-indigo-700 text-white px-8 py-3 rounded-xl font-bold shadow-lg shadow-indigo-200 transition-all hover:-translate-y-0.5 disabled:opacity-50 flex items-center gap-2"
                        >
                            {#if derivativeAnalyzing}
                                <div
                                    class="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin"
                                ></div>
                                生成中...
                            {:else}
                                <span>🚀 選択した形式で生成する</span>
                            {/if}
                        </button>
                    </div>
                {/if}
            </div>
        {/if}
    </div>
{/if}
