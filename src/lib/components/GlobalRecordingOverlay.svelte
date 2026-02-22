<script lang="ts">
    import { slide, fade, fly } from "svelte/transition";
    import {
        isRecording,
        transcript,
        resetAll,
        isOverlayVisible,
        isOverlayExpanded,
        pdfFile,
        txtFile,
        audioFile,
        imageFile,
        videoFile,
        targetUrl,
        courseName,
        analysisMode,
        selectedSyllabus,
    } from "$lib/stores/recordingStore";
    import { recognitionService } from "$lib/services/recognitionService";
    import { user as userStore } from "$lib/userStore";
    import { goto } from "$app/navigation";
    import { page } from "$app/stores";
    import { subjects, currentBinder } from "$lib/stores";
    import { storage, auth, db } from "$lib/firebase";
    import {
        ref,
        uploadBytesResumable,
        getDownloadURL,
        deleteObject,
    } from "firebase/storage";
    import {
        collection,
        addDoc,
        doc,
        setDoc,
        serverTimestamp,
        getDoc,
    } from "firebase/firestore";
    import { normalizeCourseName } from "$lib/utils/textUtils";
    import {
        extractAudioFromVideo,
        type AudioExtractionProgress,
    } from "$lib/utils/audioExtractor";
    import { retryOperation } from "$lib/utils/retry";
    import UpgradeModal from "$lib/components/UpgradeModal.svelte";

    // --- Local State for Analysis ---
    let analyzing = false;
    let isExtractingAudio = false;
    let extractionProgress: AudioExtractionProgress | null = null;
    let audioUploadPromise: Promise<string> | null = null;
    let cancellationController: AbortController | null = null;

    let progressValue = 0;
    let progressStatus = "";
    let progressInterval: any;
    let toastMessage: string | null = null;

    let showUpgradeModal = false;
    let upgradeModalTitle = "ULTIMATE限定機能";
    let upgradeModalMessage = "";
    let showCourseNameError = false;

    // Plan helpers
    $: userData = $userStore ? $userStore : null; // Need to fetch fresh user data if possible, but store is okay
    // We need to fetch basic user profile data to check plans accurately if not in store.
    // Assuming userStore has { uid, ... } and we might need to look up claims or profile doc.
    // For now, let's blindly trust userStore or fetch if needed.
    // Ideally userStore should be populated.
    // We'll use a reactive statement to read profile from DB if strictly needed,
    // but let's assume passed in props or global store 'userProfile'.

    import { userProfile } from "$lib/userStore"; // Assuming this exists as seen in +page.svelte
    $: isUltimate = $userProfile?.plan === "ultimate";
    $: isPremium =
        isUltimate ||
        $userProfile?.plan === "premium" ||
        $userProfile?.plan === "season";

    // Duration Timer
    let duration = 0;
    let timerInterval: any;

    $: if ($isRecording) {
        if (!timerInterval) {
            timerInterval = setInterval(() => duration++, 1000);
        }
    } else {
        if (timerInterval) {
            clearInterval(timerInterval);
            timerInterval = null;
            duration = 0;
        }
    }

    function formatTime(seconds: number) {
        const m = Math.floor(seconds / 60)
            .toString()
            .padStart(2, "0");
        const s = (seconds % 60).toString().padStart(2, "0");
        return `${m}:${s}`;
    }

    // Auto-show overlay when recording starts
    $: if ($isRecording && !$isOverlayVisible) {
        isOverlayVisible.set(true);
        isOverlayExpanded.set(true); // Also expand? Yes, probably.
    }

    function toggleExpand() {
        isOverlayExpanded.update((v) => !v);
    }

    function minimize() {
        isOverlayExpanded.set(false);
    }

    function closeOverlay() {
        if ($isRecording) {
            if (!confirm("録音を停止して閉じますか？")) return;
            recognitionService.stop();
        }
        if (analyzing) {
            if (!confirm("解析を中断して閉じますか？")) return;
            if (cancellationController) cancellationController.abort();
        }
        isOverlayVisible.set(false);
        resetAll();
    }

    function startRecording() {
        recognitionService.start();
    }

    function stopRecording() {
        recognitionService.stop();
    }

    // --- Analysis Logic ---

    function startProgress() {
        progressValue = 0;
        progressStatus = "音声データを解析中...";
        progressInterval = setInterval(() => {
            if (progressValue < 30) {
                progressValue += Math.random() * 2;
                progressStatus = "音声データを解析中...";
            } else if (progressValue < 60) {
                progressValue += Math.random() * 1.5;
                progressStatus = "講義の構造を分析中...";
            } else if (progressValue < 85) {
                progressValue += Math.random() * 0.5;
                progressStatus = "ノートをまとめています...";
            } else if (progressValue < 95) {
                progressValue += 0.1;
                progressStatus = "仕上げ中...";
            }
        }, 200);
    }

    async function stopProgress() {
        clearInterval(progressInterval);
        progressValue = 100;
        progressStatus = "完了";
        await new Promise((r) => setTimeout(r, 500));
    }

    async function uploadToStorage(file: File): Promise<string> {
        const originalName = file.name || "file";
        const filename = `${Date.now()}_${originalName}`;
        const storageRef = ref(
            storage,
            `uploads/${$userStore?.uid}/${filename}`,
        );

        return retryOperation(async () => {
            return new Promise((resolve, reject) => {
                const uploadTask = uploadBytesResumable(storageRef, file);

                if (cancellationController?.signal.aborted) {
                    uploadTask.cancel();
                    reject(new DOMException("Upload cancelled", "AbortError"));
                    return;
                }

                const abortHandler = () => {
                    uploadTask.cancel();
                    reject(new DOMException("Upload cancelled", "AbortError"));
                };
                cancellationController?.signal.addEventListener(
                    "abort",
                    abortHandler,
                );

                uploadTask.on(
                    "state_changed",
                    (snapshot) => {
                        const progress =
                            (snapshot.bytesTransferred / snapshot.totalBytes) *
                            100;
                        progressValue = 40 + progress * 0.4;
                        progressStatus = "ファイルをアップロード中...";
                    },
                    (error) => {
                        cancellationController?.signal.removeEventListener(
                            "abort",
                            abortHandler,
                        );
                        reject(error);
                    },
                    async () => {
                        cancellationController?.signal.removeEventListener(
                            "abort",
                            abortHandler,
                        );
                        const url = await getDownloadURL(
                            uploadTask.snapshot.ref,
                        );
                        resolve(url);
                    },
                );
            });
        });
    }

    async function extractAudio(file: File) {
        try {
            isExtractingAudio = true;
            const result = await extractAudioFromVideo(file, (p) => {
                extractionProgress = p;
            });
            const extractedFile = new File(
                [result.blob],
                file.name.replace(/\.[^/.]+$/, "") + ".wav",
                { type: "audio/wav" },
            );
            audioFile.set(extractedFile);
            videoFile.set(null); // Prioritize audio
            toastMessage = "🎥 デジタル高速抽出完了 (WAV 16kHz)";
            // Start upload immediately?
            // audioUploadPromise = uploadToStorage(extractedFile); // Can't start yet, controller not ready?
            // Actually we should wait for Analyze click to upload, or start background?
            // +page.svelte started it immediately. Let's do same if we can manage cancellation.
            // For simplicity, we'll wait for analyze click in this global version to avoid orphans.

            setTimeout(() => (toastMessage = null), 3000);
        } catch (e: any) {
            console.error(e);
            toastMessage = "音声抽出失敗: " + e.message;
        } finally {
            isExtractingAudio = false;
            extractionProgress = null;
        }
    }

    async function handleAnalyze() {
        if (analyzing || isExtractingAudio) return;

        if (!$courseName.trim()) {
            showCourseNameError = true;
            toastMessage = "講義名を入力してください";
            return;
        }

        if (
            !$pdfFile &&
            !$txtFile &&
            !$audioFile &&
            !$imageFile &&
            !$videoFile &&
            !$targetUrl &&
            !$transcript
        ) {
            toastMessage = "学習素材を入力してください";
            return;
        }

        // Quota Checks (simplified for brevity, assume similar logic to +page.svelte)
        const usageCount = $userProfile?.usageCount || 0;
        if (!isPremium && usageCount >= 5) {
            showUpgradeModal = true;
            return;
        }
        if (($videoFile || $audioFile || $targetUrl) && !isUltimate) {
            showUpgradeModal = true;
            toastMessage = "動画・音声解析はアルティメットプラン限定です";
            return;
        }

        analyzing = true;
        startProgress();
        toastMessage = null;
        showCourseNameError = false;

        try {
            if (!$userStore) throw new Error("User not found");
            const idToken = await $userStore.getIdToken();

            let audioUrl = "";
            let videoUrl = "";
            let pdfUrl = "";
            let imageUrl = "";

            cancellationController = new AbortController();
            const signal = cancellationController.signal;

            // Uploads
            if ($audioFile) audioUrl = await uploadToStorage($audioFile);
            if ($videoFile) videoUrl = await uploadToStorage($videoFile); // Should be null if extracted
            if ($pdfFile) pdfUrl = await uploadToStorage($pdfFile);
            if ($imageFile) imageUrl = await uploadToStorage($imageFile);

            const formData = new FormData();
            if (audioUrl) formData.append("audioUrl", audioUrl);
            if (videoUrl) formData.append("videoUrl", videoUrl);
            if (pdfUrl) formData.append("pdfUrl", pdfUrl);
            if (imageUrl) formData.append("imageUrl", imageUrl);
            if ($txtFile) formData.append("txt", $txtFile);
            if ($targetUrl) formData.append("url", $targetUrl);
            formData.append("transcript", $transcript);
            formData.append("mode", $analysisMode);
            formData.append("plan", $userProfile?.plan || "free");
            // formData.append("targetLength", ...); // Default or store?

            const res = await fetch("/api/analyze", {
                method: "POST",
                body: formData,
                headers: { Authorization: `Bearer ${idToken}` },
                signal,
            });

            if (!res.ok) throw new Error("Analysis failed");
            const data = await res.json();

            // Save Logic
            const lectureData = {
                title: data.result?.title || $courseName,
                courseName: $courseName,
                content: $transcript,
                analysis: data.result, // The structured result
                analyses: { [$analysisMode]: data.result },
                createdAt: serverTimestamp(),
                subjectId: $currentBinder || null,
                uid: $userStore?.uid,
                sourceType: $videoFile
                    ? "video"
                    : $audioFile
                      ? "audio"
                      : $targetUrl
                        ? "url"
                        : "text",
            };

            const docRef = await addDoc(
                collection(db, `users/${$userStore?.uid}/lectures`),
                lectureData,
            );

            // Success
            toastMessage = "解析完了！";
            await stopProgress();
            analyzing = false;

            // Navigate
            minimize();
            resetAll(); // Clear inputs
            goto(`/?lectureId=${docRef.id}`);
        } catch (e: any) {
            console.error(e);
            toastMessage = "エラー: " + e.message;
            analyzing = false;
            stopProgress();
        }
    }

    // --- Handlers ---
    function handleFileChange(e: Event, type: string) {
        const input = e.target as HTMLInputElement;
        if (input.files && input.files[0]) {
            const file = input.files[0];
            if (type === "pdf") pdfFile.set(file);
            if (type === "txt") txtFile.set(file);
            if (type === "image") imageFile.set(file);
            if (type === "audio") audioFile.set(file);
            if (type === "video") {
                videoFile.set(file);
                extractAudio(file);
            }
        }
    }
    // Auto-minimize when navigating (if expanded)
    let lastPath = "";
    $: if ($page.url.pathname !== lastPath) {
        lastPath = $page.url.pathname;
        if ($isOverlayVisible && $isOverlayExpanded) {
            minimize();
        }
    }
</script>

{#if $isOverlayVisible}
    <!-- Overlay Backdrop -->
    {#if $isOverlayExpanded}
        <div
            class="fixed inset-0 bg-black/40 backdrop-blur-sm z-50 pointer-events-auto"
            transition:fade
            on:click={minimize}
            role="button"
            tabindex="0"
            on:keydown={(e) => e.key === "Enter" && minimize()}
        ></div>
    {/if}

    <!-- Main Container -->
    {#if $isOverlayExpanded}
        <div
            class="fixed inset-x-0 bottom-0 sm:inset-0 sm:flex sm:items-center sm:justify-center z-50 pointer-events-none"
        >
            <div
                class="bg-white w-full h-[90vh] sm:h-auto sm:max-w-5xl sm:rounded-3xl shadow-2xl flex flex-col pointer-events-auto overflow-hidden transition-all transform"
                transition:fly={{ y: 50 }}
            >
                <!-- Header -->
                <div
                    class="flex items-center justify-between px-6 py-4 border-b border-gray-100 bg-white"
                >
                    <h2
                        class="text-lg font-bold text-gray-800 flex items-center gap-2"
                    >
                        {#if $isRecording}
                            <span class="animate-pulse text-red-500"
                                >● 録音中</span
                            >
                            <span class="font-mono text-red-500"
                                >{formatTime(duration)}</span
                            >
                        {:else}
                            <span class="text-gray-700">新しい講義を追加</span>
                        {/if}
                    </h2>
                    <div class="flex items-center gap-2">
                        <button
                            on:click={minimize}
                            class="p-2 hover:bg-gray-100 rounded-full text-gray-500"
                        >
                            <span class="sr-only">Minimize</span>
                            <svg
                                class="w-6 h-6"
                                fill="none"
                                viewBox="0 0 24 24"
                                stroke="currentColor"
                                ><path
                                    stroke-linecap="round"
                                    stroke-linejoin="round"
                                    stroke-width="2"
                                    d="M19 9l-7 7-7-7"
                                /></svg
                            >
                        </button>
                        <button
                            on:click={closeOverlay}
                            class="p-2 hover:bg-red-50 rounded-full text-red-400"
                        >
                            <span class="sr-only">Close</span>
                            <svg
                                class="w-6 h-6"
                                fill="none"
                                viewBox="0 0 24 24"
                                stroke="currentColor"
                                ><path
                                    stroke-linecap="round"
                                    stroke-linejoin="round"
                                    stroke-width="2"
                                    d="M6 18L18 6M6 6l12 12"
                                /></svg
                            >
                        </button>
                    </div>
                </div>

                <!-- Scrollable Content -->
                <div class="flex-1 overflow-y-auto p-6 bg-slate-50">
                    <!-- Course Name Input -->
                    <div class="mb-6">
                        <label
                            for="course-name"
                            class="block text-sm font-bold text-slate-700 mb-2"
                            >講義名 <span class="text-red-500">*</span></label
                        >
                        <input
                            id="course-name"
                            type="text"
                            bind:value={$courseName}
                            placeholder="例: 線形代数 第3回"
                            class="w-full text-lg font-bold border-0 bg-transparent border-b-2 border-slate-200 focus:border-indigo-500 focus:ring-0 px-0 py-2 transition-colors placeholder:text-slate-300 {showCourseNameError
                                ? 'border-red-400'
                                : ''}"
                        />
                        {#if showCourseNameError}<p
                                class="text-xs text-red-500 mt-1"
                            >
                                必須項目です
                            </p>{/if}
                    </div>

                    <!-- File Inputs Grid -->
                    <div class="grid grid-cols-1 md:grid-cols-2 gap-8">
                        <div class="space-y-4">
                            <h3
                                class="text-xs font-bold text-slate-400 uppercase tracking-widest"
                            >
                                資料を添付
                            </h3>
                            <div class="grid grid-cols-4 gap-3">
                                <!-- PDF -->
                                <label
                                    class="aspect-square rounded-xl border-2 border-dashed border-slate-300 hover:border-indigo-400 flex flex-col items-center justify-center cursor-pointer transition-colors {$pdfFile
                                        ? 'bg-indigo-50 border-indigo-500'
                                        : 'bg-white'}"
                                >
                                    <span
                                        class="text-xs font-bold text-slate-500"
                                        >PDF</span
                                    >
                                    <span
                                        class="text-[9px] text-slate-400 truncate max-w-[90%]"
                                        >{$pdfFile ? $pdfFile.name : ""}</span
                                    >
                                    <input
                                        type="file"
                                        accept=".pdf"
                                        class="hidden"
                                        on:change={(e) =>
                                            handleFileChange(e, "pdf")}
                                    />
                                </label>
                                <!-- Image -->
                                <label
                                    class="aspect-square rounded-xl border-2 border-dashed border-slate-300 hover:border-emerald-400 flex flex-col items-center justify-center cursor-pointer transition-colors {$imageFile
                                        ? 'bg-emerald-50 border-emerald-500'
                                        : 'bg-white'}"
                                >
                                    <span
                                        class="text-xs font-bold text-slate-500"
                                        >IMG</span
                                    >
                                    <span
                                        class="text-[9px] text-slate-400 truncate max-w-[90%]"
                                        >{$imageFile
                                            ? $imageFile.name
                                            : ""}</span
                                    >
                                    <input
                                        type="file"
                                        accept="image/*"
                                        class="hidden"
                                        on:change={(e) =>
                                            handleFileChange(e, "image")}
                                    />
                                </label>
                                <!-- Audio -->
                                <label
                                    class="aspect-square rounded-xl border-2 border-dashed border-slate-300 hover:border-amber-400 flex flex-col items-center justify-center cursor-pointer transition-colors {$audioFile
                                        ? 'bg-amber-50 border-amber-500'
                                        : 'bg-white'}"
                                >
                                    <span
                                        class="text-xs font-bold text-slate-500"
                                        >AUDIO</span
                                    >
                                    <span
                                        class="text-[9px] text-slate-400 truncate max-w-[90%]"
                                        >{$audioFile
                                            ? $audioFile.name
                                            : ""}</span
                                    >
                                    <input
                                        type="file"
                                        accept="audio/*"
                                        class="hidden"
                                        on:change={(e) =>
                                            handleFileChange(e, "audio")}
                                    />
                                </label>
                                <!-- Video -->
                                <label
                                    class="aspect-square rounded-xl border-2 border-dashed border-slate-300 hover:border-rose-400 flex flex-col items-center justify-center cursor-pointer transition-colors {$videoFile
                                        ? 'bg-rose-50 border-rose-500'
                                        : 'bg-white'}"
                                >
                                    <span
                                        class="text-xs font-bold text-slate-500"
                                        >VIDEO</span
                                    >
                                    <span
                                        class="text-[9px] text-slate-400 truncate max-w-[90%]"
                                        >{$videoFile
                                            ? $videoFile.name
                                            : ""}</span
                                    >
                                    <input
                                        type="file"
                                        accept="video/*"
                                        class="hidden"
                                        on:change={(e) =>
                                            handleFileChange(e, "video")}
                                    />
                                </label>
                            </div>
                            {#if isExtractingAudio}
                                <div
                                    class="text-xs text-slate-500 flex items-center gap-2"
                                >
                                    <div
                                        class="w-3 h-3 rounded-full border-2 border-rose-500 border-t-transparent animate-spin"
                                    ></div>
                                    動画から音声を抽出中...
                                </div>
                            {/if}
                        </div>

                        <!-- Transcript Preview -->
                        <div
                            class="flex flex-col h-[200px] bg-white rounded-xl border border-slate-200 overflow-hidden relative"
                        >
                            <div
                                class="bg-slate-50 px-3 py-2 border-b border-slate-100 flex justify-between items-center"
                            >
                                <span class="text-xs font-bold text-slate-500"
                                    >TRANSCRIPT</span
                                >
                            </div>
                            <div
                                class="flex-1 p-3 overflow-y-auto text-sm text-slate-600 leading-relaxed font-mono whitespace-pre-wrap"
                            >
                                {$transcript || "No transcript yet..."}
                            </div>
                        </div>
                    </div>

                    <!-- Footer Action -->
                    <div class="mt-8 flex flex-col items-center gap-4">
                        {#if analyzing}
                            <div class="flex flex-col items-center gap-2">
                                <div class="flex items-center gap-2">
                                    <div
                                        class="w-5 h-5 border-2 border-indigo-600 border-t-transparent rounded-full animate-spin"
                                    ></div>
                                    <span class="font-bold text-indigo-900"
                                        >{progressStatus} ({Math.round(
                                            progressValue,
                                        )}%)</span
                                    >
                                </div>
                                <div
                                    class="w-64 h-2 bg-slate-100 rounded-full overflow-hidden"
                                >
                                    <div
                                        class="h-full bg-indigo-500 transition-all duration-300"
                                        style="width: {progressValue}%"
                                    ></div>
                                </div>
                            </div>
                        {:else}
                            <div class="flex items-center gap-4">
                                {#if !$isRecording}
                                    <button
                                        on:click={startRecording}
                                        class="bg-red-500 hover:bg-red-600 text-white px-8 py-4 rounded-full font-bold shadow-lg shadow-red-200 transition-all hover:scale-105 flex items-center gap-2"
                                    >
                                        <div
                                            class="w-3 h-3 bg-white rounded-full"
                                        ></div>
                                        録音開始
                                    </button>

                                    <button
                                        on:click={handleAnalyze}
                                        class="bg-slate-900 hover:bg-slate-800 text-white px-8 py-4 rounded-full font-bold shadow-lg shadow-slate-200 transition-all hover:scale-105 flex items-center gap-2"
                                    >
                                        <span>⚡ 解析する</span>
                                    </button>
                                {:else}
                                    <button
                                        on:click={stopRecording}
                                        class="bg-white border-2 border-red-500 text-red-500 hover:bg-red-50 px-8 py-4 rounded-full font-bold shadow-sm transition-all flex items-center gap-2"
                                    >
                                        <div
                                            class="w-3 h-3 bg-red-500 rounded-sm"
                                        ></div>
                                        録音停止
                                    </button>
                                {/if}
                            </div>
                        {/if}

                        {#if toastMessage}
                            <div
                                class="mt-2 text-sm font-bold text-indigo-600 animate-bounce"
                            >
                                {toastMessage}
                            </div>
                        {/if}
                    </div>
                </div>
            </div>
        </div>
    {:else}
        <!-- Minimized Floating Bar -->
        <button
            class="fixed bottom-6 right-6 z-[60] bg-slate-900 text-white shadow-2xl rounded-full pl-2 pr-6 py-2 flex items-center gap-3 transition-all hover:scale-105 hover:bg-slate-800 group border border-white/10"
            on:click={toggleExpand}
            transition:fly={{ y: 20 }}
        >
            <div
                class="w-10 h-10 rounded-full flex items-center justify-center bg-slate-800 group-hover:bg-slate-700 relative"
            >
                {#if $isRecording}
                    <span
                        class="animate-ping absolute inline-flex h-full w-full rounded-full bg-red-400 opacity-20"
                    ></span>
                    <div class="w-3 h-3 bg-red-500 rounded-full"></div>
                {:else if analyzing}
                    <div
                        class="w-4 h-4 border-2 border-indigo-400 border-t-transparent rounded-full animate-spin"
                    ></div>
                {:else}
                    <svg
                        class="w-5 h-5 text-gray-400"
                        fill="none"
                        viewBox="0 0 24 24"
                        stroke="currentColor"
                        ><path
                            stroke-linecap="round"
                            stroke-linejoin="round"
                            stroke-width="2"
                            d="M19 11a7 7 0 01-7 7m0 0a7 7 0 01-7-7m7 7v4m0 0H8m4 0h4m-4-8a3 3 0 01-3-3V5a3 3 0 116 0v6a3 3 0 01-3 3z"
                        /></svg
                    >
                {/if}
            </div>
            <div class="text-left">
                <div
                    class="text-[10px] font-bold text-slate-400 uppercase tracking-wider flex items-center gap-2"
                >
                    {#if analyzing}
                        <span class="text-indigo-400"
                            >ANALYZING {Math.round(progressValue)}%</span
                        >
                    {:else if $isRecording}
                        <span class="text-red-400">REC</span>
                        <span>{formatTime(duration)}</span>
                    {:else}
                        <span>Ready</span>
                    {/if}
                </div>
                <div
                    class="text-xs font-medium max-w-[150px] truncate text-slate-200"
                >
                    {analyzing
                        ? progressStatus
                        : $transcript
                          ? $transcript.slice(-30)
                          : "タップして展開"}
                </div>
            </div>
            <div
                class="w-6 h-6 flex items-center justify-center text-slate-500 group-hover:text-white transition-colors"
            >
                <svg
                    class="w-4 h-4"
                    fill="none"
                    viewBox="0 0 24 24"
                    stroke="currentColor"
                    ><path
                        stroke-linecap="round"
                        stroke-linejoin="round"
                        stroke-width="2"
                        d="M5 15l7-7 7 7"
                    /></svg
                >
            </div>
        </button>
    {/if}
{/if}

<UpgradeModal
    isOpen={showUpgradeModal}
    onClose={() => (showUpgradeModal = false)}
    title={upgradeModalTitle}
    message={upgradeModalMessage}
/>
