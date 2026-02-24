import { writable } from 'svelte/store';

export const subjects = writable<any[]>([]);
export const lectures = writable<any[]>([]);
export const currentBinder = writable<string | null>(null);
// Persist which subject folders are expanded in the sidebar
export const expandedSubjects = writable<Set<string>>(new Set());
export const isSidebarOpen = writable(false);
export const isEnrollModalOpen = writable(false);
export const sidebarScrollY = writable<number>(0);
export const isOpenBinderStore = writable<boolean>(true);
export const isOpenLecturesStore = writable<boolean>(true);
