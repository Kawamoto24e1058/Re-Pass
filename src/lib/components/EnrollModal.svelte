<script lang="ts">
    import { fade, fly, slide } from "svelte/transition";
    import { goto } from "$app/navigation";
    import { getRandomColor, getRandomIcon } from "$lib/utils/metaUtils";
    import {
        collection,
        addDoc,
        deleteDoc,
        doc,
        onSnapshot,
        serverTimestamp,
        query,
        orderBy,
    } from "firebase/firestore";
    import { db } from "$lib/firebase";
    import { user as userStore, userProfile } from "$lib/userStore";

    let { isOpen = false, onClose } = $props();

    let activeTab = $state<"manual" | "image">("manual");

    // Manual Input State
    let manualCourseName = $state("");
    let manualInstructor = $state("");

    // Enrolled Courses State
    let enrolledCourses = $state<any[]>([]);
    let unsubscribeCourses: any = null;

    // Image Upload State
    let imageFile = $state<File | null>(null);
    let imageUploading = $state(false);
    let previewCourses = $state<{ courseName: string; instructor: string }[]>(
        [],
    );
    let errorMessage = $state("");
    let isSaving = $state(false);

    $effect(() => {
        if (isOpen) {
            document.body.style.overflow = "hidden";
            // Subscribe to courses
            if ($userStore) {
                const q = query(
                    collection(db, `users/${$userStore.uid}/enrolled_courses`),
                    orderBy("createdAt", "desc"),
                );
                unsubscribeCourses = onSnapshot(q, (snapshot) => {
                    enrolledCourses = snapshot.docs.map((d) => ({
                        id: d.id,
                        ...d.data(),
                    }));
                });
            }
        } else {
            document.body.style.overflow = "";
            if (unsubscribeCourses) unsubscribeCourses();
            // Reset state
            activeTab = "manual";
            manualCourseName = "";
            manualInstructor = "";
            imageFile = null;
            previewCourses = [];
            errorMessage = "";
        }
        return () => {
            document.body.style.overflow = "";
            if (unsubscribeCourses) unsubscribeCourses();
        };
    });

    async function addManualCourse() {
        if (!manualCourseName.trim()) return;
        if (!$userStore) return;
        try {
            await addDoc(
                collection(db, `users/${$userStore.uid}/enrolled_courses`),
                {
                    courseName: manualCourseName.trim(),
                    instructor: manualInstructor.trim(),
                    color: getRandomColor(),
                    icon: getRandomIcon(),
                    createdAt: serverTimestamp(),
                },
            );
            manualCourseName = "";
            manualInstructor = "";
        } catch (e) {
            console.error(e);
        }
    }

    async function deleteCourse(id: string) {
        if (!$userStore) return;
        try {
            await deleteDoc(
                doc(db, `users/${$userStore.uid}/enrolled_courses/${id}`),
            );
        } catch (e) {
            console.error(e);
        }
    }

    function handleImageChange(e: Event) {
        const input = e.target as HTMLInputElement;
        if (input.files && input.files[0]) {
            imageFile = input.files[0];
            previewCourses = [];
            errorMessage = "";
        }
    }

    async function processImage() {
        if (!imageFile || !$userStore) return;
        imageUploading = true;
        errorMessage = "";
        try {
            const idToken = await $userStore.getIdToken();
            const formData = new FormData();
            formData.append("image", imageFile);

            const res = await fetch("/api/extract-courses", {
                method: "POST",
                headers: {
                    Authorization: `Bearer ${idToken}`,
                },
                body: formData,
            });

            const data = await res.json();
            if (!res.ok) {
                throw new Error(data.error || "抽出に失敗しました");
            }

            previewCourses = data.result || [];
        } catch (e: any) {
            errorMessage = e.message;
        } finally {
            imageUploading = false;
        }
    }

    async function savePreviewCourses() {
        if (!$userStore || previewCourses.length === 0) return;
        isSaving = true;
        try {
            const promises = previewCourses.map((course) => {
                if (!course.courseName.trim()) return Promise.resolve();
                return addDoc(
                    collection(db, `users/${$userStore!.uid}/enrolled_courses`),
                    {
                        courseName: course.courseName.trim(),
                        instructor: course.instructor.trim(),
                        color: getRandomColor(),
                        icon: getRandomIcon(),
                        createdAt: serverTimestamp(),
                    },
                );
            });
            await Promise.all(promises);
            // Reset and close or go back to manual tab
            previewCourses = [];
            imageFile = null;
            activeTab = "manual";
        } catch (e) {
            console.error(e);
            errorMessage = "保存中にエラーが発生しました";
        } finally {
            isSaving = false;
        }
    }

    let isPremium = $derived($userProfile && $userProfile.plan !== "free");
</script>

{#if isOpen}
    <div
        class="fixed inset-0 z-[100] flex items-center justify-center p-4 sm:p-6"
        role="dialog"
        aria-modal="true"
    >
        <!-- Backdrop -->
        <div
            transition:fade={{ duration: 200 }}
            class="absolute inset-0 bg-slate-900/60 backdrop-blur-sm"
            onclick={onClose}
            role="button"
            tabindex="0"
            onkeydown={(e) => e.key === "Escape" && onClose()}
        ></div>

        <!-- Modal Content -->
        <div
            transition:fly={{ y: 20, duration: 400 }}
            class="relative w-full max-w-2xl bg-white rounded-3xl shadow-2xl overflow-hidden flex flex-col max-h-[90vh]"
        >
            <!-- Header -->
            <div
                class="px-6 py-5 border-b border-slate-100 flex justify-between items-center bg-slate-50/50"
            >
                <h2
                    class="text-xl font-bold tracking-tight text-slate-800 flex items-center gap-2"
                >
                    <span class="text-2xl">⚙️</span> 履修講義の登録
                </h2>
                <button
                    onclick={onClose}
                    class="p-2 text-slate-400 hover:text-slate-600 hover:bg-slate-100 rounded-full transition-colors"
                    aria-label="閉じる"
                >
                    <svg
                        class="w-5 h-5"
                        fill="none"
                        viewBox="0 0 24 24"
                        stroke="currentColor"
                    >
                        <path
                            stroke-linecap="round"
                            stroke-linejoin="round"
                            stroke-width="2"
                            d="M6 18L18 6M6 6l12 12"
                        />
                    </svg>
                </button>
            </div>

            <!-- Tabs -->
            <div class="flex border-b border-slate-100">
                <button
                    class="flex-1 py-4 text-sm font-bold transition-colors border-b-2 {activeTab ===
                    'manual'
                        ? 'border-indigo-600 text-indigo-600'
                        : 'border-transparent text-slate-500 hover:text-slate-700 hover:bg-slate-50'}"
                    onclick={() => (activeTab = "manual")}
                >
                    ✍️ 手入力で登録
                </button>
                <button
                    class="flex-1 py-4 text-sm font-bold transition-colors border-b-2 {activeTab ===
                    'image'
                        ? 'border-indigo-600 text-indigo-600'
                        : 'border-transparent text-slate-500 hover:text-slate-700 hover:bg-slate-50'}"
                    onclick={() => (activeTab = "image")}
                >
                    📸 画像から自動登録 <span
                        class="text-xs ml-1 bg-gradient-to-r from-amber-400 to-amber-600 text-white px-2 py-0.5 rounded-full"
                        >Pro限定</span
                    >
                </button>
            </div>

            <!-- Content Area -->
            <div class="p-6 overflow-y-auto flex-1 bg-white">
                {#if activeTab === "manual"}
                    <div transition:fade={{ duration: 200 }}>
                        <div
                            class="bg-indigo-50/50 rounded-2xl p-5 mb-8 border border-indigo-100/50"
                        >
                            <h3
                                class="text-sm font-bold text-indigo-900 mb-4 flex items-center gap-2"
                            >
                                <svg
                                    class="w-4 h-4 text-indigo-500"
                                    fill="none"
                                    viewBox="0 0 24 24"
                                    stroke="currentColor"
                                >
                                    <path
                                        stroke-linecap="round"
                                        stroke-linejoin="round"
                                        stroke-width="2"
                                        d="M12 4v16m8-8H4"
                                    />
                                </svg>
                                新しい講義を追加
                            </h3>
                            <div class="flex flex-col sm:flex-row gap-3">
                                <div class="flex-1">
                                    <input
                                        type="text"
                                        placeholder="講義名 (例: 経済学入門)"
                                        bind:value={manualCourseName}
                                        class="w-full px-4 py-3 bg-white border border-indigo-100 rounded-xl focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:border-transparent transition-all placeholder:text-slate-400 text-slate-700 font-medium"
                                        onkeydown={(e) =>
                                            e.key === "Enter" &&
                                            addManualCourse()}
                                    />
                                </div>
                                <div class="flex-1">
                                    <input
                                        type="text"
                                        placeholder="担当教員 (任意)"
                                        bind:value={manualInstructor}
                                        class="w-full px-4 py-3 bg-white border border-indigo-100 rounded-xl focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:border-transparent transition-all placeholder:text-slate-400 text-slate-700 font-medium"
                                        onkeydown={(e) =>
                                            e.key === "Enter" &&
                                            addManualCourse()}
                                    />
                                </div>
                                <button
                                    onclick={addManualCourse}
                                    disabled={!manualCourseName.trim()}
                                    class="px-6 py-3 bg-indigo-600 text-white font-bold rounded-xl hover:bg-indigo-700 transition-colors disabled:opacity-50 disabled:cursor-not-allowed shadow-md shadow-indigo-600/20 whitespace-nowrap"
                                >
                                    追加
                                </button>
                            </div>
                        </div>

                        <div>
                            <h3
                                class="text-sm font-bold text-slate-700 mb-4 px-1"
                            >
                                現在の登録リスト ({enrolledCourses.length})
                            </h3>

                            {#if enrolledCourses.length === 0}
                                <div
                                    class="text-center py-12 bg-slate-50 rounded-2xl border border-dashed border-slate-200"
                                >
                                    <div class="text-4xl mb-3">📚</div>
                                    <p class="text-slate-500 font-medium">
                                        まだ講義が登録されていません
                                    </p>
                                    <p class="text-slate-400 text-sm mt-1">
                                        上のフォームから追加してください
                                    </p>
                                </div>
                            {:else}
                                <ul class="space-y-2">
                                    {#each enrolledCourses as course (course.id)}
                                        <li
                                            transition:slide={{ duration: 200 }}
                                            class="flex items-center justify-between p-4 bg-white border border-slate-100 rounded-xl hover:border-slate-200 hover:shadow-sm transition-all group"
                                        >
                                            <div>
                                                <p
                                                    class="font-bold text-slate-800"
                                                >
                                                    {course.courseName}
                                                </p>
                                                {#if course.instructor}
                                                    <p
                                                        class="text-xs font-medium text-slate-500 mt-0.5 flex items-center gap-1"
                                                    >
                                                        <svg
                                                            class="w-3 h-3"
                                                            fill="none"
                                                            viewBox="0 0 24 24"
                                                            stroke="currentColor"
                                                        >
                                                            <path
                                                                stroke-linecap="round"
                                                                stroke-linejoin="round"
                                                                stroke-width="2"
                                                                d="M16 7a4 4 0 11-8 0 4 4 0 018 0zM12 14a7 7 0 00-7 7h14a7 7 0 00-7-7z"
                                                            />
                                                        </svg>
                                                        {course.instructor}
                                                    </p>
                                                {/if}
                                            </div>
                                            <button
                                                onclick={() =>
                                                    deleteCourse(course.id)}
                                                class="w-8 h-8 flex items-center justify-center rounded-lg text-slate-300 hover:text-red-500 hover:bg-red-50 transition-colors opacity-0 group-hover:opacity-100"
                                                title="削除"
                                            >
                                                <svg
                                                    class="w-4 h-4"
                                                    fill="none"
                                                    viewBox="0 0 24 24"
                                                    stroke="currentColor"
                                                >
                                                    <path
                                                        stroke-linecap="round"
                                                        stroke-linejoin="round"
                                                        stroke-width="2"
                                                        d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16"
                                                    />
                                                </svg>
                                            </button>
                                        </li>
                                    {/each}
                                </ul>
                            {/if}
                        </div>
                    </div>
                {:else if activeTab === "image"}
                    <div transition:fade={{ duration: 200 }}>
                        {#if !isPremium}
                            <div
                                class="text-center py-16 px-6 bg-gradient-to-br from-indigo-50 to-purple-50 rounded-2xl border border-indigo-100 relative overflow-hidden"
                            >
                                <div
                                    class="absolute inset-0 bg-[url('/noise.png')] opacity-20 mix-blend-overlay"
                                ></div>
                                <div class="relative z-10">
                                    <div
                                        class="w-16 h-16 bg-white rounded-full flex items-center justify-center mx-auto mb-6 shadow-sm border border-indigo-50"
                                    >
                                        <span class="text-3xl">📸</span>
                                    </div>
                                    <h3
                                        class="text-xl font-black text-indigo-900 mb-3 tracking-tight"
                                    >
                                        時間割をAIで一瞬で登録
                                    </h3>
                                    <p
                                        class="text-indigo-700/80 font-medium mb-8 leading-relaxed max-w-sm mx-auto"
                                    >
                                        この機能は有料プラン限定です。時間割やシラバスの写真を撮るだけで、ワンタップで講義リストを構築します。
                                    </p>
                                    <button
                                        onclick={() => {
                                            onClose();
                                            goto("/pricing");
                                        }}
                                        class="px-8 py-3.5 bg-gradient-to-r from-indigo-600 to-indigo-500 text-white font-bold rounded-xl hover:shadow-lg hover:shadow-indigo-500/30 hover:-translate-y-0.5 transition-all w-full sm:w-auto"
                                    >
                                        プランをアップグレード
                                    </button>
                                </div>
                            </div>
                        {:else if previewCourses.length > 0}
                            <div>
                                <div
                                    class="flex items-center justify-between mb-6"
                                >
                                    <h3
                                        class="text-base font-bold text-slate-800 flex items-center gap-2"
                                    >
                                        <span class="text-xl">✨</span> 以下の講義が見つかりました
                                    </h3>
                                    <button
                                        onclick={() => {
                                            previewCourses = [];
                                            imageFile = null;
                                        }}
                                        class="text-sm text-indigo-600 font-bold hover:text-indigo-700 px-3 py-1.5 rounded-lg hover:bg-indigo-50 transition-colors"
                                    >
                                        やり直す
                                    </button>
                                </div>

                                <div class="space-y-3 mb-8">
                                    {#each previewCourses as course, i}
                                        <div class="flex gap-3 p-1">
                                            <input
                                                type="text"
                                                bind:value={course.courseName}
                                                class="flex-[2] px-4 py-2.5 bg-slate-50 border border-slate-200 rounded-xl focus:bg-white focus:outline-none focus:border-indigo-500 focus:ring-1 focus:ring-indigo-500 transition-all text-sm font-bold text-slate-700"
                                                placeholder="講義名"
                                            />
                                            <input
                                                type="text"
                                                bind:value={course.instructor}
                                                class="flex-1 px-4 py-2.5 bg-slate-50 border border-slate-200 rounded-xl focus:bg-white focus:outline-none focus:border-indigo-500 focus:ring-1 focus:ring-indigo-500 transition-all text-sm font-medium text-slate-600"
                                                placeholder="担当教員 (任意)"
                                            />
                                            <button
                                                onclick={() =>
                                                    (previewCourses =
                                                        previewCourses.filter(
                                                            (_, idx) =>
                                                                idx !== i,
                                                        ))}
                                                class="w-10 h-10 flex flex-shrink-0 items-center justify-center rounded-xl text-slate-400 hover:text-red-500 hover:bg-red-50 transition-colors"
                                                aria-label="削除"
                                            >
                                                <svg
                                                    class="w-5 h-5"
                                                    fill="none"
                                                    viewBox="0 0 24 24"
                                                    stroke="currentColor"
                                                >
                                                    <path
                                                        stroke-linecap="round"
                                                        stroke-linejoin="round"
                                                        stroke-width="2"
                                                        d="M6 18L18 6M6 6l12 12"
                                                    />
                                                </svg>
                                            </button>
                                        </div>
                                    {/each}
                                </div>

                                <button
                                    onclick={savePreviewCourses}
                                    disabled={isSaving}
                                    class="w-full py-4 bg-indigo-600 text-white font-bold rounded-xl hover:bg-indigo-700 transition-all disabled:opacity-50 shadow-lg shadow-indigo-600/20 flex items-center justify-center gap-2"
                                >
                                    {#if isSaving}
                                        <svg
                                            class="animate-spin h-5 w-5 text-white"
                                            viewBox="0 0 24 24"
                                        >
                                            <circle
                                                class="opacity-25"
                                                cx="12"
                                                cy="12"
                                                r="10"
                                                stroke="currentColor"
                                                stroke-width="4"
                                                fill="none"
                                            ></circle>
                                            <path
                                                class="opacity-75"
                                                fill="currentColor"
                                                d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"
                                            ></path>
                                        </svg>
                                        保存中...
                                    {:else}
                                        この内容で登録する ({previewCourses.length}件)
                                    {/if}
                                </button>
                            </div>
                        {:else}
                            <div class="space-y-6">
                                <div class="relative">
                                    <input
                                        type="file"
                                        accept="image/*"
                                        onchange={handleImageChange}
                                        disabled={imageUploading}
                                        class="absolute inset-0 w-full h-full opacity-0 cursor-pointer disabled:cursor-not-allowed z-10"
                                        id="file-upload"
                                    />
                                    <div
                                        class="border-2 border-dashed border-indigo-200 rounded-2xl p-10 text-center bg-indigo-50/30 hover:bg-indigo-50/60 transition-colors pointer-events-none relative overflow-hidden"
                                    >
                                        {#if imageUploading}
                                            <div
                                                class="flex flex-col items-center justify-center"
                                            >
                                                <div
                                                    class="w-12 h-12 bg-white rounded-2xl shadow-sm flex items-center justify-center mb-4 relative"
                                                >
                                                    <svg
                                                        class="animate-spin h-6 w-6 text-indigo-600"
                                                        viewBox="0 0 24 24"
                                                    >
                                                        <circle
                                                            class="opacity-25"
                                                            cx="12"
                                                            cy="12"
                                                            r="10"
                                                            stroke="currentColor"
                                                            stroke-width="4"
                                                            fill="none"
                                                        ></circle>
                                                        <path
                                                            class="opacity-75"
                                                            fill="currentColor"
                                                            d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"
                                                        ></path>
                                                    </svg>
                                                </div>
                                                <p
                                                    class="text-indigo-900 font-bold mb-1"
                                                >
                                                    AIが画像を解析中...
                                                </p>
                                                <p
                                                    class="text-indigo-600/70 text-sm font-medium"
                                                >
                                                    数秒お待ちください
                                                </p>
                                            </div>
                                        {:else}
                                            <div
                                                class="w-14 h-14 bg-white rounded-full flex items-center justify-center mx-auto mb-4 shadow-sm text-indigo-500"
                                            >
                                                <svg
                                                    class="w-7 h-7"
                                                    fill="none"
                                                    viewBox="0 0 24 24"
                                                    stroke="currentColor"
                                                >
                                                    <path
                                                        stroke-linecap="round"
                                                        stroke-linejoin="round"
                                                        stroke-width="2"
                                                        d="M4 16l4.586-4.586a2 2 0 012.828 0L16 16m-2-2l1.586-1.586a2 2 0 012.828 0L20 14m-6-6h.01M6 20h12a2 2 0 002-2V6a2 2 0 00-2-2H6a2 2 0 00-2 2v12a2 2 0 002 2z"
                                                    />
                                                </svg>
                                            </div>
                                            <p
                                                class="text-indigo-900 font-bold text-lg mb-2"
                                            >
                                                時間割やシラバスの画像をアップロード
                                            </p>
                                            <p
                                                class="text-indigo-600/70 text-sm font-medium"
                                            >
                                                タップしてファイルを選択 または
                                                ドラッグ＆ドロップ
                                            </p>
                                        {/if}
                                    </div>
                                </div>

                                {#if imageFile && !imageUploading}
                                    <div
                                        class="flex items-center justify-between p-4 bg-slate-50 rounded-xl border border-slate-200"
                                        transition:slide
                                    >
                                        <div
                                            class="flex items-center gap-3 overflow-hidden"
                                        >
                                            <div
                                                class="w-10 h-10 bg-indigo-100 rounded-lg flex items-center justify-center text-indigo-600 flex-shrink-0"
                                            >
                                                <svg
                                                    class="w-5 h-5"
                                                    fill="none"
                                                    viewBox="0 0 24 24"
                                                    stroke="currentColor"
                                                >
                                                    <path
                                                        stroke-linecap="round"
                                                        stroke-linejoin="round"
                                                        stroke-width="2"
                                                        d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-8l-4-4m0 0L8 8m4-4v12"
                                                    />
                                                </svg>
                                            </div>
                                            <div class="min-w-0">
                                                <p
                                                    class="text-sm font-bold text-slate-700 truncate"
                                                >
                                                    {imageFile.name}
                                                </p>
                                                <p
                                                    class="text-xs text-slate-500"
                                                >
                                                    {(
                                                        imageFile.size /
                                                        1024 /
                                                        1024
                                                    ).toFixed(2)} MB
                                                </p>
                                            </div>
                                        </div>
                                        <button
                                            onclick={processImage}
                                            class="px-5 py-2.5 bg-indigo-600 text-white font-bold text-sm rounded-lg hover:bg-indigo-700 transition-colors shadow-sm whitespace-nowrap"
                                        >
                                            AIで解析
                                        </button>
                                    </div>
                                {/if}

                                {#if errorMessage}
                                    <div
                                        class="p-4 bg-red-50 text-red-600 text-sm font-medium rounded-xl border border-red-100 flex items-start gap-2"
                                        transition:slide
                                    >
                                        <svg
                                            class="w-5 h-5 flex-shrink-0 mt-0.5"
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
                                        <p>{errorMessage}</p>
                                    </div>
                                {/if}
                            </div>
                        {/if}
                    </div>
                {/if}
            </div>
        </div>
    </div>
{/if}
