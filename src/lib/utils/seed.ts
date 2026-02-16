import { db } from "$lib/firebase";
import { doc, setDoc, writeBatch, collection } from "firebase/firestore";
import { normalizeCourseName } from "./textUtils";

export const dummyCourses = [
    {
        courseName: "経済学入門",
        teacherName: "田中 教授",
        evaluationCriteria: "期末テスト80%、レポート20%。テストは教科書の第1章〜第5章から出題。",
        faculty: "経済学部"
    },
    {
        courseName: "心理学基礎",
        teacherName: "佐藤 准教授",
        evaluationCriteria: "出席30%、中間レポート30%、期末レポート40%。感想文の質を重視。",
        faculty: "社会学部"
    },
    {
        courseName: "ビジネスデザイン論",
        teacherName: "鈴木 講師",
        evaluationCriteria: "グループワーク50%、個人プレゼン50%。積極的な発言が加点対象。",
        faculty: "ビジネスデザイン学部"
    },
    {
        courseName: "英語コミュニケーション",
        teacherName: "Brown",
        evaluationCriteria: "TOEICスコア30%、クラス内活動70%。発話を重視。",
        faculty: "国際教養学部"
    },
    {
        courseName: "情報処理演習",
        teacherName: "高橋 教授",
        evaluationCriteria: "課題提出100%。締切厳守。コードの可読性も評価。",
        faculty: "経営学部"
    }
];

export async function seedMasterCourses() {
    const batch = writeBatch(db);

    for (const course of dummyCourses) {
        const normalized = normalizeCourseName(course.courseName);
        const docRef = doc(db, "masterCourses", normalized);
        batch.set(docRef, {
            ...course,
            normalizedCourseName: normalized,
            updatedAt: new Date()
        });
    }

    await batch.commit();
    console.log("Master courses seeded successfully");
}
