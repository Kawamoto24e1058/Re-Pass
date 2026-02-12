<script lang="ts">
    import { auth, db, googleProvider, microsoftProvider } from "$lib/firebase";
    import {
        signInWithPopup,
        signInWithEmailAndPassword,
        createUserWithEmailAndPassword,
        RecaptchaVerifier,
        signInWithPhoneNumber,
    } from "firebase/auth";
    import { doc, getDoc, setDoc, serverTimestamp } from "firebase/firestore";
    import { goto } from "$app/navigation";
    import { onMount } from "svelte";
    import { fade, fly } from "svelte/transition";

    // Login Modes: 'choice' | 'email' | 'phone' | 'verify'
    type LoginMode = "choice" | "email" | "phone" | "verify";
    let mode = $state<LoginMode>("choice");

    let email = $state("");
    let password = $state("");
    let phoneNumber = $state("");
    let verificationCode = $state("");
    let isRegistering = $state(false);
    let error = $state("");
    let loading = $state(false);
    let isAgreed = $state(false);

    let confirmationResult: any = null;
    let recaptchaVerifier: any = null;

    async function checkAndCreateUser(user: any) {
        const userRef = doc(db, "users", user.uid);
        const userSnap = await getDoc(userRef);

        if (!userSnap.exists()) {
            // Auto-create user doc with 'free' plan and basic info
            await setDoc(
                userRef,
                {
                    name:
                        user.displayName ||
                        user.email?.split("@")[0] ||
                        "学習者",
                    email: user.email || null,
                    photoURL: user.photoURL || null,
                    plan: "free",
                    agreedAt: serverTimestamp(),
                    createdAt: serverTimestamp(),
                    updatedAt: serverTimestamp(),
                },
                { merge: true },
            );
        }
    }

    async function handleSocialLogin(provider: any) {
        if (!isAgreed) {
            error = "利用規約への同意が必要です。";
            return;
        }
        try {
            loading = true;
            error = "";
            const result = await signInWithPopup(auth, provider);
            await checkAndCreateUser(result.user);
            goto("/");
        } catch (e: any) {
            console.error(e);
            if (e.code === "auth/account-exists-with-different-credential") {
                error = "このメールアドレスは既に他の方法で登録されています。";
            } else {
                error = "ログインに失敗しました。";
            }
        } finally {
            loading = false;
        }
    }

    async function handleEmailAuth() {
        try {
            loading = true;
            error = "";
            if (isRegistering) {
                if (!isAgreed) {
                    error = "利用規約への同意が必要です。";
                    loading = false;
                    return;
                }
                const result = await createUserWithEmailAndPassword(
                    auth,
                    email,
                    password,
                );
                await checkAndCreateUser(result.user);
            } else {
                await signInWithEmailAndPassword(auth, email, password);
            }
            goto("/");
        } catch (e: any) {
            console.error(e);
            if (e.code === "auth/email-already-in-use") {
                error = "このメールアドレスは既に登録されています。";
            } else if (e.code === "auth/weak-password") {
                error = "パスワードが短すぎます（6文字以上必要です）。";
            } else {
                error =
                    "認証に失敗しました。メールアドレスとパスワードを確認してください。";
            }
        } finally {
            loading = false;
        }
    }

    onMount(() => {
        // Initial check: if already logged in, redirect
        if (auth.currentUser) {
            goto("/");
        }

        recaptchaVerifier = new RecaptchaVerifier(auth, "recaptcha-container", {
            size: "invisible",
        });
    });

    async function handlePhoneSubmit() {
        if (!isAgreed) {
            error = "利用規約への同意が必要です。";
            return;
        }
        if (!phoneNumber) return;
        try {
            loading = true;
            error = "";
            const formatted = phoneNumber.startsWith("+")
                ? phoneNumber
                : `+81${phoneNumber.replace(/^0/, "")}`;
            confirmationResult = await signInWithPhoneNumber(
                auth,
                formatted,
                recaptchaVerifier,
            );
            mode = "verify";
        } catch (e: any) {
            console.error(e);
            error = "SMS送信に失敗しました。番号を確認してください。";
        } finally {
            loading = false;
        }
    }

    async function handleVerifyCode() {
        if (!verificationCode) return;
        try {
            loading = true;
            error = "";
            const result = await confirmationResult.confirm(verificationCode);
            await checkAndCreateUser(result.user);
            goto("/");
        } catch (e: any) {
            error = "認証コードが正しくありません。";
        } finally {
            loading = false;
        }
    }
</script>

<div
    class="min-h-screen bg-[#F9FAFB] flex flex-col items-center justify-center p-6 font-sans selection:bg-indigo-100"
>
    <div id="recaptcha-container"></div>

    <!-- Background Decor -->
    <div class="fixed inset-0 overflow-hidden pointer-events-none opacity-40">
        <div
            class="absolute -top-[10%] -left-[5%] w-[40%] h-[40%] rounded-full bg-indigo-200 blur-[120px]"
        ></div>
        <div
            class="absolute top-[30%] -right-[10%] w-[35%] h-[35%] rounded-full bg-pink-100 blur-[100px]"
        ></div>
    </div>

    <div
        class="relative w-full max-w-[420px] bg-white/80 backdrop-blur-2xl border border-white rounded-[2.5rem] shadow-[0_32px_64px_-16px_rgba(0,0,0,0.08)] p-10 flex flex-col items-center"
    >
        <!-- Brand -->
        <a
            href="/"
            class="mb-8 text-center group no-underline block hover:opacity-90 transition-opacity"
        >
            <div
                class="w-16 h-16 bg-indigo-600 rounded-2xl flex items-center justify-center text-white mb-6 mx-auto shadow-xl shadow-indigo-100 rotate-3 animate-in zoom-in-50 duration-500 group-hover:scale-105 transition-transform"
            >
                <svg class="w-10 h-10" viewBox="0 0 24 24" fill="currentColor">
                    <path d="M12 2L2 7L12 12L22 7L12 2Z" fill="white" />
                    <path
                        d="M2 17L12 22L22 17"
                        stroke="white"
                        stroke-width="2"
                        stroke-linecap="round"
                        stroke-linejoin="round"
                    />
                    <path
                        d="M2 12L12 17L22 12"
                        stroke="white"
                        stroke-width="2"
                        stroke-linecap="round"
                        stroke-linejoin="round"
                    />
                </svg>
            </div>
            <h1
                class="text-3xl font-black text-slate-900 tracking-tighter mb-1"
            >
                Re-Pass
            </h1>
            <p
                class="text-indigo-500 text-[10px] font-black tracking-[0.2em] uppercase"
            >
                Academic Intelligence
            </p>
        </a>

        {#if error}
            <div
                in:fade
                class="w-full bg-red-50 text-red-600 px-4 py-3 rounded-2xl text-[11px] font-bold mb-6 border border-red-100 flex items-center gap-2"
            >
                <svg
                    class="w-4 h-4 flex-shrink-0"
                    fill="none"
                    viewBox="0 0 24 24"
                    stroke="currentColor"
                >
                    <path
                        stroke-linecap="round"
                        stroke-linejoin="round"
                        stroke-width="2"
                        d="M12 8v4m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z"
                    />
                </svg>
                {error}
            </div>
        {/if}

        <div class="w-full space-y-4">
            <!-- Global Agreement Checkbox (Always visible for clarity) -->
            <div
                class="bg-slate-50 p-4 rounded-2xl border border-slate-100 mb-2"
            >
                <div class="flex items-start gap-3">
                    <input
                        id="tos-agree"
                        type="checkbox"
                        bind:checked={isAgreed}
                        class="mt-1 w-4 h-4 rounded text-indigo-600 focus:ring-indigo-500 border-slate-300 cursor-pointer transition-all"
                    />
                    <label
                        for="tos-agree"
                        class="text-[11px] text-slate-500 leading-relaxed cursor-pointer select-none"
                    >
                        <a
                            href="/terms"
                            target="_blank"
                            class="text-indigo-600 font-bold hover:underline"
                            >利用規約</a
                        >および
                        <a
                            href="/privacy"
                            target="_blank"
                            class="text-indigo-600 font-bold hover:underline"
                            >プライバシーポリシー</a
                        >
                        に同意します。
                    </label>
                </div>
            </div>

            {#if mode === "choice"}
                <div in:fade={{ duration: 200 }} class="space-y-3">
                    <button
                        onclick={() => handleSocialLogin(googleProvider)}
                        class="w-full py-4 px-6 bg-white border border-slate-200 rounded-2xl flex items-center justify-center gap-3 hover:bg-slate-50 transition-all shadow-sm active:scale-[0.98] disabled:opacity-50"
                        disabled={loading}
                    >
                        <svg class="w-5 h-5" viewBox="0 0 24 24">
                            <path
                                fill="#4285F4"
                                d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z"
                            />
                            <path
                                fill="#34A853"
                                d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"
                            />
                            <path
                                fill="#FBBC05"
                                d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z"
                            />
                            <path
                                fill="#EA4335"
                                d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z"
                            />
                        </svg>
                        <span class="text-sm font-bold text-slate-700"
                            >Googleで続ける</span
                        >
                    </button>

                    <button
                        onclick={() => handleSocialLogin(microsoftProvider)}
                        class="w-full py-4 px-6 bg-white border border-slate-200 rounded-2xl flex items-center justify-center gap-3 hover:bg-slate-50 transition-all shadow-sm active:scale-[0.98] disabled:opacity-50"
                        disabled={loading}
                    >
                        <svg class="w-5 h-5" viewBox="0 0 23 23">
                            <path fill="#f3f3f3" d="M0 0h23v23H0z" />
                            <path fill="#f35325" d="M1 1h10v10H1z" />
                            <path fill="#81bc06" d="M12 1h10v10H12z" />
                            <path fill="#05a6f0" d="M1 12h10v10H1z" />
                            <path fill="#ffba08" d="M12 12h10v10H12z" />
                        </svg>
                        <span class="text-sm font-bold text-slate-700"
                            >Microsoftで続ける</span
                        >
                    </button>

                    <div class="flex items-center gap-3 py-4">
                        <div class="h-[1px] flex-1 bg-slate-100"></div>
                        <span
                            class="text-[10px] font-black text-slate-200 uppercase tracking-widest"
                            >or</span
                        >
                        <div class="h-[1px] flex-1 bg-slate-100"></div>
                    </div>

                    <div class="grid grid-cols-2 gap-3">
                        <button
                            onclick={() => (mode = "email")}
                            class="py-4 rounded-2xl bg-slate-900 text-white font-bold text-[13px] shadow-lg shadow-slate-200 hover:bg-slate-800 transition-all active:scale-[0.98]"
                        >
                            メール
                        </button>
                        <button
                            onclick={() => (mode = "phone")}
                            class="py-4 rounded-2xl bg-white border border-slate-200 text-slate-600 font-bold text-[13px] hover:bg-slate-50 transition-all active:scale-[0.98]"
                        >
                            電話番号
                        </button>
                    </div>
                </div>
            {:else if mode === "email"}
                <div in:fly={{ y: 20, duration: 300 }} class="space-y-4 w-full">
                    <div>
                        <label
                            for="email"
                            class="text-[10px] font-black text-slate-400 uppercase tracking-[0.2em] ml-4 mb-2 block"
                            >Email</label
                        >
                        <input
                            id="email"
                            type="email"
                            bind:value={email}
                            placeholder="example@univ.ac.jp"
                            class="w-full px-6 py-4 bg-slate-50 border border-slate-100 rounded-[1.5rem] text-sm focus:bg-white focus:ring-2 focus:ring-indigo-100 outline-none transition-all"
                        />
                    </div>
                    <div>
                        <label
                            for="password"
                            class="text-[10px] font-black text-slate-400 uppercase tracking-[0.2em] ml-4 mb-2 block"
                            >Password</label
                        >
                        <input
                            id="password"
                            type="password"
                            bind:value={password}
                            placeholder="••••••••"
                            class="w-full px-6 py-4 bg-slate-50 border border-slate-100 rounded-[1.5rem] text-sm focus:bg-white focus:ring-2 focus:ring-indigo-100 outline-none transition-all"
                        />
                    </div>

                    <button
                        onclick={handleEmailAuth}
                        disabled={loading || (isRegistering && !isAgreed)}
                        class="w-full py-5 rounded-2xl bg-indigo-600 text-white font-black text-sm shadow-xl shadow-indigo-100 hover:bg-indigo-500 transition-all disabled:opacity-50"
                    >
                        {loading
                            ? "処理中..."
                            : isRegistering
                              ? "アカウントを作成"
                              : "ログイン"}
                    </button>

                    <div class="flex flex-col items-center gap-4 mt-6">
                        <button
                            onclick={() => {
                                isRegistering = !isRegistering;
                                error = "";
                            }}
                            class="text-xs font-bold text-slate-500 hover:text-indigo-600 transition-colors"
                        >
                            {isRegistering
                                ? "ログインに戻る"
                                : "新しくアカウントを作成する"}
                        </button>
                        <button
                            onclick={() => (mode = "choice")}
                            class="text-xs font-bold text-slate-300 hover:text-slate-400"
                            >戻る</button
                        >
                    </div>
                </div>
            {:else if mode === "phone"}
                <div in:fly={{ y: 20, duration: 300 }} class="space-y-4 w-full">
                    <div>
                        <label
                            for="phone"
                            class="text-[10px] font-black text-slate-400 uppercase tracking-[0.2em] ml-4 mb-2 block"
                            >Phone Number</label
                        >
                        <input
                            id="phone"
                            type="tel"
                            bind:value={phoneNumber}
                            placeholder="09012345678"
                            class="w-full px-6 py-4 bg-slate-50 border border-slate-100 rounded-[1.5rem] text-sm focus:bg-white focus:ring-2 focus:ring-indigo-100 outline-none transition-all"
                        />
                    </div>
                    <p
                        class="text-[10px] text-slate-400 text-center leading-relaxed"
                    >
                        SMSで認証コードを送信します。
                    </p>
                    <button
                        onclick={handlePhoneSubmit}
                        disabled={loading || !isAgreed}
                        class="w-full py-5 rounded-2xl bg-indigo-600 text-white font-black text-sm shadow-xl shadow-indigo-100 hover:bg-indigo-500 transition-all disabled:opacity-50"
                    >
                        {loading ? "送信中..." : "認証コードを送信"}
                    </button>
                    <button
                        onclick={() => (mode = "choice")}
                        class="w-full text-xs font-bold text-slate-300 hover:text-slate-400 py-2"
                        >戻る</button
                    >
                </div>
            {:else if mode === "verify"}
                <div in:fly={{ y: 20, duration: 300 }} class="space-y-4 w-full">
                    <div>
                        <label
                            for="code"
                            class="text-[10px] font-black text-slate-400 uppercase tracking-[0.2em] ml-4 mb-2 block"
                            >Verification Code</label
                        >
                        <input
                            id="code"
                            type="text"
                            bind:value={verificationCode}
                            placeholder="000000"
                            maxlength="6"
                            class="w-full px-6 py-4 bg-slate-50 border border-slate-100 rounded-[1.5rem] text-2xl font-black tracking-[0.5em] text-center focus:bg-white focus:ring-2 focus:ring-indigo-100 outline-none transition-all"
                        />
                    </div>
                    <button
                        onclick={handleVerifyCode}
                        disabled={loading}
                        class="w-full py-5 rounded-2xl bg-indigo-600 text-white font-black text-sm shadow-xl shadow-indigo-100 hover:bg-indigo-500 transition-all"
                    >
                        {loading ? "確認中..." : "番号を認証して開始"}
                    </button>
                    <button
                        onclick={() => (mode = "phone")}
                        class="w-full text-xs font-bold text-slate-300 hover:text-slate-400 py-2"
                        >やり直す</button
                    >
                </div>
            {/if}
        </div>

        <p
            class="mt-12 text-[10px] text-slate-300 text-center leading-relaxed max-w-[280px]"
        >
            AIを活用した効率的な学習管理。<br />
            講義を資産に変え、テスト前の余裕を手に入れましょう。
        </p>
    </div>
</div>
