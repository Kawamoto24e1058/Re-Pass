<script lang="ts">
	import "../app.css";
	import favicon from "$lib/assets/favicon.svg";
	import { onMount } from "svelte";
	import { auth, db } from "$lib/firebase";
	import {
		doc,
		getDoc,
		collection,
		query,
		orderBy,
		onSnapshot,
	} from "firebase/firestore";
	import { goto } from "$app/navigation";
	import { page } from "$app/stores";
	import { subjects, lectures } from "$lib/stores";

	let { children } = $props();
	let loading = $state(true); // Splash screen state
	let showSplash = $state(true); // For fade-out animation
	let user = $state<any>(null);
	let lectureUnsubscribes: (() => void)[] = [];
	let lecturesMap = $state<Record<string, any[]>>({});

	$effect(() => {
		const allLectures = Object.values(lecturesMap)
			.flat()
			.sort((a, b) => {
				const tA = a.createdAt?.seconds || 0;
				const tB = b.createdAt?.seconds || 0;
				return tB - tA;
			});
		lectures.set(allLectures);
	});

	function cleanupLectureListeners() {
		lectureUnsubscribes.forEach((unsub) => unsub());
		lectureUnsubscribes = [];
	}

	$effect(() => {
		if (!user) {
			cleanupLectureListeners();
			lecturesMap = {};
			return;
		}

		cleanupLectureListeners();

		// 1. Root Lectures
		const rootQuery = query(
			collection(db, `users/${user.uid}/lectures`),
			orderBy("createdAt", "desc"),
		);
		const unsubRoot = onSnapshot(rootQuery, (snapshot) => {
			lecturesMap["root"] = snapshot.docs.map((d) => ({
				id: d.id,
				path: d.ref.path,
				...d.data(),
			}));
		});
		lectureUnsubscribes.push(unsubRoot);

		// 2. Subject Lectures
		if ($subjects.length > 0) {
			$subjects.forEach((subject) => {
				const subQuery = query(
					collection(
						db,
						`users/${user.uid}/subjects/${subject.id}/lectures`,
					),
					orderBy("createdAt", "desc"),
				);
				const unsubSub = onSnapshot(subQuery, (snapshot) => {
					lecturesMap[subject.id] = snapshot.docs.map((d) => ({
						id: d.id,
						path: d.ref.path,
						subjectId: subject.id,
						...d.data(),
					}));
				});
				lectureUnsubscribes.push(unsubSub);
			});
		}
	});

	onMount(() => {
		let unsubscribeSubjects: () => void;

		const unsubscribe = auth.onAuthStateChanged(async (currentUser) => {
			user = currentUser;
			// Small delay to ensure minimum splash time for branding feel
			await new Promise((r) => setTimeout(r, 1500));

			const path = $page.url.pathname;

			if (!currentUser) {
				subjects.set([]); // Clear subjects
				if (path !== "/auth") await goto("/auth");
			} else {
				// User is logged in, check if they have a profile doc (onboarded)
				try {
					const userDoc = await getDoc(
						doc(db, "users", currentUser.uid),
					);

					if (!userDoc.exists()) {
						if (path !== "/pricing") await goto("/pricing");
					} else {
						if (path === "/auth" || path === "/pricing")
							await goto("/");
					}

					// Fetch Subjects Globally
					const qSubjects = query(
						collection(db, `users/${currentUser.uid}/subjects`),
						orderBy("createdAt", "asc"),
					);
					unsubscribeSubjects = onSnapshot(qSubjects, (snapshot) => {
						const subs = snapshot.docs.map((doc) => ({
							id: doc.id,
							...doc.data(),
						}));
						subjects.set(subs);
					});
				} catch (e) {
					console.error("Error fetching user profile", e);
				}
			}

			// Hide Splash
			showSplash = false;
			setTimeout(() => (loading = false), 500); // Wait for fade out
		});

		return () => {
			unsubscribe();
			if (unsubscribeSubjects) unsubscribeSubjects();
			cleanupLectureListeners();
		};
	});
</script>

<svelte:head>
	<link rel="icon" href={favicon} />
</svelte:head>

<!-- Splash Screen -->
{#if loading}
	<div
		class="fixed inset-0 z-[9999] bg-[#F9FAFB] flex items-center justify-center transition-opacity duration-500 {showSplash
			? 'opacity-100'
			: 'opacity-0 pointer-events-none'}"
	>
		<div class="text-center animate-in fade-in zoom-in-95 duration-1000">
			<h1
				class="text-4xl font-bold bg-gradient-to-r from-indigo-600 to-pink-500 bg-clip-text text-transparent tracking-tighter mb-2"
			>
				Re-Pass
			</h1>
			<div
				class="h-1 w-12 bg-slate-200 mx-auto rounded-full overflow-hidden"
			>
				<div
					class="h-full bg-indigo-500 w-full animate-progress-indeterminate"
				></div>
			</div>
		</div>
	</div>
{/if}

{@render children()}

<style>
	@keyframes progress-indeterminate {
		0% {
			transform: translateX(-100%);
		}
		50% {
			transform: translateX(0);
		}
		100% {
			transform: translateX(100%);
		}
	}
	.animate-progress-indeterminate {
		animation: progress-indeterminate 1.5s infinite linear;
	}
</style>
