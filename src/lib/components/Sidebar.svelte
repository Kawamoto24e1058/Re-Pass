<script lang="ts">
    import { auth, db } from "$lib/firebase";
    import {
        doc,
        onSnapshot,
        setDoc,
        getDoc,
        addDoc,
        collection,
        query,
        orderBy,
        deleteDoc,
        updateDoc,
        serverTimestamp,
    } from "firebase/firestore";
    import { onMount, onDestroy } from "svelte";
    import { currentBinder, expandedSubjects } from "$lib/stores";

    // Props
    let props = $props<{
        user: any;
        lectures?: any[];
        subjects?: any[];
        currentLectureId?: string | null;
        selectedSubjectId?: string | null;
        onLoadLecture: (lecture: any) => void;
        onSelectSubject: (subjectId: string | null) => void;
        onSignOut: () => void;
        onDragStart?: (lectureId: string) => void;
        onDragEnd?: () => void;
        draggingLectureId?: string | null;
    }>();

    // Local State
    let userData = $state<any>(null);
    let nickname = $state("");
    let isMenuOpen = $state(false);
    let isEditModalOpen = $state(false);
    let editNicknameValue = $state("");
    let unsubscribeUser = $state<(() => void) | null>(null);
    let dragTargetId = $state<string | null>(null);
    // Subject State
    let isSubjectModalOpen = $state(false);
    let newSubjectName = $state("");
    let newSubjectColor = $state("bg-indigo-500");
    let flashTargetId = $state<string | null>(null);

    function toggleSubject(id: string) {
        expandedSubjects.update((s) => {
            const newSet = new Set(s);
            if (newSet.has(id)) {
                newSet.delete(id);
            } else {
                newSet.add(id);
            }
            return newSet;
        });
    }

    const subjectColors = [
        {
            name: "Red",
            value: "bg-red-500",
            text: "text-red-500",
            bg: "bg-red-50",
        },
        {
            name: "Orange",
            value: "bg-orange-500",
            text: "text-orange-500",
            bg: "bg-orange-50",
        },
        {
            name: "Amber",
            value: "bg-amber-500",
            text: "text-amber-500",
            bg: "bg-amber-50",
        },
        {
            name: "Green",
            value: "bg-green-500",
            text: "text-green-500",
            bg: "bg-green-50",
        },
        {
            name: "Blue",
            value: "bg-blue-500",
            text: "text-blue-500",
            bg: "bg-blue-50",
        },
        {
            name: "Indigo",
            value: "bg-indigo-500",
            text: "text-indigo-500",
            bg: "bg-indigo-50",
        },
        {
            name: "Purple",
            value: "bg-purple-500",
            text: "text-purple-500",
            bg: "bg-purple-50",
        },
        {
            name: "Pink",
            value: "bg-pink-500",
            text: "text-pink-500",
            bg: "bg-pink-50",
        },
    ];

    // Listener for user profile & subjects
    onMount(() => {
        if (props.user) {
            const userRef = doc(db, "users", props.user.uid);
            unsubscribeUser = onSnapshot(userRef, (docSnap) => {
                if (docSnap.exists()) {
                    userData = docSnap.data();
                    // Priority: Firestore Nickname > Auth DisplayName > Auth Email
                    nickname =
                        userData.nickname ||
                        props.user.displayName ||
                        props.user.email?.split("@")[0] ||
                        "User";
                } else {
                    nickname =
                        props.user.displayName ||
                        props.user.email?.split("@")[0] ||
                        "User";
                }
            });

            // Fetch Subjects - REMOVED (Managed by Parent)
        }

        // Close menu on outside click
        window.addEventListener("click", handleOutsideClick);

        return () => {
            if (unsubscribeUser) unsubscribeUser();
            // if (unsubscribeSubjects) unsubscribeSubjects();
            window.removeEventListener("click", handleOutsideClick);
        };
    });

    function handleOutsideClick(e: MouseEvent) {
        const target = e.target as HTMLElement;
        if (!target.closest(".user-menu-container")) {
            isMenuOpen = false;
        }
    }

    function toggleMenu() {
        isMenuOpen = !isMenuOpen;
    }

    function openEditModal() {
        editNicknameValue = nickname;
        isEditModalOpen = true;
        isMenuOpen = false;
    }

    async function saveNickname() {
        if (!props.user) return;
        try {
            await setDoc(
                doc(db, "users", props.user.uid),
                {
                    nickname: editNicknameValue,
                },
                { merge: true },
            );
            isEditModalOpen = false;
        } catch (e) {
            console.error("Error saving nickname", e);
            alert("Failed to save nickname.");
        }
    }

    // --- Subject Management ---

    let editingSubjectId = $state<string | null>(null); // Track if we are editing

    async function handleSubjectSubmit() {
        if (!newSubjectName.trim()) return;

        try {
            if (editingSubjectId) {
                // Update Existing
                await updateDoc(
                    doc(
                        db,
                        `users/${props.user.uid}/subjects`,
                        editingSubjectId,
                    ),
                    {
                        name: newSubjectName,
                        color: newSubjectColor,
                    },
                );
            } else {
                // Create New
                await addDoc(
                    collection(db, `users/${props.user.uid}/subjects`),
                    {
                        name: newSubjectName,
                        color: newSubjectColor,
                        createdAt: serverTimestamp(),
                    },
                );
            }

            closeSubjectModal();
        } catch (e) {
            console.error("Error saving subject", e);
            alert("Failed to save subject.");
        }
    }

    function openCreateSubjectModal() {
        editingSubjectId = null;
        newSubjectName = "";
        newSubjectColor = "bg-indigo-500";
        isSubjectModalOpen = true;
    }

    function openEditSubjectModal(subject: any) {
        editingSubjectId = subject.id;
        newSubjectName = subject.name;
        newSubjectColor = subject.color;
        isSubjectModalOpen = true;
    }

    function closeSubjectModal() {
        isSubjectModalOpen = false;
        editingSubjectId = null;
        newSubjectName = "";
        newSubjectColor = "bg-indigo-500";
    }

    async function deleteSubject(subjectId: string) {
        if (
            !confirm(
                "この科目を削除してもよろしいですか？講義データは残りますが、未分類になります。",
            )
        )
            return;
        try {
            await deleteDoc(
                doc(db, `users/${props.user.uid}/subjects`, subjectId),
            );
            if (props.selectedSubjectId === subjectId) {
                props.onSelectSubject(null);
            }
        } catch (e) {
            console.error("Error deleting subject", e);
            alert("Failed to delete subject.");
        }
    }

    // --- Drag & Drop for Assignment ---

    function handleDragStart(e: DragEvent, lectureId: string) {
        if (e.dataTransfer) {
            e.dataTransfer.setData("text/plain", lectureId);
            e.dataTransfer.effectAllowed = "move";
            if (props.onDragStart) props.onDragStart(lectureId);
        }
    }

    function handleDragEnd() {
        if (props.onDragEnd) props.onDragEnd();
    }

    function handleDragOver(e: DragEvent, targetId: string | null) {
        e.preventDefault(); // Necessary to allow dropping
        dragTargetId = targetId;
        if (e.dataTransfer) {
            e.dataTransfer.dropEffect = "move";
        }
    }

    function handleDragLeave() {
        dragTargetId = null;
    }

    async function handleDrop(e: DragEvent, targetSubjectId: string | null) {
        e.preventDefault();
        dragTargetId = null;
        const lectureId = e.dataTransfer?.getData("text/plain");
        if (!lectureId) return;

        const lecture = props.lectures.find((l: any) => l.id === lectureId);
        if (!lecture) return;

        // If target is unassigned (null), handle it
        const finalTargetSubjectId =
            targetSubjectId === "unassigned" ? null : targetSubjectId;

        // If already in same subject, do nothing
        if (lecture.subjectId === finalTargetSubjectId) return;

        try {
            const oldPath = lecture.path;
            const newPath = finalTargetSubjectId
                ? `users/${props.user.uid}/subjects/${finalTargetSubjectId}/lectures/${lectureId}`
                : `users/${props.user.uid}/lectures/${lectureId}`;

            // 1. Get current data
            const sourceRef = doc(db, oldPath);
            const sourceSnap = await getDoc(sourceRef);
            if (!sourceSnap.exists()) return;

            const data = sourceSnap.data();

            // 2. Set in new location (with updated subjectId field just in case)
            const targetRef = doc(db, newPath);
            await setDoc(targetRef, {
                ...data,
                subjectId: finalTargetSubjectId,
                categoryTag: finalTargetSubjectId
                    ? null
                    : data.categoryTag || null, // Clear tag if organized
                updatedAt: serverTimestamp(),
            });

            // 3. Delete from old location
            await deleteDoc(sourceRef);

            console.log(
                `Moved lecture ${lectureId} to ${finalTargetSubjectId}`,
            );
            // Flash visual feedback
            flashTargetId = targetSubjectId;
            setTimeout(() => {
                flashTargetId = null;
            }, 1000);
        } catch (e) {
            console.error("Error moving lecture", e);
            alert("講義の移動に失敗しました。");
        }
    }

    // Derived state for plan
    let planName = $derived(
        userData?.plan === "premium" ? "Pro Plan" : "Free Plan",
    );
    let usagePercent = $derived(userData?.plan === "premium" ? 100 : 33); // Mock usage logic for now
    let usageText = $derived(
        userData?.plan === "premium" ? "Unlimited" : "1 / 3 used",
    );
</script>

<!-- Sidebar -->
<aside
    class="w-72 bg-white/70 backdrop-blur-md border-r border-slate-200/50 flex flex-col h-full z-20 flex-shrink-0 animate-in slide-in-from-left-4 duration-500 font-sans"
>
    <!-- Sidebar Header -->
    <div class="p-6 pb-2">
        <div class="flex items-center justify-between mb-6">
            <span
                class="font-bold text-slate-900 tracking-tight text-xl bg-gradient-to-r from-indigo-700 to-pink-600 bg-clip-text text-transparent"
                >Re-Pass</span
            >
        </div>
    </div>

    <!-- Navigation Sections -->
    <div class="flex-1 overflow-y-auto px-3 space-y-6">
        <!-- Folders / Subjects -->
        <div>
            <div
                class="px-2 text-[11px] font-bold text-slate-400 uppercase tracking-wider mb-2 flex justify-between items-center"
            >
                <span>科目 (バインダー)</span>
                <button
                    onclick={() => (isSubjectModalOpen = true)}
                    class="text-indigo-500 hover:text-indigo-700 p-1 rounded hover:bg-indigo-50 transition-colors"
                    title="新規科目作成"
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
                            d="M12 4v16m8-8H4"
                        /></svg
                    >
                </button>
            </div>

            <div class="space-y-1">
                <!-- Unassigned / Inbox -->
                <div class="group relative">
                    <button
                        onclick={() => {
                            props.onSelectSubject(null);
                            currentBinder.set(null);
                            toggleSubject("unassigned");
                        }}
                        ondragover={(e) => handleDragOver(e, "unassigned")}
                        ondragleave={handleDragLeave}
                        ondrop={(e) => handleDrop(e, "unassigned")}
                        class="w-full text-left px-3 py-2 rounded-lg text-sm flex items-center justify-between transition-all duration-200
                        {dragTargetId === 'unassigned'
                            ? 'bg-indigo-100 ring-2 ring-indigo-500 scale-[1.02]'
                            : ''}
                        {flashTargetId === 'unassigned'
                            ? 'ring-4 ring-green-400 ring-offset-2 animate-pulse'
                            : ''}
                        {$currentBinder === null
                            ? 'bg-indigo-50 text-indigo-900 font-semibold'
                            : 'text-slate-600 hover:bg-black/5'}"
                    >
                        <div class="flex items-center gap-3">
                            <svg
                                class="w-4 h-4 text-slate-400"
                                fill="none"
                                viewBox="0 0 24 24"
                                stroke="currentColor"
                            >
                                <path
                                    stroke-linecap="round"
                                    stroke-linejoin="round"
                                    stroke-width="2"
                                    d="M20 13V6a2 2 0 00-2-2H6a2 2 0 00-2 2v7m16 0v5a2 2 0 01-2 2H6a2 2 0 01-2-2v-5m16 0h-2.586a1 1 0 00-.707.293l-2.414 2.414a1 1 0 01-.707.293h-3.172a1 1 0 01-.707-.293l-2.414-2.414A1 1 0 006.586 13H4"
                                />
                            </svg>
                            <span>未分類の履歴</span>
                        </div>
                        <span
                            class="text-xs text-slate-400 font-normal bg-slate-100 px-1.5 rounded-full"
                        >
                            {props.lectures.filter((l: any) => !l.subjectId)
                                .length}
                        </span>
                    </button>

                    <!-- Unassigned Lectures List -->
                    {#if $expandedSubjects.has("unassigned")}
                        <div
                            class="pl-4 mt-1 space-y-0.5 border-l-2 border-slate-100 ml-3 animate-in slide-in-from-top-1"
                        >
                            {#each props.lectures.filter((l: any) => !l.subjectId) as lecture (lecture.id)}
                                <button
                                    draggable="true"
                                    ondragstart={(e) =>
                                        handleDragStart(e, lecture.id)}
                                    ondragend={handleDragEnd}
                                    onclick={(e) => {
                                        e.stopPropagation();
                                        props.onLoadLecture(lecture);
                                    }}
                                    class="w-full text-left px-3 py-2 rounded-md text-xs transition-all duration-200 truncate
                                    {props.currentLectureId === lecture.id
                                        ? 'text-indigo-600 font-bold bg-indigo-50/50'
                                        : 'text-slate-500 hover:text-slate-800 hover:bg-black/5'}
                                    {props.draggingLectureId === lecture.id
                                        ? 'opacity-40 scale-[0.98]'
                                        : ''}"
                                >
                                    <div
                                        class="flex items-center justify-between gap-2 overflow-hidden"
                                    >
                                        <span class="truncate flex-1"
                                            >{lecture.title || "Untitled"}</span
                                        >
                                        {#if lecture.categoryTag}
                                            <span
                                                class="text-[9px] px-1.5 py-0.5 bg-indigo-50 text-indigo-500 rounded border border-indigo-100/50 flex-shrink-0"
                                            >
                                                {lecture.categoryTag}
                                            </span>
                                        {/if}
                                    </div>
                                </button>
                            {/each}
                            {#if props.lectures.filter((l: any) => !l.subjectId).length === 0}
                                <div
                                    class="px-3 py-2 text-[10px] text-slate-300 italic"
                                >
                                    空のインボックス
                                </div>
                            {/if}
                        </div>
                    {/if}
                </div>

                <!-- Subject Accordions -->
                {#each props.subjects as subject (subject.id)}
                    <!-- Using standard div instead of details for easier control -->
                    <div class="group/accordion">
                        <div
                            class="w-full text-left px-3 py-2 rounded-lg text-sm flex items-center justify-between cursor-pointer transition-all duration-200
                            {dragTargetId === subject.id
                                ? 'bg-indigo-100 ring-2 ring-indigo-500 scale-[1.02]'
                                : ''}
                            {flashTargetId === subject.id
                                ? 'ring-4 ring-green-400 ring-offset-2 animate-pulse'
                                : ''}
                            {$currentBinder === subject.id
                                ? 'bg-indigo-50 text-indigo-900 font-semibold'
                                : 'text-slate-600 hover:bg-black/5'}"
                            role="button"
                            tabindex="0"
                            ondragover={(e) => handleDragOver(e, subject.id)}
                            ondragleave={handleDragLeave}
                            ondrop={(e) => handleDrop(e, subject.id)}
                            onclick={() => {
                                props.onSelectSubject(subject.id);
                                currentBinder.set(subject.id);
                                toggleSubject(subject.id);
                            }}
                            onkeydown={(e) => {
                                if (e.key === "Enter" || e.key === " ") {
                                    props.onSelectSubject(subject.id);
                                    currentBinder.set(subject.id);
                                    toggleSubject(subject.id);
                                }
                            }}
                        >
                            <div
                                class="flex items-center gap-3 flex-1 overflow-hidden"
                            >
                                <div
                                    class="w-4 h-4 rounded-full {subject.color} opacity-80 shadow-sm flex-shrink-0"
                                ></div>
                                <span class="truncate">{subject.name}</span>
                            </div>

                            <div class="flex items-center gap-1">
                                <!-- Edit Button (Hover) -->
                                <button
                                    onclick={(e) => {
                                        e.stopPropagation();
                                        openEditSubjectModal(subject);
                                    }}
                                    class="p-1 text-slate-400 hover:text-indigo-600 hover:bg-indigo-50 rounded transition-colors opacity-0 group-hover/accordion:opacity-100"
                                    title="科目を編集"
                                >
                                    <svg
                                        class="w-3.5 h-3.5"
                                        fill="none"
                                        viewBox="0 0 24 24"
                                        stroke="currentColor"
                                    >
                                        <path
                                            stroke-linecap="round"
                                            stroke-linejoin="round"
                                            stroke-width="2"
                                            d="M15.232 5.232l3.536 3.536m-2.036-5.036a2.5 2.5 0 113.536 3.536L6.5 21.036H3v-3.572L16.732 3.732z"
                                        />
                                    </svg>
                                </button>

                                <!-- Delete Button (Hover) -->
                                {#if props.selectedSubjectId !== subject.id}
                                    <button
                                        onclick={(e) => {
                                            e.stopPropagation();
                                            deleteSubject(subject.id);
                                        }}
                                        class="p-1 text-slate-400 hover:text-red-600 hover:bg-red-50 rounded transition-colors opacity-0 group-hover/accordion:opacity-100"
                                        title="科目を削除"
                                    >
                                        <svg
                                            class="w-3.5 h-3.5"
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
                                {/if}

                                <!-- Lecture Count -->
                                <span
                                    class="text-xs text-slate-400 font-normal bg-white/50 px-1.5 rounded-full"
                                >
                                    {props.lectures.filter(
                                        (l: any) => l.subjectId === subject.id,
                                    ).length}
                                </span>

                                <!-- Chevron -->
                                <svg
                                    class="w-3 h-3 text-slate-400 transition-transform {$expandedSubjects.has(
                                        subject.id,
                                    )
                                        ? 'rotate-90'
                                        : ''}"
                                    fill="none"
                                    viewBox="0 0 24 24"
                                    stroke="currentColor"
                                >
                                    <path
                                        stroke-linecap="round"
                                        stroke-linejoin="round"
                                        stroke-width="2"
                                        d="M9 5l7 7-7 7"
                                    />
                                </svg>
                            </div>
                        </div>

                        <!-- Nested Lectures List -->
                        {#if $expandedSubjects.has(subject.id)}
                            <div
                                class="pl-4 mt-1 space-y-0.5 border-l-2 border-slate-100 ml-3 animate-in slide-in-from-top-1"
                            >
                                {#each props.lectures.filter((l: any) => l.subjectId === subject.id) as lecture (lecture.id)}
                                    <button
                                        draggable="true"
                                        ondragstart={(e) =>
                                            handleDragStart(e, lecture.id)}
                                        ondragend={handleDragEnd}
                                        onclick={(e) => {
                                            e.stopPropagation();
                                            props.onLoadLecture(lecture);
                                        }}
                                        class="w-full text-left px-3 py-2 rounded-md text-xs transition-all duration-200 truncate
                                        {props.currentLectureId === lecture.id
                                            ? 'text-indigo-600 font-bold bg-indigo-50/50'
                                            : 'text-slate-500 hover:text-slate-800 hover:bg-black/5'}
                                        {props.draggingLectureId === lecture.id
                                            ? 'opacity-40 scale-[0.98]'
                                            : ''}"
                                    >
                                        <div
                                            class="flex items-center justify-between gap-2 overflow-hidden"
                                        >
                                            <span class="truncate flex-1"
                                                >{lecture.title ||
                                                    "Untitled"}</span
                                            >
                                            {#if lecture.categoryTag}
                                                <span
                                                    class="text-[9px] px-1.5 py-0.5 bg-indigo-50 text-indigo-500 rounded border border-indigo-100/50 flex-shrink-0"
                                                >
                                                    {lecture.categoryTag}
                                                </span>
                                            {/if}
                                        </div>
                                    </button>
                                {/each}
                                {#if props.lectures.filter((l: any) => l.subjectId === subject.id).length === 0}
                                    <div
                                        class="px-3 py-2 text-[10px] text-slate-300 italic"
                                    >
                                        講義をここにドラッグ
                                    </div>
                                {/if}
                            </div>
                        {/if}
                    </div>
                {/each}
            </div>
        </div>
    </div>

    <!-- Bottom Status & User -->
    <div class="p-4 border-t border-slate-200/60 bg-white/40">
        <!-- Usage Status -->
        <div
            class="mb-4 bg-white/60 rounded-xl p-3 border border-slate-100 shadow-sm"
        >
            <div
                class="flex items-center justify-between text-xs font-semibold mb-2"
            >
                <span class="text-slate-700"
                    >{userData?.plan === "premium"
                        ? "プロプラン"
                        : "フリープラン"}</span
                >
                <span class="text-slate-400"
                    >{userData?.plan === "premium"
                        ? "無制限"
                        : `残り ${3 - props.lectures.length}枠`}</span
                >
            </div>
            <div class="h-1.5 w-full bg-slate-100 rounded-full overflow-hidden">
                <div
                    class="h-full bg-gradient-to-r from-indigo-500 to-pink-500 rounded-full"
                    style="width: {usagePercent}%"
                ></div>
            </div>
            {#if userData?.plan !== "premium"}
                <button
                    class="w-full mt-3 text-[10px] font-bold text-indigo-600 bg-indigo-50 hover:bg-indigo-100 py-1.5 rounded-lg transition-colors"
                >
                    プロにアップグレード
                </button>
            {/if}
        </div>

        <!-- Settings Link -->
        <a
            href="/settings"
            class="block mb-4 mx-1 px-3 py-2 rounded-xl text-xs font-bold text-slate-500 hover:bg-slate-50 hover:text-slate-900 transition-all flex items-center gap-3 group"
        >
            <div
                class="w-8 h-8 rounded-full bg-slate-50 text-slate-400 group-hover:bg-indigo-50 group-hover:text-indigo-600 flex items-center justify-center transition-colors"
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
                        d="M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.065 2.572c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.572 1.065c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.065-2.572c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z"
                    />
                    <path
                        stroke-linecap="round"
                        stroke-linejoin="round"
                        stroke-width="2"
                        d="M15 12a3 3 0 11-6 0 3 3 0 016 0z"
                    />
                </svg>
            </div>
            設定
        </a>

        <!-- User Profile & Menu -->
        <div class="relative user-menu-container">
            <button
                onclick={(e) => {
                    e.stopPropagation();
                    toggleMenu();
                }}
                class="w-full flex items-center gap-3 px-2 py-2 rounded-xl hover:bg-white/50 transition-colors text-left"
            >
                <div
                    class="w-8 h-8 rounded-full bg-gradient-to-br from-indigo-100 to-pink-100 border border-white shadow-sm flex items-center justify-center text-xs font-bold text-indigo-600 flex-shrink-0 overflow-hidden"
                >
                    {#if props.user?.photoURL}
                        <img
                            src={props.user.photoURL}
                            alt="User"
                            class="w-full h-full object-cover"
                        />
                    {:else}
                        {nickname.substring(0, 1).toUpperCase()}
                    {/if}
                </div>
                <div class="flex-1 min-w-0">
                    <div class="text-xs font-bold text-slate-800 truncate">
                        {nickname}
                    </div>
                    <div class="text-[10px] text-slate-400 truncate">
                        {props.user?.email}
                    </div>
                </div>
                <svg
                    class="w-4 h-4 text-slate-400"
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

            <!-- Popover Menu -->
            {#if isMenuOpen}
                <div
                    class="absolute bottom-full left-0 w-full mb-2 bg-white/80 backdrop-blur-xl border border-white/50 rounded-2xl shadow-xl overflow-hidden animate-in fade-in slide-in-from-bottom-2 z-50"
                >
                    <div class="p-1">
                        <button
                            onclick={openEditModal}
                            class="w-full text-left px-3 py-2 text-xs font-medium text-slate-700 hover:bg-indigo-50 hover:text-indigo-600 rounded-lg transition-colors flex items-center gap-2"
                        >
                            <svg
                                class="w-4 h-4"
                                fill="none"
                                viewBox="0 0 24 24"
                                stroke="currentColor"
                                ><path
                                    stroke-linecap="round"
                                    stroke-linejoin="round"
                                    stroke-width="1.5"
                                    d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z"
                                /></svg
                            >
                            プロフィール編集
                        </button>
                        <div class="h-px bg-slate-100 my-1"></div>
                        <button
                            onclick={props.onSignOut}
                            class="w-full text-left px-3 py-2 text-xs font-medium text-red-500 hover:bg-red-50 rounded-lg transition-colors flex items-center gap-2"
                        >
                            <svg
                                class="w-4 h-4"
                                fill="none"
                                viewBox="0 0 24 24"
                                stroke="currentColor"
                                ><path
                                    stroke-linecap="round"
                                    stroke-linejoin="round"
                                    stroke-width="1.5"
                                    d="M17 16l4-4m0 0l-4-4m4 4H7m6 4v1a3 3 0 01-3 3H6a3 3 0 01-3-3V7a3 3 0 013-3h4a3 3 0 013 3v1"
                                /></svg
                            >
                            ログアウト
                        </button>
                    </div>
                </div>
            {/if}
        </div>
    </div>
</aside>

<!-- New Subject Modal -->
{#if isSubjectModalOpen}
    <div
        class="fixed inset-0 z-[100] bg-black/20 backdrop-blur-sm flex items-center justify-center animate-in fade-in"
    >
        <div
            class="bg-white rounded-3xl p-6 w-full max-w-sm shadow-2xl border border-white/50 animate-in zoom-in-95"
        >
            <h3 class="text-lg font-bold text-slate-800 mb-4">
                {editingSubjectId ? "科目を編集" : "新しい科目を作成"}
            </h3>

            <div class="mb-6 space-y-4">
                <div>
                    <label
                        class="block text-xs font-bold text-slate-400 uppercase mb-2"
                        >科目名</label
                    >
                    <input
                        type="text"
                        bind:value={newSubjectName}
                        class="w-full bg-slate-50 border border-slate-200 rounded-xl px-4 py-2 text-slate-900 font-medium focus:outline-none focus:ring-2 focus:ring-indigo-500/50"
                        placeholder="例：生物学 101"
                        autofocus
                    />
                </div>
                <div>
                    <label
                        class="block text-xs font-bold text-slate-400 uppercase mb-2"
                        >カラータグ</label
                    >
                    <div class="flex flex-wrap gap-2">
                        {#each subjectColors as color}
                            <button
                                onclick={() => (newSubjectColor = color.value)}
                                class="w-8 h-8 rounded-full {color.value} shadow-sm border-2 transition-all {newSubjectColor ===
                                color.value
                                    ? 'border-slate-800 scale-110'
                                    : 'border-transparent hover:scale-105'}"
                                title={color.name}
                            ></button>
                        {/each}
                    </div>
                </div>
            </div>

            <div class="flex gap-3">
                <button
                    onclick={closeSubjectModal}
                    class="flex-1 px-4 py-2 rounded-xl text-sm font-bold text-slate-500 hover:bg-slate-50 transition-colors"
                >
                    キャンセル
                </button>
                <button
                    onclick={handleSubjectSubmit}
                    disabled={!newSubjectName.trim()}
                    class="flex-1 px-4 py-2 rounded-xl text-sm font-bold text-white bg-slate-900 hover:bg-slate-800 shadow-lg shadow-slate-900/20 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                >
                    {editingSubjectId ? "更新" : "作成"}
                </button>
            </div>
        </div>
    </div>
{/if}

<!-- Edit Nickname Modal (Keep existing) -->
{#if isEditModalOpen}
    <div
        class="fixed inset-0 z-[100] bg-black/20 backdrop-blur-sm flex items-center justify-center animate-in fade-in"
    >
        <div
            class="bg-white rounded-3xl p-6 w-full max-w-sm shadow-2xl border border-white/50 animate-in zoom-in-95"
        >
            <h3 class="text-lg font-bold text-slate-800 mb-4">
                プロフィール編集
            </h3>

            <div class="mb-6">
                <label
                    class="block text-xs font-bold text-slate-400 uppercase mb-2"
                    >ニックネーム</label
                >
                <input
                    type="text"
                    bind:value={editNicknameValue}
                    class="w-full bg-slate-50 border border-slate-200 rounded-xl px-4 py-2 text-slate-900 font-medium focus:outline-none focus:ring-2 focus:ring-indigo-500/50"
                    placeholder="ニックネームを入力"
                />
            </div>

            <div class="flex gap-3">
                <button
                    onclick={() => (isEditModalOpen = false)}
                    class="flex-1 px-4 py-2 rounded-xl text-sm font-bold text-slate-500 hover:bg-slate-50 transition-colors"
                >
                    キャンセル
                </button>
                <button
                    onclick={saveNickname}
                    class="flex-1 px-4 py-2 rounded-xl text-sm font-bold text-white bg-slate-900 hover:bg-slate-800 shadow-lg shadow-slate-900/20 transition-colors"
                >
                    保存
                </button>
            </div>
        </div>
    </div>
{/if}
