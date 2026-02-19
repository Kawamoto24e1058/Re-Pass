<script lang="ts">
    import { onMount } from "svelte";
    import { db, auth } from "$lib/firebase";
    import {
        collection,
        query,
        where,
        orderBy,
        onSnapshot,
        doc,
        getDoc,
    } from "firebase/firestore";
    import { user as userStore } from "$lib/userStore";
    import { goto } from "$app/navigation";
    import { fade, fly } from "svelte/transition";

    let lectures = $state<any[]>([]);
    let loading = $state(true);
    let user = $state<any>(null);

    // Subscribe to user store
    $effect(() => {
        user = $userStore;
    });

    onMount(() => {
        const unsubscribeAuth = auth.onAuthStateChanged(async (currentUser) => {
            if (currentUser) {
                // Fetch Uncategorized Lectures (subjectId == null)
                const q = query(
                    collection(db, `users/${currentUser.uid}/lectures`),
                    // where("subjectId", "==", null), // Firestore equality for null can be tricky, often just fetching all root collection items that are NOT in a subcollection is easier if structure allows.
                    // In this app's structure:
                    // Root lectures are `users/{uid}/lectures` -> These are uncategorized/inbox.
                    // Subject lectures are `users/{uid}/subjects/{sid}/lectures`.
                    // So querying the root `lectures` collection IS querying uncategorized ones.
                    orderBy("createdAt", "desc"),
                );

                const unsubscribe = onSnapshot(q, (snapshot) => {
                    lectures = snapshot.docs.map((doc) => ({
                        id: doc.id,
                        path: doc.ref.path,
                        ...doc.data(),
                    }));
                    loading = false;
                });

                return () => unsubscribe();
            } else {
                loading = false;
            }
        });

        return () => unsubscribeAuth();
    });

    function formatDate(timestamp: any) {
        if (!timestamp) return "";
        const date = timestamp.toDate();
        return new Intl.DateTimeFormat("ja-JP", {
            year: "numeric",
            month: "2-digit",
            day: "2-digit",
            hour: "2-digit",
            minute: "2-digit",
        }).format(date);
    }

    function getPreview(lecture: any) {
        if (lecture.analysis?.summary) return lecture.analysis.summary;
        if (typeof lecture.analysis === "string") return lecture.analysis;
        return lecture.content || "内容がありません";
    }
</script>

<div class="min-h-screen bg-[#F0F2F5] pb-20">
    <div class="max-w-5xl mx-auto px-4 pt-8 md:pt-12">
        <!-- Header -->
        <div class="mb-8 flex items-center justify-between">
            <div>
                <h1 class="text-2xl md:text-3xl font-bold text-slate-800 mb-2">
                    未分類の履歴
                </h1>
                <p class="text-slate-500 text-sm">
                    科目バインダーに整理されていない講義の一覧です。
                </p>
            </div>
            <a
                href="/"
                class="bg-indigo-600 text-white px-4 py-2 rounded-xl text-sm font-bold shadow-md hover:bg-indigo-700 transition-colors flex items-center gap-2"
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
                        d="M12 4v16m8-8H4"
                    />
                </svg>
                新規講義
            </a>
        </div>

        <!-- Content -->
        {#if loading}
            <div class="flex justify-center py-20">
                <div
                    class="animate-spin rounded-full h-10 w-10 border-b-2 border-indigo-600"
                ></div>
            </div>
        {:else if lectures.length === 0}
            <div
                class="text-center py-20 bg-white rounded-3xl shadow-sm border border-slate-100"
            >
                <div
                    class="w-16 h-16 bg-slate-50 rounded-full flex items-center justify-center mx-auto mb-4"
                >
                    <svg
                        class="w-8 h-8 text-slate-300"
                        fill="none"
                        viewBox="0 0 24 24"
                        stroke="currentColor"
                    >
                        <path
                            stroke-linecap="round"
                            stroke-linejoin="round"
                            stroke-width="2"
                            d="M19 11H5m14 0a2 2 0 012 2v6a2 2 0 01-2 2H5a2 2 0 01-2-2v-6a2 2 0 012-2m14 0V9a2 2 0 00-2-2M5 11V9a2 2 0 012-2m0 0V5a2 2 0 012-2h6a2 2 0 012 2v2M7 7h10"
                        />
                    </svg>
                </div>
                <p class="text-lg font-bold text-slate-700 mb-1">
                    履歴はありません
                </p>
                <p class="text-sm text-slate-400">
                    新しい講義を追加するとここに表示されます。
                </p>
            </div>
        {:else}
            <div class="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
                {#each lectures as lecture (lecture.id)}
                    <a
                        href="/?lectureId={lecture.id}"
                        class="group bg-white rounded-2xl p-5 shadow-sm border border-slate-100 hover:shadow-md hover:border-indigo-200 transition-all h-full flex flex-col"
                        in:fade={{ duration: 200 }}
                    >
                        <!-- Badge / Date -->
                        <div class="flex items-center justify-between mb-3">
                            <span
                                class="text-[10px] font-bold text-slate-400 bg-slate-50 px-2 py-1 rounded-full"
                            >
                                {formatDate(lecture.createdAt)}
                            </span>
                            {#if lecture.analysisMode}
                                <span
                                    class="text-[10px] font-bold uppercase tracking-wider px-2 py-1 rounded-full
                  {lecture.analysisMode === 'note'
                                        ? 'bg-indigo-50 text-indigo-600'
                                        : lecture.analysisMode === 'thoughts'
                                          ? 'bg-amber-50 text-amber-600'
                                          : 'bg-slate-100 text-slate-600'}"
                                >
                                    {lecture.analysisMode}
                                </span>
                            {/if}
                        </div>

                        <!-- Title -->
                        <h3
                            class="text-lg font-bold text-slate-800 mb-2 line-clamp-2 group-hover:text-indigo-600 transition-colors"
                        >
                            {lecture.title || "無題の講義"}
                        </h3>

                        <!-- Preview -->
                        <p
                            class="text-sm text-slate-500 line-clamp-3 mb-4 flex-1"
                        >
                            {getPreview(lecture)}
                        </p>

                        <!-- Footer -->
                        <div
                            class="pt-4 border-t border-slate-50 flex items-center justify-between text-xs text-slate-400"
                        >
                            <span class="flex items-center gap-1">
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
                                        d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z"
                                    />
                                </svg>
                                {lecture.targetLength || 500}文字
                            </span>
                            <span
                                class="group-hover:translate-x-1 transition-transform text-indigo-400 font-bold"
                            >
                                開く &rarr;
                            </span>
                        </div>
                    </a>
                {/each}
            </div>
        {/if}
    </div>
</div>
