import type { RequestHandler } from './$types';
import { json } from '@sveltejs/kit';
import { adminAuth } from '$lib/server/firebase-admin';
import { getStorage } from 'firebase-admin/storage';

export const config = {
    maxDuration: 60
};

export const POST: RequestHandler = async ({ request }) => {
    try {
        // --- Auth Check ---
        let uid: string | null = null;
        const authHeader = request.headers.get('Authorization');

        if (authHeader && authHeader.startsWith('Bearer ')) {
            try {
                const idToken = authHeader.split('Bearer ')[1];
                const decodedToken = await adminAuth.verifyIdToken(idToken);
                uid = decodedToken.uid;
            } catch (e) {
                console.warn('Auth token verification failed:', e);
                return json({ error: '認証に失敗しました' }, { status: 401 });
            }
        } else {
            return json({ error: 'ログインが必要です' }, { status: 401 });
        }

        const formData = await request.formData();
        const audioFile = formData.get('audio') as File;

        if (!audioFile) {
            return json({ error: '音声ファイルが指定されていません' }, { status: 400 });
        }

        // Validate file type
        const allowedTypes = ['audio/mpeg', 'audio/mp3', 'audio/wav', 'audio/wave', 'audio/x-wav'];
        if (!allowedTypes.includes(audioFile.type)) {
            return json({
                error: `対応していないファイル形式です。MP3またはWAVファイルをアップロードしてください。`
            }, { status: 400 });
        }

        // Validate file size (max 100MB)
        const maxSize = 100 * 1024 * 1024;
        if (audioFile.size > maxSize) {
            return json({
                error: `ファイルサイズが大きすぎます。100MB以下のファイルをアップロードしてください。`
            }, { status: 400 });
        }

        // Generate unique filename
        const timestamp = Date.now();
        const ext = audioFile.name.split('.').pop() || 'mp3';
        const filename = `${uid}_${timestamp}.${ext}`;
        const filePath = `audio-uploads/${filename}`;

        // Upload to Firebase Storage
        const storage = getStorage();
        const bucket = storage.bucket();
        const file = bucket.file(filePath);

        const arrayBuffer = await audioFile.arrayBuffer();
        const buffer = Buffer.from(arrayBuffer);

        await file.save(buffer, {
            metadata: {
                contentType: audioFile.type,
                metadata: {
                    uploadedBy: uid,
                    originalName: audioFile.name,
                    uploadedAt: new Date().toISOString()
                }
            }
        });

        // Make file publicly readable (or use signed URLs for better security)
        await file.makePublic();

        const publicUrl = `https://storage.googleapis.com/${bucket.name}/${filePath}`;

        console.log(`✅ Audio uploaded successfully: ${filename} (${(audioFile.size / 1024 / 1024).toFixed(2)}MB)`);

        return json({
            success: true,
            url: publicUrl,
            filename: filename,
            size: audioFile.size
        });

    } catch (error: any) {
        console.error('Audio upload error:', error);
        return json({ error: '音声アップロードに失敗しました' }, { status: 500 });
    }
};
