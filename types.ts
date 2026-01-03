
export type ViewMode = 'dashboard' | 'session' | 'admin' | 'feedback';
export type SessionMode = 'interview' | 'prep';
export type AvatarGender = 'male' | 'female';

export interface User {
  id: string;
  name: string;
  email: string;
  subscriptionEnd: number;
  tier: '1-month' | '4-month' | '6-month';
}

export interface Track {
  id: string;
  name: string;
  category: string;
  icon: string;
}

export interface SessionResult {
  score: number;
  strengths: string[];
  weaknesses: string[];
  improvementPlan: string;
}
