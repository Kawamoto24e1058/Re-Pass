<script lang="ts">
  import {
    extractAudioFromVideo,
    type AudioExtractionProgress,
  } from "$lib/utils/audioExtractor";
  import { retryOperation } from "$lib/utils/retry";
  import { normalizeCourseName } from "$lib/utils/textUtils";
  import { onMount, onDestroy, tick } from "svelte";
  import { storage, auth, db } from "$lib/firebase";
  import {
    ref,
    uploadBytes,
    uploadBytesResumable,
    getDownloadURL,
    deleteObject,
  } from "firebase/storage";
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
    getDoc,
    getDocs,
    limit,
    deleteDoc,
    serverTimestamp,
    startAt,
    endAt,
  } from "firebase/firestore";
  import { goto } from "$app/navigation";
  import { signOut } from "firebase/auth";
  import { subjects, lectures, currentBinder } from "$lib/stores";
  import {
    isRecording,
    transcript,
    finalTranscript,
    interimTranscript,
    resetTranscript,
  } from "$lib/stores/recordingStore";
  import { recognitionService } from "$lib/services/recognitionService";
  import { page } from "$app/stores";

  // --- State Variables (Runes) ---
  let pdfFile = $state<File | null>(null);
  let txtFile = $state<File | null>(null);
  let audioFile = $state<File | null>(null); // New: Audio File
  let imageFile = $state<File | null>(null);
  let videoFile = $state<File | null>(null);
  let isExtractingAudio = $state(false);
  let extractionProgress = $state<AudioExtractionProgress | null>(null);
  let audioUploadPromise = $state<Promise<string> | null>(null);
  let targetUrl = $state("");
  let analyzing = $state(false);
  let upgradeModalTitle = $state("ULTIMATE限定機能");
  let upgradeModalMessage = $state("");

  type AnalysisResult =
    | {
        title?: string;
        category?: string;
        summary: string;
        glossary?: { term: string; definition: string }[];
      }
    | string;

  let result = $state<AnalysisResult>("");
  let cancellationController = $state<AbortController | null>(null); // Global cancellation controller
  let categoryTag = $state(""); // AI generated category
  let videoPlayer = $state<HTMLVideoElement | null>(null);
  let previewVideoUrl = $state("");

  // Course Info & Sharing
  let courseName = $state("");
  let isShared = $state(true); // Default true
  let showCourseNameError = $state(false);

  // Syllabus Autocomplete
  let suggestedCourses = $state<any[]>([]);
  let selectedSyllabus = $state<any>(null);
  let showSuggestions = $state(false);
  let courseInputTimer: any;

  $effect(() => {
    if (videoFile) {
      const url = URL.createObjectURL(videoFile);
      previewVideoUrl = url;
      return () => URL.revokeObjectURL(url);
    } else {
      previewVideoUrl = "";
    }
  });

  function seekVideo(timeString: string) {
    if (!videoPlayer) return;
    const parts = timeString.split(":");
    let seconds = 0;
    if (parts.length === 2) {
      seconds = parseInt(parts[0]) * 60 + parseInt(parts[1]);
    } else if (parts.length === 3) {
      seconds =
        parseInt(parts[0]) * 3600 +
        parseInt(parts[1]) * 60 +
        parseInt(parts[2]);
    }
    videoPlayer.currentTime = seconds;
    videoPlayer.play();
  }

  async function handleCourseInput() {
    showCourseNameError = false;
    const input = courseName.trim();

    // Clear previous selection if user types
    if (selectedSyllabus && selectedSyllabus.courseName !== input) {
      selectedSyllabus = null;
    }

    if (!input) {
      suggestedCourses = [];
      return;
    }

    clearTimeout(courseInputTimer);
    courseInputTimer = setTimeout(async () => {
      // Normalize university name for consistent querying
      const cleanUniv = userData?.university ? userData.university.trim() : "";
      console.log("🔍 [Suggest] Processing input for university:", {
        raw: userData?.university,
        trimmed: cleanUniv,
        input: input,
      });

      // Fallback: If university is missing in state, try a hard fetch
      if (!cleanUniv && auth.currentUser) {
        console.log(
          "🔍 [Suggest] University missing in state, attempting hard fetch...",
        );
        try {
          const userDoc = await getDoc(doc(db, "users", auth.currentUser.uid));
          if (userDoc.exists()) {
            const freshData = userDoc.data();
            // Removed manual userData override to maintain onSnapshot reactivity
            const refetchedUniv = freshData.university
              ? freshData.university.trim()
              : "";
            console.log("🔍 [Suggest] Hard fetch successful:", refetchedUniv);
            if (!refetchedUniv) {
              console.warn("⚠️ [Suggest] Refetched university is still empty");
              suggestedCourses = [];
              return;
            }
          }
        } catch (e) {
          console.error("❌ [Suggest] Hard fetch for university failed:", e);
        }
      }

      const finalUniv = userData?.university ? userData.university.trim() : "";
      if (!finalUniv) {
        console.warn(
          "⚠️ [Suggest] No university set, skipping suggestion fetch",
        );
        suggestedCourses = [];
        return;
      }

      const normalizedInput = normalizeCourseName(input);
      console.log("🔍 [Suggest] Executing Firestore Query:", {
        university: finalUniv,
        input: normalizedInput,
        prefix: normalizedInput + "\uf8ff",
      });

      try {
        const q = query(
          collection(db, "masterCourses"),
          where("university", "==", finalUniv),
          orderBy("normalizedCourseName"),
          where("normalizedCourseName", ">=", normalizedInput),
          where("normalizedCourseName", "<=", normalizedInput + "\uf8ff"),
          limit(5),
        );

        const snapshot = await getDocs(q);
        suggestedCourses = snapshot.docs.map((d: any) => d.data());
        console.log("✨ [Suggest] Query Results:", {
          foundCount: suggestedCourses.length,
          courses: suggestedCourses.map((c: any) => c.courseName),
        });

        if (suggestedCourses.length === 0) {
          console.warn(
            "⚠️ [Suggest] No suggestions found. University mismatch? Searching in 'masterCourses' with:",
            finalUniv,
          );
        }
        showSuggestions = true;
      } catch (e) {
        console.error("❌ [Suggest] Firestore Query Error:", e);
      }
    }, 300);
  }

  function selectCourse(course: any) {
    courseName = course.courseName;
    selectedSyllabus = course;
    showSuggestions = false;
    showCourseNameError = false;
  }

  function handleTimestampClick(e: MouseEvent) {
    const target = e.target as HTMLElement;
    if (target.classList.contains("timestamp-link")) {
      const timestamp = target.dataset.timestamp;
      if (timestamp) {
        seekVideo(timestamp);
        // Visual feedback
        toastMessage = `🎥 ${timestamp} にジャンプしました`;
        setTimeout(() => (toastMessage = null), 2000);
      }
    }
  }

  // Helper to process markdown and inject clickable timestamps
  function processMarkdownWithTimestamps(markdown: string): string {
    // Regex to find [MM:SS] or [H:MM:SS]
    const regex = /\[(\d{1,2}:\d{2}(?::\d{2})?)\]/g;

    // Convert to HTML first using marked (assuming renderMarkdown is the function, checking below)
    // Actually, we usually parse markdown then inject, or inject then parse if code blocks aren't an issue.
    // To be safe against code blocks, we should use a custom renderer, but for now simple replacement might suffice
    // if we assume timestamps aren't in code blocks.

    // Better approach: Let marked parse it, then replace in the HTML output.
    // But marked logic is inside the template `{@html marked(result)}`.
    // We will override `marked.use` or just do a string replace on the output of marked.
    return markdown; // We will handle this in the template expression
  }
  let analyzedTitle = $state(""); // AI generated title
  let analyzedCategory = $state(""); // AI generated category raw
  let draggingLectureId = $state<string | null>(null);
  import UpgradeModal from "$lib/components/UpgradeModal.svelte";
  let showUpgradeModal = $state(false);
  let showUltimateModal = $state(false); // New modal for Ultimate features
  let isDragOverMainTarget = $state(false);

  // Advanced Organization State
  let selectedLectureIds = $state(new Set<string>());
  let movingLectureId = $state<string | null>(null);
  let analysisProposal = $state<{
    lectureId: string;
    subjectId: string;
    subjectName: string;
  } | null>(null);

  // View Mode State
  let isEditing = $state(true);

  // User & Data State
  let user = $state<any>(null);
  let userData = $state<any>(null);
  // subjects managed via store
  let currentLectureId = $state<string | null>(null);
  // selectedSubjectId is now derived from store or synced
  let selectedSubjectId = $state<string | null>(null);

  // Sync state with store
  import { user as userStore, userProfile } from "$lib/userStore";
  $effect(() => {
    user = $userStore;
    userData = $userProfile;
    selectedSubjectId = $currentBinder;
  });
  // Duplicate removed
  let lectureTitle = $state("");
  let unsubscribeUser: () => void;
  // unsubscribeLectures removed as it is now managed via list

  // UI State
  let toastMessage = $state<string | null>(null);
  let resultContainer = $state<HTMLElement | null>(null); // For auto-scroll
  let resultTextContainer = $state<HTMLElement | null>(null); // For individual copy
  let finalResultContainer = $state<HTMLElement | null>(null); // For final copy

  // Speech Recognition State - Moved to global recordingStore
  // let isRecording = $state(false);
  // let transcript = $state("");
  // let finalTranscript = $state("");
  // let recognition: any;

  // Analysis Settings
  let analysisMode = $state<"note" | "thoughts" | "report">("note");
  let targetLength = $state(500);

  // Series Analysis State
  let analyzingSeries = $state(false);
  let seriesSummary = $state<{
    story: string;
    unresolved: string;
    exam: string;
  } | null>(null);

  // Progress State
  let progressValue = $state(0);
  let progressStatus = $state("準備中...");
  let progressInterval: any;
  let customAnalysisInstructions = $state("");
  let analyzingFinal = $state(false);
  let finalExamView = $state(false); // Toggle between lecture list and final exam
  let finalExamResult = $state(""); // Store AI-generated final exam summary
  let isCopied = $state(false); // Feedback state for summary copy
  let isResultCopied = $state(false); // Feedback state for individual results

  // --- Derivative Generation State ---
  let lectureAnalyses = $state<Record<string, AnalysisResult>>({}); // Store different modes for current lecture
  let initialGenerationDone = $state(false);
  let derivativeAnalyzing = $state(false);

  // Copy result to clipboard (AnalysisResult aware)
  let strategyContent = $derived.by(() => {
    const ca = lectureAnalyses[analysisMode];
    if (!ca || typeof ca !== "object" || !ca.summary) return null;
    const match = ca.summary.match(
      /\[A_STRATEGY_START\]([\s\S]*?)\[A_STRATEGY_END\]/,
    );
    return match ? match[1].trim() : null;
  });

  let displaySummary = $derived.by(() => {
    const ca = lectureAnalyses[analysisMode];
    if (!ca) return "";
    if (typeof ca === "string") return ca;
    if (!ca.summary) return "";
    return ca.summary
      .replace(/\[A_STRATEGY_START\][\s\S]*?\[A_STRATEGY_END\]/g, "")
      .trim();
  });

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
    const currentData = lectureAnalyses[analysisMode] || result;

    if (typeof currentData === "object" && currentData !== null) {
      const { title, category, summary, glossary } = currentData;
      cleanText += `${title || "無題"}\n`;
      if (category) cleanText += `カテゴリ: ${category}\n`;
      cleanText += `\n${summary}\n`;

      if (glossary && glossary.length > 0) {
        cleanText += `\n【用語辞典】\n`;
        glossary.forEach((item) => {
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

  // --- Derived State for UI ---
  let manuscriptPages = $derived(Math.ceil(targetLength / 400));
  let thumbPosition = $derived((targetLength / 4000) * 100);

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
  let isFree = $derived(!isPremium);

  let dailyRemaining = $derived.by(() => {
    if (isPremium) return Infinity;
    const today = new Date().toISOString().split("T")[0];
    const dailyUsage = userData?.dailyUsage || {
      count: 0,
      lastResetDate: today,
    };
    if (dailyUsage.lastResetDate !== today) return 3;
    return Math.max(0, 3 - dailyUsage.count);
  });

  let selectedSummary = $derived.by(() => {
    const parts = [];
    if (pdfFile) parts.push("PDF");
    if (txtFile) parts.push("TXT");
    if (audioFile) parts.push("Audio");
    if (imageFile) parts.push("Image");
    if (videoFile) parts.push("Video");
    if (targetUrl) parts.push("URL");
    const transcriptLen = $transcript.length;
    if (transcriptLen > 0 && !$isRecording) parts.push("Transcript");

    if (parts.length === 0) return null;
    return parts.join(" + ");
  });

  let headerTitle = $derived(
    analysisMode === "note"
      ? "講義ノート (復習用)"
      : analysisMode === "thoughts"
        ? "感想・リアクション (提出用)"
        : "学術レポート (課題用)",
  );

  let containerBgColor = $derived(
    analysisMode === "note"
      ? "bg-white/60"
      : analysisMode === "thoughts"
        ? "bg-amber-50/60"
        : "bg-slate-50/60",
  );

  // --- Lifecycle & Auth ---
  let wakeLock = $state<WakeLockSentinel | null>(null);

  // Wake Lock & Navigation Warning
  $effect(() => {
    if (analyzing || isExtractingAudio) {
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
  });

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

    // ... (rest of onMount)

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

  // ... (Keep existing onMount logic) ...

  // Global SpeechRecognition is managed in +layout via recognitionService

  // --- Functions ---

  function startProgress() {
    progressValue = 0;
    progressStatus = "音声データを解析中...";

    // Simulate realistic progress steps
    progressInterval = setInterval(() => {
      if (progressValue < 30) {
        progressValue += Math.random() * 2;
        progressStatus = "音声データを解析中...";
      } else if (progressValue < 60) {
        progressValue += Math.random() * 1.5;
        progressStatus = "講義の構造を分析中...";
      } else if (progressValue < 85) {
        progressValue += Math.random() * 0.5;
        progressStatus =
          analysisMode === "thoughts"
            ? "想いを言語化中..."
            : analysisMode === "report"
              ? "論理構成を構築中..."
              : "ノートをまとめています...";
      } else if (progressValue < 95) {
        progressValue += 0.1;
        progressStatus = "仕上げ中...";
      }
    }, 200);
  }

  async function uploadToStorage(file: File | Blob): Promise<string> {
    const originalName = (file as File).name || "extracted_audio.mp3";
    const filename = `${Date.now()}_${originalName}`;
    const storageRef = ref(storage, `video/${user.uid}/${filename}`);

    // Note: We create the upload task INSIDE the retry operation for retries,
    // BUT uploadBytesResumable is stateful.
    // However, for a simple implementation, if we retry, we might want to start fresh
    // or resume. Here we will start a new upload for simplicity on retry,
    // or arguably, we should reuse the task if it's resumable.
    // Given the complexity, let's just make a new task per attempt to avoid state issues.

    return retryOperation(async () => {
      return new Promise((resolve, reject) => {
        const uploadTask = uploadBytesResumable(storageRef, file);

        // Listen for abort signal
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
            const progress =
              (snapshot.bytesTransferred / snapshot.totalBytes) * 100;
            progressValue = 40 + progress * 0.4; // Mapping 0-100 to 40-80% of total progress
            progressStatus = "ファイルをアップロード中...";
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
            const downloadURL = await getDownloadURL(uploadTask.snapshot.ref);
            resolve(downloadURL);
          },
        );
      });
    });
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

  async function stopProgress() {
    clearInterval(progressInterval);
    // Smoothly animate to 100%
    const remaining = 100 - progressValue;
    const steps = 10;
    const stepSize = remaining / steps;

    for (let i = 0; i < steps; i++) {
      progressValue += stepSize;
      await new Promise((r) => setTimeout(r, 20)); // Fast animation
    }
    progressValue = 100;
    progressStatus = "完了";
    await new Promise((r) => setTimeout(r, 500)); // Show 100% momentarily
  }

  function setAnalysisMode(newMode: "note" | "thoughts" | "report") {
    if ((newMode === "thoughts" || newMode === "report") && !isPremium) {
      showUpgradeModal = true;
      return;
    }
    analysisMode = newMode;
  }

  function handleLengthChange(e: Event) {
    let val = parseInt((e.target as HTMLInputElement).value);
    if (val < 100) val = 100; // Snap to 100 min

    if (!isPremium && val > 500) {
      showUpgradeModal = true;
      upgradeModalTitle = "プレミアムプラン限定";
      upgradeModalMessage =
        "フリープランの解析上限は500文字です。<br />プレミアムプランなら2000文字、アルティメットプランなら4000文字まで拡張されます。";
      toastMessage = "フリープランは500文字までです";
      setTimeout(() => (toastMessage = null), 3000);
      targetLength = 500; // Force back
      return;
    }

    if (!isUltimate && val > 2000) {
      showUpgradeModal = true;
      upgradeModalTitle = "アルティメットプラン限定";
      upgradeModalMessage =
        "アルティメットプランなら、最大4000文字（原稿用紙10枚分）の超ロング解析が可能です。";
      toastMessage = "2000文字以上はアルティメット限定です";
      setTimeout(() => (toastMessage = null), 3000);
      targetLength = 2000; // Force back
      return;
    }
    targetLength = val;
  }

  function toggleRecording() {
    recognitionService.toggle();
  }

  function handleFileChange(
    event: Event,
    type: "pdf" | "txt" | "audio" | "image" | "video",
  ) {
    const input = event.target as HTMLInputElement;
    if (input.files && input.files.length > 0) {
      audioUploadPromise = null; // Reset previous upload
      if (type === "pdf") pdfFile = input.files[0];
      else if (type === "txt") txtFile = input.files[0];
      else if (type === "audio") audioFile = input.files[0];
      else if (type === "image") imageFile = input.files[0];
      else if (type === "video") {
        const file = input.files[0];
        videoFile = file;
        // Automatically extract and compress audio if it's a video
        extractAudio(file);
      }
    }
  }

  async function extractAudio(file: File) {
    try {
      isExtractingAudio = true;
      const result = await extractAudioFromVideo(file, (p) => {
        extractionProgress = p;
      });
      audioFile = new File(
        [result.blob],
        file.name.replace(/\.[^/.]+$/, "") + ".wav",
        {
          type: "audio/wav",
        },
      );
      videoFile = null; // Prioritize audio for analysis savings
      toastMessage = "🎥 デジタル高速抽出完了 (WAV 16kHz)";

      // Start background upload immediately
      audioUploadPromise = uploadToStorage(audioFile);

      setTimeout(() => (toastMessage = null), 3000);
    } catch (e: any) {
      console.error(e);
      toastMessage = "音声の抽出に失敗しました: " + e.message;
    } finally {
      isExtractingAudio = false;
      extractionProgress = null;
    }
  }

  function handleCancelAnalysis() {
    if (cancellationController) {
      cancellationController.abort();
      cancellationController = null;
      analyzing = false;
      result = "";
      toastMessage = "解析を中断しました";
      setTimeout(() => (toastMessage = null), 3000);
      stopProgress();
    }
  }

  async function handleAnalyze() {
    // Prevent double submission
    if (analyzing || isExtractingAudio) return;

    // Validate Course Name
    if (!courseName.trim()) {
      showCourseNameError = true;
      toastMessage = "講義名を入力してください";
      return;
    }

    if (
      !pdfFile &&
      !txtFile &&
      !audioFile &&
      !imageFile &&
      !videoFile &&
      !targetUrl &&
      !$transcript
    ) {
      toastMessage = "学習素材を入力してください";
      return;
    }

    // YouTube URL Validation - Block YouTube links
    if (
      targetUrl &&
      (targetUrl.includes("youtube.com") || targetUrl.includes("youtu.be"))
    ) {
      toastMessage = "YouTubeは未対応です（動画ファイルはOK）";
      return;
    }

    // Usage Quota Check
    console.log(
      `🚀 HandleAnalyze - Plan: ${userData?.plan || "free"}, isPremium: ${isPremium}, isUltimate: ${isUltimate}`,
    );

    const usageCount = userData?.usageCount || 0;

    if (!isPremium && usageCount >= 5) {
      showUpgradeModal = true;
      toastMessage = "今月の制限に達しました";
      setTimeout(() => (toastMessage = null), 4000);
      return;
    }

    // Feature Gating: Relaxed PDF analysis (2 trials)
    if (pdfFile && !isPremium) {
      const pdfUsage = $lectures.filter((l: any) => l.hasPdf).length;
      if (pdfUsage >= 2) {
        showUpgradeModal = true;
        return;
      }
    }

    // Feature Gating: Report Mode (Premium Only)
    if (analysisMode === "report" && !isPremium) {
      showUpgradeModal = true;
      toastMessage = "レポート作成モードはPremiumプラン限定です";
      return;
    }

    // Feature Gating: Video / Audio / URL (Ultimate Only)
    if ((videoFile || audioFile || targetUrl) && !isUltimate) {
      showUpgradeModal = true;
      toastMessage = "動画・URL解析はアルティメットプラン限定です";
      return;
    }

    // Feature Gating: Video Length/Size (Ultimate Only - though already blocked above, strictly enforced here)
    if (videoFile && !isUltimate) {
      // Redundant but safe
      showUpgradeModal = true;
      return;
    }
    // Let's set a conservative limit for free tier: 200MB (Actually blocked above, but kept for logic safety if rules change)
    if (videoFile && !isPremium && videoFile.size > 200 * 1024 * 1024) {
      // This branch is theoretically unreachable now for Non-Ultimate,
      // but meaningful if we allow Premium video in future.
      // Current rule: Video/URL is Ultimate ONLY.
      showUpgradeModal = true;
      toastMessage = "動画・URL解析はアルティメットプラン限定です";
      return;
    }

    analyzing = true;
    startProgress(); // Start visual feedback
    result = "";
    lectureAnalyses = {}; // Reset accumulation
    toastMessage = null; // Clear previous toast

    // Cleanup tracker (Defined here to be available in finally block)
    let uploadedUrls: string[] = [];

    try {
      console.log("Analyzing...");
      const idToken = await user.getIdToken();

      // --- Storage-first Upload ---
      let audioUrl = "";
      let videoUrl = "";
      let pdfUrl = "";
      let imageUrl = "";

      // Cleanup tracker
      const uploadedUrls: string[] = [];

      if (audioFile) {
        if (audioUploadPromise) {
          progressStatus = "アップロード完了を待機中...";
          audioUrl = await audioUploadPromise;
        } else {
          progressStatus = "音声ファイルをアップロード中...";
          audioUrl = await uploadToStorage(audioFile);
        }
      }
      if (videoFile) {
        progressStatus = "動画ファイルをアップロード中...";
        videoUrl = await uploadToStorage(videoFile);
      }
      if (pdfFile) {
        progressStatus = "PDFファイルをアップロード中...";
        pdfUrl = await uploadToStorage(pdfFile);
      }
      if (imageFile) {
        progressStatus = "画像ファイルをアップロード中...";
        imageUrl = await uploadToStorage(imageFile);
      }

      if (audioUrl) uploadedUrls.push(audioUrl);
      if (videoUrl) uploadedUrls.push(videoUrl);
      if (pdfUrl) uploadedUrls.push(pdfUrl);
      if (imageUrl) uploadedUrls.push(imageUrl);

      const formData = new FormData();
      if (audioUrl) formData.append("audioUrl", audioUrl);
      if (videoUrl) formData.append("videoUrl", videoUrl);
      if (pdfUrl) formData.append("pdfUrl", pdfUrl);
      if (imageUrl) formData.append("imageUrl", imageUrl);
      if (txtFile) formData.append("txt", txtFile as Blob); // TXT is small, keep direct
      if (targetUrl) formData.append("url", targetUrl);

      formData.append("transcript", $transcript);
      formData.append("mode", analysisMode);
      formData.append("plan", userData?.plan || "free");
      formData.append("targetLength", targetLength.toString());

      // Initialize AbortController for this session
      cancellationController = new AbortController();
      const signal = cancellationController.signal;

      // Timeout safety (90s) - combined with cancellation
      const timeoutId = setTimeout(() => {
        if (cancellationController) cancellationController.abort("timeout");
      }, 90000);
      const response = await retryOperation(async () => {
        const res = await fetch("/api/analyze", {
          method: "POST",
          body: formData,
          headers: {
            Authorization: `Bearer ${idToken}`,
          },
          signal: signal,
        });

        if (!res.ok) {
          // Retry on 5xx errors or network issues
          if (res.status >= 500) throw new Error(`Server Error: ${res.status}`);
          // Don't retry on 4xx errors
          return res;
        }
        return res;
      });

      clearTimeout(timeoutId);

      if (response.status === 403) {
        const errorData = await response.json();
        showUpgradeModal = true;
        toastMessage = errorData.error || "本日の上限に達しました";
        setTimeout(() => (toastMessage = null), 5000);
        return;
      }

      if (!response.ok) {
        throw new Error("Analysis failed");
      }

      const data = await response.json();

      // Handle JSON Response (Title + Category + Summary + Glossary)
      if (data.result && typeof data.result === "object") {
        const { title, category, summary, glossary } = data.result;

        // Auto-Title
        if (title) {
          analyzedTitle = title;
          if (!lectureTitle || lectureTitle.startsWith("講義 20")) {
            lectureTitle = title;
          }
        }

        // Auto-Category / Folder Sorting
        if (category) {
          analyzedCategory = category;
          const matchedSubject = $subjects.find(
            (s: any) =>
              s.name.toLowerCase().includes(analyzedCategory.toLowerCase()) ||
              analyzedCategory.toLowerCase().includes(s.name.toLowerCase()),
          );

          if (matchedSubject) {
            // PROPOSAL: Don't move yet, just suggest
            categoryTag = category; // Keep tag as visual hint
            // Store proposal to be displayed
            // Note: docSnap.id is only available after save, but we can set it here if we await save first
          } else {
            categoryTag = category;
            currentBinder.set(null); // Keep in Inbox but keep tag
          }
        }

        // Store Structured Data
        const structuredResult = { title, category, summary, glossary };

        // Update State
        lectureAnalyses = {
          ...lectureAnalyses,
          [analysisMode]: structuredResult,
        };
        // Save the structured object as the primary result
        result = structuredResult;

        initialGenerationDone = true;
      } else {
        // Fallback handling
        const textRes = data.text || data.result || "";
        lectureAnalyses = { ...lectureAnalyses, [analysisMode]: textRes };
        result = textRes;
      }

      // Legacy extraction fallback (if not in JSON)
      if (!lectureTitle || lectureTitle.startsWith("講義 20")) {
        const textToCheck =
          typeof result === "string" ? result : result.summary;
        const firstLine = textToCheck.split("\n")[0].trim();
        if (firstLine.startsWith("# ")) {
          const extractedTitle = firstLine
            .replace(/^#\s*/, "")
            .replace(/^【|】$/g, "")
            .trim();
          lectureTitle = extractedTitle;
        }
      }

      const savedLectureId = await saveLecture();

      // Set proposal after save so we have the ID
      if (analyzedCategory) {
        const matchedSubject = $subjects.find(
          (s: any) =>
            s.name.toLowerCase().includes(analyzedCategory.toLowerCase()) ||
            analyzedCategory
              .toLowerCase()
              .includes(analyzedCategory.toLowerCase()),
        );
        if (matchedSubject && savedLectureId) {
          analysisProposal = {
            lectureId: savedLectureId as string,
            subjectId: matchedSubject.id,
            subjectName: matchedSubject.name,
          };
        }
      }

      // Toast & Auto-scroll
      toastMessage = "解析が完了しました";
      setTimeout(() => {
        toastMessage = null;
      }, 3000);

      await tick();
      if (resultContainer) {
        (resultContainer as HTMLElement).scrollIntoView({
          behavior: "smooth",
          block: "start",
        });
      }

      // Increment Usage Count (Free tier)
      if (!isPremium && user) {
        const userRef = doc(db, "users", user.uid);
        await setDoc(userRef, { usageCount: usageCount + 1 }, { merge: true });
      }
    } catch (e: any) {
      console.error(e);
      if (e.name === "AbortError") {
        if (cancellationController?.signal.reason === "timeout") {
          toastMessage = "⌛ 解析がタイムアウトしました。";
        } else {
          toastMessage = "🛑 解析を中断しました。";
        }
      } else {
        toastMessage = "解析エラーが発生しました: " + (e as Error).message;
      }
    } finally {
      await stopProgress();
      analyzing = false;
      setTimeout(() => (toastMessage = null), 6000);

      // Automatic Cleanup
      if (uploadedUrls.length > 0) {
        console.log("Cleaning up storage files...");
        await Promise.all(uploadedUrls.map((url) => deleteFromStorage(url)));
      }
    }
  }

  async function handleDerivativeGenerate(
    targetMode: "note" | "thoughts" | "report",
  ) {
    if (lectureAnalyses[targetMode]) {
      analysisMode = targetMode;
      result = lectureAnalyses[targetMode];
      return;
    }

    // Must have a source to derive from
    const sourceContent = typeof result === "object" ? result.summary : result;
    if (!sourceContent) return;

    derivativeAnalyzing = true;
    analysisMode = targetMode;
    startProgress();

    // Implement AbortController for timeout handling
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 55000); // 55 second timeout

    try {
      const idToken = await user.getIdToken();
      const response = await fetch("/api/analyze-derivative", {
        method: "POST",
        body: JSON.stringify({
          sourceAnalysis: sourceContent,
          targetMode,
          targetLength,
        }),
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${idToken}`,
        },
        signal: controller.signal,
      });

      clearTimeout(timeoutId);

      if (!response.ok) throw new Error("Derivative generation failed");

      const data = await response.json();
      const newResult = data.result.summary;

      // Update accumulation
      lectureAnalyses = { ...lectureAnalyses, [targetMode]: newResult };
      result = newResult;

      // Save the updated lecture with multiple analyses
      await saveLecture();

      toastMessage = "新しい形式を生成しました";
      setTimeout(() => (toastMessage = null), 3000);
    } catch (e: any) {
      console.error(e);
      if (e.name === "AbortError") {
        toastMessage =
          "⌛ 派生データの生成に時間がかかっています。しばらく経ってから再度お試しください。";
      } else {
        toastMessage = "追加生成エラー: " + (e as Error).message;
      }
    } finally {
      await stopProgress();
      derivativeAnalyzing = false;
      setTimeout(() => (toastMessage = null), 6000);
    }
  }

  function toggleLectureSelection(lectureId: string) {
    if (selectedLectureIds.has(lectureId)) {
      selectedLectureIds.delete(lectureId);
    } else {
      selectedLectureIds.add(lectureId);
    }
    // Svelte 5 Set reactivity: re-assign to trigger updates if needed,
    // but Set is not reactive in Svelte 5 by default unless using a proxy or re-assignment.
    // Let's use re-assignment for now.
    selectedLectureIds = new Set(selectedLectureIds);
  }

  async function bulkMoveLectures(targetSubjectId: string | null) {
    const ids = Array.from(selectedLectureIds);
    if (ids.length === 0) return;

    const count = ids.length;
    toastMessage = `${count}件を移動中...`;

    try {
      await Promise.all(ids.map((id) => moveLecture(id, targetSubjectId)));
      selectedLectureIds = new Set();
      toastMessage = `${count}件を移動しました`;
      setTimeout(() => (toastMessage = null), 2000);
    } catch (e) {
      console.error("Bulk move error", e);
      toastMessage = "一括移動中にエラーが発生しました";
    }
  }

  async function saveLecture() {
    if (!user) return null;

    const lectureData = {
      title: lectureTitle || `講義 ${new Date().toLocaleString()}`,
      content: $transcript,
      analysis: result,
      analyses: lectureAnalyses, // Save all generated formats
      analysisMode: analysisMode,
      targetLength: targetLength,
      categoryTag: categoryTag || null,
      updatedAt: serverTimestamp(),
      subjectId: $currentBinder || null, // Ensure subjectId is saved
      university: userData?.university || null, // Save university context
      courseName: courseName.trim(),
      normalizedCourseName: normalizeCourseName(courseName.trim()),
      isShared: isShared,
      sourceType: videoFile
        ? "video"
        : audioFile
          ? "audio"
          : targetUrl
            ? "url"
            : pdfFile
              ? "pdf"
              : txtFile
                ? "txt"
                : "text",
    };

    try {
      // 1. Save to masterCourses if shared and university is set
      if (isShared && userData?.university && courseName.trim()) {
        const normalized = normalizeCourseName(courseName.trim());
        const masterCourseId = `${userData.university}_${normalized}`;
        const masterCourseRef = doc(db, "masterCourses", masterCourseId);

        // Try to update or create masterCourse
        await setDoc(
          masterCourseRef,
          {
            courseName: courseName.trim(),
            normalizedCourseName: normalized,
            university: userData.university,
            teacherName: (result as any)?.teacherName || null, // Extract if available
            faculty: (result as any)?.faculty || analyzedCategory || null,
            evaluationCriteria: (result as any)?.evaluationCriteria || null,
            updatedAt: serverTimestamp(),
          },
          { merge: true },
        );
      }

      // 2. Save the lecture itself
      if (currentLectureId) {
        // Find the existing lecture to get its path
        const existingLecture = $lectures.find(
          (l: any) => l.id === currentLectureId,
        );

        let docRef;
        if (existingLecture && (existingLecture as any).path) {
          docRef = doc(db, (existingLecture as any).path);
        } else {
          // Fallback to root (shouldn't happen with new logic, but for safety)
          console.warn(
            "Could not find path for existing lecture, defaulting to root",
          );
          docRef = doc(db, `users/${user.uid}/lectures`, currentLectureId);
        }

        await setDoc(docRef, lectureData, { merge: true });
      } else {
        // New Lecture
        const collectionPath = $currentBinder
          ? `users/${user.uid}/subjects/${$currentBinder}/lectures`
          : `users/${user.uid}/lectures`;

        const docRef = await addDoc(collection(db, collectionPath), {
          ...lectureData,
          createdAt: serverTimestamp(),
        });
        currentLectureId = docRef.id;
        return docRef.id;
      }
      return currentLectureId;
    } catch (e) {
      console.error("Error saving lecture:", e);
      toastMessage = "保存に失敗しました";
      return null;
    }
  }

  async function handleGenerateSeriesSummary() {
    const isPremium =
      userData?.plan === "pro" ||
      userData?.plan === "premium" ||
      userData?.plan === "season";
    if (!isPremium) {
      showUpgradeModal = true;
      return;
    }

    if (!selectedSubjectId) return;

    const subjectLectures = $lectures.filter(
      (l) => l.subjectId === selectedSubjectId,
    );
    if (subjectLectures.length === 0) {
      toastMessage = "解析可能な講義がありません";
      return;
    }

    analyzingSeries = true;
    seriesSummary = null;

    // Implement AbortController for timeout handling
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 55000); // 55 second timeout

    try {
      const subject = $subjects.find((s) => s.id === selectedSubjectId);
      const response = await fetch("/api/analyze-series", {
        method: "POST",
        body: JSON.stringify({
          uid: user.uid,
          subjectId: selectedSubjectId,
          subjectName: subject?.name || "Unknown Subject",
          customInstructions: customAnalysisInstructions, // Pass custom instructions
          lectures: subjectLectures.map((l) => ({
            id: l.id,
            title: l.title,
            date: l.createdAt
              ? new Date(l.createdAt.toDate()).toLocaleDateString()
              : "Unknown Date",
            content: l.content,
          })),
        }),
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${await user.getIdToken()}`,
        },
        signal: controller.signal,
      });

      clearTimeout(timeoutId);

      if (response.status === 403) {
        showUpgradeModal = true;
        toastMessage = "本日の解析上限に達しました";
        setTimeout(() => (toastMessage = null), 5000);
        return;
      }

      if (!response.ok) throw new Error("Failed to generate summary");

      const data = await response.json();
      seriesSummary = data;
    } catch (e: any) {
      console.error(e);
      if (e.name === "AbortError") {
        toastMessage =
          "⌛ まとめ解析に時間がかかっています。しばらく経ってから再度お試しください。";
      } else {
        toastMessage = "まとめ解析に失敗しました";
      }
    } finally {
      analyzingSeries = false;
      setTimeout(() => (toastMessage = null), 6000);
    }
  }

  async function generateFinalSummary() {
    if (!selectedSubjectId || analyzingFinal) return;

    try {
      analyzingFinal = true;
      const subject = $subjects.find((s) => s.id === selectedSubjectId);
      const subjectLectures = $lectures.filter(
        (l) => l.subjectId === selectedSubjectId && l.analysis,
      );

      if (subjectLectures.length === 0) {
        toastMessage = "要約済みの講義がありません";
        return;
      }

      // Implement AbortController for timeout handling
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 55000); // 55 second timeout

      const response = await fetch("/api/analyze-final", {
        method: "POST",
        body: JSON.stringify({
          subjectName: subject?.name || "Unknown Subject",
          customInstructions: customAnalysisInstructions,
          analyses: subjectLectures.map((l) => ({
            title: l.title,
            analysis: l.analysis,
          })),
        }),
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${await user.getIdToken()}`,
        },
        signal: controller.signal,
      });

      clearTimeout(timeoutId);

      if (response.status === 403) {
        showUpgradeModal = true;
        toastMessage = "本日の解析上限に達しました";
        setTimeout(() => (toastMessage = null), 5000);
        return;
      }

      if (!response.ok) throw new Error("まとめの生成に失敗しました");
      const data = await response.json();

      // Store result and switch to final exam view
      finalExamResult = data.result;
      finalExamView = true;
    } catch (e: any) {
      console.error(e);
      if (e.name === "AbortError") {
        toastMessage =
          "⌛ 試験対策ノートの生成に時間がかかっています。しばらく経ってから再度お試しください。";
      } else {
        toastMessage = "エラー: " + e.message;
      }
    } finally {
      analyzingFinal = false;
      setTimeout(() => (toastMessage = null), 6000);
    }
  }

  async function loadLecture(lecture: any) {
    if ($isRecording) recognitionService.stop();

    currentLectureId = lecture.id;
    // Don't auto-deselect subject, keep context
    lectureTitle = lecture.title;
    // Update global transcript store when loading a lecture
    resetTranscript();
    finalTranscript.set(lecture.content || "");

    // Restore settings with defaults
    const modeMap: Record<string, "note" | "thoughts" | "report"> = {
      summary: "note",
      analysis: "report",
      note: "note",
      thoughts: "thoughts",
      report: "report",
    };
    analysisMode = modeMap[lecture.analysisMode] || "note";
    targetLength = lecture.targetLength || 1000;

    result = lecture.analysis || "";
    lectureAnalyses =
      lecture.analyses || (result ? { [analysisMode]: result } : {});
    initialGenerationDone = !!result;
    isEditing = false; // Switch to View Mode

    localStorage.setItem("transcript", $transcript);

    // Auto-scroll to top of main content area
    await tick();
    const mainArea = document.querySelector("main");
    if (mainArea) {
      mainArea.scrollIntoView({ behavior: "smooth", block: "start" });
    }
  }

  function handleSelectSubject(subjectId: string | null) {
    if ($isRecording) recognitionService.stop();
    currentBinder.set(subjectId);
    currentLectureId = null; // Clear lecture selection

    // Show Dashboard
    isEditing = false;

    // Reset editor state
    lectureTitle = "";
    resetTranscript();
    result = "";
    pdfFile = null;
    txtFile = null;
    audioFile = null;
    imageFile = null;
    videoFile = null;
    targetUrl = "";
    localStorage.removeItem("transcript");
  }

  function startNewLecture() {
    if ($isRecording) recognitionService.stop();

    currentLectureId = null;
    currentBinder.set(null); // Clear subject selection
    lectureTitle = "";
    resetTranscript();
    result = "";
    pdfFile = null;
    txtFile = null;
    audioFile = null;
    imageFile = null;
    videoFile = null;
    targetUrl = "";
    analysisMode = "note";
    targetLength = 1000;

    isEditing = true; // Switch to Edit Mode
    finalExamView = false;
    finalExamResult = "";
    lectureAnalyses = {};
    initialGenerationDone = false;
    derivativeAnalyzing = false;
    analyzing = false;
    analyzingSeries = false;
    analyzingFinal = false;
    progressValue = 0;

    analyzedTitle = "";
    analyzedCategory = "";
    categoryTag = "";

    const pdfInput = document.getElementById("pdf-upload") as HTMLInputElement;
    if (pdfInput) pdfInput.value = "";
    const txtInput = document.getElementById("txt-upload") as HTMLInputElement;
    if (txtInput) txtInput.value = "";

    localStorage.removeItem("transcript");
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

  let parsedHtml = $derived(
    result
      ? typeof result === "object"
        ? marked.parse(result.summary)
        : marked.parse(result)
      : "",
  );

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
          onclick={() => {
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
          onclick={() => (analysisProposal = null)}
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
                onclick={() => bulkMoveLectures(subject.id)}
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
              onclick={() => bulkMoveLectures(null)}
              class="w-full text-left px-4 py-2.5 hover:bg-red-50 text-red-600 flex items-center gap-3 transition-colors"
            >
              <span class="text-xs font-medium">インボックスに戻す</span>
            </button>
          </div>
        </div>

        <button
          onclick={() => {
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
  {#snippet LectureItem(lecture: any)}
    <div
      draggable="true"
      ondragstart={(e) => handleDragStartToSidebar(e, lecture.id)}
      class="contents"
      role="article"
    >
      <div class="group relative">
        <!-- Checkbox (Overlay on hover or persistent if selected) -->
        <div
          class="absolute top-4 left-4 z-20 transition-all duration-300
          {selectedLectureIds.has(lecture.id)
            ? 'opacity-100'
            : 'opacity-0 group-hover:opacity-100'}"
        >
          <button
            onclick={(e) => {
              e.stopPropagation();
              toggleLectureSelection(lecture.id);
            }}
            class="w-6 h-6 rounded-lg border-2 flex items-center justify-center transition-all
            {selectedLectureIds.has(lecture.id)
              ? 'bg-indigo-600 border-indigo-600 text-white shadow-lg'
              : 'bg-white border-slate-200 hover:border-indigo-400'}"
          >
            {#if selectedLectureIds.has(lecture.id)}
              <svg
                class="w-4 h-4"
                fill="none"
                viewBox="0 0 24 24"
                stroke="currentColor"
              >
                <path
                  stroke-linecap="round"
                  stroke-linejoin="round"
                  stroke-width="3"
                  d="M5 13l4 4L19 7"
                />
              </svg>
            {/if}
          </button>
        </div>

        <!-- Quick Move Folder Icon -->
        <div
          class="absolute top-4 right-4 z-20 opacity-0 group-hover:opacity-100 transition-opacity"
        >
          <div class="relative group/mover">
            <button
              onclick={(e) => {
                e.stopPropagation();
                movingLectureId =
                  movingLectureId === lecture.id ? null : lecture.id;
              }}
              class="w-10 h-10 rounded-full bg-white shadow-md border border-slate-100 flex items-center justify-center text-slate-400 hover:text-indigo-600 hover:border-indigo-200 transition-all"
              title="フォルダへ移動"
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
                  d="M3 7v10a2 2 0 002 2h14a2 2 0 002-2V9a2 2 0 00-2-2h-6l-2-2H5a2 2 0 00-2 2z"
                />
              </svg>
            </button>

            <!-- Dropdown -->
            {#if movingLectureId === lecture.id}
              <div
                class="absolute top-full right-0 mt-2 w-48 bg-white rounded-2xl shadow-2xl border border-slate-100 py-2 z-50 animate-in zoom-in-95 duration-200"
              >
                <div
                  class="px-4 py-2 text-[10px] font-bold text-slate-400 uppercase tracking-wider"
                >
                  移動先
                </div>
                {#each $subjects as subject (subject.id)}
                  <button
                    onclick={(e) => {
                      e.stopPropagation();
                      moveLecture(lecture.id, subject.id);
                      movingLectureId = null;
                    }}
                    class="w-full text-left px-4 py-2 hover:bg-indigo-50 flex items-center gap-2 transition-colors"
                  >
                    <div class="w-2 h-2 rounded-full {subject.color}"></div>
                    <span class="text-xs text-slate-700">{subject.name}</span>
                  </button>
                {/each}
                <div class="h-px bg-slate-100 my-1"></div>
                <button
                  onclick={(e) => {
                    e.stopPropagation();
                    moveLecture(lecture.id, null);
                    movingLectureId = null;
                  }}
                  class="w-full text-left px-4 py-2 hover:bg-red-50 text-red-600 text-xs transition-colors"
                >
                  インボックスに戻す
                </button>
              </div>
            {/if}
          </div>
        </div>

        <button
          onclick={() => loadLecture(lecture)}
          ondragend={handleDragEnd}
          class="w-full text-left bg-white p-8 rounded-3xl border border-slate-100 shadow-sm hover:shadow-xl transition-all overflow-hidden relative
          {draggingLectureId === lecture.id
            ? 'opacity-40 scale-[0.98] rotate-[1deg] shadow-none pointer-events-none'
            : 'hover:-translate-y-1'}
          {selectedLectureIds.has(lecture.id)
            ? 'ring-2 ring-indigo-600 bg-indigo-50/10'
            : ''}"
        >
          <div class="pl-2">
            <h3
              class="font-bold text-slate-800 mb-3 truncate group-hover:text-indigo-600 transition-colors text-lg"
            >
              {lecture.title || "無題の講義"}
            </h3>
            <p class="text-xs text-slate-400 flex items-center gap-2">
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
                  d="M8 7V3m8 4V3m-9 8h10M5 21h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z"
                />
              </svg>
              {lecture.createdAt
                ? new Date(lecture.createdAt.toDate()).toLocaleDateString()
                : "下書き"}
            </p>
            <div class="mt-6 flex flex-wrap gap-2">
              <span
                class="text-[10px] px-2.5 py-1 bg-slate-100 text-slate-500 rounded-lg border border-slate-200 uppercase font-bold tracking-wider"
              >
                {lecture.analysisMode === "thoughts"
                  ? "感想"
                  : lecture.analysisMode === "report"
                    ? "レポート"
                    : "ノート"}
              </span>
              {#if lecture.categoryTag}
                <span
                  class="text-[10px] px-2.5 py-1 bg-indigo-50 text-indigo-600 rounded-lg border border-indigo-100 font-bold"
                >
                  🏷️ {lecture.categoryTag}
                </span>
              {/if}
            </div>
          </div>
        </button>
      </div>
    </div>
  {/snippet}

  {#snippet ResultDisplay()}
    {@const currentAnalysis = lectureAnalyses[analysisMode] || result}
    {#if currentAnalysis}
      <div
        bind:this={resultContainer}
        class="relative bg-white rounded-3xl shadow-sm border border-slate-100 p-8 md:p-12 animate-in fade-in slide-in-from-bottom-8 duration-700 overflow-hidden {analysisMode ===
        'note'
          ? 'bg-article-paper'
          : ''}"
      >
        <div class="absolute top-6 right-6 flex items-center gap-4 z-20">
          {#if !derivativeAnalyzing}
            <button
              onclick={copyResultToClipboard}
              class="flex items-center gap-2 px-3 py-1.5 rounded-xl bg-white/80 backdrop-blur-sm border border-slate-200 text-slate-500 hover:bg-white hover:border-indigo-300 hover:text-indigo-600 transition-all shadow-sm active:scale-95 group"
            >
              {#if isResultCopied}
                <span
                  class="text-[10px] font-bold text-emerald-600 animate-in fade-in"
                  >✅ コピー完了</span
                >
              {:else}
                <span class="text-xs group-hover:scale-110 transition-transform"
                  >📋</span
                >
                <span class="text-[10px] font-bold uppercase tracking-wider"
                  >コピー</span
                >
              {/if}
            </button>
          {/if}
        </div>

        {#if derivativeAnalyzing}
          <div class="py-20 text-center animate-in fade-in">
            <!-- ... existing loading ... -->
            <p class="text-slate-400">生成中...</p>
          </div>
        {:else}
          <!-- Video Player (Sticky) -->
          {#if previewVideoUrl && analysisMode === "note"}
            <div
              class="mb-8 sticky top-4 z-30 bg-white/95 backdrop-blur-md p-2 rounded-2xl shadow-lg border border-indigo-50 transition-all max-w-2xl mx-auto ring-1 ring-slate-900/50"
            >
              <video
                bind:this={videoPlayer}
                src={previewVideoUrl}
                controls
                class="w-full h-auto max-h-[300px] rounded-xl bg-black shadow-inner"
              >
                <track kind="captions" />
              </video>
              <p class="text-[10px] text-center text-slate-400 mt-1 font-bold">
                ノート内の <span
                  class="text-indigo-600 bg-indigo-50 px-1 rounded"
                  >[00:00]</span
                > をクリックしてシーク再生
              </p>
            </div>
          {/if}

          <!-- Rich Structured Display -->
          {#if typeof currentAnalysis === "object"}
            {@const isVideoSource =
              videoFile !== null ||
              $lectures.find((l) => l.id === currentLectureId)?.sourceType ===
                "video" ||
              $lectures.find((l) => l.id === currentLectureId)?.sourceType ===
                "audio"}

            <header class="mb-8 border-b border-indigo-50 pb-6">
              <div
                class="flex flex-wrap gap-2 mb-3 justify-between items-start"
              >
                <div class="flex gap-2">
                  {#if currentAnalysis.category}
                    <span
                      class="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-bold bg-indigo-50 text-indigo-700 border border-indigo-100"
                    >
                      {currentAnalysis.category}
                    </span>
                  {/if}
                  <span
                    class="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-bold bg-slate-50 text-slate-500 border border-slate-100 uppercase tracking-wider"
                  >
                    {analysisMode === "note"
                      ? "Lecture Note"
                      : analysisMode === "thoughts"
                        ? "Reflections"
                        : "Academic Report"}
                  </span>
                </div>

                <button
                  onclick={() => {
                    isEditing = true;
                    finalExamView = false;
                  }}
                  class="text-xs font-bold text-slate-400 hover:text-indigo-600 bg-slate-50 hover:bg-indigo-50 px-3 py-1.5 rounded-lg transition-colors flex items-center gap-1"
                >
                  <svg
                    class="w-3.5 h-3.5"
                    fill="none"
                    viewBox="0 0 24 24"
                    stroke="currentColor"
                    ><path
                      stroke-linecap="round"
                      stroke-linejoin="round"
                      stroke-width="2"
                      d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z"
                    /></svg
                  >
                  編集に戻る
                </button>
              </div>

              <h1
                class="text-2xl md:text-3xl font-extrabold text-slate-900 tracking-tight leading-tight"
              >
                {currentAnalysis.title || analyzedTitle || "Analysis Result"}
              </h1>
            </header>

            <!-- Main Content (Summary) -->
            <!-- svelte-ignore a11y_click_events_have_key_events -->
            <!-- svelte-ignore a11y_no_noninteractive_element_interactions -->
            <article
              bind:this={resultTextContainer}
              onclick={handleTimestampClick}
              class="prose prose-slate max-w-none
                prose-p:text-slate-700 prose-p:leading-8 prose-p:text-[17px]
                prose-headings:font-bold prose-headings:text-slate-900 prose-headings:tracking-tight
                prose-h2:text-xl prose-h2:mt-10 prose-h2:mb-4 prose-h2:border-l-4 prose-h2:border-indigo-500 prose-h2:pl-3
                prose-h3:text-lg prose-h3:text-indigo-900
                prose-ul:my-6 prose-li:my-1 prose-li:text-slate-700
                prose-strong:text-indigo-900 prose-strong:font-bold
                prose-a:text-indigo-600 prose-a:no-underline hover:prose-a:underline
                prose-blockquote:border-l-indigo-300 prose-blockquote:bg-indigo-50/30 prose-blockquote:py-1 prose-blockquote:px-4 prose-blockquote:rounded-r-lg"
            >
              {@html (
                marked.parse(
                  isVideoSource
                    ? displaySummary
                    : displaySummary.replace(
                        /\[(\d{1,2}:\d{2}(?::\d{2})?)\]/g,
                        "",
                      ),
                ) as string
              ).replace(
                /\[(\d{1,2}:\d{2}(?::\d{2})?)\]/g,
                '<button class="timestamp-link inline-flex items-center gap-1 bg-indigo-50 text-indigo-700 px-1.5 py-0.5 rounded-md text-xs font-bold hover:bg-indigo-100 hover:text-indigo-800 transition-colors cursor-pointer select-none border border-indigo-100/50" data-timestamp="$1">▶ $1</button>',
              )}
            </article>

            <!-- Strategy Guide -->
            {#if strategyContent}
              <div
                class="mt-8 relative group overflow-hidden rounded-2xl border-2 transition-all duration-500 {isPremium
                  ? 'border-amber-400 bg-amber-50'
                  : 'border-slate-200 bg-slate-50'}"
              >
                <!-- Header -->
                <div
                  class="bg-gradient-to-r {isPremium
                    ? 'from-amber-400 to-amber-500 text-white'
                    : 'from-slate-200 to-slate-300 text-slate-500'} px-6 py-3 font-bold flex items-center gap-2"
                >
                  <span class="text-xl">{isPremium ? "🏆" : "🔒"}</span>
                  <span>A評価攻略ガイド</span>
                  {#if isPremium}
                    <span
                      class="ml-auto text-xs bg-white/20 px-2 py-0.5 rounded text-amber-50 font-normal"
                      >{isUltimate ? "Ultimate" : "Premium"}</span
                    >
                  {/if}
                </div>

                <!-- Content -->
                <div class="p-6 relative">
                  <div
                    class="prose prose-sm max-w-none prose-p:text-slate-700 prose-headings:text-amber-900 {isPremium
                      ? ''
                      : 'blur-sm select-none opacity-50 pointer-events-none'}"
                  >
                    {@html marked.parse(strategyContent)}
                  </div>

                  <!-- Lock Overlay for Free Users -->
                  {#if !isPremium}
                    <div
                      class="absolute inset-0 z-10 flex flex-col items-center justify-center p-6 text-center"
                    >
                      <div
                        class="bg-white/90 backdrop-blur-sm p-6 rounded-2xl shadow-xl border border-white/50 max-w-sm"
                      >
                        <div
                          class="w-12 h-12 bg-slate-100 rounded-full flex items-center justify-center mx-auto mb-4 text-2xl"
                        >
                          🔒
                        </div>
                        <h3 class="font-bold text-slate-900 mb-2">
                          A評価攻略ガイドをアンロック
                        </h3>
                        <p class="text-xs text-slate-500 mb-4 leading-relaxed">
                          この講義の「評価基準」に基づいた、具体的な高評価獲得戦略（レポートのキーワードやテスト対策など）を表示します。
                        </p>
                        <button
                          onclick={() => (showUpgradeModal = true)}
                          class="w-full bg-slate-900 text-white py-3 rounded-xl text-sm font-bold shadow-lg shadow-slate-900/10 hover:shadow-xl hover:-translate-y-0.5 transition-all"
                        >
                          プレミアムプランにアップグレード
                        </button>
                      </div>
                    </div>
                  {/if}
                </div>
              </div>
            {/if}

            <!-- Glossary Section (Conditional) -->
            {#if currentAnalysis.glossary && currentAnalysis.glossary.length > 0}
              <section class="mt-16 pt-10 border-t border-slate-200/60">
                <h3
                  class="flex items-center gap-2 text-lg font-bold text-slate-900 mb-6"
                >
                  <span class="text-xl">📚</span> 用語辞典
                </h3>
                <div class="grid grid-cols-1 md:grid-cols-2 gap-4">
                  {#each currentAnalysis.glossary as item}
                    <div
                      class="bg-slate-50/80 rounded-xl p-4 border border-slate-100 hover:border-indigo-100 hover:shadow-sm transition-all group"
                    >
                      <dt
                        class="font-bold text-indigo-900 text-[15px] mb-1 group-hover:text-indigo-700 flex items-baseline justify-between"
                      >
                        {item.term}
                      </dt>
                      <dd
                        class="text-sm text-slate-600 leading-relaxed text-[13px]"
                      >
                        {item.definition}
                      </dd>
                    </div>
                  {/each}
                </div>
              </section>
            {/if}
          {:else}
            <!-- Legacy String Rendering -->
            <!-- svelte-ignore a11y_click_events_have_key_events -->
            <!-- svelte-ignore a11y_no_noninteractive_element_interactions -->
            <article
              bind:this={resultTextContainer}
              onclick={handleTimestampClick}
              class="prose prose-slate max-w-none prose-headings:font-bold prose-headings:text-slate-800 prose-p:text-slate-600 prose-li:text-slate-600 prose-a:text-indigo-600 prose-strong:text-indigo-700 prose-strong:font-bold prose-code:text-pink-600 prose-code:bg-pink-50 prose-code:px-1 prose-code:rounded prose-pre:bg-slate-900 prose-pre:rounded-2xl prose-img:rounded-2xl prose-hr:border-slate-100 marker:text-indigo-400"
            >
              {@html (
                marked.parse(currentAnalysis as string) as string
              ).replace(
                /\[(\d{1,2}:\d{2}(?::\d{2})?)\]/g,
                '<button class="timestamp-link inline-flex items-center gap-1 bg-indigo-50 text-indigo-700 px-1.5 py-0.5 rounded-md text-xs font-bold hover:bg-indigo-100 hover:text-indigo-800 transition-colors cursor-pointer select-none" data-timestamp="$1">▶ $1</button>',
              )}
            </article>
          {/if}

          <div class="mt-12 pt-8 border-t border-slate-100">
            <p
              class="text-xs font-bold text-slate-400 uppercase tracking-widest mb-6 text-center"
            >
              他の形式も作成する
            </p>
            <div class="flex flex-wrap justify-center gap-4">
              <button
                onclick={() => handleDerivativeGenerate("note")}
                class="px-6 py-3 rounded-2xl font-bold transition-all flex items-center gap-2
                {analysisMode === 'note'
                  ? 'bg-indigo-600 text-white shadow-lg shadow-indigo-100'
                  : lectureAnalyses['note']
                    ? 'bg-white border border-indigo-200 text-indigo-600'
                    : 'bg-white border border-slate-200 text-slate-500 hover:border-indigo-300 hover:text-indigo-600'}"
              >
                {lectureAnalyses["note"] ? "✅ " : ""}ノート形式
              </button>
              <button
                onclick={() => handleDerivativeGenerate("thoughts")}
                class="px-6 py-3 rounded-2xl font-bold transition-all flex items-center gap-2
                {analysisMode === 'thoughts'
                  ? 'bg-amber-500 text-white shadow-lg shadow-amber-100'
                  : lectureAnalyses['thoughts']
                    ? 'bg-white border border-amber-200 text-amber-600'
                    : 'bg-white border border-slate-200 text-slate-500 hover:border-amber-300 hover:text-amber-600'}"
              >
                {lectureAnalyses["thoughts"] ? "✅ " : ""}感想文形式
              </button>
              <button
                onclick={() => handleDerivativeGenerate("report")}
                class="px-6 py-3 rounded-2xl font-bold transition-all flex items-center gap-2
                {analysisMode === 'report'
                  ? 'bg-slate-800 text-white shadow-lg shadow-slate-200'
                  : lectureAnalyses['report']
                    ? 'bg-white border border-slate-400 text-slate-800'
                    : 'bg-white border border-slate-200 text-slate-500 hover:border-slate-800 hover:text-slate-800'}"
              >
                {lectureAnalyses["report"] ? "✅ " : ""}レポート形式
              </button>
            </div>
          </div>
        {/if}
      </div>
    {/if}
  {/snippet}

  {#if user}
    <UpgradeModal
      isOpen={showUpgradeModal}
      onClose={() => (showUpgradeModal = false)}
      title={upgradeModalTitle}
      message={upgradeModalMessage}
    />
  {/if}

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
            onclick={() => {
              currentLectureId = null;
              isEditing = false; // Show dashboard
            }}
            class="mb-8 text-sm font-bold text-slate-400 hover:text-indigo-600 flex items-center gap-2 transition-colors"
          >
            ← 履歴リストへ戻る
          </button>

          <div class="mb-10">
            <h1 class="text-4xl font-bold text-slate-900 tracking-tight mb-2">
              {lectureTitle}
            </h1>
            <div
              class="h-1.5 w-24 bg-gradient-to-r from-indigo-600 to-pink-400 mt-4 rounded-full opacity-90"
            ></div>
          </div>

          {@render ResultDisplay()}
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
                onclick={() => {
                  finalExamView = false;
                }}
                class="px-6 py-3 font-bold transition-all relative {!finalExamView
                  ? 'text-indigo-600 border-b-2 border-indigo-600'
                  : 'text-slate-400 hover:text-slate-600'}"
              >
                📚 講義一覧
              </button>
              <button
                onclick={() => {
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
                        onclick={generateFinalSummary}
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
                      onclick={copyToClipboard}
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
              <!-- Lecture Grid -->
              <div class="grid grid-cols-1 md:grid-cols-2 gap-6 mt-10">
                {#each $lectures.filter((l: any) => l.subjectId === selectedSubjectId) as lecture (lecture.id)}
                  {@render LectureItem(lecture)}
                {/each}
                {#if $lectures.filter((l) => l.subjectId === selectedSubjectId).length === 0}
                  <div
                    ondragover={handleMainTargetDragOver}
                    ondragleave={handleMainTargetDragLeave}
                    ondrop={handleMainTargetDrop}
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
                    onclick={() => (isEditing = true)}
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
      {:else if !selectedSubjectId && !isEditing}
        <!-- Unassigned Dashboard (Inbox) -->
        <div class="mb-10">
          <div class="flex items-center justify-between mb-8">
            <div>
              <h1 class="text-4xl font-bold text-slate-900 tracking-tight">
                未分類の履歴
              </h1>
              <p class="text-slate-500 mt-2">
                {$lectures.filter((l) => !l.subjectId).length} 件の講義が整理を待っています
              </p>
            </div>
            <button
              onclick={() => startNewLecture()}
              class="bg-indigo-600 text-white px-6 py-3 rounded-xl font-bold hover:bg-indigo-700 transition-colors shadow-lg shadow-indigo-200 flex items-center gap-2"
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
              新しい講義を記録
            </button>
          </div>

          <div class="grid grid-cols-1 md:grid-cols-2 gap-4">
            {#each $lectures.filter((l: any) => !l.subjectId) as lecture (lecture.id)}
              {@render LectureItem(lecture)}
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
        </div>
      {:else}
        <!-- Input Form Mode (isEditing is true) -->
        <!-- ... (Keep existing Top Section & Inputs) ... -->
        <div class="mb-10 space-y-8">
          <div>
            <input
              type="text"
              bind:value={lectureTitle}
              placeholder="講義タイトル"
              class="bg-transparent border-none w-full text-4xl font-bold text-slate-900 placeholder-slate-300 focus:outline-none focus:ring-0 p-0 tracking-tight"
            />
            <!-- Momoyama Gradient Accent -->
            <div
              class="h-1.5 w-24 bg-gradient-to-r from-indigo-600 to-pink-400 mt-4 rounded-full opacity-90"
            ></div>
          </div>

          <!-- Waveform Animation (Visible only when Recording) -->
          {#if $isRecording}
            <div
              class="flex items-center justify-center gap-1.5 h-12 mb-4 animate-in fade-in duration-500"
            >
              <div
                class="w-1.5 bg-red-500 rounded-full animate-waveform-1 h-3"
              ></div>
              <div
                class="w-1.5 bg-red-500 rounded-full animate-waveform-2 h-6"
              ></div>
              <div
                class="w-1.5 bg-red-500 rounded-full animate-waveform-3 h-4"
              ></div>
              <div
                class="w-1.5 bg-red-500 rounded-full animate-waveform-2 h-8"
              ></div>
              <div
                class="w-1.5 bg-red-500 rounded-full animate-waveform-1 h-5"
              ></div>
              <div
                class="w-1.5 bg-red-500 rounded-full animate-waveform-3 h-3"
              ></div>
            </div>
            <p
              class="text-center text-red-500 font-bold text-[10px] tracking-widest uppercase animate-pulse mb-6"
            >
              Recording...
            </p>
          {/if}

          <!-- Controls Container -->
          {#if isEditing}
            <div
              class="{containerBgColor} backdrop-blur-sm rounded-2xl border border-white/50 p-6 transition-colors duration-500"
            >
              <!-- Settings Row -->
              <div class="flex flex-col md:flex-row gap-6 mb-6">
                <!-- 1. Segmented Control (Mode) -->
                <div class="flex-1">
                  <span
                    class="role-label text-xs font-bold text-slate-500 uppercase tracking-wide mb-2 block"
                    >生成モード</span
                  >
                  <div class="bg-indigo-50/50 p-1 rounded-xl flex shadow-inner">
                    <button
                      onclick={() => setAnalysisMode("note")}
                      class="flex-1 py-2 rounded-lg text-sm font-bold transition-all {analysisMode ===
                      'note'
                        ? 'bg-white text-indigo-900 shadow-sm'
                        : 'text-slate-500 hover:text-indigo-600'}"
                    >
                      ノート
                    </button>
                    <button
                      onclick={() => setAnalysisMode("thoughts")}
                      class="flex-1 py-2 rounded-lg text-sm font-bold transition-all relative {analysisMode ===
                      'thoughts'
                        ? 'bg-white text-indigo-900 shadow-sm'
                        : 'text-slate-500 hover:text-indigo-600'}"
                    >
                      感想
                      {#if !isPremium}
                        <svg
                          class="w-3 h-3 text-amber-500 inline-block ml-1 mb-0.5"
                          fill="currentColor"
                          viewBox="0 0 20 20"
                        >
                          <path
                            fill-rule="evenodd"
                            d="M5 9V7a5 5 0 0110 0v2a2 2 0 012 2v5a2 2 0 01-2 2H5a2 2 0 01-2-2v-5a2 2 0 012-2zm8-2v2H7V7a3 3 0 016 0z"
                            clip-rule="evenodd"
                          />
                        </svg>
                      {/if}
                    </button>
                    <button
                      onclick={() => setAnalysisMode("report")}
                      class="flex-1 py-2 rounded-lg text-sm font-bold transition-all relative {analysisMode ===
                      'report'
                        ? 'bg-white text-indigo-900 shadow-sm'
                        : 'text-slate-500 hover:text-indigo-600'}"
                    >
                      レポート
                      {#if !isPremium}
                        <svg
                          class="w-3 h-3 text-amber-500 inline-block ml-1 mb-0.5"
                          fill="currentColor"
                          viewBox="0 0 20 20"
                        >
                          <path
                            fill-rule="evenodd"
                            d="M5 9V7a5 5 0 0110 0v2a2 2 0 012 2v5a2 2 0 01-2 2H5a2 2 0 01-2-2v-5a2 2 0 012-2zm8-2v2H7V7a3 3 0 016 0z"
                            clip-rule="evenodd"
                          />
                        </svg>
                      {/if}
                    </button>
                  </div>
                  {#if analysisMode === "report"}
                    <p
                      class="text-[10px] text-slate-400 mt-1 ml-1 animate-in fade-in"
                    >
                      ※「だ・である」調で論理的に記述します
                    </p>
                  {/if}
                </div>

                <!-- 2. Character Length Slider -->
                <div class="flex-1">
                  <div class="flex justify-between items-center mb-2">
                    <label
                      for="target-length-slider"
                      class="text-xs font-bold text-slate-500 uppercase tracking-wide"
                      >目標文字数</label
                    >
                    <div class="flex items-center gap-2">
                      <span
                        class="text-[10px] font-bold text-slate-500 bg-white border border-slate-200 px-2 py-0.5 rounded-full"
                        >原稿用紙 {manuscriptPages}枚分</span
                      >
                    </div>
                  </div>

                  <div class="relative pt-6 pb-2">
                    <!-- Tooltip -->
                    <div
                      class="absolute top-0 -translate-x-1/2 bg-indigo-600 text-white text-[10px] font-bold px-2 py-1 rounded-md shadow-lg pointer-events-none transition-all duration-75"
                      style="left: {thumbPosition}%"
                    >
                      {targetLength}文字
                      <div
                        class="absolute top-full left-1/2 -translate-x-1/2 border-4 border-transparent border-t-indigo-600"
                      ></div>
                    </div>

                    <input
                      id="target-length-slider"
                      type="range"
                      min="0"
                      max="4000"
                      step="100"
                      bind:value={targetLength}
                      oninput={handleLengthChange}
                      class="w-full h-2 bg-slate-200 rounded-lg appearance-none cursor-pointer accent-indigo-600"
                    />

                    <!-- Fixed Labels Alignment -->
                    <div class="relative w-full h-4 mt-1">
                      <span
                        class="absolute -translate-x-1/2 text-[10px] text-slate-400"
                        style="left: 2.5%">100</span
                      >
                      <span
                        class="absolute -translate-x-1/2 text-[10px] text-slate-400 whitespace-nowrap"
                        style="left: 12.5%"
                      >
                        500
                        {#if !isPremium}
                          <svg
                            class="w-2.5 h-2.5 text-amber-500 inline-block ml-1 mb-0.5"
                            fill="currentColor"
                            viewBox="0 0 20 20"
                          >
                            <path
                              fill-rule="evenodd"
                              d="M5 9V7a5 5 0 0110 0v2a2 2 0 012 2v5a2 2 0 01-2 2H5a2 2 0 01-2-2v-5a2 2 0 012-2zm8-2v2H7V7a3 3 0 016 0z"
                              clip-rule="evenodd"
                            />
                          </svg>
                        {/if}
                      </span>
                      <span
                        class="absolute -translate-x-1/2 text-[10px] font-bold text-indigo-500 whitespace-nowrap"
                        style="left: 50%"
                      >
                        2000
                        {#if !isPremium}
                          <svg
                            class="w-2.5 h-2.5 text-amber-500 inline-block ml-0.5 mb-0.5"
                            fill="currentColor"
                            viewBox="0 0 20 20"
                          >
                            <path
                              fill-rule="evenodd"
                              d="M5 9V7a5 5 0 0110 0v2a2 2 0 012 2v5a2 2 0 01-2 2H5a2 2 0 01-2-2v-5a2 2 0 012-2zm8-2v2H7V7a3 3 0 016 0z"
                              clip-rule="evenodd"
                            />
                          </svg>
                        {/if}
                      </span>
                      <span
                        class="absolute right-0 text-[10px] text-slate-400 flex items-center gap-1"
                        >4000
                        {#if !isUltimate}
                          <svg
                            class="w-2.5 h-2.5 text-amber-500 inline-block"
                            fill="currentColor"
                            viewBox="0 0 20 20"
                          >
                            <path
                              fill-rule="evenodd"
                              d="M5 9V7a5 5 0 0110 0v2a2 2 0 012 2v5a2 2 0 01-2 2H5a2 2 0 01-2-2v-5a2 2 0 012-2zm8-2v2H7V7a3 3 0 016 0z"
                              clip-rule="evenodd"
                            />
                          </svg>
                        {/if}
                      </span>
                    </div>
                  </div>
                </div>
              </div>

              {#if !analyzing}
                <div class="space-y-8 mt-6 px-4">
                  <!-- 1. Learning Materials (PDF / Image / Text) -->
                  <div>
                    <h3
                      class="text-xs font-bold text-slate-400 uppercase tracking-wider mb-3 flex items-center gap-2"
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
                          d="M12 6.253v13m0-13C10.832 5.477 9.246 5 7.5 5S4.168 5.477 3 6.253v13C4.168 18.477 5.754 18 7.5 18s3.332.477 4.5 1.253m0-13C13.168 5.477 14.754 5 16.5 5c1.747 0 3.332.477 4.5 1.253v13C19.832 18.477 18.247 18 16.5 18c-1.746 0-3.332.477-4.5 1.253"
                        /></svg
                      >
                      学習資料 (A系統)
                    </h3>
                    <div class="grid grid-cols-1 sm:grid-cols-3 gap-4">
                      <!-- PDF -->
                      <label class="cursor-pointer group block">
                        <div
                          class="{pdfFile
                            ? 'border-indigo-500 bg-indigo-50 ring-2 ring-indigo-200'
                            : 'border-slate-200 hover:border-indigo-300'} flex items-center gap-3 p-3 rounded-xl bg-white border shadow-sm transition-all relative overflow-hidden h-full"
                        >
                          <div
                            class="w-8 h-8 rounded-full bg-indigo-100 text-indigo-600 flex items-center justify-center relative z-10 flex-shrink-0"
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
                                d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z"
                              /></svg
                            >
                          </div>
                          <div class="relative z-10 flex-1 min-w-0">
                            <div
                              class="text-[10px] font-bold text-slate-400 uppercase"
                            >
                              PDF
                            </div>
                            <div
                              class="text-xs font-bold text-slate-700 truncate"
                            >
                              {pdfFile ? pdfFile.name : "スライド・資料"}
                            </div>
                          </div>
                          <input
                            type="file"
                            accept=".pdf"
                            class="hidden"
                            onchange={(e) => handleFileChange(e, "pdf")}
                          />
                        </div>
                      </label>

                      <!-- Image -->
                      <label class="cursor-pointer group block">
                        <div
                          class="{imageFile
                            ? 'border-emerald-500 bg-emerald-50 ring-2 ring-emerald-200'
                            : 'border-slate-200 hover:border-emerald-300'} flex items-center gap-3 p-3 rounded-xl bg-white border shadow-sm transition-all relative overflow-hidden h-full"
                        >
                          <div
                            class="w-8 h-8 rounded-full bg-emerald-100 text-emerald-600 flex items-center justify-center relative z-10 flex-shrink-0"
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
                                d="M4 16l4.586-4.586a2 2 0 012.828 0L16 16m-2-2l1.586-1.586a2 2 0 012.828 0L20 14m-6-6h.01M6 20h12a2 2 0 002-2V6a2 2 0 00-2-2H6a2 2 0 00-2 2v12a2 2 0 002 2z"
                              /></svg
                            >
                          </div>
                          <div class="relative z-10 flex-1 min-w-0">
                            <div
                              class="text-[10px] font-bold text-slate-400 uppercase"
                            >
                              Image
                            </div>
                            <div
                              class="text-xs font-bold text-slate-700 truncate"
                            >
                              {imageFile ? imageFile.name : "板書・写真"}
                            </div>
                          </div>
                          <input
                            type="file"
                            accept="image/*"
                            class="hidden"
                            onchange={(e) => handleFileChange(e, "image")}
                          />
                        </div>
                      </label>

                      <!-- Text -->
                      <label class="cursor-pointer group block">
                        <div
                          class="{txtFile
                            ? 'border-slate-500 bg-slate-50 ring-2 ring-slate-200'
                            : 'border-slate-200 hover:border-slate-300'} flex items-center gap-3 p-3 rounded-xl bg-white border shadow-sm transition-all relative overflow-hidden h-full"
                        >
                          <div
                            class="w-8 h-8 rounded-full bg-slate-100 text-slate-500 flex items-center justify-center relative z-10 flex-shrink-0"
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
                                d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z"
                              /></svg
                            >
                          </div>
                          <div class="relative z-10 flex-1 min-w-0">
                            <div
                              class="text-[10px] font-bold text-slate-400 uppercase"
                            >
                              Text
                            </div>
                            <div
                              class="text-xs font-bold text-slate-700 truncate"
                            >
                              {txtFile ? txtFile.name : "メモ・レジュメ"}
                            </div>
                          </div>
                          <input
                            type="file"
                            accept=".txt"
                            class="hidden"
                            onchange={(e) => handleFileChange(e, "txt")}
                          />
                        </div>
                      </label>
                    </div>
                  </div>

                  <!-- 2. Rich Media (Video / Audio / URL) - Ultimate Only -->
                  <div>
                    <h3
                      class="text-xs font-bold {isUltimate
                        ? 'text-indigo-500'
                        : 'text-slate-400'} uppercase tracking-wider mb-3 flex items-center gap-2"
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
                          d="M14.752 11.168l-3.197-2.132A1 1 0 0010 9.87v4.263a1 1 0 001.555.832l3.197-2.132a1 1 0 000-1.664z"
                        /><path
                          stroke-linecap="round"
                          stroke-linejoin="round"
                          stroke-width="2"
                          d="M21 12a9 9 0 11-18 0 9 9 0 0118 0z"
                        /></svg
                      >
                      アルティメットプラン限定 (自動文字起こし)
                    </h3>
                    <div class="grid grid-cols-1 sm:grid-cols-2 gap-4">
                      <!-- Video -->
                      <button
                        onclick={() => {
                          if (!isUltimate) {
                            upgradeModalTitle = "動画解析をアンロック";
                            upgradeModalMessage =
                              "動画ファイルからの文字起こし・自動解析は<br /><span class='text-indigo-900 font-bold'>アルティメットプラン</span>専用の機能です。<br /><br />Zoom録画や講義動画をそのままドラッグするだけで、試験対策ノートが完成します。";
                            showUpgradeModal = true;
                            return;
                          }
                          // Trigger file input click
                          document.getElementById("video-upload")?.click();
                        }}
                        class="text-left w-full group block relative focus:outline-none"
                      >
                        <div
                          class="{videoFile
                            ? 'border-indigo-500 bg-indigo-50 ring-2 ring-indigo-200'
                            : isUltimate
                              ? 'border-slate-200 hover:border-indigo-300'
                              : 'border-slate-200 bg-slate-50 opacity-70'} flex items-center gap-3 p-3 rounded-xl bg-white border shadow-sm transition-all relative overflow-hidden h-full"
                        >
                          <div
                            class="w-8 h-8 rounded-full {isUltimate
                              ? 'bg-indigo-100 text-indigo-600'
                              : 'bg-slate-200 text-slate-400'} flex items-center justify-center relative z-10 flex-shrink-0"
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
                                d="M15 10l4.553-2.276A1 1 0 0121 8.618v6.764a1 1 0 01-1.447.894L15 14M5 18h8a2 2 0 002-2V8a2 2 0 00-2-2H5a2 2 0 00-2 2v8a2 2 0 002 2z"
                              /></svg
                            >
                          </div>
                          <div class="relative z-10 flex-1 min-w-0">
                            <div
                              class="text-[10px] font-bold text-slate-400 uppercase flex items-center gap-1"
                            >
                              Video
                              {#if !isUltimate}
                                <svg
                                  class="w-3.5 h-3.5 text-slate-500"
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
                              {/if}
                            </div>
                            <div
                              class="text-xs font-bold text-slate-700 truncate"
                            >
                              {videoFile ? videoFile.name : "動画ファイル"}
                            </div>
                          </div>
                          <input
                            id="video-upload"
                            type="file"
                            accept="video/*"
                            class="hidden"
                            onchange={(e) => handleFileChange(e, "video")}
                            disabled={!isUltimate}
                          />
                        </div>
                      </button>

                      <!-- Audio -->
                      <button
                        onclick={() => {
                          if (!isUltimate) {
                            upgradeModalTitle = "音声解析をアンロック";
                            upgradeModalMessage =
                              "音声ファイルからの文字起こし・自動解析は<br /><span class='text-indigo-900 font-bold'>アルティメットプラン</span>専用の機能です。<br /><br />長時間の講義録音も、AIが瞬時に構造化してノートにまとめます。";
                            showUpgradeModal = true;
                            return;
                          }
                          document.getElementById("audio-upload")?.click();
                        }}
                        class="text-left w-full group block relative focus:outline-none"
                      >
                        <div
                          class="{audioFile
                            ? 'border-pink-500 bg-pink-50 ring-2 ring-pink-200'
                            : isUltimate
                              ? 'border-slate-200 hover:border-pink-300'
                              : 'border-slate-200 bg-slate-50 opacity-70'} flex items-center gap-3 p-3 rounded-xl bg-white border shadow-sm transition-all relative overflow-hidden h-full"
                        >
                          <div
                            class="w-8 h-8 rounded-full {isUltimate
                              ? 'bg-pink-100 text-pink-600'
                              : 'bg-slate-200 text-slate-400'} flex items-center justify-center relative z-10 flex-shrink-0"
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
                                d="M19 11a7 7 0 01-7 7m0 0a7 7 0 01-7-7m7 7v4m0 0H8m4 0h4m-4-8a3 3 0 01-3-3V5a3 3 0 116 0v6a3 3 0 01-3 3z"
                              /></svg
                            >
                          </div>
                          <div class="relative z-10 flex-1 min-w-0">
                            <div
                              class="text-[10px] font-bold text-slate-400 uppercase flex items-center gap-1"
                            >
                              Audio
                              {#if !isUltimate}
                                <svg
                                  class="w-3.5 h-3.5 text-slate-500"
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
                              {/if}
                            </div>
                            <div
                              class="text-xs font-bold text-slate-700 truncate"
                            >
                              {audioFile ? audioFile.name : "音声ファイル"}
                            </div>
                          </div>
                          <input
                            id="audio-upload"
                            type="file"
                            accept="audio/*"
                            class="hidden"
                            onchange={(e) => handleFileChange(e, "audio")}
                            disabled={!isUltimate}
                          />
                        </div>
                      </button>
                    </div>

                    <!-- URL Input -->
                    <div class="mt-6 relative">
                      <h4
                        class="text-xs font-bold text-slate-500 mb-2 flex items-center gap-2"
                      >
                        URLから解析（Webサイト・記事）
                        {#if !isUltimate}
                          <svg
                            class="w-3.5 h-3.5 text-slate-500"
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
                        {/if}
                      </h4>

                      <div class="relative">
                        {#if !isUltimate}
                          <button
                            onclick={() => {
                              upgradeModalTitle = "URL解析をアンロック";
                              upgradeModalMessage =
                                "Web記事やブログからの自動ノート生成は<br /><span class='text-indigo-900 font-bold'>Ultimateプラン</span>専用の機能です。<br /><br />参考文献のURLを貼るだけで、要約と重要なポイントを抽出できます。";
                              showUpgradeModal = true;
                            }}
                            class="absolute inset-0 z-20 cursor-pointer w-full h-full"
                            aria-label="Unlock feature"
                          ></button>
                        {/if}

                        <input
                          type="text"
                          bind:value={targetUrl}
                          placeholder="https://example.com"
                          disabled={!isUltimate}
                          class="w-full bg-slate-50 border border-slate-200 rounded-xl p-4 pl-12 text-sm text-slate-700 placeholder:text-slate-400 focus:outline-none focus:ring-2 focus:ring-indigo-500/50 transition-all {isUltimate
                            ? 'bg-white'
                            : 'opacity-60'}"
                        />

                        <svg
                          class="w-5 h-5 absolute left-4 top-1/2 -translate-y-1/2 text-slate-400"
                          fill="none"
                          viewBox="0 0 24 24"
                          stroke="currentColor"
                          stroke-width="2.5"
                        >
                          <path
                            stroke-linecap="round"
                            stroke-linejoin="round"
                            d="M13.19 8.688a4.5 4.5 0 0 1 1.242 7.244l-4.5 4.5a4.5 4.5 0 0 1-6.364-6.364l1.757-1.757m13.35-.622l1.757-1.757a4.5 4.5 0 0 0-6.364-6.364l-4.5 4.5a4.5 4.5 0 0 0 1.242 7.244"
                          />
                        </svg>
                      </div>
                    </div>
                  </div>

                  <!-- 3. Course Info (Mandatory) -->
                  <div class="mt-6">
                    <h3
                      class="text-xs font-bold text-slate-400 uppercase tracking-wider mb-3 flex items-center gap-2"
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
                          d="M12 6.253v13m0-13C10.832 5.477 9.246 5 7.5 5S4.168 5.477 3 6.253v13C4.168 18.477 5.754 18 7.5 18s3.332.477 4.5 1.253m0-13C13.168 5.477 14.754 5 16.5 5c1.747 0 3.332.477 4.5 1.253v13C19.832 18.477 18.247 18 16.5 18c-1.746 0-3.332.477-4.5 1.253"
                        /></svg
                      >
                      講義情報 (必須)
                    </h3>
                    <div
                      class="bg-white border border-slate-200 rounded-xl p-4 shadow-sm"
                    >
                      <div class="mb-4 relative">
                        <label
                          for="courseNameInput"
                          class="block text-xs font-bold text-slate-500 mb-1"
                          >講義名</label
                        >
                        <input
                          id="courseNameInput"
                          type="text"
                          bind:value={courseName}
                          list="enrolled-courses"
                          placeholder="講義名を入力 (例: 経済学入門)"
                          class="w-full bg-slate-50 border border-slate-200 rounded-lg px-3 py-2 text-sm focus:ring-2 focus:ring-indigo-500 outline-none {showCourseNameError
                            ? 'border-red-500 ring-1 ring-red-500'
                            : ''}"
                          oninput={handleCourseInput}
                          onfocus={() => {
                            if (suggestedCourses.length > 0)
                              showSuggestions = true;
                          }}
                          onblur={() =>
                            setTimeout(() => (showSuggestions = false), 200)}
                        />

                        <!-- Custom Autocomplete Dropdown -->
                        {#if showSuggestions && suggestedCourses.length > 0}
                          <div
                            class="absolute z-10000 w-full bg-white border-2 border-indigo-200 rounded-lg shadow-[0_10px_25px_-5px_rgba(0,0,0,0.1),0_8px_10px_-6px_rgba(0,0,0,0.1)] max-h-60 overflow-y-auto mt-1"
                          >
                            {#each suggestedCourses as course}
                              <button
                                class="w-full text-left px-4 py-3 hover:bg-indigo-50 transition-colors border-b border-slate-50 last:border-0"
                                onclick={() => selectCourse(course)}
                                onmousedown={(e) => e.preventDefault()}
                              >
                                <div class="font-bold text-slate-800 text-sm">
                                  {course.courseName}
                                </div>
                                {#if course.teacherName || course.faculty}
                                  <div
                                    class="text-xs text-slate-500 mt-0.5 flex gap-2"
                                  >
                                    {#if course.faculty}<span
                                        class="bg-slate-100 px-1.5 rounded"
                                        >{course.faculty}</span
                                      >{/if}
                                    {#if course.teacherName}<span
                                        >{course.teacherName}</span
                                      >{/if}
                                  </div>
                                {/if}
                                {#if course.evaluationCriteria}
                                  <div
                                    class="text-[10px] text-indigo-500 mt-1 truncate opacity-70"
                                  >
                                    評価: {course.evaluationCriteria}
                                  </div>
                                {/if}
                              </button>
                            {/each}
                          </div>
                        {:else if userData?.enrolledCourses && !courseName}
                          <!-- Fallback to Enrolled Courses suggestions if empty? Or just rely on typing? -->
                          <!-- Let's keep the datalist as a fallback or just show enrolled as suggestions initially? -->
                          <!-- The user requested "From masterCourses", so let's stick to that. -->
                          <!-- But seeing enrolled courses is nice. Let's merge? -->
                          <!-- For now, we only show Master Course suggestions when typing. -->
                        {/if}

                        {#if selectedSyllabus}
                          <div
                            class="mt-2 bg-indigo-50 border border-indigo-100 rounded-lg p-3 text-xs text-indigo-800 animate-in fade-in slide-in-from-top-1"
                          >
                            <div class="font-bold mb-1 flex items-center gap-1">
                              <svg
                                class="w-3 h-3"
                                fill="none"
                                viewBox="0 0 24 24"
                                stroke="currentColor"
                                ><path
                                  stroke-linecap="round"
                                  stroke-linejoin="round"
                                  stroke-width="2"
                                  d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z"
                                /></svg
                              >
                              シラバス連携中
                            </div>
                            <div class="opacity-80">
                              評価方法: {selectedSyllabus.evaluationCriteria}
                            </div>
                          </div>
                        {/if}
                        {#if showCourseNameError}
                          <p class="text-red-500 text-xs mt-1">
                            ※講義名の入力は必須です
                          </p>
                        {/if}
                      </div>

                      <div class="flex items-center justify-between">
                        <div>
                          <p class="text-sm font-bold text-slate-700">
                            コミュニティ共有
                          </p>
                          <p class="text-xs text-slate-500">
                            同じ講義を履修する学生にノートを共有します
                          </p>
                        </div>
                        <label
                          class="relative inline-flex items-center cursor-pointer"
                        >
                          <input
                            type="checkbox"
                            bind:checked={isShared}
                            class="sr-only peer"
                          />
                          <div
                            class="w-11 h-6 bg-slate-200 peer-focus:outline-none peer-focus:ring-4 peer-focus:ring-indigo-300 rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-gray-300 after:border after:rounded-full after:h-5 after:w-5 after:transition-all peer-checked:bg-indigo-600"
                          ></div>
                        </label>
                      </div>
                    </div>
                  </div>

                  <div
                    class="flex justify-end items-center gap-4 p-4 pt-0 mt-8"
                  >
                    {#if analyzing}
                      <button
                        onclick={handleCancelAnalysis}
                        class="text-slate-500 text-sm font-bold hover:text-red-500 underline transition-colors"
                      >
                        キャンセル
                      </button>
                    {/if}

                    <button
                      onclick={handleAnalyze}
                      disabled={analyzing || isExtractingAudio}
                      class="bg-slate-900 text-white px-8 py-3 rounded-xl text-sm font-bold shadow-lg shadow-slate-900/10 hover:shadow-xl hover:-translate-y-0.5 active:translate-y-0 active:shadow-sm transition-all flex items-center gap-2 disabled:opacity-50 disabled:cursor-not-allowed disabled:transform-none"
                    >
                      {#if analyzing}
                        <svg
                          class="animate-spin h-4 w-4 text-white"
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
                        解析中...
                      {:else if isExtractingAudio}
                        <svg
                          class="animate-spin h-4 w-4 text-white"
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
                        音声処理中...
                      {:else}
                        まず {analysisMode === "note"
                          ? "ノート"
                          : analysisMode === "thoughts"
                            ? "感想文"
                            : "レポート"} を生成
                        {#if selectedSummary}
                          <span
                            class="ml-2 bg-white/20 px-2 py-0.5 rounded text-xs font-normal opacity-90"
                            >{selectedSummary}</span
                          >
                        {/if}
                        <svg
                          class="w-4 h-4 ml-1"
                          fill="none"
                          viewBox="0 0 24 24"
                          stroke="currentColor"
                          ><path
                            stroke-linecap="round"
                            stroke-linejoin="round"
                            stroke-width="2"
                            d="M14 5l7 7m0 0l-7 7m7-7H3"
                          /></svg
                        >
                      {/if}
                    </button>
                  </div>

                  {#if isExtractingAudio}
                    <div
                      class="p-8 text-center animate-in fade-in flex flex-col items-center bg-indigo-50/50 rounded-2xl border border-indigo-100 mb-4"
                    >
                      <div class="mb-6 relative">
                        <div
                          class="w-16 h-16 bg-white rounded-2xl shadow-xl flex items-center justify-center text-indigo-600"
                        >
                          <svg
                            class="w-10 h-10 animate-bounce"
                            fill="none"
                            viewBox="0 0 24 24"
                            stroke="currentColor"
                          >
                            <path
                              stroke-linecap="round"
                              stroke-linejoin="round"
                              stroke-width="2"
                              d="M19 11a7 7 0 01-7 7m0 0a7 7 0 01-7-7m7 7v4m0 0H8m4 0h4m-4-8a3 3 0 01-3-3V5a3 3 0 116 0v6a3 3 0 01-3 3z"
                            />
                          </svg>
                        </div>
                      </div>
                      <div class="w-full max-w-md mb-4 text-left">
                        <p
                          class="text-xs font-bold text-indigo-400 uppercase tracking-widest mb-1"
                        >
                          {extractionProgress?.stage || "Processing"}
                        </p>
                        <div
                          class="w-full bg-slate-100 rounded-full h-2 overflow-hidden"
                        >
                          <div
                            class="bg-indigo-500 h-2 rounded-full transition-all duration-300 ease-out"
                            style="width: {extractionProgress?.progress || 0}%"
                          ></div>
                        </div>
                      </div>
                      <p class="text-slate-700 font-bold text-sm tracking-wide">
                        {extractionProgress?.message || "動画を最適化中..."}
                      </p>
                      <p class="text-[10px] text-slate-400 mt-2 italic">
                        ※
                        解析の前に、動画から音声を抽出し、サイズを約90%削減しています。
                      </p>
                    </div>
                  {/if}
                </div>
              {/if}

              {#if analyzing}
                <div
                  class="p-8 text-center animate-in fade-in flex flex-col items-center"
                >
                  <!-- App Icon with Pulse Animation -->
                  <div class="mb-6 relative">
                    <img
                      src="/icon-512.png"
                      alt="解析中"
                      class="w-16 h-16 rounded-2xl shadow-xl"
                      style="animation: gentlePulse 2s ease-in-out infinite;"
                    />
                    <!-- Decorative Glow -->
                    <div
                      class="absolute -inset-4 bg-indigo-400/30 blur-2xl rounded-full -z-10"
                      style="animation: glowPulse 2s ease-in-out infinite;"
                    ></div>
                  </div>

                  <div class="w-full max-w-md mb-4">
                    <div
                      class="w-full bg-slate-100 rounded-full h-2.5 overflow-hidden"
                    >
                      <div
                        class="bg-gradient-to-r from-indigo-500 via-purple-500 to-pink-500 h-2.5 rounded-full transition-all duration-300 ease-out"
                        style="width: {progressValue}%"
                      ></div>
                    </div>
                  </div>
                  <p
                    class="text-slate-600 font-bold text-sm tracking-wide animate-pulse"
                  >
                    {progressStatus}
                  </p>
                  <p class="text-xs text-slate-400 mt-2">
                    {Math.floor(progressValue)}% Completed
                  </p>
                </div>
              {/if}
            </div>
          {/if}
        </div>

        <!-- Transcript Preview -->
        {#if $transcript || $isRecording}
          <div class="mb-8 animate-in fade-in slide-in-from-bottom-2">
            <div
              class="bg-white rounded-2xl border border-slate-200 p-4 shadow-sm relative overflow-hidden group"
            >
              <!-- ... -->
              <div class="pl-4">
                <div class="flex items-center justify-between mb-2">
                  <h3 class="text-xs font-bold text-slate-400 uppercase">
                    Live Transcript
                  </h3>
                </div>
                <p
                  class="text-sm text-slate-600 font-mono leading-relaxed line-clamp-3 hover:line-clamp-none transition-all"
                >
                  {$transcript}
                </p>
              </div>
            </div>
          </div>
        {/if}

        <!-- Result Card -->
        {#if !analyzing}
          {@render ResultDisplay()}
        {/if}
      {/if}
    </main>
  </div>

  <!-- FAB: Recording & Analysis Buttons (Bottom Right) -->
  {#if user}
    <div class="fixed bottom-8 right-8 flex flex-col items-end gap-4 z-50">
      <!-- Recording FAB (Only item remaining in this floating container) -->
      <button
        onclick={toggleRecording}
        class="w-16 h-16 rounded-full shadow-2xl flex items-center justify-center transition-all active:scale-95 group border border-white/10
        {$isRecording
          ? 'bg-red-500 text-white ring-4 ring-red-500/20'
          : 'bg-white text-red-500 hover:bg-slate-50'}"
        title={$isRecording ? "Stop Recording" : "Start Recording"}
      >
        {#if $isRecording}
          <div class="w-6 h-6 bg-white rounded-md animate-pulse"></div>
        {:else}
          <div class="relative">
            <svg
              class="w-8 h-8"
              fill="none"
              viewBox="0 0 24 24"
              stroke="currentColor"
            >
              <path
                stroke-linecap="round"
                stroke-linejoin="round"
                stroke-width="2.5"
                d="M19 11a7 7 0 01-7 7m0 0a7 7 0 01-7-7m7 7v4m0 0H8m4 0h4m-4-8a3 3 0 01-3-3V5a3 3 0 116 0v6a3 3 0 01-3 3z"
              />
            </svg>
            {#if !selectedSummary && !$isRecording}
              <div
                class="absolute -top-1 -right-1 w-3 h-3 bg-indigo-500 rounded-full border-2 border-white animate-bounce"
              ></div>
            {/if}
          </div>
        {/if}
      </button>
    </div>
  {/if}

  <!-- Debug Footer (Temporary for verification) -->
  <div
    class="fixed bottom-0 left-0 right-0 bg-slate-900 text-white p-2 text-[10px] font-mono flex gap-4 z-[9999] opacity-80 pointer-events-none"
  >
    <span>DB Plan: {userData?.plan || "N/A"}</span>
    <span>isUltimate: {isUltimate}</span>
    <span class="text-slate-400 opacity-50 ml-auto">Debug Mode ON</span>
  </div>

  <!-- Global Styles for Waveform Animations -->
  <style>
    @keyframes waveform-1 {
      0%,
      100% {
        height: 10px;
      }
      50% {
        height: 20px;
      }
    }
    @keyframes waveform-2 {
      0%,
      100% {
        height: 15px;
      }
      50% {
        height: 35px;
      }
    }
    @keyframes waveform-3 {
      0%,
      100% {
        height: 12px;
      }
      50% {
        height: 25px;
      }
    }
    .animate-waveform-1 {
      animation: waveform-1 1s infinite ease-in-out;
    }
    .animate-waveform-2 {
      animation: waveform-2 1.2s infinite ease-in-out;
    }
    .animate-waveform-3 {
      animation: waveform-3 0.8s infinite ease-in-out;
    }

    /* Graph Paper Background */
    .bg-graph-paper {
      background-color: #ffffff;
      background-image: linear-gradient(#e5e7eb 1px, transparent 1px),
        linear-gradient(90deg, #e5e7eb 1px, transparent 1px);
      background-size: 20px 20px;
      background-position: center top;
    }

    /* Gentle Pulse Animation for Loading Icon */
    @keyframes gentlePulse {
      0%,
      100% {
        transform: scale(1);
        opacity: 1;
      }
      50% {
        transform: scale(1.05);
        opacity: 0.95;
      }
    }

    /* Glow Pulse Animation */
    @keyframes glowPulse {
      0%,
      100% {
        opacity: 0.3;
        transform: scale(1);
      }
      50% {
        opacity: 0.5;
        transform: scale(1.1);
      }
    }
  </style>
</div>
