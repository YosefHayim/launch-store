// A Google Play review and the developer reply.

export type PlayReview = Readonly<{
  reviewId: string;
  authorName?: string;
  rating: number;
  text?: string;
  reviewerLanguage?: string;
  device?: string;
  appVersionName?: string;
  lastModified?: string;
  answered: boolean;
  developerReply?: string;
}>;

export type PlayReplyResult = Readonly<{ replyText: string; lastEdited?: string }>;
