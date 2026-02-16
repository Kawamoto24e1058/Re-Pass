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
    } from "firebase/firestore";
    import { goto } from "$app/navigation";
    import Sidebar from "$lib/components/Sidebar.svelte";
    import { subjects, lectures } from "$lib/stores";
    import { signOut } from "firebase/auth";
    import { marked } from "marked";
    import { normalizeCourseName } from "$lib/utils/textUtils";

    let user = $state<any>(null);
    let userData = $state<any>(null);
    let loading = $state(true);
    let isMobileOpen = $state(false);

    // Search State
    let searchQuery = $state("");
    let searchResults = $state<any[]>([]);
    let searching = $state(false);
    let searchError = $state<string | null>(null);

    // Derived
    let isPremium = $derived(
        userData?.plan === "pro" ||
            userData?.plan === "premium" ||
            userData?.plan === "season" ||
            userData?.isPro === true,
    );

    // Calculate Academic Year threshold (April 1st)
    const today = new Date();
    const currentYear =
        today.getMonth() < 3 ? today.getFullYear() - 1 : today.getFullYear();
    // If Jan-Mar, academic year started previous year. If Apr-Dec, started this year.
    const academicYearStart = new Date(currentYear, 3, 1); // April 1st of current academic year

    onMount(() => {
        const unsub = auth.onAuthStateChanged(async (currentUser) => {
            if (currentUser) {
                user = currentUser;
                // We rely on the layout or a direct fetch to get userData if not available in store
                // For this page, let's fetch strictly to ensure we have enrolledCourses
                const docRef = await import("firebase/firestore").then((m) =>
                    m.doc(db, "users", user.uid),
                );
                const docSnap = await import("firebase/firestore").then((m) =>
                    m.getDoc(docRef),
                );
                if (docSnap.exists()) {
                    userData = docSnap.data();
                }
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
            const lecturesQuery = query(
                collectionGroup(db, "lectures"),
                where("isShared", "==", true),
                limit(100),
            );

            const snapshot = await getDocs(lecturesQuery);
            let results = snapshot.docs.map(
                (doc) => ({ id: doc.id, ...doc.data() }) as any,
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
                };
            });

            searchResults = results;
        } catch (e: any) {
            console.error("Search failed", e);
            if (e.code === "failed-precondition") {
                searchError =
                    "検索インデックスの構築が必要です。管理者に連絡してください。";
            } else {
                searchError = "検索中にエラーが発生しました。";
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
    class="flex h-screen overflow-hidden bg-[#F9FAFB] text-slate-800 font-sans relative"
>
    <!-- Sidebar -->
    {#if user}
        <Sidebar
            {user}
            lectures={$lectures}
            subjects={$subjects}
            currentLectureId={null}
            selectedSubjectId={null}
            {isMobileOpen}
            onClose={() => (isMobileOpen = false)}
            onLoadLecture={() => goto("/")}
            onSelectSubject={() => goto("/")}
            onSignOut={handleLogout}
        />
    {/if}

    <div class="flex-1 relative overflow-y-auto bg-slate-50 pt-16 lg:pt-0">
        <main class="max-w-5xl mx-auto py-8 lg:py-12 px-4 lg:px-12">
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
                <!-- Suggested Tags (Optional, currently hardcoded or derived) -->
                {#if userData?.enrolledCourses?.length}
                    <div class="mt-4 flex flex-wrap gap-2">
                        <span
                            class="text-xs font-bold text-slate-400 uppercase mr-2 py-1"
                            >My Courses:</span
                        >
                        {#each userData.enrolledCourses as course}
                            <button
                                onclick={() => {
                                    searchQuery = course;
                                    handleSearch();
                                }}
                                class="bg-white border border-slate-200 text-slate-600 px-3 py-1 rounded-full text-xs font-bold hover:bg-slate-50 hover:text-indigo-600 transition-colors"
                            >
                                {course}
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
                                            Premium Content
                                        </h3>
                                        <p class="text-sm text-slate-500 mb-4">
                                            過去の講義ノートを閲覧するには<br
                                            />PROプランへのアップグレードが必要です。
                                        </p>
                                        <button
                                            onclick={() =>
                                                goto("/settings/subscription")}
                                            class="bg-amber-500 text-white px-6 py-2 rounded-full text-sm font-bold shadow-lg shadow-amber-500/30 hover:bg-amber-600 transition-all"
                                            >アップグレード</button
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
                                            Enrollment Required
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
                                            {lecture.courseName ||
                                                "Unknown Course"}
                                        </span>
                                        <span
                                            class="text-[10px] text-slate-400 font-medium"
                                            >by {userData?.faculty
                                                ? "ビジネスデザイン学部生"
                                                : "桃大生"}</span
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
                                        {@html marked(
                                            lecture.analysis.summary.substring(
                                                0,
                                                150,
                                            ) + "...",
                                        )}
                                    {:else if typeof lecture.analysis === "string"}
                                        {@html marked(
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
                                    <span
                                        class="text-indigo-600 flex items-center gap-1"
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
                                                d="M15 12a3 3 0 11-6 0 3 3 0 016 0z"
                                            /><path
                                                stroke-linecap="round"
                                                stroke-linejoin="round"
                                                stroke-width="2"
                                                d="M2.458 12C3.732 7.943 7.523 5 12 5c4.478 0 8.268 2.943 9.542 7-1.274 4.057-5.064 7-9.542 7-4.477 0-8.268-2.943-9.542-7z"
                                            /></svg
                                        >
                                        View
                                    </span>
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
    </div>
</div>
