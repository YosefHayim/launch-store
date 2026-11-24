// Game Center achievements, leaderboards, and detail.

import type { components } from './apple-api-types.ts';

/** Apple's leaderboard score formatters */
export const LEADERBOARD_FORMATTERS = [
  'INTEGER',
  'DECIMAL_POINT_1_PLACE',
  'DECIMAL_POINT_2_PLACE',
  'DECIMAL_POINT_3_PLACE',
  'ELAPSED_TIME_CENTISECOND',
  'ELAPSED_TIME_MINUTE',
  'ELAPSED_TIME_SECOND',
  'MONEY_POUND_DECIMAL',
  'MONEY_POUND',
  'MONEY_DOLLAR_DECIMAL',
  'MONEY_DOLLAR',
  'MONEY_EURO_DECIMAL',
  'MONEY_EURO',
  'MONEY_FRANC_DECIMAL',
  'MONEY_FRANC',
  'MONEY_KRONER_DECIMAL',
  'MONEY_KRONER',
  'MONEY_YEN',
] as const satisfies readonly components['schemas']['GameCenterLeaderboardFormatter'][];

/** One of Apple's leaderboard score formatters. */
export type LeaderboardFormatter = components['schemas']['GameCenterLeaderboardFormatter'];

/** How a leaderboard score is aggregated and sorted */
export const LEADERBOARD_SUBMISSION_TYPES = ['BEST_SCORE', 'MOST_RECENT_SCORE'] as const;

type LeaderboardSubmissionType = (typeof LEADERBOARD_SUBMISSION_TYPES)[number];

export const LEADERBOARD_SORT_TYPES = ['ASC', 'DESC'] as const;

type LeaderboardSortType = (typeof LEADERBOARD_SORT_TYPES)[number];

/** An app's Game Center configuration container (read-only attributes; created to enable Game Center). */
export type GameCenterDetailResource = Readonly<{
  id: string;
}>;

/** A Game Center achievement, identified for config matching by its developer-chosen `vendorIdentifier`. */
export type GameCenterAchievementResource = Readonly<{
  id: string;
  vendorIdentifier?: string;
}>;

/** A Game Center leaderboard, identified for config matching by its developer-chosen `vendorIdentifier`. */
export type GameCenterLeaderboardResource = Readonly<{
  id: string;
  vendorIdentifier?: string;
}>;

/** Attributes for creating a Game Center achievement (mirrors Apple's `GameCenterAchievementV2CreateRequest`). */
export type GameCenterAchievementCreate = Readonly<{
  referenceName: string;
  vendorIdentifier: string;
  points: number;
  showBeforeEarned: boolean;
  repeatable: boolean;
}>;

/** Attributes for creating a Game Center leaderboard (mirrors Apple's `GameCenterLeaderboardV2CreateRequest`). */
export type GameCenterLeaderboardCreate = Readonly<{
  referenceName: string;
  vendorIdentifier: string;
  defaultFormatter: LeaderboardFormatter;
  submissionType: LeaderboardSubmissionType;
  scoreSortType: LeaderboardSortType;
}>;
