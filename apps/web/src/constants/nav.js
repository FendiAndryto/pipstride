import {
  Home,
  BookOpen,
  TrendingUp,
  Sparkles,
  PlaySquare,
  User
} from 'lucide-react';

export const NAV_TABS = [
  { id: 'home', label: 'Home', icon: Home, symbol: '⌂' },
  { id: 'journal', label: 'Journal', icon: BookOpen, symbol: '▤' },
  { id: 'market', label: 'Market', icon: TrendingUp, symbol: '◈' },
  { id: 'ai', label: 'AI Assistant', icon: Sparkles, symbol: '✧' },
  { id: 'replay', label: 'Replay', icon: PlaySquare, symbol: '▷' },
  { id: 'profile', label: 'Profile', icon: User, symbol: '◉' }
];
