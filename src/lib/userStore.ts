
import { writable } from 'svelte/store';
import type { User } from 'firebase/auth';

interface UserProfile {
    uid: string;
    email: string | null;
    displayName: string | null;
    photoURL: string | null;
    plan: 'free' | 'premium' | 'ultimate';
    usageCount?: number;
    createdAt: any;
}

export const user = writable<User | null>(null);
export const userProfile = writable<UserProfile | null>(null);
export const authLoading = writable<boolean>(true);
