<script lang="ts">
    import { onMount } from "svelte";
    import { auth, db } from "$lib/firebase";
    import {
        collectionGroup,
        query,
        where,
        getDocs,
        orderBy,
        limit,
        Timestamp,
        updateDoc,
        doc,
        collection,
        onSnapshot,
    } from "firebase/firestore";
    import { goto } from "$app/navigation";
    import { page } from "$app/stores";
    import UpgradeModal from "$lib/components/UpgradeModal.svelte";
    import { fade, fly } from "svelte/transition";
    import { subjects, lectures } from "$lib/stores";
    import { signOut } from "firebase/auth";
    import { marked } from "marked";
    import { normalizeCourseName } from "$lib/utils/textUtils";

    let user = $state<any>(null);
    let userData = $state<any>(null);
    let loading = $state(true);

    // Search State
    let searchQuery = $state("");
    let searchResults = $state<any[]>([]);
    let searching = $state(false);
    let showUltimateModal = $state(false);
    let searchError = $state<string | null>(null);
    let selectedLecture = $state<any>(null);
    let upgradeModalTitle = $state("アルティメットプラン限定機能");
    let upgradeModalMessage = $state("");

    // Derived
    let isUltimate = $derived(
        String(userData?.plan || "")
            .trim()
            .toLowerCase() === "ultimate",
    );
    let isPremium = $derived(
        isUltimate ||
            String(userData?.plan || "")
                .trim()
                .toLowerCase() === "premium",
    );

    // Calculate Academic Year threshold (April 1st)
    const today = new Date();
    const currentYear =
        today.getMonth() < 3 ? today.getFullYear() - 1 : today.getFullYear();
    // If Jan-Mar, academic year started previous year. If Apr-Dec, started this year.
    const academicYearStart = new Date(currentYear, 3, 1); // April 1st of current academic year

    import { user as userStore, userProfile } from "$lib/userStore";
    let autoSearchedQuery = $state("");
    let enrolledCoursesList = $state<any[]>([]);
    let unsubscribeEnrolledCourses: any = null;
    $effect(() => {
        user = $userStore;
        userData = $userProfile;

        // Fetch enrolled_courses collection
        if (user && !loading && !unsubscribeEnrolledCourses) {
            const qEnrolled = query(
                collection(db, `users/${user.uid}/enrolled_courses`),
                orderBy("createdAt", "desc"),
            );
            unsubscribeEnrolledCourses = onSnapshot(qEnrolled, (snapshot) => {
                enrolledCoursesList = snapshot.docs.map((doc) => ({
                    id: doc.id,
                    ...doc.data(),
                }));
            });
        }
    });

    // Cleanup listener on destroy
    import { onDestroy } from "svelte";
    onDestroy(() => {
        if (unsubscribeEnrolledCourses) unsubscribeEnrolledCourses();
    });

    $effect(() => {
        // Auto search handling
        if (user && !loading) {
            const q =
                $page.url.searchParams.get("q") ||
                $page.url.searchParams.get("course") ||
                $page.url.searchParams.get("courseName");
            if (q && q !== autoSearchedQuery) {
                autoSearchedQuery = q;
                searchQuery = q;
                // Defer slightly to ensure state is ready
                setTimeout(() => handleSearch(), 0);
            } else if (!q && autoSearchedQuery) {
                autoSearchedQuery = "";
                searchQuery = "";
                setTimeout(() => handleSearch(), 0);
            }
        }
    });

    onMount(() => {
        const unsub = auth.onAuthStateChanged(async (currentUser) => {
            if (currentUser) {
                user = currentUser;
            } else {
                goto("/login");
            }
            loading = false;
        });
        return () => unsub();
    });

    async function handleSearch() {
        if (!user) return;
        searching = true;
        searchError = null;
        searchResults = [];

        try {
            // 1. Base Query: Shared Lectures
            // (Note: To search across all users' shared lectures, we don't filter by uid here)
            const lecturesQuery = query(
                collectionGroup(db, "lectures"),
                where("isShared", "==", true),
                limit(100),
            );

            const snapshot = await getDocs(lecturesQuery);
            let results = snapshot.docs.map(
                (doc) =>
                    ({ id: doc.id, path: doc.ref.path, ...doc.data() }) as any,
            );

            // 2. Client-side Filtering with Normalization
            if (searchQuery.trim()) {
                const q = normalizeCourseName(searchQuery);
                results = results.filter((l) => {
                    const normCourse =
                        l.normalizedCourseName ||
                        normalizeCourseName(l.courseName || "");
                    const normTitle = (l.title || "").toLowerCase(); // Title match is loose
                    const normTag = (l.categoryTag || "").toLowerCase();
                    const rawQ = searchQuery.toLowerCase();

                    return (
                        normCourse.includes(q) ||
                        normTitle.includes(rawQ) ||
                        normTag.includes(rawQ)
                    );
                });
            }

            // 3. Process Results (Enrollment & Premium Check)
            const enrolledNorm =
                userData?.normalizedEnrolledCourses ||
                (userData?.enrolledCourses || []).map((c: string) =>
                    normalizeCourseName(c),
                );

            results = results.map((l) => {
                const targetNorm =
                    l.normalizedCourseName ||
                    normalizeCourseName(l.courseName || "");
                const isEnrolled = enrolledNorm.includes(targetNorm);

                // const isOwner = l.uid === user.uid;

                // Check if generated before academicYearStart
                const createdAt =
                    l.createdAt instanceof Timestamp
                        ? l.createdAt.toDate()
                        : new Date(l.createdAt);
                const isPastYear = createdAt < academicYearStart;

                let accessStatus = "granted";
                if (isPastYear && !isPremium) {
                    accessStatus = "premium_locked";
                } else if (!isEnrolled) {
                    accessStatus = "enrollment_required";
                }

                return {
                    ...l,
                    accessStatus,
                    isPastYear,
                    isEnrolled,
                };
            });

            // Prioritize Enrolled Courses
            results.sort((a, b) => {
                if (a.isEnrolled && !b.isEnrolled) return -1;
                if (!a.isEnrolled && b.isEnrolled) return 1;
                return 0;
            });

            searchResults = results;
        } catch (e: any) {
            console.error("Search failed", e);
            if (e.code === "failed-precondition") {
                searchError =
                    "検索インデックスの構築が必要です。コンソールのエラーURLリンク（The query requires an index...）をクリックしてインデックスを作成してください。";
            } else {
                searchError =
                    "検索中にエラーが発生しました。権限が不足しているか、通信状況を確認してください。";
            }
        } finally {
            searching = false;
        }
    }

    async function enrollAndOpen(courseName: string) {
        if (!courseName || !user) return;
        if (!confirm(`「${courseName}」を履修登録して閲覧しますか？`)) return;

        try {
            const currentCourses = userData?.enrolledCourses || [];
            const newCourses = [...currentCourses, courseName];
            const newNormalized = newCourses.map((c) => normalizeCourseName(c));

            // Optimistic update
            userData = {
                ...userData,
                enrolledCourses: newCourses,
                normalizedEnrolledCourses: newNormalized,
            };

            // Re-run search processing to unlock UI immediately
            // We can just re-call handleSearch or manually update accessStatus in searchResults.
            // Re-calling handleSearch is easier but triggers logic again.
            // Let's manually enable the view for smoothness.
            searchResults = searchResults.map((l) => {
                const targetNorm =
                    l.normalizedCourseName ||
                    normalizeCourseName(l.courseName || "");
                if (
                    targetNorm === normalizeCourseName(courseName) &&
                    l.accessStatus === "enrollment_required"
                ) {
                    return { ...l, accessStatus: "granted" };
                }
                return l;
            });

            await updateDoc(doc(db, "users", user.uid), {
                enrolledCourses: newCourses,
                normalizedEnrolledCourses: newNormalized,
            });

            // showToast("履修登録しました"); // Need strict toast check if available, or just alert?
            // Page doesn't have showToast exposed easily unless property passed.
            // We'll skip toast or use alert if needed, but the UI unlock is feedback enough.
        } catch (e) {
            console.error("Enrollment failed", e);
            alert("登録に失敗しました");
        }
    }

    async function handleLogout() {
        await signOut(auth);
        goto("/login");
    }

    function formatDate(timestamp: any) {
        if (!timestamp) return "";
        const date =
            timestamp instanceof Timestamp
                ? timestamp.toDate()
                : new Date(timestamp);
        return date.toLocaleDateString();
    }
</script>

<div
    class="flex-1 relative overflow-x-hidden overflow-y-auto bg-slate-50 pt-16 lg:pt-0"
>
    {#if !loading && user && !isUltimate}
        <div
            class="flex flex-col items-center justify-center h-full p-8 text-center animate-in fade-in"
            style="min-height: 80vh;"
        >
            <div
                class="w-20 h-20 bg-indigo-100 rounded-full flex items-center justify-center mb-6 shadow-inner mx-auto"
            >
                <svg
                    class="w-10 h-10 text-indigo-600"
                    fill="none"
                    viewBox="0 0 24 24"
                    stroke="currentColor"
                >
                    <path
                        stroke-linecap="round"
                        stroke-linejoin="round"
                        stroke-width="2"
                        d="M12 15v2m-6 4h12a2 2 0 002-2v-6a2 2 0 00-2-2H6a2 2 0 00-2 2v6a2 2 0 002 2zm10-10V7a4 4 0 00-8 0v4h8z"
                    />
                </svg>
            </div>
            <h2 class="text-2xl font-bold text-slate-800 mb-4 tracking-tight">
                アルティメットプラン限定機能
            </h2>
            <p class="text-slate-600 mb-8 max-w-md mx-auto leading-relaxed">
                「みんなのノートを検索」機能はアルティメットプラン以上の限定機能です。アップグレードして世界中の最高のノートにアクセスしましょう。
            </p>
            <button
                onclick={() => window.history.back()}
                class="bg-indigo-600 text-white px-8 py-3 rounded-xl font-bold hover:bg-indigo-700 transition-all shadow-lg hover:shadow-indigo-500/30 active:scale-95 mx-auto"
            >
                前のページに戻る
            </button>
        </div>
    {:else if !loading && user}
        <main class="w-full py-8 lg:py-12 px-4 lg:px-12">
            <h1 class="text-3xl font-bold text-slate-900 mb-8 tracking-tight">
                講義ノート検索 (Global Search)
            </h1>

            <!-- Search Input -->
            <div class="mb-8">
                <div class="relative group">
                    <div
                        class="absolute -inset-0.5 bg-gradient-to-r from-indigo-500 to-pink-500 rounded-xl blur opacity-20 group-hover:opacity-40 transition duration-1000 group-hover:duration-200"
                    ></div>
                    <div class="relative">
                        <input
                            type="text"
                            bind:value={searchQuery}
                            placeholder="キーワード、講義名で検索... (例: 経済学入門)"
                            class="w-full bg-white border border-slate-200 rounded-xl px-5 py-4 pl-12 text-lg focus:ring-2 focus:ring-indigo-500 outline-none shadow-sm transition-all text-slate-700 font-medium"
                            onkeydown={(e) =>
                                e.key === "Enter" && handleSearch()}
                        />
                        <svg
                            class="w-6 h-6 text-slate-400 absolute left-4 top-1/2 -translate-y-1/2"
                            fill="none"
                            viewBox="0 0 24 24"
                            stroke="currentColor"
                        >
                            <path
                                stroke-linecap="round"
                                stroke-linejoin="round"
                                stroke-width="2"
                                d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z"
                            />
                        </svg>
                        <button
                            onclick={handleSearch}
                            class="absolute right-2 top-1/2 -translate-y-1/2 bg-indigo-600 text-white px-6 py-2 rounded-lg text-sm font-bold hover:bg-indigo-700 transition-all shadow-md hover:shadow-lg active:scale-95"
                        >
                            検索
                        </button>
                    </div>
                </div>
                <!-- Suggested Tags -->
                {#if enrolledCoursesList.length > 0}
                    <div class="mt-4 flex flex-wrap gap-2">
                        <span
                            class="text-xs font-bold text-slate-400 uppercase mr-2 py-1"
                            >My Courses:</span
                        >
                        {#each enrolledCoursesList as course}
                            <button
                                onclick={() => {
                                    searchQuery = course.courseName;
                                    handleSearch();
                                }}
                                class="bg-white border border-slate-200 text-slate-600 px-3 py-1 rounded-full text-xs font-bold hover:bg-slate-50 hover:text-indigo-600 transition-colors"
                            >
                                {course.courseName}
                            </button>
                        {/each}
                    </div>
                {/if}
            </div>

            <!-- Error Message -->
            {#if searchError}
                <div
                    class="bg-red-50 text-red-600 p-4 rounded-xl border border-red-100 mb-8 flex items-center gap-3"
                >
                    <svg
                        class="w-6 h-6 flex-shrink-0"
                        fill="none"
                        viewBox="0 0 24 24"
                        stroke="currentColor"
                        ><path
                            stroke-linecap="round"
                            stroke-linejoin="round"
                            stroke-width="2"
                            d="M12 8v4m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z"
                        /></svg
                    >
                    <p class="font-bold">{searchError}</p>
                </div>
            {/if}

            <!-- Results -->
            {#if searching}
                <div class="text-center py-24">
                    <div
                        class="animate-spin rounded-full h-10 w-10 border-b-2 border-indigo-600 mx-auto mb-4"
                    ></div>
                    <p class="text-slate-500 font-bold animate-pulse">
                        知識の海から検索中...
                    </p>
                </div>
            {:else if searchResults.length > 0}
                <div class="grid grid-cols-1 md:grid-cols-2 gap-6">
                    {#each searchResults as lecture}
                        <div
                            class="bg-white rounded-2xl shadow-sm border border-slate-200 overflow-hidden flex flex-col hover:shadow-md transition-shadow relative group"
                        >
                            <!-- Premium / Enrollment Lock Overlay -->
                            {#if lecture.accessStatus !== "granted"}
                                <div
                                    class="absolute inset-0 bg-white/80 backdrop-blur-[2px] z-10 flex flex-col items-center justify-center text-center p-6 transition-opacity opacity-0 group-hover:opacity-100"
                                >
                                    {#if lecture.accessStatus === "premium_locked"}
                                        <div
                                            class="w-12 h-12 rounded-full bg-amber-100 text-amber-600 flex items-center justify-center mb-3"
                                        >
                                            <svg
                                                class="w-6 h-6"
                                                fill="none"
                                                viewBox="0 0 24 24"
                                                stroke="currentColor"
                                                ><path
                                                    stroke-linecap="round"
                                                    stroke-linejoin="round"
                                                    stroke-width="2"
                                                    d="M12 15v2m-6 4h12a2 2 0 002-2v-6a2 2 0 00-2-2H6a2 2 0 00-2 2v6a2 2 0 002 2zm10-10V7a4 4 0 00-8 0v4h8z"
                                                /></svg
                                            >
                                        </div>
                                        <h3
                                            class="font-bold text-slate-900 text-lg mb-1"
                                        >
                                            プレミアムコンテンツ
                                        </h3>
                                        <p class="text-sm text-slate-500 mb-4">
                                            過去の講義ノートを閲覧するには<br
                                            />PROプランへのアップグレードが必要です。
                                        </p>
                                        <button
                                            onclick={() => goto("/pricing")}
                                            class="bg-gradient-to-r from-indigo-500 to-pink-500 text-white px-8 py-3 rounded-full text-base font-bold shadow-lg shadow-indigo-500/30 hover:shadow-indigo-500/50 hover:scale-105 transition-all"
                                            >Season Passでアンロック</button
                                        >
                                    {:else}
                                        <div
                                            class="w-12 h-12 rounded-full bg-indigo-100 text-indigo-600 flex items-center justify-center mb-3"
                                        >
                                            <svg
                                                class="w-6 h-6"
                                                fill="none"
                                                viewBox="0 0 24 24"
                                                stroke="currentColor"
                                                ><path
                                                    stroke-linecap="round"
                                                    stroke-linejoin="round"
                                                    stroke-width="2"
                                                    d="M18 9v3m0 0v3m0-3h3m-3 0h-3m-2-5a4 4 0 11-8 0 4 4 0 018 0zM3 20a6 6 0 0112 0v1H3v-1z"
                                                /></svg
                                            >
                                        </div>
                                        <h3
                                            class="font-bold text-slate-900 text-lg mb-1"
                                        >
                                            履修登録が必要です
                                        </h3>
                                        <p class="text-sm text-slate-500 mb-4">
                                            このノートを閲覧するには<br
                                            />「{lecture.courseName}」の履修登録が必要です。
                                        </p>
                                        <button
                                            onclick={() =>
                                                enrollAndOpen(
                                                    lecture.courseName,
                                                )}
                                            class="bg-indigo-600 text-white px-6 py-2 rounded-full text-sm font-bold shadow-lg shadow-indigo-600/30 hover:bg-indigo-700 transition-all"
                                            >この講義を履修登録して見る</button
                                        >
                                    {/if}
                                </div>
                            {/if}

                            <div class="p-5 flex-1">
                                <div
                                    class="flex items-start justify-between mb-3"
                                >
                                    <div class="flex items-center gap-2">
                                        <span
                                            class="bg-indigo-50 text-indigo-700 px-2 py-0.5 rounded text-[10px] font-bold uppercase tracking-wider border border-indigo-100"
                                        >
                                            {lecture.courseName || "講義名不明"}
                                        </span>
                                        <span
                                            class="text-[10px] text-slate-400 font-medium"
                                            >by {lecture.authorName ||
                                                (userData?.faculty
                                                    ? "ビジネスデザイン学部生"
                                                    : "桃大生")}</span
                                        >
                                    </div>
                                    <span
                                        class="text-xs font-medium text-slate-400"
                                    >
                                        {formatDate(lecture.createdAt)}
                                    </span>
                                </div>

                                <h3
                                    class="font-bold text-slate-900 text-lg mb-2 line-clamp-2"
                                >
                                    {lecture.title || "無題のノート"}
                                </h3>
                                {#if lecture.categoryTag}
                                    <div class="flex flex-wrap gap-1 mb-3">
                                        <span
                                            class="text-[10px] bg-slate-100 text-slate-500 px-2 py-0.5 rounded-full"
                                            >#{lecture.categoryTag}</span
                                        >
                                    </div>
                                {/if}
                                <div
                                    class="text-sm text-slate-500 line-clamp-3 prose prose-sm max-w-none"
                                >
                                    {#if lecture.analysis && typeof lecture.analysis === "object" && lecture.analysis.summary}
                                        <!-- Sanitized Display: Only showing summary -->
                                        {@html marked.parse(
                                            lecture.analysis.summary.substring(
                                                0,
                                                150,
                                            ) + "...",
                                        )}
                                    {:else if typeof lecture.analysis === "string"}
                                        {@html marked.parse(
                                            lecture.analysis.substring(0, 150) +
                                                "...",
                                        )}
                                    {:else}
                                        <span class="italic text-slate-400"
                                            >要約なし</span
                                        >
                                    {/if}
                                </div>
                            </div>

                            <!-- Card Footer: Status Indicator -->
                            <div
                                class="px-5 py-3 bg-slate-50 border-t border-slate-100 flex items-center justify-between text-xs font-bold"
                            >
                                {#if lecture.isPastYear}
                                    <span
                                        class="text-amber-600 flex items-center gap-1"
                                    >
                                        <svg
                                            class="w-3 h-3"
                                            fill="none"
                                            viewBox="0 0 24 24"
                                            stroke="currentColor"
                                            ><path
                                                stroke-linecap="round"
                                                stroke-linejoin="round"
                                                stroke-width="2"
                                                d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z"
                                            /></svg
                                        >
                                        Past Year
                                    </span>
                                {:else}
                                    <span
                                        class="text-emerald-600 flex items-center gap-1"
                                    >
                                        <svg
                                            class="w-3 h-3"
                                            fill="none"
                                            viewBox="0 0 24 24"
                                            stroke="currentColor"
                                            ><path
                                                stroke-linecap="round"
                                                stroke-linejoin="round"
                                                stroke-width="2"
                                                d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z"
                                            /></svg
                                        >
                                        Current
                                    </span>
                                {/if}

                                {#if lecture.accessStatus === "granted"}
                                    <button
                                        onclick={() => {
                                            if (!isUltimate) {
                                                upgradeModalTitle =
                                                    "講義攻略ノートをアンロック";
                                                upgradeModalMessage =
                                                    "この講義の攻略ノートをすべて見るには、<br /><span class='text-indigo-900 font-bold'>ULTIMATEプラン</span>への参加が必要です。<br /><br /><span class='text-sm text-slate-500'>※ 先輩の過去問・試験対策情報が含まれています</span>";
                                                showUltimateModal = true;
                                                return;
                                            }
                                            goto(
                                                `/?path=${encodeURIComponent(lecture.path || `users/${lecture.uid}/lectures/${lecture.id}`)}`,
                                            );
                                        }}
                                        class="text-indigo-600 flex items-center gap-1 hover:underline"
                                    >
                                        {#if !isUltimate}
                                            <div class="relative group/tooltip">
                                                <svg
                                                    class="w-3 h-3 text-amber-500"
                                                    fill="none"
                                                    viewBox="0 0 24 24"
                                                    stroke="currentColor"
                                                >
                                                    <path
                                                        stroke-linecap="round"
                                                        stroke-linejoin="round"
                                                        stroke-width="2"
                                                        d="M12 15v2m-6 4h12a2 2 0 002-2v-6a2 2 0 00-2-2H6a2 2 0 00-2 2v6a2 2 0 002 2zm10-10V7a4 4 0 00-8 0v4h8z"
                                                    />
                                                </svg>
                                                <div
                                                    class="absolute bottom-full left-1/2 -translate-x-1/2 mb-2 px-2 py-1 bg-slate-800 text-white text-[10px] rounded whitespace-nowrap opacity-0 group-hover/tooltip:opacity-100 transition-opacity pointer-events-none"
                                                >
                                                    クリックでアンロック
                                                </div>
                                            </div>
                                        {:else}
                                            <svg
                                                class="w-3 h-3"
                                                fill="none"
                                                viewBox="0 0 24 24"
                                                stroke="currentColor"
                                                ><path
                                                    stroke-linecap="round"
                                                    stroke-linejoin="round"
                                                    stroke-width="2"
                                                    d="M15 12a3 3 0 11-6 0 3 3 0 016 0z"
                                                /><path
                                                    stroke-linecap="round"
                                                    stroke-linejoin="round"
                                                    stroke-width="2"
                                                    d="M2.458 12C3.732 7.943 7.523 5 12 5c4.478 0 8.268 2.943 9.542 7-1.274 4.057-5.064 7-9.542 7-4.477 0-8.268-2.943-9.542-7z"
                                                /></svg
                                            >
                                        {/if}
                                        見る
                                    </button>
                                {:else}
                                    <span
                                        class="text-slate-400 flex items-center gap-1"
                                    >
                                        <svg
                                            class="w-3 h-3"
                                            fill="none"
                                            viewBox="0 0 24 24"
                                            stroke="currentColor"
                                            ><path
                                                stroke-linecap="round"
                                                stroke-linejoin="round"
                                                stroke-width="2"
                                                d="M12 15v2m-6 4h12a2 2 0 002-2v-6a2 2 0 00-2-2H6a2 2 0 00-2 2v6a2 2 0 002 2zm10-10V7a4 4 0 00-8 0v4h8z"
                                            /></svg
                                        >
                                        Locked
                                    </span>
                                {/if}
                            </div>
                        </div>
                    {/each}
                </div>
            {:else if searchQuery && !searching}
                <div class="text-center py-12">
                    <p class="text-slate-500 mb-2">
                        該当するノートは見つかりませんでした。
                    </p>
                    <p class="text-sm text-slate-400">
                        キーワードを変えるか、履修講義を確認してください。
                    </p>
                </div>
            {/if}
        </main>
    {/if}
</div>
<!-- Detail View Modal/Panel -->
{#if selectedLecture}
    <div class="fixed inset-0 z-50 flex items-center justify-center p-4 sm:p-6">
        <!-- Backdrop -->
        <div
            class="absolute inset-0 bg-slate-900/60 backdrop-blur-sm"
            role="button"
            tabindex="0"
            aria-label="Close modal"
            onclick={() => (selectedLecture = null)}
            onkeydown={(e) => {
                if (e.key === "Escape" || e.key === "Enter" || e.key === " ")
                    selectedLecture = null;
            }}
        ></div>
        <div
            class="bg-white w-full max-w-4xl max-h-[90vh] rounded-2xl shadow-2xl relative flex flex-col overflow-hidden animate-in zoom-in-95 duration-200 pointer-events-auto"
        >
            <!-- Modal Header -->
            <div
                class="px-6 py-4 border-b border-slate-100 flex items-center justify-between bg-white z-10"
            >
                <h2
                    class="text-xl font-bold text-slate-800 truncate flex items-center gap-2"
                >
                    {selectedLecture.title}
                    {#if selectedLecture.isPastYear}
                        <span
                            class="bg-amber-100 text-amber-700 px-2 py-0.5 rounded text-xs"
                            >過去問</span
                        >
                    {/if}
                </h2>
                <button
                    type="button"
                    title="Close"
                    aria-label="Close"
                    onclick={() => (selectedLecture = null)}
                    class="p-2 hover:bg-slate-100 rounded-full transition-colors"
                >
                    <svg
                        class="w-6 h-6 text-slate-500"
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

            <!-- Modal Content -->
            <div class="flex-1 overflow-y-auto p-6 md:p-8">
                <!-- Ultimate Badge (if locked) -->
                {#if !isUltimate}
                    <div
                        class="mb-6 bg-indigo-50 border border-indigo-100 rounded-lg p-4 flex items-center gap-3"
                    >
                        <div
                            class="w-10 h-10 bg-indigo-100 text-indigo-600 rounded-full flex items-center justify-center flex-shrink-0"
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
                                    d="M12 15v2m-6 4h12a2 2 0 002-2v-6a2 2 0 00-2-2H6a2 2 0 00-2 2v6a2 2 0 002 2zm10-10V7a4 4 0 00-8 0v4h8z"
                                />
                            </svg>
                        </div>
                        <div>
                            <h4 class="font-bold text-indigo-900 text-sm">
                                Ultimateプラン限定機能
                            </h4>
                            <p class="text-indigo-700 text-xs">
                                詳細な攻略ガイドを見るにはSeason
                                Passが必要です。
                            </p>
                        </div>
                    </div>
                {/if}

                <div
                    class="flex items-center gap-4 text-sm text-slate-500 mb-8 pb-4 border-b border-slate-100"
                >
                    <span class="flex items-center gap-1">
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
                                d="M16 7a4 4 0 11-8 0 4 4 0 018 0zM12 14a7 7 0 00-7 7h14a7 7 0 00-7-7z"
                            />
                        </svg>
                        {selectedLecture.nickname || "匿名学生"}
                    </span>
                    <span>|</span>
                    <span class="flex items-center gap-1">
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
                                d="M8 7V3m8 4V3m-9 8h10M5 21h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z"
                            />
                        </svg>
                        {formatDate(selectedLecture.createdAt)}
                    </span>
                    <span>|</span>
                    <span class="flex items-center gap-1">
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
                                d="M19 11H5m14 0a2 2 0 012 2v6a2 2 0 01-2 2H5a2 2 0 01-2-2v-6a2 2 0 012-2m14 0V9a2 2 0 00-2-2M5 11V9a2 2 0 012-2m0 0V5a2 2 0 012-2h6a2 2 0 012 2v2M7 7h10"
                            />
                        </svg>
                        {selectedLecture.courseName}
                    </span>
                </div>

                <div class="prose prose-slate max-w-none relative">
                    {#if selectedLecture.analysis}
                        <!-- Content with Blur -->
                        <div
                            class={!isUltimate
                                ? "filter blur-sm select-none pointer-events-none opacity-60"
                                : ""}
                        >
                            {@html marked.parse(
                                typeof selectedLecture.analysis === "string"
                                    ? selectedLecture.analysis
                                    : selectedLecture.analysis.summary +
                                          (selectedLecture.analysis
                                              .strategyContent
                                              ? "\n\n## A評価攻略ガイド\n" +
                                                selectedLecture.analysis
                                                    .strategyContent
                                              : ""),
                            )}
                        </div>

                        <!-- Lock Overlay -->
                        {#if !isUltimate}
                            <div
                                class="absolute inset-0 flex items-center justify-center z-20"
                            >
                                <div
                                    class="bg-white/90 backdrop-blur p-8 rounded-2xl shadow-xl text-center border border-slate-100 max-w-sm mx-auto"
                                >
                                    <div
                                        class="w-16 h-16 bg-gradient-to-br from-indigo-500 to-pink-500 rounded-full flex items-center justify-center mx-auto mb-4 text-white shadow-lg"
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
                                                d="M12 15v2m-6 4h12a2 2 0 002-2v-6a2 2 0 00-2-2H6a2 2 0 00-2 2v6a2 2 0 002 2zm10-10V7a4 4 0 00-8 0v4h8z"
                                            />
                                        </svg>
                                    </div>
                                    <h3
                                        class="text-lg font-bold text-slate-900 mb-2"
                                    >
                                        Season Pass限定
                                    </h3>
                                    <p class="text-sm text-slate-500 mb-6">
                                        他の学生の詳しい攻略ノートを見るには<br
                                        />Season
                                        Passへのアップグレードが必要です。
                                    </p>
                                    <button
                                        onclick={() => goto("/settings")}
                                        class="w-full bg-slate-900 text-white font-bold py-3 rounded-xl shadow-lg hover:bg-slate-800 transition-all hover:scale-[1.02]"
                                    >
                                        Season Passでアンロック
                                    </button>
                                </div>
                            </div>
                        {/if}
                    {:else}
                        <p class="text-slate-500 italic">
                            解析データがありません。
                        </p>
                    {/if}
                </div>
            </div>
        </div>
    </div>
{/if}

<UpgradeModal
    isOpen={showUltimateModal}
    onClose={() => (showUltimateModal = false)}
    title={upgradeModalTitle}
    message={upgradeModalMessage}
/>
