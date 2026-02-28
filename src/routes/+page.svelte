<script lang="ts">
  import { onMount, onDestroy, tick } from "svelte";
  import { storage, auth, db } from "$lib/firebase";
  import {
    ref,
    uploadBytes,
    uploadBytesResumable,
    getDownloadURL,
    deleteObject,
  } from "firebase/storage";
  import {
    extractAudioFromVideo,
    type AudioExtractionProgress,
  } from "$lib/utils/audioExtractor";
  import { retryOperation } from "$lib/utils/retry";
  import { marked } from "marked";
  import {
    collection,
    addDoc,
    query,
    where,
    orderBy,
    onSnapshot,
    doc,
    setDoc,
    updateDoc,
    getDoc,
    getDocs,
    limit,
    deleteDoc,
    serverTimestamp,
    startAt,
    endAt,
    collectionGroup,
    Timestamp,
  } from "firebase/firestore";
  import { goto } from "$app/navigation";
  import { browser } from "$app/environment";
  import { signOut } from "firebase/auth";
  import { subjects, lectures, currentBinder } from "$lib/stores";
  import { user as userStore, userProfile } from "$lib/userStore";
  import {
    isRecording,
    transcript,
    isShared,
    courseId,
    resetSession, // Renamed from resetTranscript/resetAll
    lectureTitle,
    analysisMode,
    targetLength,
    pdfFile,
    txtFile,
    audioFile,
    imageFile,
    videoFile,
    targetUrl,
    interimTranscript,
    analysisCountdown,
    analysisStatus,
    stagedImages,
    taskText,
  } from "$lib/stores/sessionStore";
  import { recognitionService } from "$lib/services/recognitionService";
  import { streamingService } from "$lib/services/streamingService";
  import { page } from "$app/stores";
  import UpgradeModal from "$lib/components/UpgradeModal.svelte";
  import EnrollModal from "$lib/components/EnrollModal.svelte";
  import { isEnrollModalOpen } from "$lib/stores";
  import TranscriptResetModal from "$lib/components/dashboard/TranscriptResetModal.svelte";
  import { normalizeCourseName } from "$lib/utils/textUtils";

  // Dashboard Components
  import LectureCard from "$lib/components/dashboard/LectureCard.svelte";
  import FileInputCard from "$lib/components/dashboard/FileInputCard.svelte";
  import ResultView from "$lib/components/dashboard/ResultView.svelte";

  // --- Contextual Search State ---
  let contextualSharedNotes: any[] = [];
  let isSearchingNotes = false;
  let hasSearchedNotes = false;

  // --- Simplified State Variables ---
  let recordingMode: "lecture" | "meeting" = "lecture"; // 'lecture' or 'meeting'
  let isEditing = false;
  let isCourseDropdownOpen = false;
  let isMobileCourseViewOpen = false; // For mobile bottom sheet
  let viewMode: "create" | "gallery" = "create"; // 'create' (4-step editor) or 'gallery' (shared notes)
  let galleryCourseName = ""; // Selected course for gallery
  // lectureTitle is managed by sessionStore
  let currentLectureId: string | null = null;
  let selectedSubjectId: string | null = null;
  let draggingLectureId: string | null = null;
  let isDragOverMainTarget = false;
  let selectedLectureIds = new Set<string>();
  let movingLectureId: string | null = null;
  let selectedDerivativeMode: "note" | "thoughts" | "report" | null = null;
  let derivativeTargetLength = 400;

  // User & Data State
  let user: any = null;
  let userData: any = null;

  // Sync state with store
  $: {
    user = $userStore;
    userData = $userProfile; // Restore this for global data access
  }

  // Handle subject change side effects
  let lastSubjectId: string | null = null;
  $: if ($currentBinder !== lastSubjectId) {
    lastSubjectId = $currentBinder;
    selectedSubjectId = lastSubjectId;

    // When subject changes, clear contextual search state
    contextualSharedNotes = [];
    hasSearchedNotes = false;

    // Auto-search for Ultimate users
    if (selectedSubjectId && isUltimate) {
      const subject = $subjects.find((s) => s.id === selectedSubjectId);
      if (subject) {
        fetchContextualNotes(subject.name);
      }
    }

    // Pre-select course based on selected subject in sidebar
    if (selectedSubjectId && enrolledCoursesList.length > 0) {
      const subject = $subjects.find((s) => s.id === selectedSubjectId);
      if (subject) {
        const matchingCourse = enrolledCoursesList.find(
          (c) =>
            normalizeCourseName(c.courseName) ===
            normalizeCourseName(subject.name),
        );
        if (matchingCourse && !$lectureTitle) {
          $lectureTitle = matchingCourse.courseName;
        }
      }
    }
  }

  // Derived courses for display (with retry/fallback)
  let enrolledCoursesList: any[] = [];
  let unsubscribeEnrolledCourses: any = null;

  // React to courseContext clicks from Sidebar
  $: if (browser && $page.url.searchParams.has("courseContext")) {
    const courseContextParam = $page.url.searchParams.get("courseContext");
    if (courseContextParam) {
      const decodedCourse = decodeURIComponent(courseContextParam);
      viewMode = "gallery";
      galleryCourseName = decodedCourse;
      $lectureTitle = "";

      currentLectureId = null;
      isEditing = false;

      fetchContextualNotes(decodedCourse);

      // Clean up the URL silently
      const newUrl = new URL(window.location.href);
      newUrl.searchParams.delete("courseContext");
      window.history.replaceState({}, "", newUrl);
    }
  }

  $: if (user) {
    if (unsubscribeEnrolledCourses) unsubscribeEnrolledCourses();
    const q = query(
      collection(db, `users/${user.uid}/enrolled_courses`),
      orderBy("createdAt", "desc"),
    );
    unsubscribeEnrolledCourses = onSnapshot(q, (snapshot) => {
      enrolledCoursesList = snapshot.docs.map((d) => ({
        id: d.id,
        ...d.data(),
      }));
    });
  }

  onDestroy(() => {
    if (unsubscribeEnrolledCourses) unsubscribeEnrolledCourses();
  });

  // UI State
  let toastMessage: string | null = null;
  let analysisProposal: {
    lectureId: string;
    subjectId: string;
    subjectName: string;
  } | null = null;

  // Action for auto-scrolling element
  function actionTextAreaAutoscroll(node: HTMLElement, value: string) {
    const scroll = () => {
      node.scrollTop = node.scrollHeight;
    };

    // Scroll on mount
    scroll();

    return {
      update() {
        scroll();
      },
    };
  }

  let upgradeModalTitle = "ULTIMATE限定機能";
  let upgradeModalMessage = "";
  let showUpgradeModal = false;
  let showUltimateModal = false;
  let showTranscriptResetModal = false;
  let analyzing = false;
  let cancellationController: AbortController | null = null;

  type AnalysisResult =
    | {
        title?: string;
        category?: string;
        summary: string;
        glossary?: { term: string; definition: string }[];
      }
    | string;

  let result: AnalysisResult = "";
  // --- Derived State for UI ---
  $: analyzedTitle = (() => {
    const activeMode = selectedDerivativeMode || $analysisMode || "note";
    const ca = lectureAnalyses[activeMode] || result;

    // Safely extract title from current analysis or fallback to lectureTitle
    let extractedTitle = "";
    if (ca && typeof ca === "object" && ca.title) {
      extractedTitle = ca.title;
    }

    if (!extractedTitle) {
      extractedTitle =
        typeof $lectureTitle === "object"
          ? ($lectureTitle as any).title || "講義ノート"
          : $lectureTitle || "講義ノート";
    }
    return extractedTitle;
  })();

  let analyzedCategory = "";

  // --- Derivative Generation State ---
  let lectureAnalyses: Record<string, AnalysisResult> = {};
  let initialGenerationDone = false;
  let derivativeAnalyzing = false;

  // --- Interactive QA State ---
  let isAskingQuestion = false;
  let qaInput = "";
  let qaHistory: { role: "user" | "assistant"; content: string }[] = [];

  let resultTextContainer: HTMLElement | null = null; // For individual copy
  let resultContainer: HTMLElement | null = null; // For auto-scroll
  let finalResultContainer: HTMLElement | null = null; // For final copy

  let unsubscribeUser: any = null;
  let previewVideoUrl: string | null = null;
  let videoPlayer: HTMLVideoElement | null = null;

  // Speech Recognition State - Moved to global recordingStore
  // let isRecording = $state(false);
  // let transcript = $state("");
  // let finalTranscript = $state("");
  // let recognition: any;

  // Analysis Settings
  // Managed by sessionStore: analysisMode, targetLength

  // Series Analysis State
  let analyzingSeries = false;
  let seriesSummary: {
    story: string;
    unresolved: string;
    exam: string;
  } | null = null;

  // Progress State
  let progressValue = 0;
  let progressStatus = "準備中...";
  let progressInterval: any;
  let customAnalysisInstructions = "";
  let analyzingFinal = false;
  let finalExamView = false; // Toggle between lecture list and final exam
  let finalExamResult = ""; // Store AI-generated final exam summary
  let isCopied = false; // Feedback state for summary copy
  let isResultCopied = false; // Feedback state for individual results  // --- Progressive Disclosure State ---
  $: isStep2Locked = !$lectureTitle;
  $: isStep3Locked = isStep2Locked; // Mode is usually selected, so lock same as Step 2
  $: isStep4Locked =
    analyzing ||
    (!$pdfFile &&
      !$imageFile &&
      !$txtFile &&
      !$videoFile &&
      !$audioFile &&
      !$targetUrl &&
      !$transcript.trim() &&
      $stagedImages.length === 0);

  // Copy result to clipboard (AnalysisResult aware)
  $: strategyContent = (() => {
    const activeMode = selectedDerivativeMode || $analysisMode || "note";
    const ca = lectureAnalyses[activeMode] || result;
    if (!ca || typeof ca !== "object" || !ca.summary) return null;
    const match = ca.summary.match(
      /\[A_STRATEGY_START\]([\s\S]*?)\[A_STRATEGY_END\]/,
    );
    return match ? match[1].trim() : null;
  })();

  $: displaySummary = (() => {
    const activeMode = selectedDerivativeMode || $analysisMode || "note";
    const ca = lectureAnalyses[activeMode] || result;
    if (!ca) return "";
    if (typeof ca === "string") return ca;
    if (!ca.summary) return "";
    return ca.summary
      .replace(/\[A_STRATEGY_START\][\s\S]*?\[A_STRATEGY_END\]/g, "")
      .trim();
  })();

  function copyToClipboard() {
    if (!finalResultContainer) return;

    // Use innerText as a fallback, but ideally we reconstruct from data if available
    const rawText = finalResultContainer.innerText;
    const cleanText = rawText
      .split("\n")
      .map((line) => line.trim())
      .join("\n")
      .replace(/\n{3,}/g, "\n\n")
      .trim();

    navigator.clipboard.writeText(cleanText).then(() => {
      isCopied = true;
      setTimeout(() => (isCopied = false), 2000);
    });
  }

  // Copy individual lecture note to clipboard (AnalysisResult aware)
  function copyResultToClipboard() {
    let cleanText = "";

    // If we have structured data, construct a nice report
    const activeMode = selectedDerivativeMode || $analysisMode || "note";
    const currentData = lectureAnalyses[activeMode] || result;

    if (typeof currentData === "object" && currentData !== null) {
      const { title, category, summary, glossary } = currentData;
      cleanText += `${title || "無題"}\n`;
      if (category) cleanText += `カテゴリ: ${category}\n`;
      cleanText += `\n${summary}\n`;

      if (glossary && glossary.length > 0) {
        cleanText += `\n【用語辞典】\n`;
        glossary.forEach((item: any) => {
          cleanText += `・${item.term}: ${item.definition}\n`;
        });
      }
    } else {
      // Legacy or string fallback
      if (!resultTextContainer) return;
      cleanText = resultTextContainer.innerText
        .split("\n")
        .map((line) => line.trim())
        .join("\n")
        .replace(/\n{3,}/g, "\n\n")
        .trim();
    }

    navigator.clipboard.writeText(cleanText).then(() => {
      isResultCopied = true;
      setTimeout(() => (isResultCopied = false), 2000);
    });
  }

  async function handleDerivativeGenerate(
    mode: "note" | "thoughts" | "report",
  ) {
    if (!currentLectureId) return;
    if (derivativeAnalyzing) return;

    // Premium check
    if ((mode === "thoughts" || mode === "report") && !isPremium) {
      showUpgradeModal = true;
      upgradeModalTitle = "プレミアムプラン限定";
      upgradeModalMessage =
        "感想文やレポート形式の出力はプレミアムプラン以上の機能です。";
      return;
    }

    try {
      derivativeAnalyzing = true;
      toastMessage = "生成を開始しました...";

      const lecture = $lectures.find((l) => l.id === currentLectureId);
      if (!lecture) throw new Error("Lecture not found");

      const idToken = await user.getIdToken();

      const formData = new FormData();
      formData.append("mode", mode);
      formData.append("targetLength", derivativeTargetLength.toString());
      formData.append("documentText", $transcript || lecture.content || "");
      formData.append("plan", userData?.plan || "free");

      const response = await fetch("/api/analyze", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${idToken}`,
        },
        body: formData,
      });

      if (!response.ok) {
        throw new Error("Analysis failed");
      }

      const data = await response.json();
      const newResult = data.result;

      if (!newResult) {
        throw new Error("Invalid response format from server");
      }

      // Update store
      lectureAnalyses[mode] = newResult;

      // Save to Firestore
      const ref = doc(db, `users/${user.uid}/lectures/${currentLectureId}`);
      await setDoc(
        ref,
        {
          analyses: lectureAnalyses,
          updatedAt: serverTimestamp(),
        },
        { merge: true },
      );

      toastMessage = "生成が完了しました";

      await tick();
      if (resultContainer) {
        resultContainer.scrollIntoView({ behavior: "smooth", block: "start" });
      }
    } catch (e) {
      console.error(e);
      toastMessage = "エラーが発生しました";
    } finally {
      derivativeAnalyzing = false;
      setTimeout(() => (toastMessage = null), 3000);
    }
  }

  async function generateFinalSummary() {
    if (selectedLectureIds.size === 0) {
      toastMessage = "講義が選択されていません";
      return;
    }

    analyzingFinal = true;
    try {
      const idToken = await user.getIdToken();
      const selectedLectures = $lectures.filter((l) =>
        selectedLectureIds.has(l.id),
      );

      const response = await fetch("/api/summary", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${idToken}`,
        },
        body: JSON.stringify({
          lectures: selectedLectures.map((l) => ({
            title: l.title,
            summary:
              typeof l.analysis === "string" ? l.analysis : l.analysis?.summary,
            date: l.createdAt,
          })),
          instructions: customAnalysisInstructions,
        }),
      });

      if (!response.ok) throw new Error("Failed to generate summary");

      const data = await response.json();
      finalExamResult = data.summary;
    } catch (e) {
      console.error(e);
      toastMessage = "生成に失敗しました";
    } finally {
      analyzingFinal = false;
    }
  }

  // --- Interactive QA Logic ---
  async function askQuestion() {
    if (!qaInput.trim() || isAskingQuestion || !currentLectureId) return;

    qaHistory = [...qaHistory, { role: "user", content: qaInput }];
    const currentQuestion = qaInput;
    qaInput = "";
    isAskingQuestion = true;

    // Auto-scroll immediately after user asks
    await tick();
    const qaContainer = document.getElementById("qa-container");
    if (qaContainer) qaContainer.scrollTop = qaContainer.scrollHeight;

    try {
      const activeMode = selectedDerivativeMode || $analysisMode || "note";
      const currentData = lectureAnalyses[activeMode] || result;
      let contextText = "";

      if (
        typeof currentData === "object" &&
        currentData !== null &&
        currentData.summary
      ) {
        contextText = currentData.summary;
      } else if (typeof currentData === "string") {
        contextText = currentData;
      }

      const idToken = await user.getIdToken();
      const formData = new FormData();
      formData.append("documentText", contextText); // Context is the generated note
      formData.append("taskText", currentQuestion); // The specific question
      formData.append("isTaskAssist", "true"); // Trigger TA mode in API

      const response = await fetch("/api/analyze", {
        method: "POST",
        headers: { Authorization: `Bearer ${idToken}` },
        body: formData,
      });

      if (!response.ok) throw new Error("Failed to get answer");
      const data = await response.json();

      const answer =
        typeof data.result === "string"
          ? data.result
          : data.result.summary || "回答を生成できませんでした。";

      qaHistory = [...qaHistory, { role: "assistant", content: answer }];

      // Save QA history to Firestore seamlessly
      const ref = doc(db, `users/${user.uid}/lectures/${currentLectureId}`);
      await setDoc(
        ref,
        { qaHistory, updatedAt: serverTimestamp() },
        { merge: true },
      );
    } catch (e) {
      console.error(e);
      toastMessage = "エラーが発生しました";
      qaHistory = [
        ...qaHistory,
        { role: "assistant", content: "エラーが発生しました。" },
      ];
    } finally {
      isAskingQuestion = false;
      await tick();
      // Auto-scroll to bottom of QA after AI replies
      const qaContainer = document.getElementById("qa-container");
      if (qaContainer) {
        qaContainer.scrollTo({
          top: qaContainer.scrollHeight,
          behavior: "smooth",
        });
      }
    }
  }

  // --- Derived State for UI ---
  $: manuscriptPages = Math.ceil($targetLength / 400);

  $: isUltimate =
    String(userData?.plan || "")
      .trim()
      .toLowerCase() === "ultimate";
  $: isPremium =
    isUltimate ||
    String(userData?.plan || "")
      .trim()
      .toLowerCase() === "premium";
  $: isFree = !isPremium;

  $: dailyRemaining = (() => {
    if (isPremium) return Infinity;
    const today = new Date().toISOString().split("T")[0];
    const dailyUsage = userData?.dailyUsage || {
      count: 0,
      lastResetDate: today,
    };
    if (dailyUsage.lastResetDate !== today) return 3;
    return Math.max(0, 3 - dailyUsage.count);
  })();

  $: headerTitle =
    $analysisMode === "note"
      ? "講義ノート (復習用)"
      : $analysisMode === "thoughts"
        ? "感想・リアクション (提出用)"
        : "学術レポート (課題用)";

  $: containerBgColor =
    $analysisMode === "note"
      ? "bg-white/60"
      : $analysisMode === "thoughts"
        ? "bg-amber-50/60"
        : "bg-slate-50/60";

  // --- Lifecycle & Auth ---
  let wakeLock: WakeLockSentinel | null = null;

  // Wake Lock & Navigation Warning
  $: if (browser) {
    if (analyzing) {
      // 1. Prevent Navigation
      window.onbeforeunload = (e) => {
        e.preventDefault();
        e.returnValue = "解析処理を中断しますか？";
        return "解析処理を中断しますか？";
      };

      // 2. Request Wake Lock
      if ("wakeLock" in navigator && !wakeLock) {
        navigator.wakeLock
          .request("screen")
          .then((sentinel) => {
            wakeLock = sentinel;
          })
          .catch((err) => console.error("Wake Lock rejected:", err));
      }
    } else {
      // Cleanup
      window.onbeforeunload = null;
      if (wakeLock) {
        wakeLock.release().then(() => (wakeLock = null));
      }
    }
  }

  onMount(() => {
    const authUnsub = auth.onAuthStateChanged(async (currentUser) => {
      if (currentUser) {
        user = currentUser;

        unsubscribeUser = onSnapshot(doc(db, "users", user.uid), (docSnap) => {
          if (docSnap.exists()) {
            userData = docSnap.data();
            console.log(`👤 User Plan Updated: ${userData.plan || "free"}`);
          }
        });
      } else {
        goto("/login");
      }
    });

    // Handle Stripe Success Redirect
    const sessionId = $page.url.searchParams.get("session_id");
    if (sessionId) {
      toastMessage =
        "✨ アップグレードありがとうございます！全ての講義を資産に変えましょう。";
      setTimeout(() => (toastMessage = null), 6000);

      // Clean up the URL parameter
      const newUrl = new URL(window.location.href);
      newUrl.searchParams.delete("session_id");
      window.history.replaceState({}, "", newUrl);
    }

    // Handle Shared Lecture Path
    const path = $page.url.searchParams.get("path");
    if (path) {
      try {
        const docRef = doc(db, path);
        getDoc(docRef).then((snap) => {
          if (snap.exists()) {
            const data = snap.data();
            // Basic access check already enforced by security rules, but UI should be graceful
            loadLecture({ id: snap.id, path: snap.ref.path, ...data });
          } else {
            toastMessage = "ノートが見つからないか、アクセス権がありません";
            setTimeout(() => (toastMessage = null), 4000);
          }
        });
      } catch (e) {
        console.error("Error loading shared note", e);
      }
    }

    // Handle URL Lecture ID
    const urlId = $page.url.searchParams.get("lectureId");
    if (urlId && urlId !== currentLectureId) {
      loadLectureById(urlId);
    }

    // Global click listener to close move menus
    const handleGlobalClick = (e: MouseEvent) => {
      if (movingLectureId) {
        movingLectureId = null;
      }
    };
    window.addEventListener("click", handleGlobalClick);

    return () => {
      authUnsub();
      if (unsubscribeUser) unsubscribeUser();
      window.removeEventListener("click", handleGlobalClick);
    };
  });

  async function fetchContextualNotes(courseName: string) {
    if (!courseName || !user) return;

    isSearchingNotes = true;
    hasSearchedNotes = true;
    contextualSharedNotes = [];

    try {
      const q = normalizeCourseName(courseName);

      // Target shared lectures globally
      const lecturesQuery = query(
        collectionGroup(db, "lectures"),
        where("isShared", "==", true),
        limit(50), // Fetch a bit more to allow for client-side filtering
      );

      const snapshot = await getDocs(lecturesQuery);
      let results = snapshot.docs.map(
        (docSnap) =>
          ({
            id: docSnap.id,
            path: docSnap.ref.path,
            ...docSnap.data(),
          }) as any,
      );

      // Client-side Filter
      results = results.filter((l) => {
        const normCourse =
          l.normalizedCourseName || normalizeCourseName(l.courseName || "");
        return normCourse.includes(q);
      });

      // We only want others' notes, typically, but showing own shared notes is okay too
      // Take top 10 recent
      results.sort((a, b) => b.createdAt?.seconds - a.createdAt?.seconds);
      results = results.slice(0, 10);

      // Calculate access status (same rules applied in old search)
      const currentYear = new Date().getFullYear();
      const academicYearStart = new Date(
        currentYear - (new Date().getMonth() < 3 ? 1 : 0),
        3,
        1,
      );

      contextualSharedNotes = results.map((l) => {
        const createdAt =
          l.createdAt instanceof Timestamp
            ? l.createdAt.toDate()
            : new Date(l.createdAt);
        const isPastYear = createdAt < academicYearStart;
        let accessStatus = "granted";
        if (isPastYear && !isPremium) {
          accessStatus = "premium_locked";
        }
        // We assume if they clicked it from their enrolled list, they are enrolled.
        return { ...l, accessStatus, isPastYear };
      });
    } catch (e) {
      console.error("Error fetching contextual notes", e);
    } finally {
      isSearchingNotes = false;
    }
  }

  // ... (Keep existing onMount logic) ...

  // Global SpeechRecognition is managed in +layout via recognitionService

  // --- Timer & Progress ---
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
    }
  }

  function formatTime(seconds: number) {
    const m = Math.floor(seconds / 60)
      .toString()
      .padStart(2, "0");
    const s = (seconds % 60).toString().padStart(2, "0");
    return `${m}:${s}`;
  }

  function startProgress() {
    progressValue = 0;
    progressStatus = "AIが音声を文字に変換しています (残り約30秒)...";
    progressInterval = setInterval(() => {
      if (progressValue < 20) {
        progressValue += Math.random() * 2;
        progressStatus = "AIが音声を文字に変換しています (残り約30秒)...";
      } else if (progressValue < 50) {
        progressValue += Math.random() * 1.5;
        progressStatus = "講義の構造を分析中...";
      } else if (progressValue < 85) {
        progressValue += Math.random() * 1;
        progressStatus = "ノートをまとめています...";
      } else if (progressValue < 95) {
        progressValue += 0.5;
        progressStatus = "仕上げ中...";
      }
    }, 300);
  }

  async function stopProgress() {
    clearInterval(progressInterval);
    progressValue = 100;
    progressStatus = "完了";
    await new Promise((r) => setTimeout(r, 500));
  }

  async function handleAnalyze() {
    if (analyzing || isExtractingAudio) return;

    if (!$lectureTitle.trim()) {
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
      !$transcript &&
      $stagedImages.length === 0 &&
      !$taskText.trim()
    ) {
      toastMessage = "学習素材を入力してください";
      return;
    }

    // Guard: Prevent empty recording (less than 1s)
    if ($transcript.trim() && duration === 0) {
      toastMessage = "録音時間が短すぎます";
      return;
    }

    // Quota Checks
    const usageCount = userData?.usageCount || 0;

    // Free plan: MAX 1 total generate per day
    const today = new Date().toISOString().split("T")[0];
    const dailyCount = userData?.dailyUsageCount || 0; // Read from DB, assuming sync or fallback

    if (!isPremium && usageCount >= 1) {
      // Adjusted from 5 to 1 for Free Plan
      showUpgradeModal = true;
      upgradeModalTitle = "無料プランの解析上限";
      upgradeModalMessage =
        "Freeプランでのノート解析は「1日1回」までとなります。プレミアムプランなら無制限にご利用いただけます。";
      toastMessage = "無料枠(1回)を使い切りました";
      return;
    }

    // Premium plan MEDIA limits: MAX 3 media analyses per day
    if (isPremium && !isUltimate && ($videoFile || $audioFile)) {
      const mediaUsageCount = userData?.mediaUsageCount || 0;
      if (mediaUsageCount >= 3) {
        showUpgradeModal = true;
        upgradeModalTitle = "メディア解析上限";
        upgradeModalMessage =
          "プレミアムプランのメディア解析は「1日3回」までとなります。アルティメットプランなら完全無制限にご利用いただけます。";
        toastMessage = "本日のメディア解析上限(3回)に達しました";
        return;
      }
    }

    if (($videoFile || $audioFile) && !isPremium) {
      showUpgradeModal = true;
      toastMessage = "メディア解析はプレミアムプラン以上の機能です";
      return;
    }

    analyzing = true;
    startProgress();
    toastMessage = null;

    try {
      const idToken = await user.getIdToken();

      let audioUrl = "";
      let videoUrl = "";
      let pdfUrl = "";
      let imageUrl = "";

      cancellationController = new AbortController();
      const signal = cancellationController.signal;

      // Uploads (using our update uploadToStorage)
      if ($audioFile) audioUrl = await uploadToStorage($audioFile);
      if ($videoFile) videoUrl = await uploadToStorage($videoFile);
      if ($pdfFile) pdfUrl = await uploadToStorage($pdfFile);
      if ($imageFile) imageUrl = await uploadToStorage($imageFile);

      // Upload Staged Images
      let stagedImageUrls: string[] = [];
      if ($stagedImages && $stagedImages.length > 0) {
        toastMessage = "画像をアップロード中...";
        for (const img of $stagedImages) {
          const sUrl = await uploadToStorage(img);
          stagedImageUrls.push(sUrl);
        }
      }

      const formData = new FormData();
      if (audioUrl) formData.append("audioUrl", audioUrl);
      if (videoUrl) formData.append("videoUrl", videoUrl);
      if (pdfUrl) formData.append("pdfUrl", pdfUrl);
      if (imageUrl) formData.append("imageUrl", imageUrl);

      // Append each staged image URL using the same key
      stagedImageUrls.forEach((url) => {
        formData.append("imageUrl", url);
      });

      // Explicitly separate text inputs for the prompt
      let documentText = "";
      if ($txtFile) {
        documentText = await $txtFile.text();
      }

      formData.append("documentText", documentText);
      formData.append("audioText", $transcript);
      formData.append("url", $targetUrl || "");
      formData.append("mode", $analysisMode);
      formData.append("plan", userData?.plan || "free");
      formData.append(
        "recordingInstructions",
        recordingMode === "lecture"
          ? "講義室の反響を考慮して解析してください。スピーカー越しの音声で一部聞き取りにくいですが、講義の文脈から最適に補完してください"
          : "近距離の対話を正確に書き起こしてください",
      );

      const res = await fetch("/api/analyze", {
        method: "POST",
        body: formData,
        headers: { Authorization: `Bearer ${idToken}` },
        signal,
      });

      if (!res.ok) throw new Error("Analysis failed");
      const data = await res.json();

      // Save Logic
      const generatedSubtitle =
        data.result?.subtitle || data.result?.title || "要約";
      const combinedTitle = `${$lectureTitle} : ${generatedSubtitle}`;

      // 1. Find the selected course ID from enrolledCoursesList
      const selectedCourse = Object.values(enrolledCoursesList || {}).find(
        (c: any) => c.courseName === $lectureTitle,
      ) as any;
      const selectedCourseId = selectedCourse ? selectedCourse.id : null;

      const lectureData = {
        title: combinedTitle,
        lectureTitle: combinedTitle,
        courseName: $lectureTitle || "未分類", // Update to handle empty as "未分類"
        courseId: selectedCourseId, // Add the binder ID
        content: $transcript,
        analysis: data.result,
        analyses: { [$analysisMode]: data.result },
        isShared: $isShared ?? true,
        createdAt: serverTimestamp(),
        subjectId: selectedSubjectId || null,
        uid: user.uid,
        authorName:
          userData?.nickname ||
          user.displayName ||
          user.email?.split("@")[0] ||
          "匿名ユーザー",
        sourceType: $videoFile
          ? "video"
          : $audioFile
            ? "audio"
            : $targetUrl
              ? "url"
              : "text",
      };

      const docRef = await addDoc(
        collection(db, `users/${user.uid}/lectures`),
        lectureData,
      );

      toastMessage = "解析完了！";
      await stopProgress();
      analyzing = false;
      resetSession();

      // Navigate to the new lecture
      // We are already on the page, just load it
      loadLecture({ id: docRef.id, ...lectureData });

      await tick();
      if (resultContainer) {
        resultContainer.scrollIntoView({ behavior: "smooth", block: "start" });
      }
    } catch (e: any) {
      console.error(e);
      toastMessage = "エラー: " + e.message;
      analyzing = false;
      stopProgress();
    }
  }

  // --- Functions ---

  // --- File Handlers ---
  let isExtractingAudio = false;
  let extractionProgress: AudioExtractionProgress | null = null;

  async function uploadToStorage(file: File): Promise<string> {
    const originalName = file.name || "file";
    const filename = `${Date.now()}_${originalName}`;
    if (!$userStore) throw new Error("User not authenticated");
    const storageRef = ref(storage, `uploads/${$userStore.uid}/${filename}`);

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
        cancellationController?.signal.addEventListener("abort", abortHandler);

        uploadTask.on(
          "state_changed",
          (snapshot) => {
            // Optional: Update progress
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
            const url = await getDownloadURL(uploadTask.snapshot.ref);
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
      setTimeout(() => (toastMessage = null), 3000);
    } catch (e: any) {
      console.error(e);
      toastMessage = "音声抽出失敗: " + e.message;
    } finally {
      isExtractingAudio = false;
      extractionProgress = null;
    }
  }

  function handleFileChange(e: Event, type: string) {
    const input = e.target as HTMLInputElement;
    if (input.files && input.files.length > 0) {
      if (type === "pdf") pdfFile.set(input.files[0]);
      if (type === "txt") txtFile.set(input.files[0]);
      if (type === "audio") audioFile.set(input.files[0]);
      if (type === "video") {
        // Changed mapping for the integrated MEDIA button
        videoFile.set(input.files[0]);
        extractAudio(input.files[0]);
      }
      if (type === "single_image") {
        imageFile.set(input.files[0]);
      }
      if (type === "staged_image") {
        // Append to existing staged images
        const newFiles = Array.from(input.files);
        stagedImages.update((current) => [...current, ...newFiles]);
      }
    }
  }

  async function deleteFromStorage(downloadUrl: string) {
    if (!downloadUrl) return;
    try {
      const fileRef = ref(storage, downloadUrl);
      await deleteObject(fileRef);
      console.log(`Deleted from storage: ${downloadUrl}`);
    } catch (e) {
      console.error("Error deleting from storage:", e);
      // Don't alert user as this is a background cleanup task
    }
  }

  function setAnalysisMode(newMode: "note" | "thoughts" | "report") {
    if ((newMode === "thoughts" || newMode === "report") && !isPremium) {
      showUpgradeModal = true;
      return;
    }
    $analysisMode = newMode;
  }

  function handleLengthChange(e: Event) {
    const val = parseInt((e.target as HTMLInputElement).value);

    // Plan Enforcement
    if (!isPremium && val > 500) {
      showUpgradeModal = true;
      upgradeModalTitle = "プレミアムプラン限定";
      upgradeModalMessage =
        "フリープランの解析上限は500文字です。<br />プレミアムプランなら2000文字、アルティメットプランなら4000文字まで拡張されます。";
      toastMessage = "フリープランは500文字までです";
      setTimeout(() => (toastMessage = null), 3000);
      $targetLength = 500; // Force back
      return;
    }

    if (!isUltimate && val > 2000) {
      showUpgradeModal = true;
      upgradeModalTitle = "アルティメットプラン限定";
      upgradeModalMessage =
        "アルティメットプランなら、最大4000文字（原稿用紙10枚分）の超ロング解析が可能です。";
      toastMessage = "2000文字以上はアルティメット限定です";
      setTimeout(() => (toastMessage = null), 3000);
      $targetLength = 2000; // Force back
      return;
    }
  }

  function toggleRecording() {
    streamingService.toggle(recordingMode);
  }

  function handleCancelAnalysis() {
    if (cancellationController) {
      cancellationController.abort();
      cancellationController = null;
      analyzing = false;
      result = "";
      toastMessage = "解析を中断しました";
      setTimeout(() => (toastMessage = null), 3000);
    }
  }

  // --- Shared Note Gallery Logic ---
  function startNewNoteFromGallery() {
    $lectureTitle = galleryCourseName;
    viewMode = "create";
  }

  function closeGallery() {
    viewMode = "create";
    galleryCourseName = "";
  }

  // --- Simplified Dashboard Logic ---
  // Most complex analysis logic has moved to GlobalRecordingOverlay.

  // Handle URL Lecture ID
  onMount(() => {
    const urlId = $page.url.searchParams.get("lectureId");
    if (urlId && urlId !== currentLectureId) {
      // Load lecture logic (reused from existing or implemented here)
      // We might need to fetch the lecture doc.
      loadLectureById(urlId);
    }
  });

  function loadSharedNote(note: any) {
    loadLecture(note);
  }

  async function loadLecture(lecture: any) {
    if ($isRecording) recognitionService.stop();

    currentLectureId = lecture.id;
    // Don't auto-deselect subject, keep context

    // Safely unbox lecture.title if it happened to be pushed as an object
    const rawTitle = lecture.title;
    $lectureTitle =
      typeof rawTitle === "string"
        ? rawTitle
        : rawTitle?.title || "無題のノート";

    // Update global transcript store when loading a lecture
    resetSession();
    transcript.set(lecture.content || "");

    // Restore settings with defaults
    const modeMap: Record<string, "note" | "thoughts" | "report"> = {
      summary: "note",
      analysis: "report",
      note: "note",
      thoughts: "thoughts",
      report: "report",
    };
    $analysisMode = modeMap[lecture.analysisMode] || "note";
    $targetLength = lecture.targetLength || 1000;

    result = lecture.analysis || "";
    lectureAnalyses =
      lecture.analyses || (result ? { [$analysisMode]: result } : {});
    initialGenerationDone = !!result;

    // Restore Interactive QA state
    qaHistory = lecture.qaHistory || [];
    qaInput = "";
    isAskingQuestion = false;

    isEditing = false; // Switch to View Mode

    // Set preview video if available
    previewVideoUrl = lecture.downloadUrl || lecture.sourceUrl || null; // Simplified assumption

    localStorage.setItem("transcript", $transcript);

    // Auto-scroll to top of main content area
    await tick();
    const mainArea = document.querySelector("main");
    if (mainArea) {
      mainArea.scrollIntoView({ behavior: "smooth", block: "start" });
    }
  }

  function handleSelectSubject(subjectId: string | null) {
    if ($isRecording) streamingService.stop();
    currentBinder.set(subjectId);
    currentLectureId = null; // Clear lecture selection

    // Show Dashboard
    isEditing = false;

    // Reset editor state
    $lectureTitle = "";
    resetSession();
    result = "";
    // Removed file inputs state clearing as they are gone

    localStorage.removeItem("transcript");
  }

  function handleTranscriptReset() {
    if (!$transcript) return;
    showTranscriptResetModal = true;
  }

  async function confirmTranscriptReset() {
    // Reset UI state
    transcript.set("");

    // Reset database if we are viewing a saved lecture
    if (currentLectureId && user) {
      try {
        const ref = doc(db, `users/${user.uid}/lectures/${currentLectureId}`);
        await updateDoc(ref, {
          content: "",
          updatedAt: serverTimestamp(),
        });
        toastMessage = "文字起こしをリセットしました";
      } catch (e) {
        console.error("Error resetting transcript:", e);
        toastMessage = "リセットに失敗しました";
      } finally {
        setTimeout(() => (toastMessage = null), 3000);
      }
    } else {
      toastMessage = "文字起こしをクリアしました";
      setTimeout(() => (toastMessage = null), 3000);
    }
    showTranscriptResetModal = false;
  }

  // --- Simplified Dashboard Logic ---

  async function loadLectureById(id: string) {
    if (!user) return;
    const ref = doc(db, `users/${user.uid}/lectures/${id}`);
    const snap = await getDoc(ref);
    if (snap.exists()) {
      loadLecture({ id: snap.id, ...snap.data() });
    }
  }

  function startNewLecture() {
    resetSession();
    // Ensure we stay in dashboard mode
    isEditing = false;
    currentLectureId = null;
    currentBinder.set(null);
    contextualSharedNotes = [];
    hasSearchedNotes = false;
    qaHistory = [];
    qaInput = "";
    isAskingQuestion = false;
  }

  /**
   * Complete Reset & Force Home Navigation
   */
  function handleLogoClick() {
    startNewLecture();
    goto("/", { invalidateAll: true });
  }

  /**
   * REUSABLE MOVEMENT LOGIC
   */
  async function moveLecture(
    lectureId: string,
    targetSubjectId: string | null,
  ) {
    const lecture = $lectures.find((l: any) => l.id === lectureId);
    if (!lecture) return;

    // If target is "unassigned" (null), handle it
    const finalTargetSubjectId =
      targetSubjectId === "unassigned" ? null : targetSubjectId;

    if (lecture.subjectId === finalTargetSubjectId) return;

    try {
      const oldPath = lecture.path;
      const newPath = finalTargetSubjectId
        ? `users/${user.uid}/subjects/${finalTargetSubjectId}/lectures/${lectureId}`
        : `users/${user.uid}/lectures/${lectureId}`;

      // 1. Get current data
      const sourceRef = doc(db, oldPath);
      const sourceSnap = await getDoc(sourceRef);
      if (!sourceSnap.exists()) return;

      const data = sourceSnap.data();

      // 2. Set in new location
      const targetRef = doc(db, newPath);
      await setDoc(targetRef, {
        ...data,
        subjectId: finalTargetSubjectId,
        categoryTag: finalTargetSubjectId ? null : data.categoryTag || null,
        updatedAt: serverTimestamp(),
      });

      // 3. Delete from old location
      await deleteDoc(sourceRef);

      toastMessage = finalTargetSubjectId
        ? "科目に移動しました"
        : "インボックスに移動しました";
      setTimeout(() => (toastMessage = null), 2000);

      // Reset proposal if this was the proposed lecture
      if (analysisProposal?.lectureId === lectureId) {
        analysisProposal = null;
      }
    } catch (e) {
      console.error("Error moving lecture", e);
      alert("移動に失敗しました");
    }
  }

  async function bulkMoveLectures(targetSubjectId: string | null) {
    if (selectedLectureIds.size === 0) return;

    const promises = Array.from(selectedLectureIds).map((id) =>
      moveLecture(id, targetSubjectId),
    );

    await Promise.all(promises);
    selectedLectureIds.clear(); // svelte 5 set clear triggers reactivity? yes if using Svelte Set... wait, it's native Set.
    // If it's a native Set in a rune, we need to reassign or mutate.
    // $state(new Set()) -> mutation works if we use Svelte 5 Set? No, Svelte 5 proxies Set.
    // simpler: selectedLectureIds = new Set();
    selectedLectureIds = new Set();

    toastMessage = "一括移動しました";
    setTimeout(() => (toastMessage = null), 2000);
  }

  function toggleLectureSelection(id: string) {
    if (selectedLectureIds.has(id)) {
      selectedLectureIds.delete(id);
    } else {
      selectedLectureIds.add(id);
    }
    selectedLectureIds = new Set(selectedLectureIds); // Trigger reactivity
  }

  function handleTimestampClick(e: MouseEvent) {
    const target = e.target as HTMLElement;
    if (target.classList.contains("timestamp-link")) {
      const timestamp = target.dataset.timestamp;
      if (timestamp && videoPlayer) {
        const parts = timestamp.split(":").map(Number);
        const seconds =
          parts.length === 2
            ? parts[0] * 60 + parts[1]
            : parts[0] * 3600 + parts[1] * 60 + parts[2];
        videoPlayer.currentTime = seconds;
        videoPlayer.play();
      }
    }
  }

  $: parsedHtml = result
    ? typeof result === "object"
      ? marked.parse(result.summary)
      : marked.parse(result)
    : "";

  function handleDragStartToSidebar(e: DragEvent, lectureId: string) {
    if (e.dataTransfer) {
      e.dataTransfer.setData("text/plain", lectureId);
      e.dataTransfer.effectAllowed = "move";
      draggingLectureId = lectureId;
    }
  }

  function handleDragEnd() {
    draggingLectureId = null;
  }

  function handleMainTargetDragOver(e: DragEvent) {
    e.preventDefault();
    isDragOverMainTarget = true;
  }

  function handleMainTargetDragLeave() {
    isDragOverMainTarget = false;
  }

  async function handleMainTargetDrop(e: DragEvent) {
    e.preventDefault();
    isDragOverMainTarget = false;
    const lectureId = e.dataTransfer?.getData("text/plain");
    if (!lectureId || !selectedSubjectId) return;

    await moveLecture(lectureId, selectedSubjectId);
  }
  function handleUpgradeRequest(label: string) {
    showUpgradeModal = true;
    upgradeModalTitle = "プレミアムプラン限定";
    upgradeModalMessage =
      label === "MEDIA"
        ? "動画や音声の解析はプレミアムプラン以上の機能です。"
        : label === "📝 課題・問題"
          ? "課題アシスト機能はプレミアムプラン以上の機能です。"
          : "この機能はプレミアムプラン限定です。";
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
      <div class="w-2 h-2 rounded-full bg-indigo-500 animate-pulse"></div>
      <span class="text-sm font-bold">{toastMessage}</span>
    </div>
  </div>
{/if}

<!-- Smart Move Proposal Banner -->
{#if analysisProposal}
  <div
    class="fixed top-20 left-1/2 -translate-x-1/2 z-[60] animate-in slide-in-from-top-4 duration-500"
  >
    <div
      class="bg-indigo-600 text-white px-6 py-4 rounded-3xl shadow-2xl flex items-center gap-6 border border-white/20 backdrop-blur-md"
    >
      <div class="flex items-center gap-3">
        <span class="text-2xl">✨</span>
        <div>
          <p class="text-xs font-medium opacity-80">AIによる自動分類</p>
          <p class="text-sm font-bold">
            この講義を「{analysisProposal.subjectName}」に移動しますか？
          </p>
        </div>
      </div>
      <div class="flex items-center gap-2 border-l border-white/20 pl-4">
        <button
          on:click={() => {
            if (analysisProposal) {
              moveLecture(
                analysisProposal.lectureId,
                analysisProposal.subjectId,
              );
              analysisProposal = null;
            }
          }}
          class="bg-white text-indigo-600 px-4 py-2 rounded-xl text-xs font-bold hover:bg-indigo-50 transition-colors"
        >
          移動する
        </button>
        <button
          on:click={() => (analysisProposal = null)}
          class="text-white/60 hover:text-white px-3 py-2 text-xs font-medium transition-colors"
        >
          あとで
        </button>
      </div>
    </div>
  </div>
{/if}

<!-- Selection Action Bar -->
{#if selectedLectureIds.size > 0}
  <div
    class="fixed bottom-24 left-1/2 -translate-x-1/2 z-[60] animate-in slide-in-from-bottom-10 duration-300"
  >
    <div
      class="bg-slate-900 border border-slate-800 text-white px-6 py-4 rounded-3xl shadow-2xl flex items-center gap-8"
    >
      <div class="flex items-center gap-3">
        <div
          class="bg-indigo-500 text-white w-8 h-8 rounded-full flex items-center justify-center font-bold text-sm"
        >
          {selectedLectureIds.size}
        </div>
        <p class="text-sm font-medium">個を選択中</p>
      </div>

      <div class="flex items-center gap-2 border-l border-slate-700 pl-6">
        <div class="relative group">
          <button
            class="bg-slate-800 hover:bg-slate-700 text-white px-5 py-2.5 rounded-2xl text-xs font-bold transition-all flex items-center gap-2"
          >
            <span>フォルダへ移動</span>
            <svg
              class="w-4 h-4 opacity-50"
              fill="none"
              viewBox="0 0 24 24"
              stroke="currentColor"
            >
              <path
                stroke-linecap="round"
                stroke-linejoin="round"
                stroke-width="2"
                d="M19 9l-7 7-7-7"
              />
            </svg>
          </button>

          <!-- Quick Move Dropdown -->
          <div
            class="absolute bottom-full left-0 mb-3 w-56 bg-white rounded-2xl shadow-2xl border border-slate-100 py-2 opacity-0 invisible group-hover:opacity-100 group-hover:visible transition-all"
          >
            <div
              class="px-4 py-2 text-[10px] font-bold text-slate-400 uppercase tracking-wider"
            >
              移動先を選択
            </div>
            {#each $subjects as subject (subject.id)}
              <button
                on:click={() => bulkMoveLectures(subject.id)}
                class="w-full text-left px-4 py-2.5 hover:bg-indigo-50 flex items-center gap-3 transition-colors"
              >
                <div class="w-2.5 h-2.5 rounded-full {subject.color}"></div>
                <span class="text-xs text-slate-700 font-medium"
                  >{subject.name}</span
                >
              </button>
            {/each}
            <div class="h-px bg-slate-100 my-1"></div>
            <button
              on:click={() => bulkMoveLectures(null)}
              class="w-full text-left px-4 py-2.5 hover:bg-red-50 text-red-600 flex items-center gap-3 transition-colors"
            >
              <span class="text-xs font-medium">インボックスに戻す</span>
            </button>
          </div>
        </div>

        <button
          on:click={() => {
            selectedLectureIds = new Set();
          }}
          class="text-slate-400 hover:text-white px-4 py-2.5 text-xs font-medium transition-colors"
        >
          選択解除
        </button>
      </div>
    </div>
  </div>
{/if}

<div
  class="flex h-screen overflow-hidden bg-[#F9FAFB] text-slate-800 font-sans selection:bg-indigo-100 selection:text-indigo-700 relative"
>
  {#if user}
    <UpgradeModal
      isOpen={showUpgradeModal || showUltimateModal}
      onClose={() => {
        showUpgradeModal = false;
        showUltimateModal = false;
      }}
      title={upgradeModalTitle}
      message={upgradeModalMessage}
      billingCycle="monthly"
    />
    <EnrollModal
      isOpen={$isEnrollModalOpen}
      onClose={() => ($isEnrollModalOpen = false)}
    />
  {/if}

  <!-- Custom Transcript Reset Modal -->
  <TranscriptResetModal
    isOpen={showTranscriptResetModal}
    onClose={() => (showTranscriptResetModal = false)}
    onConfirm={confirmTranscriptReset}
  />

  <!-- Main Content -->
  <div
    class="flex-1 relative overflow-x-hidden overflow-y-auto h-full bg-[linear-gradient(to_right,#8080800a_1px,transparent_1px),linear-gradient(to_bottom,#8080800a_1px,transparent_1px)] bg-[size:20px_20px] pt-16 lg:pt-0"
  >
    <main
      class="w-full py-8 lg:py-12 px-4 lg:px-16 pb-32 animate-in fade-in duration-700 slide-in-from-bottom-4"
    >
      {#if currentLectureId && !isEditing}
        <!-- Viewing Result Mode -->
        <div class="mb-10">
          <button
            on:click={() => {
              currentLectureId = null;
              isEditing = false; // Show dashboard
            }}
            class="mb-8 text-sm font-bold text-slate-400 hover:text-indigo-600 flex items-center gap-2 transition-colors"
          >
            ← 履歴リストへ戻る
          </button>

          <div class="mb-10">
            <h1 class="text-4xl font-bold text-slate-900 tracking-tight mb-2">
              {$lectureTitle}
            </h1>
            <div
              class="h-1.5 w-24 bg-gradient-to-r from-indigo-600 to-pink-400 mt-4 rounded-full opacity-90"
            ></div>
          </div>

          <ResultView
            {lectureAnalyses}
            {result}
            {derivativeAnalyzing}
            {isResultCopied}
            {previewVideoUrl}
            {currentLectureId}
            {analyzedTitle}
            {strategyContent}
            {displaySummary}
            {isPremium}
            {isUltimate}
            {selectedDerivativeMode}
            {derivativeTargetLength}
            on:copy={copyResultToClipboard}
            on:edit={() => (isEditing = true)}
            on:select_derivative={(
              e: CustomEvent<"note" | "thoughts" | "report">,
            ) => (selectedDerivativeMode = e.detail)}
            on:length_change={(e: CustomEvent<string | number>) =>
              (derivativeTargetLength = Number(e.detail))}
            on:generate={(e: CustomEvent<"note" | "thoughts" | "report">) =>
              handleDerivativeGenerate(e.detail)}
            on:upgrade_request={() => (showUpgradeModal = true)}
          />

          <!-- Interactive QA History Section (Input is now in sticky toolbar) -->
          <div
            class="mt-12 bg-white rounded-3xl p-6 lg:p-8 shadow-sm border border-slate-200"
          >
            <h3
              class="text-xl font-bold text-slate-800 mb-6 flex items-center gap-2"
            >
              <span class="text-2xl">💬</span> AIアシスタントとの対話履歴
            </h3>

            <div
              id="qa-container"
              class="space-y-6 max-h-[500px] overflow-y-auto custom-scrollbar pr-2"
            >
              {#if qaHistory.length === 0}
                <div class="text-center py-8 text-slate-400">
                  <p class="text-sm">
                    上部のツールバーから質問や課題を入力すると、ここに回答が表示されます。
                  </p>
                </div>
              {:else}
                {#each qaHistory as msg}
                  <div
                    class="flex flex-col {msg.role === 'user'
                      ? 'items-end'
                      : 'items-start'}"
                  >
                    <div
                      class="max-w-[85%] rounded-2xl p-4 {msg.role === 'user'
                        ? 'bg-indigo-600 text-white rounded-br-none'
                        : 'bg-slate-50 border border-slate-100 text-slate-700 rounded-bl-none'}"
                    >
                      <div
                        class="prose prose-sm {msg.role === 'user'
                          ? 'prose-invert'
                          : 'prose-slate'} max-w-none"
                      >
                        {@html marked.parse(msg.content)}
                      </div>
                    </div>
                  </div>
                {/each}
              {/if}

              {#if isAskingQuestion}
                <div class="flex flex-col items-start">
                  <div
                    class="max-w-[85%] rounded-2xl p-4 bg-slate-50 border border-slate-100 text-slate-700 rounded-bl-none flex items-center gap-3"
                  >
                    <div
                      class="w-2 h-2 rounded-full bg-slate-400 animate-bounce"
                    ></div>
                    <div
                      class="w-2 h-2 rounded-full bg-slate-400 animate-bounce"
                      style="animation-delay: 0.1s"
                    ></div>
                    <div
                      class="w-2 h-2 rounded-full bg-slate-400 animate-bounce"
                      style="animation-delay: 0.2s"
                    ></div>
                  </div>
                </div>
              {/if}
            </div>

            <!-- Bottom Row: Slim QA Input (Moved from ResultView) -->
            <div
              class="relative flex items-center gap-2 mt-6 pt-6 border-t border-slate-100"
            >
              <div
                class="absolute inset-y-0 left-0 pl-3 flex items-center pointer-events-none mt-6"
              >
                <span class="text-lg">💬</span>
              </div>
              <input
                type="text"
                bind:value={qaInput}
                disabled={isAskingQuestion}
                placeholder="TAに質問・課題を投げる..."
                on:keydown={(e) => {
                  if (e.key === "Enter") {
                    e.preventDefault();
                    askQuestion();
                  }
                }}
                class="w-full bg-slate-50 border border-slate-200 rounded-xl py-3 pl-10 pr-12 text-sm text-slate-700 placeholder:text-slate-400 focus:outline-none focus:ring-2 focus:ring-indigo-500/20 focus:bg-white transition-all disabled:opacity-50"
              />
              <button
                on:click={askQuestion}
                disabled={!qaInput.trim() || isAskingQuestion}
                aria-label="質問を送信"
                class="absolute right-1.5 top-[calc(50%+12px)] -translate-y-1/2 w-9 h-9 rounded-lg bg-indigo-600 text-white flex items-center justify-center hover:bg-indigo-700 transition-colors disabled:opacity-50 disabled:cursor-not-allowed shadow-sm"
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
                    d="M12 19l9 2-9-18-9 18 9-2zm0 0v-8"
                  />
                </svg>
              </button>
            </div>
          </div>
        </div>
      {:else if selectedSubjectId && !isEditing}
        {@const subject = $subjects.find((s) => s.id === selectedSubjectId)}
        {#if subject}
          <!-- Subject Dashboard -->
          <div class="mb-10">
            <div class="flex items-center gap-4 mb-4">
              <div class="w-8 h-8 rounded-full {subject.color} shadow-sm"></div>
              <h1 class="text-4xl font-bold text-slate-900 tracking-tight">
                {subject.name}
              </h1>
            </div>
            <p class="text-slate-500">
              {$lectures.filter((l: any) => l.subjectId === selectedSubjectId)
                .length}
              講義がこの科目にあります
            </p>

            <!-- Tab Switcher -->
            <div class="mt-8 flex gap-2 border-b border-slate-200">
              <button
                on:click={() => {
                  finalExamView = false;
                }}
                class="px-6 py-3 font-bold transition-all relative {!finalExamView
                  ? 'text-indigo-600 border-b-2 border-indigo-600'
                  : 'text-slate-400 hover:text-slate-600'}"
              >
                📚 講義一覧
              </button>
              <button
                on:click={() => {
                  finalExamView = true;
                }}
                class="px-6 py-3 font-bold transition-all relative flex items-center gap-2 {finalExamView
                  ? 'text-indigo-600 border-b-2 border-indigo-600'
                  : 'text-slate-400 hover:text-slate-600'}"
              >
                🔥 期末試験対策
                {#if analyzingFinal}
                  <svg
                    class="animate-spin h-4 w-4"
                    xmlns="http://www.w3.org/2000/svg"
                    fill="none"
                    viewBox="0 0 24 24"
                  >
                    <circle
                      class="opacity-25"
                      cx="12"
                      cy="12"
                      r="10"
                      stroke="currentColor"
                      stroke-width="4"
                    ></circle>
                    <path
                      class="opacity-75"
                      fill="currentColor"
                      d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"
                    ></path>
                  </svg>
                {/if}
              </button>
            </div>

            {#if finalExamView}
              <!-- Final Exam Summary Section -->
              <div class="mt-8 animate-in fade-in slide-in-from-bottom-4">
                <!-- Regenerate Section -->
                <div
                  class="bg-gradient-to-br from-indigo-50 to-blue-50 rounded-3xl p-6 mb-8 border border-indigo-100"
                >
                  <div class="flex items-start justify-between gap-6">
                    <div class="flex-1">
                      <h3 class="text-lg font-bold text-slate-900 mb-2">
                        🎓 試験対策ノート生成
                      </h3>
                      <p class="text-sm text-slate-600 mb-4">
                        各講義の要約を統合して、最短で試験準備が完了できる対策ノートを生成します。
                      </p>

                      <!-- Custom Instructions -->
                      <div class="mb-4">
                        <label
                          for="final-exam-instructions"
                          class="block text-xs font-bold text-slate-500 uppercase tracking-widest mb-2"
                          >AIへの追加指示（オプション）</label
                        >
                        <textarea
                          id="final-exam-instructions"
                          bind:value={customAnalysisInstructions}
                          placeholder="例：○○的な視点を重視して、××の用語を多めに..."
                          class="w-full bg-white border border-slate-200 rounded-xl p-3 text-sm text-slate-900 placeholder:text-slate-400 focus:outline-none focus:ring-2 focus:ring-indigo-500/50 transition-all resize-none"
                          rows="2"
                        ></textarea>
                      </div>

                      <button
                        on:click={(e) => {
                          if (!isUltimate) {
                            e.preventDefault();
                            upgradeModalTitle = "アルティメットプラン限定機能";
                            upgradeModalMessage =
                              "「試験対策ノート生成」機能はアルティメットプラン専用です。複数の講義をまたいだ高度な要約を作成するには、アップグレードを行ってください。";
                            showUltimateModal = true;
                            return;
                          }
                          generateFinalSummary();
                        }}
                        disabled={analyzingFinal}
                        class="bg-indigo-600 text-white px-6 py-3 rounded-xl font-bold hover:bg-indigo-700 transition-colors shadow-lg disabled:opacity-50 disabled:cursor-not-allowed flex items-center gap-2"
                      >
                        {#if analyzingFinal}
                          <svg
                            class="animate-spin h-5 w-5 text-white"
                            xmlns="http://www.w3.org/2000/svg"
                            fill="none"
                            viewBox="0 0 24 24"
                          >
                            <circle
                              class="opacity-25"
                              cx="12"
                              cy="12"
                              r="10"
                              stroke="currentColor"
                              stroke-width="4"
                            ></circle>
                            <path
                              class="opacity-75"
                              fill="currentColor"
                              d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"
                            ></path>
                          </svg>
                          AIが対策ノートを編集中...
                        {:else}
                          {finalExamResult
                            ? "🔄 再生成する"
                            : "✨ 対策ノートを生成する"}
                        {/if}
                      </button>

                      {#if dailyRemaining !== Infinity}
                        <div class="mt-4 flex items-center gap-2">
                          <span
                            class="text-[10px] font-bold px-2 py-0.5 rounded-full {dailyRemaining >
                            0
                              ? 'bg-indigo-100 text-indigo-600'
                              : 'bg-rose-100 text-rose-600'}"
                          >
                            本日あと {dailyRemaining} 回
                          </span>
                          <span class="text-[10px] text-slate-400">
                            （無料枠 上限 3回/日）
                          </span>
                        </div>
                      {/if}
                    </div>
                  </div>
                </div>

                <!-- Final Exam Result Display -->
                {#if finalExamResult}
                  <div class="flex justify-end mb-3 mt-4">
                    <button
                      on:click={copyToClipboard}
                      class="flex items-center gap-2 px-4 py-2 rounded-xl {isCopied
                        ? 'bg-emerald-600 text-white'
                        : 'bg-slate-800 text-white hover:bg-slate-700'} transition-all shadow-md active:scale-95 font-bold"
                    >
                      {#if isCopied}
                        ✅ コピーしました！
                      {:else}
                        📋 対策ノートをコピー
                      {/if}
                    </button>
                  </div>

                  <div
                    class="bg-white rounded-3xl p-8 border border-slate-200 shadow-sm"
                  >
                    <div
                      bind:this={finalResultContainer}
                      class="prose prose-slate prose-headings:text-slate-900 prose-headings:font-bold prose-p:text-slate-700 prose-li:text-slate-700 prose-strong:text-slate-900 max-w-none"
                    >
                      {@html marked.parse(finalExamResult)}
                    </div>
                  </div>
                {:else if !analyzingFinal}
                  <div
                    class="text-center py-12 text-slate-400 border-2 border-dashed border-slate-200 rounded-3xl"
                  >
                    <p class="text-lg font-bold mb-2">
                      試験対策ノートがまだ生成されていません
                    </p>
                    <p class="text-sm">
                      上のボタンをクリックして生成してください
                    </p>
                  </div>
                {/if}
              </div>
            {:else}
              <!-- Ultimate contextual Shared Notes Section -->
              <div class="mt-8 mb-6">
                <div class="flex items-center justify-between mb-4">
                  <h3
                    class="flex items-center gap-2 text-sm font-bold text-slate-700"
                  >
                    <span class="text-lg">🔍</span> この講義の共有ノート
                    {#if isSearchingNotes}
                      <svg
                        class="animate-spin h-4 w-4 text-indigo-500"
                        xmlns="http://www.w3.org/2000/svg"
                        fill="none"
                        viewBox="0 0 24 24"
                      >
                        <circle
                          class="opacity-25"
                          cx="12"
                          cy="12"
                          r="10"
                          stroke="currentColor"
                          stroke-width="4"
                        ></circle>
                        <path
                          class="opacity-75"
                          fill="currentColor"
                          d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"
                        ></path>
                      </svg>
                    {/if}
                  </h3>
                </div>

                {#if !isUltimate}
                  <!-- Upgrade Prompt for Non-Ultimate Users -->
                  <div
                    class="bg-gradient-to-r from-amber-50 to-orange-50 rounded-2xl p-4 border border-amber-100 flex items-center justify-between shadow-sm"
                  >
                    <div class="flex items-center gap-3">
                      <div
                        class="w-10 h-10 rounded-full bg-white flex items-center justify-center text-xl shadow-sm border border-amber-50"
                      >
                        ✨
                      </div>
                      <div>
                        <p class="text-sm font-bold text-slate-800">
                          共有ノートの自動検索はアルティメットプラン限定です
                        </p>
                        <p class="text-xs text-slate-500">
                          他の学生が公開した最新のノートを瞬時にチェックできます。
                        </p>
                      </div>
                    </div>
                    <button
                      on:click={() => {
                        upgradeModalTitle = "アルティメットプラン限定機能";
                        upgradeModalMessage =
                          "共有ノートの自動検索機能を使うと、同じ科目の受講生が公開したノートを自動的に見つけることができます。";
                        showUltimateModal = true;
                      }}
                      class="px-4 py-2 bg-white text-indigo-600 rounded-xl text-xs font-bold shadow-sm hover:shadow-md transition-all border border-indigo-100"
                    >
                      アップグレード
                    </button>
                  </div>
                {:else if hasSearchedNotes}
                  {#if contextualSharedNotes.length > 0}
                    <div
                      class="flex overflow-x-auto gap-4 pb-4 custom-scrollbar"
                    >
                      {#each contextualSharedNotes as note}
                        <button
                          on:click={() => loadSharedNote(note)}
                          class="flex-shrink-0 w-64 bg-white rounded-2xl p-4 border border-slate-200 hover:border-indigo-300 hover:shadow-md transition-all text-left group"
                        >
                          <div class="flex items-center justify-between mb-2">
                            <span
                              class="text-[10px] font-bold text-slate-400 uppercase tracking-widest"
                              >{note.category || "Shared"}</span
                            >
                            {#if note.isPastYear}
                              <span
                                class="px-2 py-0.5 rounded-full bg-slate-100 text-slate-500 text-[9px] font-bold"
                                >過去ノート</span
                              >
                            {/if}
                          </div>
                          <h4
                            class="font-bold text-slate-800 line-clamp-2 mb-2 group-hover:text-indigo-600 transition-colors"
                          >
                            {note.title || "Untitled Note"}
                          </h4>
                          <div class="flex items-center gap-2 mt-auto">
                            <div
                              class="w-6 h-6 rounded-full bg-indigo-50 flex items-center justify-center text-[10px] font-bold text-indigo-600 border border-indigo-100"
                            >
                              {note.nickname?.[0]?.toUpperCase() || "U"}
                            </div>
                            <span class="text-xs text-slate-500"
                              >{note.nickname || "Anonymous"}</span
                            >
                          </div>
                        </button>
                      {/each}
                    </div>
                  {:else if !isSearchingNotes}
                    <div
                      class="py-10 text-center bg-slate-50 rounded-2xl border-2 border-dashed border-slate-200"
                    >
                      <p class="text-sm text-slate-400 font-medium">
                        現在、この科目の共有ノートは見つかりませんでした。
                      </p>
                    </div>
                  {/if}
                {/if}
              </div>

              <!-- Lecture Grid -->
              <div class="grid grid-cols-1 md:grid-cols-2 gap-6 mt-10">
                {#each $lectures.filter((l: any) => l.subjectId === selectedSubjectId) as lecture (lecture.id)}
                  <LectureCard
                    {lecture}
                    {selectedLectureIds}
                    {movingLectureId}
                    {draggingLectureId}
                    {handleDragStartToSidebar}
                    {toggleLectureSelection}
                    setMovingLectureId={(id) => (movingLectureId = id)}
                    {moveLecture}
                    {loadLecture}
                    {handleDragEnd}
                  />
                {/each}
                {#if $lectures.filter((l) => l.subjectId === selectedSubjectId).length === 0}
                  <div
                    on:dragover={handleMainTargetDragOver}
                    on:dragleave={handleMainTargetDragLeave}
                    on:drop={handleMainTargetDrop}
                    role="region"
                    aria-label="講義のドロップエリア"
                    class="col-span-full text-center py-12 text-slate-400 border-2 border-dashed rounded-3xl transition-all duration-300
                  {isDragOverMainTarget
                      ? 'bg-indigo-50 border-indigo-400 scale-[1.01] text-indigo-500 ring-4 ring-indigo-500/10'
                      : 'border-slate-200'}"
                  >
                    この科目にはまだ講義がありません。<br />
                    サイドバーから講義をドラッグして追加してください。
                  </div>

                  <button
                    on:click={() => (isEditing = true)}
                    class="col-span-full mt-4 w-full py-4 rounded-2xl border-2 border-dashed border-slate-200 text-slate-400 font-bold hover:border-indigo-300 hover:text-indigo-500 hover:bg-indigo-50/30 transition-all flex items-center justify-center gap-2"
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
                        d="M12 4v16m8-8H4"
                      />
                    </svg>
                    この科目に新しい講義を追加
                  </button>
                {/if}
              </div>
            {/if}
          </div>
        {/if}
      {:else}
        <!-- Input Section Only (History moved to /history) -->
        {#if viewMode === "create"}
          <div class="mb-10">
            <div class="space-y-8">
              <!-- STEP 1: Choose Course -->
              <div
                class="bg-white rounded-[40px] shadow-sm border border-slate-100 {isCourseDropdownOpen
                  ? 'overflow-visible'
                  : 'overflow-hidden'} relative group transition-all hover:shadow-lg hover:shadow-indigo-50/50"
              >
                <div class="p-8 md:p-12">
                  <div class="flex items-center gap-5 mb-8">
                    <div
                      class="w-20 h-14 px-3 rounded-2xl bg-indigo-50 flex items-center justify-center text-indigo-600 shadow-inner"
                    >
                      <span class="text-xs font-black">STEP 1/4</span>
                    </div>
                    <div>
                      <h2
                        class="text-2xl font-black text-slate-900 leading-none"
                      >
                        履修中の講義を選択
                      </h2>
                      <p
                        class="text-[10px] font-bold text-slate-400 uppercase tracking-[0.2em] mt-2"
                      >
                        SELECT YOUR COURSE
                      </p>
                    </div>
                  </div>

                  <div class="relative w-full z-50">
                    <button
                      type="button"
                      on:click={(e) => {
                        e.stopPropagation();
                        // On mobile (less than 768px), open bottom sheet. On desktop, open dropdown.
                        if (window.innerWidth < 768) {
                          isMobileCourseViewOpen = true;
                        } else {
                          isCourseDropdownOpen = !isCourseDropdownOpen;
                        }
                      }}
                      class="w-full flex items-center justify-between p-6 bg-slate-50 border-2 border-slate-100 rounded-3xl shadow-sm hover:bg-white hover:border-indigo-200 text-left transition-all group"
                    >
                      <span
                        class="text-gray-700 font-black text-xl {$lectureTitle
                          ? 'text-slate-900'
                          : 'text-slate-400'}"
                      >
                        {$lectureTitle || "こちらをタップして講義を選択"}
                      </span>
                      <svg
                        class="w-6 h-6 text-gray-400 transition-transform {isCourseDropdownOpen
                          ? 'rotate-180'
                          : ''}"
                        fill="none"
                        viewBox="0 0 24 24"
                        stroke="currentColor"
                      >
                        <path
                          stroke-linecap="round"
                          stroke-linejoin="round"
                          stroke-width="3"
                          d="M19 9l-7 7-7-7"
                        />
                      </svg>
                    </button>

                    <!-- Desktop Dropdown -->
                    {#if isCourseDropdownOpen}
                      <button
                        type="button"
                        class="fixed inset-0 z-40 hidden md:block w-full h-full bg-transparent cursor-default border-none"
                        on:click={() => (isCourseDropdownOpen = false)}
                        aria-label="閉じる"
                      ></button>
                      <div
                        class="absolute top-full left-0 w-full mt-3 bg-white border border-slate-100 rounded-[32px] shadow-2xl z-50 overflow-hidden animate-in fade-in zoom-in-95 duration-200 hidden md:block"
                      >
                        <div
                          class="max-h-80 overflow-y-auto custom-scrollbar p-2"
                        >
                          {#if enrolledCoursesList && enrolledCoursesList.length > 0}
                            {#each enrolledCoursesList as course}
                              <button
                                type="button"
                                on:click={() => {
                                  $lectureTitle = course.courseName;
                                  isCourseDropdownOpen = false;
                                }}
                                class="w-full text-left px-6 py-5 hover:bg-indigo-50 hover:text-indigo-600 rounded-2xl transition-all flex items-center justify-between group {$lectureTitle ===
                                course.courseName
                                  ? 'bg-indigo-50 text-indigo-700 font-bold'
                                  : 'text-slate-700'}"
                              >
                                <span class="text-xl font-bold">
                                  {course.courseName}
                                  {#if course.instructor}<span
                                      class="text-xs text-slate-400 ml-3 font-medium"
                                      >({course.instructor})</span
                                    >{/if}
                                </span>
                                {#if $lectureTitle === course.courseName}
                                  <svg
                                    class="w-6 h-6 text-indigo-600"
                                    fill="none"
                                    viewBox="0 0 24 24"
                                    stroke="currentColor"
                                    ><path
                                      stroke-linecap="round"
                                      stroke-linejoin="round"
                                      stroke-width="3"
                                      d="M5 13l4 4L19 7"
                                    /></svg
                                  >
                                {/if}
                              </button>
                            {/each}
                          {:else}
                            <div class="p-8 text-center">
                              <p class="font-bold text-slate-600 mb-4">
                                履修中の講義がありません
                              </p>
                              <button
                                on:click={() => {
                                  isCourseDropdownOpen = false;
                                  $isEnrollModalOpen = true;
                                }}
                                class="bg-indigo-600 text-white font-black py-3 px-6 rounded-2xl shadow-lg shadow-indigo-100 hover:bg-indigo-700 transition-all"
                                >⚙️ 講義を登録する</button
                              >
                            </div>
                          {/if}
                        </div>
                      </div>
                    {/if}

                    <!-- Mobile Bottom Sheet -->
                    {#if isMobileCourseViewOpen}
                      <!-- svelte-ignore a11y_click_events_have_key_events -->
                      <!-- svelte-ignore a11y_no_static_element_interactions -->
                      <div
                        class="fixed inset-0 bg-slate-900/40 backdrop-blur-sm z-[100] md:hidden"
                        on:click={() => (isMobileCourseViewOpen = false)}
                      >
                        <div
                          class="absolute bottom-0 left-0 w-full bg-white rounded-t-[40px] shadow-2xl p-6 pb-12 animate-in slide-in-from-bottom duration-300 pointer-events-auto"
                          on:click|stopPropagation
                          role="dialog"
                          aria-modal="true"
                          aria-label="講義選択"
                        >
                          <div
                            class="w-12 h-1.5 bg-slate-200 rounded-full mx-auto mb-8"
                          ></div>
                          <h3
                            class="text-xl font-black text-slate-900 mb-6 px-2"
                          >
                            講義を選択
                          </h3>

                          <div
                            class="max-h-[60vh] overflow-y-auto space-y-3 custom-scrollbar"
                          >
                            {#if enrolledCoursesList && enrolledCoursesList.length > 0}
                              {#each enrolledCoursesList as course}
                                <button
                                  type="button"
                                  on:click={() => {
                                    $lectureTitle = course.courseName;
                                    isMobileCourseViewOpen = false;
                                  }}
                                  class="w-full text-left p-6 rounded-[24px] transition-all flex items-center justify-between border-2 {$lectureTitle ===
                                  course.courseName
                                    ? 'bg-indigo-50 border-indigo-200 text-indigo-700'
                                    : 'bg-slate-50 border-transparent text-slate-700 active:bg-slate-100'}"
                                >
                                  <div>
                                    <p class="text-lg font-black">
                                      {course.courseName}
                                    </p>
                                    {#if course.instructor}<p
                                        class="text-sm font-bold opacity-40 mt-1"
                                      >
                                        {course.instructor}
                                      </p>{/if}
                                  </div>
                                  {#if $lectureTitle === course.courseName}
                                    <div
                                      class="w-8 h-8 rounded-full bg-indigo-600 text-white flex items-center justify-center shadow-lg shadow-indigo-200"
                                    >
                                      <svg
                                        class="w-5 h-5"
                                        fill="none"
                                        viewBox="0 0 24 24"
                                        stroke="currentColor"
                                        ><path
                                          stroke-linecap="round"
                                          stroke-linejoin="round"
                                          stroke-width="3"
                                          d="M5 13l4 4L19 7"
                                        /></svg
                                      >
                                    </div>
                                  {/if}
                                </button>
                              {/each}
                            {:else}
                              <div class="p-12 text-center">
                                <p class="font-bold text-slate-600 mb-6">
                                  履修中の講義がありません
                                </p>
                                <button
                                  on:click={() => {
                                    isMobileCourseViewOpen = false;
                                    $isEnrollModalOpen = true;
                                  }}
                                  class="w-full bg-indigo-600 text-white font-black py-5 rounded-3xl shadow-xl shadow-indigo-100"
                                  >⚙️ 講義を登録する</button
                                >
                              </div>
                            {/if}
                          </div>

                          <button
                            on:click={() => (isMobileCourseViewOpen = false)}
                            class="w-full mt-8 py-5 text-slate-400 font-bold text-sm"
                            >キャンセル</button
                          >
                        </div>
                      </div>
                    {/if}
                  </div>
                </div>
              </div>

              <!-- STEP 2: Choose Mode -->
              <div
                class="bg-white rounded-[40px] shadow-sm border border-slate-100 overflow-hidden relative group transition-all {isStep2Locked
                  ? 'opacity-40 grayscale pointer-events-none'
                  : 'hover:shadow-lg hover:shadow-amber-50/50'}"
              >
                <div class="p-8 md:p-12">
                  <div class="flex items-center gap-5 mb-10">
                    <div
                      class="w-20 h-14 px-3 rounded-2xl bg-amber-50 flex items-center justify-center text-amber-600 shadow-inner"
                    >
                      <span class="text-xs font-black">STEP 2/4</span>
                    </div>
                    <div>
                      <h2
                        class="text-2xl font-black text-slate-900 leading-none"
                      >
                        生成モードを選択
                      </h2>
                      <p
                        class="text-[10px] font-bold text-slate-400 uppercase tracking-[0.2em] mt-2"
                      >
                        CHOOSE GENERATION MODE
                      </p>
                    </div>
                  </div>

                  <div class="grid grid-cols-1 md:grid-cols-2 gap-12">
                    <div>
                      <span
                        class="block text-[10px] font-black text-slate-400 uppercase tracking-widest mb-5"
                        >生成タイプ</span
                      >
                      <div class="flex flex-col gap-4">
                        <div class="flex bg-slate-100/80 p-2 rounded-2xl">
                          <button
                            on:click={() => setAnalysisMode("note")}
                            class="flex-1 py-4 rounded-xl text-sm font-black transition-all {$analysisMode ===
                            'note'
                              ? 'bg-white text-indigo-600 shadow-sm'
                              : 'text-slate-500 hover:text-slate-700'}"
                            >ノート</button
                          >
                          <button
                            on:click={() => setAnalysisMode("thoughts")}
                            class="flex-1 py-4 rounded-xl text-sm font-black transition-all {$analysisMode ===
                            'thoughts'
                              ? 'bg-white text-amber-600 shadow-sm'
                              : 'text-slate-500 hover:text-slate-700'}"
                            >感想</button
                          >
                          <button
                            on:click={() => setAnalysisMode("report")}
                            class="flex-1 py-4 rounded-xl text-sm font-black transition-all {$analysisMode ===
                            'report'
                              ? 'bg-white text-slate-800 shadow-sm'
                              : 'text-slate-500 hover:text-slate-700'}"
                            >レポート</button
                          >
                        </div>
                        <div
                          class="bg-slate-50 p-4 rounded-2xl border border-slate-100"
                        >
                          <p
                            class="text-xs font-bold text-slate-500 leading-relaxed italic"
                          >
                            {#if $analysisMode === "note"}「講義の要点を網羅した自分専用のノートを作成します。」
                            {:else if $analysisMode === "thoughts"}「講義のポイントを整理し、提出用の感想文に仕上げます。」
                            {:else if $analysisMode === "report"}「スライドと音声を統合し、論理的なレポートを作成します。」{/if}
                          </p>
                        </div>
                      </div>
                    </div>

                    <div>
                      {#if $analysisMode !== "note"}
                        <div class="flex justify-between items-center mb-5">
                          <label
                            for="target-length-slider"
                            class="block text-[10px] font-black text-slate-400 uppercase tracking-widest"
                            >目標文字数</label
                          >
                          <span
                            class="text-xs font-black text-indigo-600 bg-indigo-50 px-3 py-1 rounded-full border border-indigo-100"
                            >{$targetLength}文字 ({manuscriptPages}枚分)</span
                          >
                        </div>
                        <div class="relative w-full pt-4 pb-2">
                          <input
                            id="target-length-slider"
                            type="range"
                            min="100"
                            max="4000"
                            step="50"
                            bind:value={$targetLength}
                            on:input={handleLengthChange}
                            class="w-full h-3 bg-slate-100 rounded-full appearance-none cursor-pointer accent-indigo-600 transition-all focus:outline-none"
                          />
                          <div
                            class="flex justify-between mt-3 text-[10px] text-slate-400 font-black"
                          >
                            <span>100</span><span>1000</span><span>2000</span
                            ><span>4000</span>
                          </div>
                        </div>
                      {:else}
                        <div
                          class="h-full flex items-center justify-center p-8 bg-slate-50 rounded-[32px] border border-dashed border-slate-200"
                        >
                          <p
                            class="text-xs font-black text-slate-400 text-center leading-relaxed"
                          >
                            ノート作成モードでは文字数制限はありません。<br
                            />AIが講義全体を網羅的に解析します。
                          </p>
                        </div>
                      {/if}
                    </div>
                  </div>
                </div>
              </div>

              <!-- STEP 3: Upload Materials -->
              <div
                class="bg-white rounded-[40px] shadow-sm border border-slate-100 overflow-hidden relative group transition-all {isStep3Locked
                  ? 'opacity-40 grayscale pointer-events-none'
                  : 'hover:shadow-lg hover:shadow-purple-50/50'}"
              >
                <div class="p-8 md:p-12">
                  <div class="flex items-center gap-5 mb-10">
                    <div
                      class="w-20 h-14 px-3 rounded-2xl bg-purple-50 flex items-center justify-center text-purple-600 shadow-inner"
                    >
                      <span class="text-xs font-black">STEP 3/4</span>
                    </div>
                    <div>
                      <h2
                        class="text-2xl font-black text-slate-900 leading-none"
                      >
                        資料をアップロード
                      </h2>
                      <p
                        class="text-[10px] font-bold text-slate-400 uppercase tracking-[0.2em] mt-2"
                      >
                        UPLOAD LEARNING MATERIALS
                      </p>
                    </div>
                  </div>

                  <div class="space-y-12">
                    <div>
                      <h3
                        class="flex items-center gap-2 text-[10px] font-black text-slate-400 uppercase tracking-widest mb-5"
                      >
                        授業スライド・配布プリント
                      </h3>
                      <div class="grid grid-cols-1 md:grid-cols-3 gap-6">
                        <div class="md:col-span-1">
                          <FileInputCard
                            id="pdf"
                            label="授業スライドを選択"
                            iconColorClass="text-red-400"
                            fileStore={$pdfFile}
                            accept=".pdf"
                            iconPath="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z"
                            on:change={(e) =>
                              handleFileChange(e.detail.event, e.detail.id)}
                            on:upgrade={(e) =>
                              handleUpgradeRequest(e.detail.label)}
                          />
                        </div>
                        <div class="md:col-span-1">
                          <FileInputCard
                            id="single_image"
                            label="配布プリントを選択"
                            iconColorClass="text-blue-400"
                            fileStore={$imageFile}
                            accept="image/*"
                            iconPath="M4 16l4.586-4.586a2 2 0 012.828 0L16 16m-2-2l1.586-1.586a2 2 0 012.828 0L20 14m-6-6h.01M6 20h12a2 2 0 002-2V6a2 2 0 00-2-2H6a2 2 0 00-2 2v12a2 2 0 002 2z"
                            on:change={(e) =>
                              handleFileChange(e.detail.event, e.detail.id)}
                            on:upgrade={(e) =>
                              handleUpgradeRequest(e.detail.label)}
                          />
                        </div>
                        <div class="md:col-span-1">
                          <FileInputCard
                            id="staged_image"
                            label="プリントを撮影"
                            iconColorClass="text-orange-400"
                            fileStore={null}
                            accept="image/*"
                            iconPath="M3 9a2 2 0 012-2h.93a2 2 0 001.664-.89l.812-1.22A2 2 0 0110.07 4h3.86a2 2 0 011.664.89l.812 1.22A2 2 0 0018.07 7H19a2 2 0 012 2v9a2 2 0 01-2 2H5a2 2 0 01-2-2V9z"
                            on:change={(e) =>
                              handleFileChange(e.detail.event, e.detail.id)}
                            on:upgrade={(e) =>
                              handleUpgradeRequest(e.detail.label)}
                          />
                        </div>
                      </div>

                      {#if $stagedImages.length > 0}
                        <div
                          class="mt-6 p-5 bg-slate-50 border border-slate-100 rounded-3xl overflow-hidden shadow-inner"
                        >
                          <h4
                            class="text-[10px] font-black text-slate-400 uppercase tracking-widest mb-4 flex items-center justify-between"
                          >
                            <span class="flex items-center gap-2"
                              >📸 撮影済み資料 ({$stagedImages.length}枚)</span
                            >
                            <button
                              on:click={() =>
                                document
                                  .getElementById(`file-input-staged_image`)
                                  ?.click()}
                              class="bg-white px-4 py-2 rounded-xl text-indigo-600 shadow-sm text-[10px] font-black hover:bg-indigo-50 transition-colors"
                              >追加撮影</button
                            >
                          </h4>
                          <div
                            class="flex overflow-x-auto gap-3 pb-2 scrollbar-hide"
                          >
                            {#each $stagedImages as img, idx}
                              <div
                                class="relative w-24 h-24 flex-shrink-0 bg-white rounded-2xl border border-slate-200 p-1 group"
                              >
                                <img
                                  src={URL.createObjectURL(img)}
                                  alt={`Captured ${idx}`}
                                  class="w-full h-full object-cover rounded-xl"
                                />
                                <button
                                  on:click={() =>
                                    stagedImages.update((current) =>
                                      current.filter((_, i) => i !== idx),
                                    )}
                                  aria-label="画像を削除"
                                  class="absolute -top-2 -right-2 w-7 h-7 bg-red-500 text-white rounded-full flex items-center justify-center shadow-lg transform scale-0 group-hover:scale-100 transition-transform"
                                  ><svg
                                    class="w-4 h-4"
                                    fill="none"
                                    viewBox="0 0 24 24"
                                    stroke="currentColor"
                                    ><path
                                      stroke-linecap="round"
                                      stroke-linejoin="round"
                                      stroke-width="3"
                                      d="M6 18L18 6M6 6l12 12"
                                    /></svg
                                  ></button
                                >
                              </div>
                            {/each}
                          </div>
                        </div>
                      {/if}
                    </div>

                    <div class="grid grid-cols-1 md:grid-cols-2 gap-8">
                      <div
                        class="p-8 bg-slate-50 rounded-[32px] border border-slate-100 shadow-inner"
                      >
                        <h3
                          class="flex items-center gap-2 text-[10px] font-black text-slate-400 uppercase tracking-widest mb-6"
                        >
                          講義の音声・動画
                        </h3>
                        <FileInputCard
                          id="video"
                          label="講義音声をアップ・録音"
                          iconColorClass="text-purple-400"
                          fileStore={$videoFile || $audioFile}
                          accept="video/*,audio/*"
                          iconPath="M14.752 11.168l-3.197-2.132A1 1 0 0010 9.87v4.263a1 1 0 001.555.832l3.197-2.132a1 1 0 000-1.664z M21 12a9 9 0 11-18 0 9 9 0 0118 0z"
                          isDisabled={!isPremium}
                          on:change={(e) =>
                            handleFileChange(e.detail.event, e.detail.id)}
                          on:upgrade={(e) =>
                            handleUpgradeRequest(e.detail.label)}
                        />
                      </div>

                      <div
                        class="p-8 bg-slate-50 rounded-[32px] border border-slate-100 shadow-inner"
                      >
                        <h3
                          class="flex items-center gap-2 text-[10px] font-black text-slate-400 uppercase tracking-widest mb-6"
                        >
                          ウェブサイトURL
                        </h3>
                        <div
                          class="h-20 rounded-2xl bg-white border border-slate-100 flex items-center px-4 transition-all focus-within:ring-2 focus-within:ring-indigo-100"
                        >
                          <input
                            type="text"
                            bind:value={$targetUrl}
                            placeholder="URLを貼り付けてください"
                            class="w-full bg-transparent border-none focus:outline-none text-sm font-black text-slate-700 placeholder:text-slate-300"
                          />
                        </div>
                      </div>
                    </div>

                    <div
                      class="p-8 bg-slate-50 rounded-[32px] border border-slate-100 shadow-inner"
                    >
                      <div class="flex flex-col gap-6 mb-8">
                        <div class="flex items-center justify-between">
                          <h3
                            class="flex items-center gap-2 text-[10px] font-black text-slate-400 uppercase tracking-widest"
                          >
                            リアルタイム文字起こし
                          </h3>
                          {#if $transcript || $interimTranscript}
                            <button
                              on:click={handleTranscriptReset}
                              class="bg-red-50 px-4 py-2 rounded-xl text-red-500 text-[10px] font-black hover:bg-red-100 transition-colors"
                              >リセット</button
                            >
                          {/if}
                        </div>

                        <!-- Recording Mode Toggle -->
                        <div
                          class="bg-slate-100/50 p-1.5 rounded-2xl flex gap-2"
                        >
                          <button
                            on:click={() => (recordingMode = "lecture")}
                            class="flex-1 flex flex-col items-center py-3 px-4 rounded-xl transition-all {recordingMode ===
                            'lecture'
                              ? 'bg-white text-indigo-600 shadow-sm'
                              : 'text-slate-400 hover:text-slate-600'}"
                          >
                            <span class="text-xs font-black">講義室モード</span>
                            <span class="text-[9px] font-bold opacity-60"
                              >全方位・マイク音優先</span
                            >
                          </button>
                          <button
                            on:click={() => (recordingMode = "meeting")}
                            class="flex-1 flex flex-col items-center py-3 px-4 rounded-xl transition-all {recordingMode ===
                            'meeting'
                              ? 'bg-white text-indigo-600 shadow-sm'
                              : 'text-slate-400 hover:text-slate-600'}"
                          >
                            <span class="text-xs font-black">対話モード</span>
                            <span class="text-[9px] font-bold opacity-60"
                              >近距離・雑音カット</span
                            >
                          </button>
                        </div>
                      </div>

                      <!-- Analysis Progress & Status -->
                      {#if $isRecording && $analysisStatus !== "idle"}
                        <div
                          class="mb-4 space-y-2 animate-in fade-in slide-in-from-top-2 duration-300"
                        >
                          <div class="flex justify-between items-end px-2">
                            <span
                              class="text-[10px] font-black uppercase tracking-widest {$analysisStatus ===
                              'processing'
                                ? 'text-indigo-500 animate-pulse'
                                : 'text-slate-400'}"
                            >
                              {$analysisStatus === "processing"
                                ? "AIが高精度に清書中..."
                                : `AIが音声を蓄積中... (あと ${$analysisCountdown}秒)`}
                            </span>
                            {#if $analysisStatus === "buffering"}
                              <span
                                class="text-[10px] font-bold text-slate-300"
                              >
                                {20 - $analysisCountdown}/20s
                              </span>
                            {/if}
                          </div>
                          <div
                            class="h-1.5 w-full bg-slate-100 rounded-full overflow-hidden border border-slate-50"
                          >
                            <div
                              class="h-full bg-indigo-500 transition-all duration-1000 ease-linear shadow-[0_0_8px_rgba(99,102,241,0.5)]"
                              style="width: {$analysisStatus === 'processing'
                                ? '100%'
                                : `${((20 - $analysisCountdown) / 20) * 100}%`}"
                            ></div>
                          </div>
                        </div>
                      {/if}

                      <div class="relative group">
                        {#if $transcript || $interimTranscript}
                          <button
                            class="absolute top-3 right-3 z-10 p-2 text-xs font-semibold text-slate-400 hover:text-rose-500 bg-slate-50/80 hover:bg-rose-50 rounded-xl transition-all opacity-0 group-hover:opacity-100 flex items-center gap-1 shadow-sm border border-slate-100"
                            on:click={() => {
                              transcript.set("");
                              interimTranscript.set("");
                              recognitionService.resetAccumulator();
                            }}
                          >
                            <svg
                              xmlns="http://www.w3.org/2000/svg"
                              class="h-3.5 w-3.5"
                              fill="none"
                              viewBox="0 0 24 24"
                              stroke="currentColor"
                            >
                              <path
                                stroke-linecap="round"
                                stroke-linejoin="round"
                                stroke-width="2"
                                d="m14.74 9-.346 9m-4.788 0L9.26 9m9.968-3.21c.342.052.682.107 1.022.166m-1.022-.165L18.16 19.673a2.25 2.25 0 0 1-2.244 2.077H8.084a2.244 2.244 0 0 1-2.244-2.077L4.772 5.79m14.456 0a48.108 48.108 0 0 0-3.478-.397m-12 .562c.34-.059.68-.114 1.022-.165m0 0a48.11 48.11 0 0 1 3.478-.397m7.5 0v-.916c0-1.18-.91-2.164-2.09-2.201a51.964 51.964 0 0 0-3.32 0c-1.18.037-2.09 1.022-2.09 2.201v.916m7.5 0a48.667 48.667 0 0 0-7.5 0"
                              />
                            </svg>
                            クリア
                          </button>
                        {/if}

                        <!-- Display Div for Hybrid Text (Normal + Thin) -->
                        <div
                          class="w-full min-h-[160px] max-h-40 p-5 bg-white rounded-3xl border border-slate-100 overflow-y-auto text-sm text-slate-700 font-medium leading-relaxed custom-scrollbar shadow-sm whitespace-pre-wrap text-left group-focus-within:border-indigo-400 group-focus-within:ring-1 group-focus-within:ring-indigo-400 group-focus-within:ring-opacity-50"
                          use:actionTextAreaAutoscroll={$transcript +
                            $interimTranscript}
                        >
                          <span class="text-slate-700">{$transcript}</span>
                          <span class="text-slate-400/60 transition-opacity"
                            >{$interimTranscript}</span
                          >
                          {#if !$transcript && !$interimTranscript}
                            <span class="text-slate-300 italic"
                              >録音ボタンを押すと、自動的に文字起こしが始まります。</span
                            >
                          {/if}
                        </div>

                        <!-- Hidden Textarea for input sync if needed, or we can make the div contenteditable -->
                        <textarea
                          class="sr-only"
                          value={$transcript}
                          on:input={(e) =>
                            transcript.set(e.currentTarget.value)}
                        ></textarea>
                      </div>
                    </div>
                  </div>
                </div>
              </div>

              <!-- STEP 4: Finalize -->
              <div
                class="bg-slate-900 rounded-[40px] shadow-2xl p-10 md:p-16 text-center relative overflow-hidden group transition-all {isStep4Locked &&
                !analyzing
                  ? 'opacity-40 grayscale pointer-events-none'
                  : ''}"
              >
                <div
                  class="absolute inset-0 bg-gradient-to-br from-indigo-950 via-slate-900 to-slate-900 opacity-50"
                ></div>
                <div
                  class="absolute -top-24 -right-24 w-64 h-64 bg-indigo-500/10 rounded-full blur-[100px] group-hover:bg-indigo-500/20 transition-all duration-1000"
                ></div>

                <div class="relative z-10 flex flex-col items-center gap-8">
                  <div class="flex items-center gap-5 mb-2">
                    <div
                      class="w-20 h-14 px-3 rounded-2xl bg-white/10 backdrop-blur-xl flex items-center justify-center text-white border border-white/10 shadow-xl"
                    >
                      <span class="text-xs font-black">STEP 4/4</span>
                    </div>
                    <div class="text-left">
                      <h2 class="text-2xl font-black text-white leading-none">
                        解析を開始
                      </h2>
                      <p
                        class="text-[10px] font-bold text-white/40 uppercase tracking-[0.2em] mt-2"
                      >
                        AUTO-GENERATE HIGH QUALITY NOTE
                      </p>
                    </div>
                  </div>

                  {#if analyzing}
                    <div
                      class="w-full max-w-md bg-white/5 backdrop-blur-2xl p-8 rounded-[32px] border border-white/10 shadow-2xl animate-in zoom-in-95 duration-500"
                    >
                      <div class="flex items-center gap-5 mb-8">
                        <div
                          class="w-10 h-10 rounded-full border-4 border-white/10 border-t-white animate-spin"
                        ></div>
                        <div class="flex-1 text-left">
                          <p
                            class="text-xs font-black text-white/40 uppercase tracking-widest mb-1"
                          >
                            Processing...
                          </p>
                          <p class="text-base font-black text-white truncate">
                            {progressStatus}
                          </p>
                        </div>
                        <span class="text-2xl font-black text-white"
                          >{Math.floor(progressValue)}%</span
                        >
                      </div>
                      <div
                        class="h-3 w-full bg-white/5 rounded-full overflow-hidden mb-6 shadow-inner border border-white/5"
                      >
                        <div
                          class="h-full bg-white transition-all duration-500 ease-out"
                          style="width: {progressValue}%"
                        ></div>
                      </div>
                      <button
                        on:click={handleCancelAnalysis}
                        class="px-6 py-2 rounded-xl text-[10px] font-black uppercase tracking-widest text-white/40 hover:text-red-400 hover:bg-red-400/10 transition-all"
                        >キャンセル</button
                      >
                    </div>
                  {:else}
                    <div
                      class="flex flex-col items-center gap-8 w-full max-w-md"
                    >
                      <div class="relative w-full group">
                        <button
                          on:click={handleAnalyze}
                          disabled={isStep4Locked}
                          class="w-full bg-white text-slate-900 h-20 rounded-[28px] font-black text-xl shadow-2xl hover:scale-[1.02] active:scale-[0.98] transition-all disabled:opacity-30 disabled:cursor-not-allowed flex items-center justify-center gap-4 group-hover:shadow-indigo-500/25"
                        >
                          <span>ノートを自動生成する</span>
                          <svg
                            class="w-6 h-6 transform group-hover:translate-x-1 transition-transform"
                            fill="none"
                            viewBox="0 0 24 24"
                            stroke="currentColor"
                            ><path
                              stroke-linecap="round"
                              stroke-linejoin="round"
                              stroke-width="4"
                              d="M13 7l5 5m0 0l-5 5m5-5H6"
                            /></svg
                          >
                        </button>

                        {#if isStep4Locked}
                          <div
                            class="absolute bottom-full mb-6 left-1/2 -translate-x-1/2 px-5 py-3 bg-slate-800 text-white text-xs font-black rounded-2xl whitespace-nowrap opacity-0 group-hover:opacity-100 transition-all translate-y-2 group-hover:translate-y-0 pointer-events-none shadow-2xl border border-white/10"
                          >
                            まずは講義資料を選択してください
                            <div
                              class="absolute top-full left-1/2 -translate-x-1/2 border-[10px] border-transparent border-t-slate-800"
                            ></div>
                          </div>
                        {/if}
                      </div>

                      <label
                        class="flex items-center gap-4 cursor-pointer bg-white/5 backdrop-blur-xl px-8 py-4 rounded-[24px] border border-white/10 transition-all hover:bg-white/10"
                      >
                        <input
                          type="checkbox"
                          bind:checked={$isShared}
                          class="sr-only peer"
                        />
                        <div
                          class="w-11 h-6 bg-white/10 rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[4px] after:left-[4px] after:bg-white after:rounded-full after:h-4 after:w-4 after:transition-all peer-checked:bg-white relative transition-colors"
                        ></div>
                        <span class="text-sm font-black text-white/80"
                          >共有ノートに公開する</span
                        >
                      </label>
                    </div>
                  {/if}
                </div>
              </div>
            </div>
          </div>

          <!-- Mobile Sticky FAB (Step 3) -->
          {#if user && !analyzing}
            <div
              class="fixed bottom-0 left-0 w-full p-6 z-50 md:hidden bg-gradient-to-t from-white via-white/95 to-transparent pt-12 pointer-events-none"
            >
              <div class="pointer-events-auto">
                <button
                  on:click={handleAnalyze}
                  disabled={isStep4Locked}
                  class="w-full bg-indigo-600 text-white h-20 rounded-[28px] font-black text-lg shadow-2xl shadow-indigo-200 flex items-center justify-center gap-3 active:scale-95 transition-all disabled:bg-slate-300 disabled:shadow-none"
                >
                  <span>ノートを自動生成する</span>
                  <svg
                    class="w-6 h-6"
                    fill="none"
                    viewBox="0 0 24 24"
                    stroke="currentColor"
                    ><path
                      stroke-linecap="round"
                      stroke-linejoin="round"
                      stroke-width="4"
                      d="M13 7l5 5m0 0l-5 5m5-5H6"
                    /></svg
                  >
                </button>
              </div>
            </div>
          {/if}
        {/if}

        {#if viewMode === "gallery"}
          <div class="py-4 md:py-8 animate-in fade-in zoom-in-95 duration-500">
            <div
              class="flex flex-col md:flex-row md:items-center justify-between gap-6 mb-10"
            >
              <div>
                <div class="flex items-center gap-3 mb-2">
                  <span
                    class="px-3 py-1 bg-indigo-50 text-indigo-600 text-xs font-black tracking-widest uppercase rounded-full border border-indigo-100"
                    >Gallery</span
                  >
                </div>
                <h1
                  class="text-3xl md:text-4xl font-black text-slate-900 tracking-tight"
                >
                  {galleryCourseName}
                </h1>
                <p class="text-slate-500 mt-2 font-medium">
                  他の学生の公開ノートを参照して学習に役立てましょう。
                </p>
              </div>
              <button
                on:click={startNewNoteFromGallery}
                class="px-6 py-4 bg-indigo-600 text-white font-bold rounded-2xl shadow-lg shadow-indigo-200 hover:bg-indigo-700 hover:shadow-xl transition-all flex items-center justify-center gap-3 shrink-0"
              >
                <svg
                  class="w-5 h-5"
                  fill="none"
                  viewBox="0 0 24 24"
                  stroke="currentColor"
                  ><path
                    stroke-linecap="round"
                    stroke-linejoin="round"
                    stroke-width="2.5"
                    d="M12 4v16m8-8H4"
                  /></svg
                >
                新規作成に戻る
              </button>
            </div>

            {#if isSearchingNotes}
              <div
                class="py-32 flex flex-col items-center justify-center text-center"
              >
                <div
                  class="w-12 h-12 border-4 border-indigo-100 border-t-indigo-600 rounded-full animate-spin mb-4"
                ></div>
                <p class="text-slate-400 font-bold tracking-wider">
                  共有ノートを検索中...
                </p>
              </div>
            {:else if contextualSharedNotes.length > 0}
              <div class="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
                {#each contextualSharedNotes as note}
                  <div
                    class="bg-white rounded-[32px] p-6 md:p-8 text-left border border-slate-100 shadow-sm hover:shadow-xl hover:-translate-y-1 transition-all group flex flex-col h-full relative overflow-hidden"
                  >
                    <!-- Transparent click overlay for Ultimate Upgrade -->
                    <!-- svelte-ignore a11y_click_events_have_key_events -->
                    <div
                      class="absolute inset-0 z-20 cursor-pointer"
                      on:click={() => {
                        if (isUltimate) {
                          loadSharedNote(note);
                        } else {
                          upgradeModalTitle = "アルティメットプラン限定機能";
                          upgradeModalMessage =
                            "他の学生の共有ノートを閲覧・検索するにはアルティメットプランへのアップグレードが必要です。";
                          showUltimateModal = true;
                        }
                      }}
                      role="button"
                      tabindex="0"
                      aria-label="Note Details"
                    ></div>

                    <!-- Decorative Background -->
                    <div
                      class="absolute top-0 right-0 w-32 h-32 bg-indigo-50 rounded-bl-full -z-10 opacity-50 group-hover:bg-indigo-100 transition-colors"
                    ></div>

                    <div
                      class="flex items-start justify-between gap-2 mb-4 relative z-10"
                    >
                      <span
                        class="px-3 py-1 bg-slate-50 text-slate-600 text-[10px] font-black tracking-widest uppercase rounded-full border border-slate-200 group-hover:border-indigo-200 group-hover:text-indigo-600 transition-colors"
                      >
                        {note.category || "Shared Note"}
                      </span>
                      <div class="flex flex-col items-end gap-2">
                        <span class="text-xs font-bold text-slate-400">
                          {note.createdAt
                            ? new Date(
                                note.createdAt.seconds * 1000,
                              ).toLocaleDateString()
                            : ""}
                        </span>
                        {#if !isUltimate}
                          <span
                            class="px-2 py-1 bg-gradient-to-r from-amber-400 to-yellow-500 text-white text-[9px] font-black tracking-widest uppercase rounded shadow-md shadow-amber-200/50 flex items-center gap-1"
                          >
                            <svg
                              class="w-2.5 h-2.5"
                              fill="currentColor"
                              viewBox="0 0 20 20"
                              ><path
                                d="M9.049 2.927c.3-.921 1.603-.921 1.902 0l1.07 3.292a1 1 0 00.95.69h3.462c.969 0 1.371 1.24.588 1.81l-2.8 2.034a1 1 0 00-.364 1.118l1.07 3.292c.3.921-.755 1.688-1.54 1.118l-2.8-2.034a1 1 0 00-1.175 0l-2.8 2.034c-.784.57-1.838-.197-1.539-1.118l1.07-3.292a1 1 0 00-.364-1.118L2.98 8.72c-.783-.57-.38-1.81.588-1.81h3.461a1 1 0 00.951-.69l1.07-3.292z"
                              ></path></svg
                            >
                            ULTIMATE ONLY
                          </span>
                        {/if}
                      </div>
                    </div>

                    <h3
                      class="text-xl font-black text-slate-800 line-clamp-2 mb-3 group-hover:text-indigo-600 transition-colors leading-tight relative z-10"
                    >
                      {note.title || "Untitled Note"}
                    </h3>

                    <!-- Value Add Tags (Auto logic) -->
                    <div class="flex flex-wrap gap-1.5 mb-4 relative z-10">
                      <span
                        class="px-2 py-0.5 bg-slate-50 text-slate-600 text-[10px] font-bold rounded shrink-0 line-clamp-1 border border-slate-100"
                        >要約済み</span
                      >
                      {#if note.summary && note.summary.length > 200}
                        <span
                          class="px-2 py-0.5 bg-amber-50 text-amber-600 text-[10px] font-bold rounded shrink-0 line-clamp-1 border border-amber-100 flex items-center gap-1"
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
                              d="M13 10V3L4 14h7v7l9-11h-7z"
                            /></svg
                          >
                          重要度: 高
                        </span>
                      {/if}
                      {#if note.category === "report" || note.category === "thoughts" || (note.summary && note.summary.includes("図"))}
                        <span
                          class="px-2 py-0.5 bg-emerald-50 text-emerald-600 text-[10px] font-bold rounded shrink-0 line-clamp-1 border border-emerald-100"
                          >詳細解説</span
                        >
                      {/if}
                    </div>

                    <!-- Content (Blurred for non-ultimate) -->
                    <div
                      class="flex-grow relative mt-2 mb-6 pointer-events-none"
                    >
                      <p
                        class="text-sm text-slate-500 line-clamp-5 leading-relaxed {isUltimate
                          ? ''
                          : 'select-none opacity-40 mix-blend-multiply'}"
                        style={!isUltimate
                          ? "filter: blur(8px); user-select: none;"
                          : ""}
                      >
                        {note.summary ||
                          "このノートは詳細な解説を提供しています。"}
                        {#if !isUltimate && (!note.summary || note.summary.length < 100)}
                          学習効率を劇的に高める重要キーワード、試験対策の要点、構造化された詳細な解説が含まれています。全体の文脈を把握するのに最適です。
                        {/if}
                      </p>
                    </div>

                    <!-- Author Footer -->
                    <div
                      class="flex items-center gap-3 mt-auto pt-5 border-t border-slate-50 relative z-10 pointer-events-none"
                    >
                      <div
                        class="w-10 h-10 rounded-full bg-gradient-to-br from-indigo-100 to-purple-100 flex items-center justify-center border-2 border-white shadow-sm shrink-0"
                      >
                        <span class="text-sm font-black text-indigo-700"
                          >{note.nickname?.[0]?.toUpperCase() || "U"}</span
                        >
                      </div>
                      <span class="text-sm font-bold text-slate-600 truncate"
                        >{note.nickname || "Anonymous"}</span
                      >
                    </div>
                  </div>
                {/each}
              </div>
            {:else}
              <div
                class="py-24 text-center bg-slate-50 rounded-[40px] border-2 border-dashed border-slate-200 flex flex-col items-center justify-center"
              >
                <div
                  class="w-20 h-20 bg-white rounded-3xl shadow-sm flex items-center justify-center mb-6"
                >
                  <svg
                    class="w-10 h-10 text-slate-300"
                    fill="none"
                    viewBox="0 0 24 24"
                    stroke="currentColor"
                    ><path
                      stroke-linecap="round"
                      stroke-linejoin="round"
                      stroke-width="2"
                      d="M19 11H5m14 0a2 2 0 012 2v6a2 2 0 01-2 2H5a2 2 0 01-2-2v-6a2 2 0 012-2m14 0V9a2 2 0 00-2-2M5 11V9a2 2 0 002-2m0 0V5a2 2 0 012-2h6a2 2 0 012 2v2M7 7h10"
                    /></svg
                  >
                </div>
                <p
                  class="text-slate-500 text-xl font-black tracking-tight mb-2"
                >
                  まだこの講義の共有ノートはありません。
                </p>
                <p class="text-slate-400 font-medium">
                  あなたが最初の投稿者になりませんか？
                </p>
                <button
                  on:click={startNewNoteFromGallery}
                  class="mt-8 px-8 py-4 bg-indigo-50 text-indigo-600 font-bold rounded-2xl hover:bg-indigo-100 transition-colors shadow-sm"
                >
                  ノートを作成して共有する
                </button>
              </div>
            {/if}
          </div>
        {/if}

        <!-- Floating Mic Button -->
        {#if user && !analyzing}
          <button
            on:click={toggleRecording}
            class="fixed bottom-12 right-12 z-50 w-20 h-20 md:w-24 md:h-24 rounded-full shadow-2xl flex items-center justify-center transition-all duration-500 hover:scale-110 active:scale-95 border-4 border-white
                {$isRecording
              ? 'bg-red-500 shadow-red-200 animate-pulse'
              : 'bg-white text-indigo-600 shadow-indigo-100 hover:shadow-indigo-200'}
                mb-24 md:mb-0"
          >
            {#if $isRecording}
              <div class="waveform-ring"></div>
              <div class="waveform-ring"></div>
              <div class="waveform-ring"></div>
              <!-- Square stop icon -->
              <div
                class="w-8 h-8 md:w-10 md:h-10 bg-white rounded-sm shadow-inner relative z-10"
              ></div>
            {:else}
              <svg
                class="w-10 h-10 md:w-12 md:h-12"
                fill="none"
                viewBox="0 0 24 24"
                stroke="currentColor"
                ><path
                  stroke-linecap="round"
                  stroke-linejoin="round"
                  stroke-width="2.5"
                  d="M19 11a7 7 0 01-7 7m0 0a7 7 0 01-7-7m7 7v4m0 0H8m4 0h4m-4-8a3 3 0 01-3-3V5a3 3 0 116 0v6a3 3 0 01-3 3z"
                /></svg
              >
            {/if}
          </button>
        {/if}

        <div class="flex items-center justify-between mb-8">
          <div>
            <h1 class="text-2xl font-bold text-slate-900 tracking-tight">
              未分類の履歴
            </h1>
            <p class="text-slate-500 mt-2">
              {$lectures.filter((l) => !l.subjectId).length} 件の講義が整理を待っています
            </p>
          </div>
        </div>

        <div class="grid grid-cols-1 md:grid-cols-2 gap-4">
          {#each $lectures.filter((l: any) => !l.subjectId) as lecture (lecture.id)}
            <LectureCard
              {lecture}
              {selectedLectureIds}
              {movingLectureId}
              {draggingLectureId}
              {handleDragStartToSidebar}
              {toggleLectureSelection}
              setMovingLectureId={(id) => (movingLectureId = id)}
              {moveLecture}
              {loadLecture}
              {handleDragEnd}
            />
          {/each}
          {#if $lectures.filter((l) => !l.subjectId).length === 0}
            <div
              class="col-span-full text-center py-20 text-slate-300 border-2 border-dashed border-slate-100 rounded-3xl"
            >
              <p class="text-lg font-medium mb-1">未分類の履歴はありません</p>
              <p class="text-sm">
                全ての講義が科目バインダーに整理されています。
              </p>
            </div>
          {/if}
        </div>
      {/if}
    </main>
  </div>
</div>

<style>
  @keyframes wave {
    0% {
      transform: scale(1);
      opacity: 0.6;
    }
    100% {
      transform: scale(1.8);
      opacity: 0;
    }
  }

  .waveform-ring {
    position: absolute;
    inset: 0;
    border-radius: 9999px;
    background-color: #ef4444; /* red-500 */
    animation: wave 2s cubic-bezier(0.4, 0, 0.2, 1) infinite;
    pointer-events: none;
    z-index: 0;
  }

  .waveform-ring:nth-child(2) {
    animation-delay: 0.6s;
  }

  .waveform-ring:nth-child(3) {
    animation-delay: 1.2s;
  }

  /* Custom scrollbar for better UI */
  .custom-scrollbar::-webkit-scrollbar {
    width: 6px;
    height: 6px;
  }
  .custom-scrollbar::-webkit-scrollbar-track {
    background: transparent;
  }
  .custom-scrollbar::-webkit-scrollbar-thumb {
    background: #e2e8f0;
    border-radius: 10px;
  }
  .custom-scrollbar::-webkit-scrollbar-thumb:hover {
    background: #cbd5e1;
  }
</style>
