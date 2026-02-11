<script lang="ts">
    import { auth, db, googleProvider } from "$lib/firebase";
    import {
        signInWithPopup,
        signInWithEmailAndPassword,
        createUserWithEmailAndPassword,
        GoogleAuthProvider,
    } from "firebase/auth";
    import { doc, getDoc, setDoc, serverTimestamp } from "firebase/firestore";
    import { goto } from "$app/navigation";
    import { onMount } from "svelte";

    let email = "";
    let password = "";
    let isRegistering = false;
    let error = "";
    let loading = false;

    async function checkAndCreateUser(user: any) {
        const userRef = doc(db, "users", user.uid);
        const userSnap = await getDoc(userRef);

        if (!userSnap.exists()) {
            // Auto-create user doc with 'free' plan
            await setDoc(userRef, {
                email: user.email,
                plan: "free",
                stripeCustomerId: null,
                createdAt: serverTimestamp(),
            });
        }
    }

    async function handleGoogleLogin() {
        try {
            loading = true;
            error = "";
            const result = await signInWithPopup(auth, googleProvider);
            await checkAndCreateUser(result.user);
            goto("/");
        } catch (e: any) {
            console.error(e);
            error = "Googleログインに失敗しました: " + e.message;
        } finally {
            loading = false;
        }
    }

    async function handleEmailAuth() {
        try {
            loading = true;
            error = "";
            if (isRegistering) {
                const result = await createUserWithEmailAndPassword(
                    auth,
                    email,
                    password,
                );
                await checkAndCreateUser(result.user);
            } else {
                await signInWithEmailAndPassword(auth, email, password);
                // Login checking is implicitly handled by onAuthStateChanged in +page.svelte,
                // but here we redirect manually.
                // For existing users, no need to recreate doc usually, but good to be safe if we want strict consistency.
                // However, standard flow is just redirect.
            }
            goto("/");
        } catch (e: any) {
            console.error(e);
            error = "認証に失敗しました: " + e.message;
        } finally {
            loading = false;
        }
    }
</script>

<div
    class="min-h-screen bg-slate-900 text-white flex flex-col items-center justify-center p-4"
>
    <div class="fixed inset-0 overflow-hidden pointer-events-none">
        <div
            class="absolute -top-[20%] -left-[10%] w-[50%] h-[50%] rounded-full bg-indigo-500/10 blur-3xl"
        ></div>
        <div
            class="absolute top-[40%] -right-[10%] w-[40%] h-[40%] rounded-full bg-purple-500/10 blur-3xl"
        ></div>
    </div>

    <div
        class="relative w-full max-w-md bg-slate-800/50 backdrop-blur-xl border border-slate-700/50 rounded-2xl shadow-2xl p-8 space-y-8"
    >
        <div class="text-center space-y-2">
            <h1
                class="text-3xl font-bold tracking-tight bg-gradient-to-r from-indigo-400 to-purple-400 bg-clip-text text-transparent"
            >
                Re-Pass
            </h1>
            <p class="text-slate-400 text-sm">
                {isRegistering ? "新規アカウント作成" : "ログイン"}
            </p>
        </div>

        {#if error}
            <div
                class="bg-red-500/10 border border-red-500/50 text-red-400 px-4 py-2 rounded text-sm"
            >
                {error}
            </div>
        {/if}

        <div class="space-y-4">
            <button
                on:click={handleGoogleLogin}
                disabled={loading}
                class="w-full py-2.5 px-4 rounded-xl font-semibold text-slate-900 bg-white hover:bg-slate-100
             disabled:opacity-50 disabled:cursor-not-allowed
             transform active:scale-[0.98] transition-all duration-200
             flex items-center justify-center gap-2"
            >
                <svg class="w-5 h-5" viewBox="0 0 24 24"
                    ><path
                        fill="currentColor"
                        d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z"
                    ></path><path
                        fill="currentColor"
                        d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"
                    ></path><path
                        fill="currentColor"
                        d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z"
                    ></path><path
                        fill="currentColor"
                        d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z"
                    ></path></svg
                >
                Googleで続ける
            </button>

            <div class="relative flex py-2 items-center">
                <div class="flex-grow border-t border-slate-700"></div>
                <span class="flex-shrink-0 mx-4 text-slate-500 text-xs"
                    >または</span
                >
                <div class="flex-grow border-t border-slate-700"></div>
            </div>

            <form on:submit|preventDefault={handleEmailAuth} class="space-y-4">
                <div>
                    <label
                        for="email"
                        class="block text-sm font-medium text-slate-300"
                        >メールアドレス</label
                    >
                    <input
                        id="email"
                        type="email"
                        bind:value={email}
                        required
                        class="mt-1 block w-full px-3 py-2 bg-slate-900/50 border border-slate-700 rounded-lg text-white focus:outline-none focus:ring-2 focus:ring-indigo-500/50"
                    />
                </div>
                <div>
                    <label
                        for="password"
                        class="block text-sm font-medium text-slate-300"
                        >パスワード</label
                    >
                    <input
                        id="password"
                        type="password"
                        bind:value={password}
                        required
                        minlength="6"
                        class="mt-1 block w-full px-3 py-2 bg-slate-900/50 border border-slate-700 rounded-lg text-white focus:outline-none focus:ring-2 focus:ring-indigo-500/50"
                    />
                </div>

                <button
                    type="submit"
                    disabled={loading}
                    class="w-full py-2.5 px-4 rounded-xl font-semibold text-white shadow-lg shadow-indigo-500/20
               bg-gradient-to-r from-indigo-600 to-purple-600 hover:from-indigo-500 hover:to-purple-500
               disabled:opacity-50 disabled:cursor-not-allowed
               transform active:scale-[0.98] transition-all duration-200"
                >
                    {#if loading}
                        <span class="animate-pulse">処理中...</span>
                    {:else}
                        {isRegistering ? "アカウント作成" : "ログイン"}
                    {/if}
                </button>
            </form>
        </div>

        <div class="text-center text-sm text-slate-400">
            <button
                on:click={() => (isRegistering = !isRegistering)}
                class="underline hover:text-white transition-colors"
            >
                {isRegistering
                    ? "すでにアカウントをお持ちですか？ログイン"
                    : "アカウントをお持ちでないですか？新規登録"}
            </button>
        </div>
    </div>
</div>
