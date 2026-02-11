<script lang="ts">
    import { onMount } from "svelte";
    import { auth, db } from "$lib/firebase";
    import { doc, getDoc, updateDoc, deleteDoc } from "firebase/firestore";
    import {
        updateProfile,
        updateEmail,
        deleteUser,
        signOut,
    } from "firebase/auth";
    import { goto } from "$app/navigation";
    import Sidebar from "$lib/components/Sidebar.svelte";
    import { subjects, lectures } from "$lib/stores";

    let user = $state<any>(null);
    let userData = $state<any>(null);
    let loading = $state(true);
    let toastMessage = $state<string | null>(null);

    // Form State
    let displayName = $state("");
    let email = $state("");

    onMount(() => {
        const unsub = auth.onAuthStateChanged(async (currentUser) => {
            if (currentUser) {
                user = currentUser;
                displayName = user.displayName || "";
                email = user.email || "";

                const docRef = doc(db, "users", user.uid);
                const docSnap = await getDoc(docRef);
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

    function showToast(message: string) {
        toastMessage = message;
        setTimeout(() => {
            toastMessage = null;
        }, 3000);
    }

    async function handleUpdateProfile() {
        if (!user) return;
        try {
            await updateProfile(user, { displayName });
            // Update Firestore as well if needed
            await updateDoc(doc(db, "users", user.uid), { displayName });
            showToast("プロフィールを更新しました");
        } catch (e) {
            console.error(e);
            alert("更新に失敗しました: " + (e as Error).message);
        }
    }

    async function handlePortal() {
        if (!userData?.stripeCustomerId) {
            if (
                confirm(
                    "サブスクリプション情報が見つかりません。プラン選択ページへ移動しますか？",
                )
            ) {
                goto("/pricing");
            }
            return;
        }
        try {
            const res = await fetch("/api/portal", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ customerId: userData.stripeCustomerId }),
            });
            const data = await res.json();
            if (data.url) {
                window.location.href = data.url;
            } else {
                throw new Error(data.error || "Unknown error");
            }
        } catch (e) {
            console.error(e);
            alert("ポータルへの移動に失敗しました: " + (e as Error).message);
        }
    }

    async function handleDeleteAccount() {
        if (
            !confirm(
                "本当にアカウントを削除しますか？この操作は取り消せません。",
            )
        )
            return;

        try {
            // Delete Firestore Data
            await deleteDoc(doc(db, "users", user.uid));
            // Delete Auth User
            await deleteUser(user);
            alert("アカウントを削除しました。");
            goto("/login");
        } catch (e) {
            console.error(e);
            alert("削除に失敗しました。再ログインしてから試してください。");
        }
    }

    async function handleLogout() {
        await signOut(auth);
        goto("/login");
    }
</script>

<!-- Toast Notification -->
{#if toastMessage}
    <div
        class="fixed top-4 left-1/2 -translate-x-1/2 z-[100] animate-in slide-in-from-top-4 fade-in duration-300"
    >
        <div
            class="bg-white/90 backdrop-blur-md text-slate-800 px-6 py-3 rounded-full shadow-2xl border border-white/50 flex items-center gap-3"
        >
            <div
                class="w-2 h-2 rounded-full bg-emerald-500 animate-pulse"
            ></div>
            <span class="text-sm font-bold">{toastMessage}</span>
        </div>
    </div>
{/if}

<div
    class="flex h-screen overflow-hidden bg-[#F9FAFB] text-slate-800 font-sans selection:bg-indigo-100 selection:text-indigo-700 relative"
>
    {#if user}
        <Sidebar
            {user}
            lectures={$lectures}
            subjects={$subjects}
            currentLectureId={null}
            selectedSubjectId={null}
            onLoadLecture={() => goto("/")}
            onSelectSubject={() => goto("/")}
            onSignOut={handleLogout}
        />
    {/if}

    <div class="flex-1 relative overflow-y-auto bg-slate-50">
        <main class="max-w-3xl mx-auto py-12 px-6 lg:px-12">
            <h1 class="text-3xl font-bold text-slate-900 mb-8 tracking-tight">
                設定
            </h1>

            {#if loading}
                <div class="text-center py-12">
                    <div
                        class="animate-spin rounded-full h-8 w-8 border-b-2 border-indigo-600 mx-auto"
                    ></div>
                </div>
            {:else if user}
                <!-- Profile Section -->
                <section class="mb-10">
                    <h2
                        class="text-sm font-bold text-slate-500 uppercase tracking-wide mb-3 ml-1"
                    >
                        プロフィール設定
                    </h2>
                    <div
                        class="bg-white rounded-2xl shadow-sm border border-slate-200 overflow-hidden divide-y divide-slate-100"
                    >
                        <!-- Avatar -->
                        <div class="p-6 flex items-center justify-between">
                            <div class="flex items-center gap-4">
                                {#if user.photoURL}
                                    <img
                                        src={user.photoURL}
                                        alt="Avatar"
                                        class="w-16 h-16 rounded-full border border-slate-100 shadow-sm"
                                    />
                                {:else}
                                    <div
                                        class="w-16 h-16 rounded-full bg-indigo-100 text-indigo-600 flex items-center justify-center text-2xl font-bold"
                                    >
                                        {displayName
                                            ? displayName[0].toUpperCase()
                                            : "U"}
                                    </div>
                                {/if}
                                <div>
                                    <p class="font-bold text-slate-900 text-lg">
                                        {displayName || "未設定"}
                                    </p>
                                    <p class="text-sm text-slate-500">
                                        {email}
                                    </p>
                                </div>
                            </div>
                        </div>

                        <!-- Nickname Input -->
                        <div
                            class="p-4 flex items-center gap-4 hover:bg-slate-50 transition-colors"
                        >
                            <label
                                class="w-32 text-sm font-medium text-slate-600"
                                >ニックネーム</label
                            >
                            <input
                                type="text"
                                bind:value={displayName}
                                class="flex-1 bg-transparent border-none focus:ring-0 text-slate-900 font-medium placeholder-slate-400 p-0"
                                placeholder="名前を入力"
                            />
                        </div>
                    </div>
                    <div class="mt-4 flex justify-end">
                        <button
                            onclick={handleUpdateProfile}
                            class="bg-indigo-600 text-white px-6 py-2 rounded-lg text-sm font-bold shadow-sm hover:shadow-md hover:bg-indigo-700 transition-all"
                        >
                            変更を保存
                        </button>
                    </div>
                </section>

                <!-- Plan Section -->
                <section class="mb-10">
                    <h2
                        class="text-sm font-bold text-slate-500 uppercase tracking-wide mb-3 ml-1"
                    >
                        プラン・お支払い
                    </h2>
                    <div
                        class="bg-white rounded-2xl shadow-sm border border-slate-200 overflow-hidden divide-y divide-slate-100"
                    >
                        <div
                            class="p-4 flex items-center justify-between hover:bg-slate-50 transition-colors"
                        >
                            <div class="flex items-center gap-4">
                                <div
                                    class="w-8 h-8 rounded-full bg-indigo-50 text-indigo-600 flex items-center justify-center"
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
                                            d="M3 10h18M7 15h1m4 0h1m-7 4h12a3 3 0 003-3V8a3 3 0 00-3-3H6a3 3 0 00-3 3v8a3 3 0 003 3z"
                                        /></svg
                                    >
                                </div>
                                <div>
                                    <p class="font-bold text-slate-900">
                                        現在のプラン
                                    </p>
                                </div>
                            </div>
                            <div>
                                {#if userData?.plan === "premium"}
                                    <span
                                        class="bg-gradient-to-r from-indigo-500 to-purple-500 text-white text-xs font-bold px-3 py-1 rounded-full shadow-sm"
                                        >PREMIUM</span
                                    >
                                {:else}
                                    <span
                                        class="bg-slate-100 text-slate-600 text-xs font-bold px-3 py-1 rounded-full"
                                        >FREE</span
                                    >
                                {/if}
                            </div>
                        </div>

                        <div
                            class="p-4 flex items-center justify-between hover:bg-slate-50 transition-colors cursor-pointer"
                            onclick={handlePortal}
                        >
                            <div class="flex items-center gap-4">
                                <div
                                    class="w-8 h-8 rounded-full bg-slate-50 text-slate-500 flex items-center justify-center"
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
                                            d="M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.065 2.572c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.572 1.065c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.065-2.572c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z"
                                        /><path
                                            stroke-linecap="round"
                                            stroke-linejoin="round"
                                            stroke-width="2"
                                            d="M15 12a3 3 0 11-6 0 3 3 0 016 0z"
                                        /></svg
                                    >
                                </div>
                                <p class="font-medium text-slate-700">
                                    サブスクリプションを管理
                                </p>
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
                                    d="M9 5l7 7-7 7"
                                /></svg
                            >
                        </div>
                    </div>
                </section>

                <!-- Data Management -->
                <section class="mb-10">
                    <h2
                        class="text-sm font-bold text-slate-500 uppercase tracking-wide mb-3 ml-1"
                    >
                        データ管理
                    </h2>
                    <div
                        class="bg-white rounded-2xl shadow-sm border border-slate-200 overflow-hidden divide-y divide-slate-100"
                    >
                        <button
                            class="w-full text-left p-4 flex items-center justify-between hover:bg-red-50 transition-colors group"
                            onclick={handleDeleteAccount}
                        >
                            <div class="flex items-center gap-4">
                                <div
                                    class="w-8 h-8 rounded-full bg-red-50 text-red-500 flex items-center justify-center group-hover:bg-red-100 transition-colors"
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
                                            d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16"
                                        /></svg
                                    >
                                </div>
                                <p class="font-medium text-red-600">
                                    アカウントを削除
                                </p>
                            </div>
                        </button>
                    </div>
                    <p class="text-xs text-slate-400 mt-2 ml-1">
                        ※アカウントを削除すると、すべてのデータが完全に消去されます。この操作は元に戻せません。
                    </p>
                </section>

                <!-- Logout -->
                <div class="flex justify-center mt-12 pb-12">
                    <button
                        onclick={handleLogout}
                        class="text-slate-400 font-bold hover:text-slate-600 transition-colors flex items-center gap-2"
                    >
                        <svg
                            class="w-5 h-5"
                            fill="none"
                            viewBox="0 0 24 24"
                            stroke="currentColor"
                            ><path
                                stroke-linecap="round"
                                stroke-linejoin="round"
                                stroke-width="2"
                                d="M17 16l4-4m0 0l-4-4m4 4H7m6 4v1a3 3 0 01-3 3H6a3 3 0 01-3-3V7a3 3 0 013-3h4a3 3 0 013 3v1"
                            /></svg
                        >
                        ログアウト
                    </button>
                </div>
            {/if}
        </main>
    </div>
</div>
